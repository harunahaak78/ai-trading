import { loadAnalysis, loadCandles, loadConfig } from "./api.js";
import { esc, formatClock, setPriceMarket } from "./format.js";
import { createLiveChart } from "./liveChart.js";
import { createLiveFeed, TIMEFRAMES as FEED_TIMEFRAMES } from "./live.js";
import { buildOverlays } from "./overlays.js";
import { createPaperPanel } from "./paper.js";

import {
    TIMEFRAMES,
    renderLoading,
    renderError,
    renderSampleNote,
    renderDecision,
    renderLadder,
    renderChartSection,
    renderCandleTable,
    renderCompare,
    renderPairs
} from "./views.js";

const params = new URLSearchParams(location.search);

const view = document.getElementById("view");
const statusEl = document.getElementById("status");
const form = document.getElementById("controls");
const marketInput = document.getElementById("market");
const symbolInput = document.getElementById("symbol");
const sourceInput = document.getElementById("source");
const pauseInput = document.getElementById("pause");
const pairsEl = document.getElementById("pairs");
const symbolList = document.getElementById("symbols");

/* ---------- defaults, used until the backend sends its own ---------- */

const DEFAULT_PAIRS = {
    crypto: ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"],
    forex: [
        "EUR/USD", "USD/CAD", "AUD/USD", "GBP/USD", "USD/JPY",
        "NZD/USD", "USD/CHF", "EUR/GBP", "EUR/JPY", "GBP/JPY"
    ]
};

const DEFAULT_LIVE = {
    crypto: { liveMs: 2_000, analysisMs: 30_000 },
    forex: { liveMs: 15_000, analysisMs: 120_000 }
};

const FIRST_PAIR = { crypto: "BTCUSDT", forex: "EUR/USD" };

/* ---------- saved preferences ---------- */

function read(key, fallback) {
    try {
        return localStorage.getItem(`ait.${key}`) ?? fallback;
    } catch {
        return fallback;
    }
}

function write(key, value) {
    try {
        localStorage.setItem(`ait.${key}`, value);
    } catch {
        // Storage can be blocked. The dashboard works without it.
    }
}

/* ---------- symbols ---------- */

// "eurusd", "EUR-USD" -> "EUR/USD". Crypto symbols are only upper-cased.
function cleanSymbol(market, raw) {
    const text = String(raw ?? "").trim().toUpperCase();

    if (market === "forex") {
        const letters = text.replace(/[^A-Z]/g, "");

        return letters.length === 6
            ? `${letters.slice(0, 3)}/${letters.slice(3)}`
            : text;
    }

    return text;
}

function validSymbol(market, text) {
    return market === "forex"
        ? /^[A-Z]{3}\/[A-Z]{3}$/.test(text)
        : /^[A-Z0-9]{5,15}$/.test(text);
}

/* ---------- state ---------- */

const validTimeframes = TIMEFRAMES.map(tf => tf.id);

const initialMarket = ["crypto", "forex"].includes(params.get("market"))
    ? params.get("market")
    : read("market", "crypto") === "forex" ? "forex" : "crypto";

const state = {
    market: initialMarket,

    symbols: {
        crypto: cleanSymbol("crypto", read("symbol.crypto", read("symbol", FIRST_PAIR.crypto))),
        forex: cleanSymbol("forex", read("symbol.forex", FIRST_PAIR.forex))
    },

    source: params.get("source") || read("source", "live"),
    timeframe: params.get("tf") || read("tf", "15M"),
    showTable: params.get("table") === "1",
    snap: read("snap", "1") !== "0",
    paused: read("pause", "0") === "1",

    config: null,

    data: null,
    error: null,
    loading: false,
    updatedAt: null,

    live: { state: "idle" }
};

if (params.get("symbol")) {
    state.symbols[state.market] = cleanSymbol(state.market, params.get("symbol"));
}

if (!["live", "wait", "ready"].includes(state.source)) state.source = "live";
if (!validTimeframes.includes(state.timeframe)) state.timeframe = "15M";

const symbol = () => state.symbols[state.market];

const pairsFor = market => state.config?.pairs?.[market] || DEFAULT_PAIRS[market];

const liveConfig = market => ({
    ...DEFAULT_LIVE[market],
    ...(state.config?.live?.[market] || {})
});

/* ---------- page skeleton (built once) ---------- */

view.innerHTML =
    `<div id="notices"></div>` +
    `<div class="hero" id="hero"></div>` +
    `<div id="chart-slot" hidden>` +
    renderChartSection({
        timeframe: state.timeframe,
        showTable: state.showTable,
        snap: state.snap,
        tool: "cursor"
    }) +
    `</div>` +
    `<div id="compare-slot"></div>` +
    `<section class="paper panel" id="paper-slot" aria-labelledby="paper-h"></section>`;

const noticesEl = document.getElementById("notices");
const heroEl = document.getElementById("hero");
const chartSlot = document.getElementById("chart-slot");
const compareSlot = document.getElementById("compare-slot");
const paperSlot = document.getElementById("paper-slot");

// The simulated $1,000 account that trades the system's signals.
const paper = createPaperPanel(paperSlot, {
    getCurrent: () =>
        state.source === "live" && state.data?.symbol
            ? { market: state.data.market, symbol: state.data.symbol }
            : null
});
const chartHost = document.getElementById("chart-host");
const tableSlot = document.getElementById("table-slot");
const pillEl = document.getElementById("live-pill");
const pillText = document.getElementById("live-text");

/* ---------- chart and live feed ---------- */

const seriesCache = new Map();

let chartContext = null;

const chart = createLiveChart(chartHost, {
    onTool: updateTools,
    onSelection: updateTools,
    onDrawings: updateTools,

    async loadOlder({ beforeTime }) {
        if (!chartContext || state.source !== "live") return [];

        const result = await loadCandles({
            market: chartContext.market,
            symbol: chartContext.symbol,
            tf: chartContext.tf,
            limit: 300,
            before: beforeTime
        });

        return result.candles;
    }
});

chart.setSnap(state.snap);

let feedKey = "";

const feed = createLiveFeed({
    fetchCandles: loadCandles,

    onCandles(candles, target) {
        if (`${target.market}|${target.symbol}|${target.tf}` !== feedKey) return;

        if (chart.mergeIn(candles) && state.showTable) updateTable();
    },

    onStatus(status) {
        state.live = status;
        renderPill();
    }
});

const cacheKey = ctx => `${ctx.market}|${ctx.symbol}|${ctx.tf}`;

function dataMarket() {
    return state.data?.market || (state.source === "live" ? state.market : "crypto");
}

function currentContext() {
    const tf = state.timeframe;

    return {
        market: dataMarket(),
        symbol: state.data?.symbol || symbol(),
        tf,
        intervalMs: FEED_TIMEFRAMES[tf].ms
    };
}

/*
 * Make the chart show the right pair and timeframe, add the candles the
 * analysis came with, and draw its zones and levels. Safe to call on every
 * refresh: when the chart already shows this series, it only adds what it
 * is missing and keeps its zoom, position and drawings.
 */
function syncChart() {
    if (!state.data) return;

    const analysis = state.data.analysis;
    const ctx = currentContext();

    chartContext = ctx;

    const sent = analysis.chart?.[ctx.tf];
    const analysed = sent?.candles || [];

    if (!chart.matches(ctx)) {
        chart.setContext(ctx);

        const cached = seriesCache.get(cacheKey(ctx));

        chart.setCandles(cached?.length ? cached : analysed);

        if (cached?.length) chart.mergeIn(analysed, { addOnly: true });

        if (chart.getCandles().length === 0) {
            chart.setMessage(`The backend did not send candles for ${ctx.tf}.`);
        }
    } else {
        chart.mergeIn(analysed, { addOnly: true });
    }

    chart.setOverlays(
        buildOverlays({
            analysis: analysis.timeframes?.[ctx.tf],
            tradeSetup: analysis.tradeSetup,
            chart: sent,
            intervalMs: ctx.intervalMs,
            timeframe: ctx.tf
        })
    );

    updateTable();
    startFeed(ctx);
    updateTools();
}

function startFeed(ctx) {
    if (state.source !== "live" || state.paused) {
        feed.stop();
        feedKey = "";
        renderPill();
        return;
    }

    const key = cacheKey(ctx);

    // Already polling this series. Restarting would only add requests.
    if (key === feedKey && feed.active) return;

    feedKey = key;

    feed.start({
        market: ctx.market,
        symbol: ctx.symbol,
        tf: ctx.tf,
        baseMs: liveConfig(ctx.market).liveMs,
        getLastTime: () => chart.lastTime()
    });
}

/* ---------- loading the analysis ---------- */

let controller = null;
let analysisTimer = 0;
let loadId = 0;
let failures = 0;
let retryAfterMs = 0;
let analysisDue = false;

async function load() {
    if (controller) controller.abort();

    controller = new AbortController();

    const mine = ++loadId;

    state.loading = true;
    renderStatus();

    if (!state.data) renderHero();

    try {
        const data = await loadAnalysis({
            source: state.source,
            market: state.market,
            symbol: symbol(),
            signal: controller.signal
        });

        if (mine !== loadId) return;

        state.data = data;
        state.error = null;
        state.updatedAt = Date.now();

        failures = 0;
        retryAfterMs = 0;
    } catch (error) {
        if (error.name === "AbortError" || mine !== loadId) return;

        state.error = error.message;

        failures++;
        retryAfterMs = error.retryAfterMs || 0;
    }

    state.loading = false;

    render();
    scheduleAnalysis();
}

// The analysis (signal, gates, zones) refreshes on its own, slower than the candles.
function scheduleAnalysis() {
    clearTimeout(analysisTimer);
    analysisTimer = 0;

    if (state.source !== "live" || state.paused) return;

    const base = liveConfig(state.market).analysisMs;

    let delay = base;

    if (failures > 0) {
        delay = Math.min(300_000, base * 2 ** Math.min(failures, 4));
    }

    delay = Math.max(delay, retryAfterMs);

    analysisTimer = setTimeout(() => {
        if (document.hidden) {
            analysisDue = true;
            return;
        }

        load();
    }, delay);
}

document.addEventListener("visibilitychange", () => {
    if (!document.hidden && analysisDue) {
        analysisDue = false;
        load();
    }
});

/* ---------- rendering ---------- */

function renderStatus() {
    let text = "";

    if (state.loading && !state.data) text = "Loading…";
    else if (state.error && state.updatedAt) text = `Last refresh failed. Showing ${formatClock(state.updatedAt)}.`;
    else if (state.updatedAt) text = `Analysis updated ${formatClock(state.updatedAt)}`;

    statusEl.textContent = text;
}

function renderStale() {
    return (
        `<div class="notice error" role="alert">` +
        `<p><strong>Could not refresh the analysis.</strong> ${esc(state.error)}</p>` +
        `<p>Showing the analysis from ${esc(formatClock(state.updatedAt))}. ` +
        `The chart keeps updating if its feed still works.</p>` +
        `<button type="button" class="btn" data-action="refresh">Try again</button>` +
        `</div>`
    );
}

function renderDelayedNotice() {
    return (
        `<p class="notice">The data provider is limiting requests, so this analysis uses ` +
        `recent data that is a few minutes old.</p>`
    );
}

function renderHero() {
    heroEl.innerHTML = state.error
        ? renderError(state.error, state.market)
        : renderLoading();
}

function renderPairsRow() {
    const pairs = pairsFor(state.market);

    pairsEl.innerHTML = renderPairs(pairs, symbol());

    symbolList.innerHTML = pairs
        .map(pair => `<option value="${esc(pair)}"></option>`)
        .join("");
}

function syncControls() {
    marketInput.value = state.market;
    symbolInput.value = symbol();
    sourceInput.value = state.source;
    pauseInput.checked = state.paused;

    const live = state.source === "live";

    marketInput.disabled = !live;
    symbolInput.disabled = !live;
    pauseInput.disabled = !live;
    pairsEl.hidden = !live;

    symbolInput.maxLength = state.market === "forex" ? 7 : 15;
    symbolInput.placeholder = state.market === "forex" ? "EUR/USD" : "BTCUSDT";

    renderPairsRow();
}

function render() {
    syncControls();
    renderStatus();

    if (!state.data) {
        heroEl.innerHTML = state.error
            ? renderError(state.error, state.market)
            : renderLoading();

        noticesEl.innerHTML = "";
        compareSlot.innerHTML = "";
        chartSlot.hidden = true;

        renderPill();
        return;
    }

    setPriceMarket(dataMarket());

    const analysis = state.data.analysis;

    document.title =
        `${analysis.finalSignal === "BUY" ? "Buy" : analysis.finalSignal === "SELL" ? "Sell" : "Wait"} ` +
        `${state.data.symbol || symbol()} – AI Trading Analyzer`;

    noticesEl.innerHTML =
        (state.error ? renderStale() : "") +
        renderSampleNote(state.data.demoNote) +
        (state.data.stale ? renderDelayedNotice() : "");

    heroEl.innerHTML = renderDecision(state.data) + renderLadder(state.data);
    compareSlot.innerHTML = renderCompare(state.data);

    chartSlot.hidden = false;

    syncChart();
    renderPill();
    paper.render();
}

/* ---------- live status ---------- */

function renderPill() {
    let tone = "idle";
    let text = "Waiting for data";

    const live = state.live || {};

    if (!state.data) {
        tone = state.error ? "error" : "idle";
        text = state.error ? "No data yet" : "Waiting for data";
    } else if (state.source !== "live") {
        tone = "sample";
        text = "Sample data. Not live.";
    } else if (state.paused) {
        tone = "paused";
        text = "Live updates paused";
    } else {
        switch (live.state) {
            case "live":
                tone = "live";
                text = `Live, updated ${formatClock(live.lastTickAt)}`;
                break;

            case "delayed":
                tone = "delayed";
                text = "Delayed. Showing recent data.";
                break;

            case "closed":
                tone = "closed";
                text = "Forex market closed. Checking once a minute.";
                break;

            case "hidden":
                tone = "paused";
                text = "Paused while this tab is hidden";
                break;

            case "error": {
                tone = "error";

                const seconds = Math.max(1, Math.round((live.retryInMs || 0) / 1000));

                text = `Live feed interrupted. Retrying in ${seconds}s. ${live.message || ""}`.trim();
                break;
            }

            default:
                tone = "idle";
                text = "Connecting…";
        }
    }

    pillEl.dataset.state = tone;
    pillText.textContent = text;
}

/* ---------- toolbar ---------- */

function updateTools() {
    for (const button of document.querySelectorAll("[data-tool]")) {
        button.setAttribute("aria-pressed", String(button.dataset.tool === chart.tool));
    }

    const del = document.querySelector('[data-action="delete-line"]');
    const clear = document.querySelector('[data-action="clear-lines"]');

    if (del) del.disabled = !chart.hasSelection;
    if (clear) clear.disabled = chart.drawingCount === 0;
}

function updateTabs() {
    for (const tab of document.querySelectorAll(".tab")) {
        const selected = tab.dataset.tf === state.timeframe;

        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
    }
}

function updateTable() {
    const toggle = document.querySelector('[data-action="toggle-table"]');

    if (toggle) {
        toggle.textContent = `${state.showTable ? "Hide" : "Show"} candle data`;
        toggle.setAttribute("aria-expanded", String(state.showTable));
    }

    tableSlot.innerHTML = state.showTable
        ? renderCandleTable({ timeframe: state.timeframe, candles: chart.getCandles() })
        : "";
}

/* ---------- changing what is shown ---------- */

function selectTimeframe(id, focus) {
    if (id !== state.timeframe) {
        // Keep the live candles, so coming back to this timeframe is instant.
        if (state.data) seriesCache.set(cacheKey(currentContext()), chart.getCandles());

        state.timeframe = id;
        write("tf", id);

        updateTabs();

        if (state.data) syncChart();
    }

    if (focus) {
        document.querySelector(`.tab[data-tf="${id}"]`)?.focus();
    }
}

// A different market or pair: forget everything about the old one.
function startOver() {
    if (controller) controller.abort();

    loadId++;

    clearTimeout(analysisTimer);

    feed.stop();
    feedKey = "";

    seriesCache.clear();

    state.data = null;
    state.error = null;
    state.updatedAt = null;
    state.live = { state: "idle" };

    chartContext = null;

    chart.setCandles([]);
    chart.setMessage("Loading candles…");

    failures = 0;
    retryAfterMs = 0;

    render();
    load();
}

function choosePair(market, pair) {
    state.market = market;
    state.symbols[market] = cleanSymbol(market, pair);

    write("market", market);
    write(`symbol.${market}`, state.symbols[market]);

    startOver();
}

/* ---------- events ---------- */

document.addEventListener("click", event => {
    const tab = event.target.closest(".tab[data-tf]");

    if (tab) {
        selectTimeframe(tab.dataset.tf, false);
        return;
    }

    const tool = event.target.closest("[data-tool]");

    if (tool) {
        chart.setTool(tool.dataset.tool);
        updateTools();
        return;
    }

    const chip = event.target.closest("[data-pair]");

    if (chip) {
        choosePair(state.market, chip.dataset.pair);
        return;
    }

    const action = event.target.closest("[data-action]")?.dataset.action;

    switch (action) {
        case "refresh":
            load();
            break;

        case "toggle-table":
            state.showTable = !state.showTable;
            updateTable();
            break;

        case "zoom-in":
            chart.zoom(0.8);
            break;

        case "zoom-out":
            chart.zoom(1.25);
            break;

        case "reset-view":
            chart.resetView();
            break;

        case "delete-line":
            chart.deleteSelected();
            break;

        case "clear-lines":
            if (window.confirm(`Remove all ${chart.drawingCount} lines you drew on ${chartContext?.symbol || "this pair"}?`)) {
                chart.clearDrawings();
            }
            break;

        default:
    }
});

document.addEventListener("change", event => {
    if (event.target.id === "snap") {
        state.snap = event.target.checked;
        write("snap", state.snap ? "1" : "0");
        chart.setSnap(state.snap);
    }
});

document.addEventListener("keydown", event => {
    const tab = event.target.closest?.(".tab");

    if (!tab || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;

    event.preventDefault();

    const index = validTimeframes.indexOf(tab.dataset.tf);
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = validTimeframes[(index + step + validTimeframes.length) % validTimeframes.length];

    selectTimeframe(next, true);
});

form.addEventListener("submit", event => {
    event.preventDefault();

    if (state.source !== "live") {
        load();
        return;
    }

    const market = marketInput.value === "forex" ? "forex" : "crypto";
    const text = cleanSymbol(market, symbolInput.value);

    if (!validSymbol(market, text)) {
        statusEl.textContent =
            market === "forex"
                ? "Enter a forex pair like EUR/USD."
                : "Enter a crypto symbol like BTCUSDT.";
        return;
    }

    choosePair(market, text);
});

marketInput.addEventListener("change", () => {
    const market = marketInput.value === "forex" ? "forex" : "crypto";

    choosePair(market, state.symbols[market] || FIRST_PAIR[market]);
});

sourceInput.addEventListener("change", () => {
    state.source = sourceInput.value;

    write("source", state.source);

    startOver();
});

pauseInput.addEventListener("change", () => {
    state.paused = pauseInput.checked;

    write("pause", state.paused ? "1" : "0");

    if (state.paused) {
        clearTimeout(analysisTimer);

        feed.stop();
        feedKey = "";

        renderPill();
    } else {
        load();
    }
});

/* ---------- start ---------- */

syncControls();
renderPill();
renderHero();
updateTools();
paper.start();

loadConfig()
    .then(config => {
        state.config = config;
        renderPairsRow();
    })
    .finally(load);
