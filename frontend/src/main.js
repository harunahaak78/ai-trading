import { loadAnalysis } from "./api.js";
import { buildChart, attachChartHover } from "./chart.js";
import { esc, formatClock } from "./format.js";

import {
    TIMEFRAMES,
    renderLoading,
    renderError,
    renderSampleNote,
    renderDecision,
    renderLadder,
    renderChartSection,
    renderCompare
} from "./views.js";

const params = new URLSearchParams(location.search);

const view = document.getElementById("view");
const statusEl = document.getElementById("status");
const form = document.getElementById("controls");
const symbolInput = document.getElementById("symbol");
const sourceInput = document.getElementById("source");
const autoInput = document.getElementById("auto");

const REFRESH_MS = 60_000;

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

/* ---------- state ---------- */

const validTimeframes = TIMEFRAMES.map(tf => tf.id);

const state = {
    symbol: (read("symbol", "BTCUSDT")).toUpperCase(),
    source: params.get("source") || read("source", "live"),
    auto: read("auto", "0") === "1",
    timeframe: params.get("tf") || read("tf", "15M"),
    showTable: params.get("table") === "1",

    data: null,
    error: null,
    loading: false,
    updatedAt: null
};

if (!["live", "wait", "ready"].includes(state.source)) state.source = "live";
if (!validTimeframes.includes(state.timeframe)) state.timeframe = "15M";

let controller = null;
let timer = null;

/* ---------- loading ---------- */

async function load() {
    if (controller) controller.abort();
    controller = new AbortController();

    state.loading = true;
    renderStatus();
    if (!state.data) render();

    try {
        state.data = await loadAnalysis({
            source: state.source,
            symbol: state.symbol,
            signal: controller.signal
        });

        state.error = null;
        state.updatedAt = Date.now();
    } catch (error) {
        if (error.name === "AbortError") return;

        state.error = error.message;
    } finally {
        state.loading = false;
    }

    render();
}

function schedule() {
    clearInterval(timer);
    timer = null;

    if (state.auto && state.source === "live") {
        timer = setInterval(() => {
            if (!document.hidden) load();
        }, REFRESH_MS);
    }
}

/* ---------- rendering ---------- */

function renderStatus() {
    let text = "";

    if (state.loading) text = "Loading…";
    else if (state.error && state.updatedAt) text = `Last refresh failed. Showing ${formatClock(state.updatedAt)}.`;
    else if (state.updatedAt) text = `Updated ${formatClock(state.updatedAt)}`;

    statusEl.textContent = text;
}

function renderStale() {
    return (
        `<div class="notice error" role="alert">` +
        `<p><strong>Could not refresh.</strong> ${esc(state.error)}</p>` +
        `<p>Showing the analysis from ${esc(formatClock(state.updatedAt))}.</p>` +
        `<button type="button" class="btn" data-action="refresh">Try again</button>` +
        `</div>`
    );
}

function render() {
    sourceInput.value = state.source;
    symbolInput.value = state.symbol;
    autoInput.checked = state.auto;

    const live = state.source === "live";
    symbolInput.disabled = !live;
    autoInput.disabled = !live;

    if (!state.data) {
        view.innerHTML = state.error ? renderError(state.error) : renderLoading();
        renderStatus();
        return;
    }

    const analysis = state.data.analysis;

    document.title =
        `${analysis.finalSignal === "BUY" ? "Buy" : analysis.finalSignal === "SELL" ? "Sell" : "Wait"} ` +
        `${state.data.symbol || state.symbol} – AI Trading Analyzer`;

    view.innerHTML =
        (state.error ? renderStale() : "") +
        renderSampleNote(state.data.demoNote) +
        `<div class="hero">${renderDecision(state.data)}${renderLadder(state.data)}</div>` +
        renderChartSection(state) +
        renderCompare(state.data);

    mountChart();
    renderStatus();
}

function mountChart() {
    const host = document.getElementById("chart-host");
    if (!host || !state.data) return;

    const analysis = state.data.analysis;
    const chart = analysis.chart?.[state.timeframe];

    if (!chart || !chart.candles?.length) {
        host.innerHTML = `<p class="empty">The backend did not send candles for ${esc(state.timeframe)}.</p>`;
        return;
    }

    const width = Math.max(320, Math.floor(host.clientWidth || 900));
    const height = width < 520 ? 300 : 400;

    const model = buildChart({
        chart,
        analysis: analysis.timeframes?.[state.timeframe],
        tradeSetup: analysis.tradeSetup,
        timeframe: state.timeframe,
        width,
        height
    });

    host.dataset.width = String(width);
    host.innerHTML = model.svg + `<div class="chart-tip" hidden></div>`;

    attachChartHover(host, model);
}

/* ---------- events ---------- */

function selectTimeframe(id, focus) {
    state.timeframe = id;
    write("tf", id);
    render();

    if (focus) {
        document.querySelector(`.tab[data-tf="${id}"]`)?.focus();
    }
}

document.addEventListener("click", event => {
    const tab = event.target.closest("[data-tf]");

    if (tab) {
        selectTimeframe(tab.dataset.tf, false);
        return;
    }

    const action = event.target.closest("[data-action]")?.dataset.action;

    if (action === "refresh") load();

    if (action === "toggle-table") {
        state.showTable = !state.showTable;
        render();
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

    const symbol = symbolInput.value.trim().toUpperCase();

    if (state.source === "live" && !/^[A-Z0-9]{5,15}$/.test(symbol)) {
        statusEl.textContent = "Enter a symbol like BTCUSDT.";
        return;
    }

    if (state.source === "live") {
        state.symbol = symbol;
        write("symbol", symbol);
    }

    load();
});

sourceInput.addEventListener("change", () => {
    state.source = sourceInput.value;
    state.data = null;
    state.error = null;

    write("source", state.source);
    schedule();
    load();
});

autoInput.addEventListener("change", () => {
    state.auto = autoInput.checked;
    write("auto", state.auto ? "1" : "0");
    schedule();
});

// Redraw the chart when its width changes.
let resizeTimer = null;

new ResizeObserver(() => {
    clearTimeout(resizeTimer);

    resizeTimer = setTimeout(() => {
        const host = document.getElementById("chart-host");

        if (host && Math.abs(host.clientWidth - Number(host.dataset.width || 0)) > 1) {
            mountChart();
        }
    }, 120);
}).observe(view);

/* ---------- start ---------- */

render();
schedule();
load();
