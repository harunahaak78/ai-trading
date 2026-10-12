/*
 * PAPER TRADER (simulation only)
 *
 * Runs inside the backend, so it keeps trading while no browser is
 * open. For each watched pair it analyses the market, opens a demo
 * trade when the system says BUY or SELL, and follows open trades
 * until they close. State is saved to a file after every change.
 *
 * It never contacts a broker or exchange account. It only reads
 * public prices.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    HttpError,
    getCandles,
    getMultiTimeframeCandles,
    liveSettings,
    normalizeSymbol
} from "../services/marketdata.js";
import { analyzeMultiTimeframe } from "../services/multiTimeframeAnalyzer.js";
import {
    createAccount,
    openTrade,
    updateTrades,
    openTrades,
    summarize,
    floatingPnl
} from "./account.js";

// Replaceable in tests so a signal can be forced without live data.
export const deps = { getMultiTimeframeCandles, getCandles, analyzeMultiTimeframe };

const FIVE_MIN = 5 * 60_000;
const LOG_LIMIT = 300;

const dataFile = () =>
    process.env.PAPER_DATA_FILE ||
    path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../data/paper.json"
    );

// ---------- state ----------

let state = null;          // { account, watchlist, running, log }
const runtime = new Map(); // key -> { timer, lastAnalysisAt, lastPrice, ... }
let saveTimer = null;

const keyOf = (market, symbol) => `${market}:${symbol}`;

function freshState() {
    return {
        account: createAccount(),
        watchlist: [],
        running: true,
        log: []
    };
}

function load() {
    try {
        const parsed = JSON.parse(fs.readFileSync(dataFile(), "utf8"));
        if (parsed?.account && Array.isArray(parsed.watchlist)) {
            parsed.log = Array.isArray(parsed.log) ? parsed.log : [];
            return parsed;
        }
    } catch {
        // No saved file yet, or it cannot be read: start fresh.
    }
    return freshState();
}

function saveNow() {
    try {
        const file = dataFile();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
        fs.renameSync(tmp, file);
    } catch (error) {
        console.error("Paper trader could not save:", error.message);
    }
}

function save() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        saveNow();
    }, 250);
}

// Every journal line is also a change worth saving.
function log(symbol, type, text) {
    state.log.push({ time: Date.now(), symbol, type, text });
    save();
    if (state.log.length > LOG_LIMIT) {
        state.log.splice(0, state.log.length - LOG_LIMIT);
    }
}

// ---------- journal text ----------

const money = n => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(2)}`;

const REASON_TEXT = {
    TAKE_PROFIT_1: "target 1 (2R), half closed, stop moved to entry",
    TAKE_PROFIT_2: "target 2 (3R)",
    STOP_LOSS: "stop loss",
    BREAKEVEN_STOP: "stop at entry after target 1"
};

function logExits(trade) {
    const done = trade.loggedExits || 0;

    for (const exit of trade.exits.slice(done)) {
        log(
            trade.symbol,
            "EXIT",
            `#${trade.id} ${trade.direction} hit ${REASON_TEXT[exit.reason] || exit.reason} at ${exit.price} (${money(exit.pnl)})`
        );
    }

    trade.loggedExits = trade.exits.length;

    if (trade.status === "CLOSED" && !trade.loggedClose) {
        trade.loggedClose = true;
        log(
            trade.symbol,
            "CLOSED",
            `#${trade.id} closed: ${money(trade.pnl)} (${trade.rMultiple}R). Balance $${state.account.balance.toFixed(2)}`
        );
    }
}

// ---------- one pair ----------

function signalFrom(entry, data, analysis) {
    const decision = analysis.multiTimeframeDecision;
    const setup = analysis.tradeSetup;
    const m5 = analysis.timeframes?.["5M"];

    const firstTest = m5?.obFvgRetest?.firstTest;
    const zone = m5?.obFvgRetest?.zone;
    const testTime = data.candles5M[firstTest?.index]?.time ?? "x";

    return {
        market: entry.market,
        symbol: entry.symbol,
        direction: setup.direction,
        entry: setup.entry,
        stop: setup.stopLoss,
        tp1: setup.takeProfit1,
        tp2: setup.takeProfit2,
        entryType: setup.entryType || decision.entryType || null,
        entryKey: [
            setup.direction,
            setup.entryType || "x",
            zone?.low ?? "x",
            zone?.high ?? "x",
            testTime
        ].join("|"),
        state: decision.state,
        confidence: decision.confidence,
        reasons: decision.reasons,
        bias: {
            "4H": decision.timeframes?.["4H"]?.direction,
            "1H": decision.timeframes?.["1H"]?.direction,
            "15M": decision.timeframes?.["15M"]?.direction,
            "5M": decision.timeframes?.["5M"]?.direction
        }
    };
}

async function cycle(entry) {
    const rt = runtime.get(keyOf(entry.market, entry.symbol));
    const live = liveSettings().live[entry.market];
    const now = Date.now();
    const hasOpen = openTrades(state.account, entry.symbol).length > 0;
    const analysisDue = now - (rt.lastAnalysisAt || 0) >= live.analysisMs;

    if (analysisDue) {
        const data = await deps.getMultiTimeframeCandles(entry.market, entry.symbol);
        const analysis = deps.analyzeMultiTimeframe({
            candles4H: data.candles4H,
            candles1H: data.candles1H,
            candles15M: data.candles15M,
            candles5M: data.candles5M,
            market: entry.market
        });

        rt.lastAnalysisAt = Date.now();

        const last = data.candles5M[data.candles5M.length - 1];
        rt.lastPrice = last.close;
        rt.lastCandleAt = last.time;
        rt.signal = analysis.finalSignal;
        rt.status = analysis.status;
        rt.stale = data.stale;

        for (const t of updateTrades(state.account, entry.symbol, data.candles5M, FIVE_MIN)) {
            logExits(t);
        }

        // A closed market or stale data must not open anything.
        const fresh = !data.stale && Date.now() - (last.time + FIVE_MIN) < 3 * FIVE_MIN;

        if (state.running && fresh && analysis.tradeSetup?.status === "READY") {
            const result = openTrade(
                state.account,
                signalFrom(entry, data, analysis)
            );

            if (result.trade) {
                const t = result.trade;
                log(
                    entry.symbol,
                    "ENTRY",
                    `#${t.id} ${t.direction} ${t.entryType === "RETEST" ? "(retest entry) " : ""}at ${t.entry}, stop ${t.stop}, targets ${t.tp1} / ${t.tp2}, risk $${t.riskAmount}`
                );
            } else if (result.skipped !== rt.lastSkip) {
                rt.lastSkip = result.skipped;
                log(entry.symbol, "SKIP", `Signal not traded: ${result.skipped}`);
            }
        }

        return;
    }

    if (hasOpen) {
        const { candles } = await deps.getCandles({
            market: entry.market,
            symbol: entry.symbol,
            interval: "5m",
            limit: 60,
            purpose: "live"
        });

        const last = candles[candles.length - 1];
        rt.lastPrice = last.close;
        rt.lastCandleAt = last.time;

        const changed = updateTrades(state.account, entry.symbol, candles, FIVE_MIN);
        for (const t of changed) logExits(t);
    }
}

function schedule(entry, delay) {
    const rt = runtime.get(keyOf(entry.market, entry.symbol));
    if (!rt || rt.stopped) return;

    rt.timer = setTimeout(async () => {
        const live = liveSettings().live[entry.market];
        let next;

        try {
            await cycle(entry);
            rt.error = null;
            rt.failures = 0;
            next = openTrades(state.account, entry.symbol).length
                ? live.liveMs
                : Math.min(live.analysisMs, live.liveMs * 5);
        } catch (error) {
            rt.failures = (rt.failures || 0) + 1;
            rt.error = error.message;
            next = Math.min(5 * 60_000, live.liveMs * 2 ** rt.failures);
        }

        schedule(entry, next);
    }, delay);

    rt.timer.unref?.();
}

function startPair(entry) {
    const key = keyOf(entry.market, entry.symbol);
    if (runtime.has(key)) return;
    runtime.set(key, { stopped: false });
    schedule(entry, 500);
}

function stopPair(entry) {
    const key = keyOf(entry.market, entry.symbol);
    const rt = runtime.get(key);
    if (rt) {
        rt.stopped = true;
        clearTimeout(rt.timer);
        runtime.delete(key);
    }
}

// ---------- public API ----------

function parsePairs(text) {
    return String(text || "crypto:BTCUSDT")
        .split(",")
        .map(part => part.trim())
        .filter(Boolean)
        .map(part => {
            const [market, symbol] = part.split(":");
            return { market: market.toLowerCase(), symbol };
        });
}

export function startPaperTrader() {
    // PAPER_ENABLED=false turns the paper trader off completely.
    if (process.env.PAPER_ENABLED === "false") {
        console.log("Paper trader is off (PAPER_ENABLED=false)");
        return;
    }

    state = load();

    if (state.watchlist.length === 0) {
        for (const p of parsePairs(process.env.PAPER_PAIRS)) {
            try {
                const { symbol } = normalizeSymbol(p.market, p.symbol);
                state.watchlist.push({ market: p.market, symbol });
            } catch (error) {
                console.error(`PAPER_PAIRS: ${error.message}`);
            }
        }
    }

    if (process.env.PAPER_AUTOSTART === "false") state.running = false;

    // Pairs keep being followed even when new entries are paused, so
    // open trades still reach their stop or target.
    for (const entry of state.watchlist) startPair(entry);

    save();
    console.log(
        `Paper trader: ${state.watchlist.map(e => e.symbol).join(", ") || "no pairs"} ` +
        `(${state.running ? "taking entries" : "paused"}), balance $${state.account.balance.toFixed(2)}`
    );
}

export const isEnabled = () => state !== null;

export function stopPaperTrader() {
    for (const entry of state?.watchlist || []) stopPair(entry);
    clearTimeout(saveTimer);
    saveTimer = null;
    if (state) saveNow();
}

export function setRunning(running) {
    state.running = Boolean(running);
    log("-", "CONTROL", state.running ? "Taking new entries" : "Paused: no new entries, open trades still followed");
    save();
}

export function addPair(market, rawSymbol) {
    const { symbol } = normalizeSymbol(market, rawSymbol);

    if (state.watchlist.some(e => e.market === market && e.symbol === symbol)) {
        return { market, symbol, added: false };
    }

    const entry = { market, symbol };
    state.watchlist.push(entry);
    startPair(entry);
    log(symbol, "CONTROL", `Now watching ${symbol}`);
    save();
    return { market, symbol, added: true };
}

export function removePair(market, rawSymbol) {
    const { symbol } = normalizeSymbol(market, rawSymbol);

    if (openTrades(state.account, symbol).length > 0) {
        throw new HttpError(409, `Close the open ${symbol} trade first. It is still being followed.`);
    }

    const index = state.watchlist.findIndex(e => e.market === market && e.symbol === symbol);
    if (index === -1) return { market, symbol, removed: false };

    stopPair(state.watchlist[index]);
    state.watchlist.splice(index, 1);
    log(symbol, "CONTROL", `Stopped watching ${symbol}`);
    save();
    return { market, symbol, removed: true };
}

export function resetAccount(startingBalance = 1000) {
    const amount = Number(startingBalance);

    if (!(amount >= 10 && amount <= 1_000_000)) {
        throw new HttpError(400, "Starting balance must be between 10 and 1,000,000.");
    }

    state.account = createAccount({ startingBalance: amount });
    state.log = [];
    log("-", "CONTROL", `Account reset to $${amount}`);
    save();
}

export function overview() {
    const prices = {};
    for (const entry of state.watchlist) {
        const rt = runtime.get(keyOf(entry.market, entry.symbol));
        if (rt?.lastPrice != null) prices[entry.symbol] = rt.lastPrice;
    }

    const open = openTrades(state.account).map(t => ({
        ...t,
        lastPrice: prices[t.symbol] ?? null,
        floatingPnl: floatingPnl(t, prices[t.symbol])
    }));

    return {
        running: state.running,
        simulated: true,
        settings: state.account.settings,
        summary: summarize(state.account, prices),
        open,
        watchlist: state.watchlist.map(entry => {
            const rt = runtime.get(keyOf(entry.market, entry.symbol)) || {};
            return {
                ...entry,
                price: rt.lastPrice ?? null,
                signal: rt.signal ?? null,
                status: rt.status ?? null,
                lastAnalysisAt: rt.lastAnalysisAt ?? null,
                stale: Boolean(rt.stale),
                error: rt.error ?? null
            };
        }),
        log: state.log.slice(-40).reverse()
    };
}

export function journal({ limit = 100, status = null } = {}) {
    let trades = [...state.account.trades].reverse();
    if (status) trades = trades.filter(t => t.status === status);
    return trades.slice(0, Math.min(Math.max(Number(limit) || 100, 1), 500));
}
