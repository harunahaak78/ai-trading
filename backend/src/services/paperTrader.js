/*
 * ==========================================================
 * PAPER TRADER (demo account)
 * ==========================================================
 *
 * Pure logic, no network and no files, so it can be tested.
 * The runner (paperRunner.js) feeds it signals and candles and
 * saves the account.
 *
 * Rules:
 *  - Starts with a demo balance (default 1000, in USD).
 *  - Risks a fixed share of the balance per trade (default 1%),
 *    sized from the distance between entry and stop.
 *  - Position size is capped so the notional never exceeds
 *    balance x maxLeverage.
 *  - At TP1 (2R) half the position is closed and the stop moves
 *    to the entry price. The rest runs to TP2 (3R) or the stop.
 *  - If one candle touches both the stop and a target, the stop
 *    is assumed to have been hit first (the cautious choice).
 *  - No fees, spread or slippage are simulated.
 *  - The candle an entry was taken on is only checked at its
 *    close, because its earlier prices came before the entry.
 *  - Forex P&L is converted to USD for pairs that include USD.
 *    Crosses such as EUR/GBP are not traded.
 */

export const DEFAULTS = {
    startingBalance: 1000,
    riskPct: 0.01,
    maxLeverage: 5,
    maxOpenTrades: 3,
    tp1CloseShare: 0.5,
    cooldownMs: 60 * 60 * 1000
};

export function newAccount(options = {}) {
    const settings = { ...DEFAULTS, ...options };

    return {
        version: 1,
        createdAt: settings.now ?? Date.now(),
        startingBalance: settings.startingBalance,
        balance: settings.startingBalance,
        peakBalance: settings.startingBalance,
        maxDrawdownPct: 0,
        settings: {
            riskPct: settings.riskPct,
            maxLeverage: settings.maxLeverage,
            maxOpenTrades: settings.maxOpenTrades,
            tp1CloseShare: settings.tp1CloseShare,
            cooldownMs: settings.cooldownMs
        },
        nextId: 1,
        trades: [],
        cooldowns: {}
    };
}

export function symbolKey(market, symbol) {
    return `${market}:${String(symbol).replace("/", "").toUpperCase()}`;
}

// Multiplier that turns a P&L in the quote currency into USD.
// Returns null when the pair can't be converted.
export function quoteToUsd(market, symbol, price) {
    if (market === "crypto") {
        return /USDT$|USDC$|BUSD$|USD$/.test(symbol) ? 1 : null;
    }

    const pair = String(symbol).replace("/", "").toUpperCase();
    if (pair.length !== 6) return null;

    const base = pair.slice(0, 3);
    const quote = pair.slice(3);

    if (quote === "USD") return 1;
    if (base === "USD" && price > 0) return 1 / price;
    return null;
}

const dirSign = direction => (direction === "BUY" ? 1 : -1);

function round(value, places = 2) {
    const f = 10 ** places;
    return Math.round(value * f) / f;
}

export function openTradeCount(account) {
    return account.trades.filter(t => t.status === "OPEN").length;
}

export function findOpenTrade(account, key) {
    return account.trades.find(t => t.status === "OPEN" && t.key === key) || null;
}

/*
 * Open a paper trade from a ready signal.
 * Returns { opened, trade?, reason? }.
 */
export function openTrade(account, signal) {
    const {
        market, symbol, direction, entryType, entry, stop, tp1, tp2,
        candleTime, now = Date.now(), decision = null
    } = signal;

    const key = symbolKey(market, symbol);

    if (direction !== "BUY" && direction !== "SELL") {
        return { opened: false, reason: "Signal is not a BUY or SELL" };
    }

    if (![entry, stop, tp1, tp2].every(Number.isFinite)) {
        return { opened: false, reason: "Missing entry, stop or targets" };
    }

    const sign = dirSign(direction);

    if ((entry - stop) * sign <= 0 || (tp1 - entry) * sign <= 0 || (tp2 - tp1) * sign <= 0) {
        return { opened: false, reason: "Stop and targets are on the wrong side of the entry" };
    }

    if (findOpenTrade(account, key)) {
        return { opened: false, reason: "A trade is already open on this pair" };
    }

    if (openTradeCount(account) >= account.settings.maxOpenTrades) {
        return { opened: false, reason: `Already ${account.settings.maxOpenTrades} trades open` };
    }

    const coolUntil = account.cooldowns[key] || 0;
    if (now < coolUntil) {
        return { opened: false, reason: "Cooling down after the last trade on this pair" };
    }

    const conv = quoteToUsd(market, symbol, entry);
    if (conv == null) {
        return { opened: false, reason: `${symbol} can't be converted to USD for the demo account` };
    }

    const riskUsdTarget = account.balance * account.settings.riskPct;
    const riskPerUnit = Math.abs(entry - stop) * conv;

    let units = riskUsdTarget / riskPerUnit;

    const maxNotional = account.balance * account.settings.maxLeverage;
    const notional = units * entry * conv;
    let capped = false;

    if (notional > maxNotional) {
        units = maxNotional / (entry * conv);
        capped = true;
    }

    if (!(units > 0) || !Number.isFinite(units)) {
        return { opened: false, reason: "Position size could not be calculated" };
    }

    const trade = {
        id: account.nextId++,
        key,
        market,
        symbol,
        status: "OPEN",
        direction,
        entryType: entryType || null,
        openedAt: now,
        entryCandleTime: candleTime ?? null,
        lastCandleTime: candleTime ?? null,
        entry,
        stop,
        initialStop: stop,
        tp1,
        tp2,
        units,
        unitsOpen: units,
        stage: 1,
        notionalUsd: round(units * entry * conv),
        riskUsd: round(units * riskPerUnit),
        sizeCapped: capped,
        exits: [],
        pnlUsd: 0,
        lastPrice: entry,
        // What the system saw when it entered, for the journal.
        context: decision
            ? {
                state: decision.state,
                bias: decision.higherTimeframeBias,
                reasons: Array.isArray(decision.reasons) ? decision.reasons.slice(0, 12) : [],
                zone: decision.higherTimeframeZone || null
            }
            : null
    };

    account.trades.push(trade);

    return { opened: true, trade };
}

function closeUnits(account, trade, units, price, reason, time) {
    const conv = quoteToUsd(trade.market, trade.symbol, price) ?? 0;
    const pnl = (price - trade.entry) * dirSign(trade.direction) * units * conv;

    trade.exits.push({
        time,
        price,
        units,
        reason,
        pnlUsd: round(pnl)
    });

    trade.unitsOpen = Math.max(0, trade.unitsOpen - units);
    trade.pnlUsd = round(trade.exits.reduce((s, e) => s + e.pnlUsd, 0));
    account.balance = round(account.balance + pnl);

    if (account.balance > account.peakBalance) {
        account.peakBalance = account.balance;
    }

    const dd = ((account.peakBalance - account.balance) / account.peakBalance) * 100;
    if (dd > account.maxDrawdownPct) account.maxDrawdownPct = round(dd);
}

function finish(account, trade, time) {
    trade.status = "CLOSED";
    trade.closedAt = time;
    trade.balanceAfter = account.balance;
    trade.rMultiple = trade.riskUsd > 0 ? round(trade.pnlUsd / trade.riskUsd) : 0;
    trade.outcome =
        Math.abs(trade.pnlUsd) < 0.005 ? "BREAKEVEN"
        : trade.pnlUsd > 0 ? "WIN"
        : "LOSS";

    const last = trade.exits[trade.exits.length - 1];
    trade.closeReason = last ? last.reason : null;

    account.cooldowns[trade.key] = time + account.settings.cooldownMs;
}

/*
 * Check the open trade on one pair against its latest 5M candles.
 * Returns the trades that closed (fully) during this call.
 */
export function updateTrades(account, key, candles, now = Date.now()) {
    const closed = [];
    if (!Array.isArray(candles) || candles.length === 0) return closed;

    const lastIndex = candles.length - 1;

    for (const trade of account.trades) {
        if (trade.status !== "OPEN" || trade.key !== key) continue;

        const sign = dirSign(trade.direction);

        for (let i = 0; i <= lastIndex && trade.status === "OPEN"; i++) {
            const c = candles[i];
            if (trade.lastCandleTime != null && c.time < trade.lastCandleTime) continue;

            // The entry candle: only its close is known to be after the entry.
            const isEntryCandle = c.time === trade.entryCandleTime;
            const high = isEntryCandle ? c.close : c.high;
            const low = isEntryCandle ? c.close : c.low;

            const worst = sign === 1 ? low : high;   // toward the stop
            const best = sign === 1 ? high : low;    // toward the targets

            const stopTouched = (trade.stop - worst) * sign >= 0;

            if (stopTouched) {
                closeUnits(
                    account, trade, trade.unitsOpen, trade.stop,
                    trade.stage === 1 ? "STOP_LOSS" : "BREAKEVEN_STOP", c.time
                );
                finish(account, trade, now);
                closed.push(trade);
                break;
            }

            if (trade.stage === 1 && (best - trade.tp1) * sign >= 0) {
                const share = account.settings.tp1CloseShare;
                closeUnits(account, trade, trade.units * share, trade.tp1, "TP1", c.time);
                trade.stage = 2;
                trade.stop = trade.entry;

                // Same candle: price may also have come back to the entry.
                // The order is unknown, so assume it did.
                const backToEntry = (trade.entry - worst) * sign >= 0;
                if (backToEntry && !isEntryCandle) {
                    closeUnits(account, trade, trade.unitsOpen, trade.entry, "BREAKEVEN_STOP", c.time);
                    finish(account, trade, now);
                    closed.push(trade);
                    break;
                }
            }

            if (trade.stage === 2 && (best - trade.tp2) * sign >= 0) {
                closeUnits(account, trade, trade.unitsOpen, trade.tp2, "TP2", c.time);
                finish(account, trade, now);
                closed.push(trade);
                break;
            }

            trade.lastCandleTime = c.time;
        }

        if (trade.status === "OPEN") {
            trade.lastPrice = candles[lastIndex].close;
        }
    }

    return closed;
}

/*
 * Numbers for the dashboard header.
 */
export function summarize(account) {
    const closed = account.trades.filter(t => t.status === "CLOSED");
    const open = account.trades.filter(t => t.status === "OPEN");

    const unrealized = open.reduce((sum, t) => {
        const conv = quoteToUsd(t.market, t.symbol, t.lastPrice) ?? 0;
        return sum + (t.lastPrice - t.entry) * dirSign(t.direction) * t.unitsOpen * conv;
    }, 0);

    const wins = closed.filter(t => t.outcome === "WIN").length;
    const losses = closed.filter(t => t.outcome === "LOSS").length;
    const realized = closed.reduce((s, t) => s + t.pnlUsd, 0);
    const openRealized = open.reduce((s, t) => s + t.pnlUsd, 0);

    return {
        startingBalance: account.startingBalance,
        balance: round(account.balance),
        equity: round(account.balance + unrealized),
        unrealizedPnl: round(unrealized),
        realizedPnl: round(realized + openRealized),
        returnPct: round(((account.balance + unrealized - account.startingBalance) / account.startingBalance) * 100),
        trades: closed.length,
        open: open.length,
        wins,
        losses,
        breakeven: closed.length - wins - losses,
        winRatePct: closed.length ? round((wins / closed.length) * 100, 1) : null,
        avgR: closed.length ? round(closed.reduce((s, t) => s + t.rMultiple, 0) / closed.length) : null,
        maxDrawdownPct: round(account.maxDrawdownPct)
    };
}
