/*
 * HTML views. Each function takes data and returns an HTML string.
 * Every piece of text that comes from the API goes through esc().
 */

import {
    esc,
    capitalize,
    humanize,
    directionWord,
    directionTone,
    directionGlyph,
    formatPrice,
    formatPercent,
    formatDateTime,
    formatVolume
} from "./format.js";

import { buildGates, describeState, MAX_CONFIDENCE } from "./gates.js";

export const TIMEFRAMES = [
    { id: "4H", role: "Bias" },
    { id: "1H", role: "Bias check" },
    { id: "15M", role: "Setup" },
    { id: "5M", role: "Entry" }
];

/* ---------- small pieces ---------- */

function direction(value) {
    const word = directionWord(value);

    return (
        `<span class="dir ${directionTone(value)}">` +
        `<span aria-hidden="true">${directionGlyph(value)}</span> ${capitalize(word)}</span>`
    );
}

/* ---------- states without data ---------- */

export function renderLoading() {
    return `<p class="notice" role="status">Loading analysis…</p>`;
}

export function renderError(message) {
    return (
        `<div class="notice error" role="alert">` +
        `<p><strong>Could not load the analysis.</strong></p>` +
        `<p>${esc(message)}</p>` +
        `<p>Check that the backend is running (<code>npm start</code> in <code>backend/</code>) ` +
        `and that it can reach Binance. You can also switch the data source to a sample.</p>` +
        `<button type="button" class="btn" data-action="refresh">Try again</button>` +
        `</div>`
    );
}

export function renderSampleNote(note) {
    return note ? `<p class="sample-note">${esc(note)}</p>` : "";
}

/* ---------- decision ---------- */

export function renderDecision(data) {
    const analysis = data.analysis;
    const decision = analysis.multiTimeframeDecision || {};
    const { tone } = buildGates(decision);

    const word =
        analysis.finalSignal === "BUY" ? "Buy"
            : analysis.finalSignal === "SELL" ? "Sell"
                : "Wait";

    const confidence = Math.max(0, Math.min(MAX_CONFIDENCE, decision.confidence || 0));
    const percent = Math.round((confidence / MAX_CONFIDENCE) * 100);

    const reasons = (decision.reasons || [])
        .map(reason => `<li>${esc(reason)}</li>`)
        .join("");

    return (
        `<section class="panel decision tone-${tone}" aria-labelledby="decision-title">` +
        `<h2 id="decision-title" class="label">Signal for ${esc(data.symbol || "")}</h2>` +
        `<p class="signal-word">${word}</p>` +
        `<p class="signal-sentence">${esc(describeState(decision))}</p>` +
        `<div class="meter" role="img" aria-label="Confidence ${confidence} out of ${MAX_CONFIDENCE}">` +
        `<span style="width:${percent}%"></span></div>` +
        `<p class="meter-text">Confidence ${confidence} of ${MAX_CONFIDENCE}. ` +
        `Each gate passed adds points.</p>` +
        `<h3 class="label">Why</h3>` +
        `<ul class="reasons">${reasons || "<li>No reasons reported.</li>"}</ul>` +
        renderLevels(analysis.tradeSetup) +
        `</section>`
    );
}

function renderLevels(setup) {
    if (!setup || setup.status !== "READY") {
        return (
            `<h3 class="label">Trade levels</h3>` +
            `<p class="empty">No levels yet. Entry, stop and targets appear once the signal is Buy or Sell.</p>`
        );
    }

    const entry = setup.entry;

    const distance = price =>
        formatPercent(((price - entry) / entry) * 100);

    const rows = [
        ["Entry", formatPrice(entry), ""],
        ["Stop", formatPrice(setup.stopLoss), distance(setup.stopLoss)],
        ["Target 2R", formatPrice(setup.takeProfit1), distance(setup.takeProfit1)],
        ["Target 3R", formatPrice(setup.takeProfit2), distance(setup.takeProfit2)]
    ];

    return (
        `<h3 class="label">Trade levels</h3>` +
        `<table class="levels"><tbody>` +
        rows.map(([name, price, change]) =>
            `<tr><th scope="row">${name}</th><td>${price}</td><td class="muted">${change}</td></tr>`
        ).join("") +
        `</tbody></table>` +
        `<p class="fine">The stop uses the 15M demand or supply zone when it sits on the correct side of entry, ` +
        `otherwise 0.5% from entry. Targets are 2 and 3 times the risk.</p>`
    );
}

/* ---------- gate ladder ---------- */

const STATUS_TEXT = {
    passed: "Passed",
    blocked: "Blocked here",
    pending: "Not reached"
};

export function renderLadder(data) {
    const decision = data.analysis.multiTimeframeDecision || {};
    const { gates, tone } = buildGates(decision);

    const items = gates.map((gate, index) => {
        const mark = gate.status === "passed" ? "✓" : String(index + 1);

        return (
            `<li class="gate is-${gate.status}">` +
            `<span class="gate-mark" aria-hidden="true">${mark}</span>` +
            `<div class="gate-body">` +
            `<div class="gate-head">` +
            `<span class="gate-name">${esc(gate.name)}</span>` +
            (gate.timeframe ? `<span class="gate-tf">${esc(gate.timeframe)}</span>` : "") +
            `<span class="gate-status">${STATUS_TEXT[gate.status]}</span>` +
            `</div>` +
            `<p class="gate-detail">${esc(gate.detail)}</p>` +
            `</div>` +
            `</li>`
        );
    });

    return (
        `<section class="panel ladder tone-${tone}" aria-labelledby="ladder-title">` +
        `<h2 id="ladder-title" class="label">Gates</h2>` +
        `<p class="ladder-note">A signal is issued only when all five gates pass, in this order.</p>` +
        `<ol class="gates">${items.join("")}</ol>` +
        `</section>`
    );
}

/* ---------- chart section ---------- */

export function renderChartSection(state) {
    const tabs = TIMEFRAMES.map(tf => {
        const selected = tf.id === state.timeframe;

        return (
            `<button type="button" role="tab" class="tab" data-tf="${tf.id}" ` +
            `aria-selected="${selected}" tabindex="${selected ? 0 : -1}">` +
            `<span class="tab-id">${tf.id}</span><span class="tab-role">${tf.role}</span></button>`
        );
    }).join("");

    return (
        `<section class="chart-section" aria-labelledby="chart-title">` +
        `<div class="chart-head">` +
        `<h2 id="chart-title" class="label">Chart</h2>` +
        `<div class="tabs" role="tablist" aria-label="Timeframe">${tabs}</div>` +
        `</div>` +
        `<div class="chart" id="chart-host"></div>` +
        renderLegend() +
        `<button type="button" class="link-btn" data-action="toggle-table" aria-expanded="${state.showTable}">` +
        `${state.showTable ? "Hide" : "Show"} candle data</button>` +
        (state.showTable ? renderCandleTable(state) : "") +
        `</section>`
    );
}

function renderLegend() {
    const swatch = cls => `<svg class="swatch ${cls}" viewBox="0 0 18 12" aria-hidden="true"></svg>`;

    return (
        `<ul class="legend" aria-label="Chart key">` +
        `<li>${swatch("sw-up")} Bullish candle</li>` +
        `<li>${swatch("sw-down")} Bearish candle</li>` +
        `<li>${swatch("sw-ob")} Order block</li>` +
        `<li>${swatch("sw-fvg")} Fair value gap</li>` +
        `<li>${swatch("sw-sd")} Supply or demand zone</li>` +
        `</ul>`
    );
}

function renderCandleTable(state) {
    const chart = state.data?.analysis?.chart?.[state.timeframe];
    const candles = (chart?.candles || []).slice(-30).reverse();

    if (!candles.length) {
        return `<p class="empty">No candles to show.</p>`;
    }

    const rows = candles.map(c =>
        `<tr><th scope="row">${esc(formatDateTime(c.time))}</th>` +
        `<td>${esc(formatPrice(c.open))}</td><td>${esc(formatPrice(c.high))}</td>` +
        `<td>${esc(formatPrice(c.low))}</td><td>${esc(formatPrice(c.close))}</td>` +
        `<td>${esc(formatVolume(c.volume))}</td></tr>`
    ).join("");

    return (
        `<div class="table-scroll"><table class="data">` +
        `<caption>Latest 30 ${esc(state.timeframe)} candles, newest first</caption>` +
        `<thead><tr><th scope="col">Time</th><th scope="col">Open</th><th scope="col">High</th>` +
        `<th scope="col">Low</th><th scope="col">Close</th><th scope="col">Volume</th></tr></thead>` +
        `<tbody>${rows}</tbody></table></div>`
    );
}

/* ---------- timeframe comparison ---------- */

const SEQUENCE_TEXT = {
    ACTIVE: "Active",
    CONFIRMED: "Confirmed",
    FORMING: "Forming",
    NONE: "None"
};

const SETUP_TEXT = {
    CONFIRMED: "Confirmed",
    FORMING: "Forming",
    PARTIAL: "Partial",
    NO_SETUP: "None",
    STALE: "Stale",
    INVALIDATED: "Invalidated"
};

const RETEST_TEXT = {
    RETEST_CONFIRMED: "Confirmed",
    RETEST_ACTIVE: "In one zone",
    WAITING_FOR_RETEST: "Waiting",
    NO_RETEST: "None",
    NO_RETEST_ZONE: "No zone",
    INVALIDATED_BY_STRUCTURE_REVERSAL: "Invalidated",
    SEQUENCE_STALE: "Stale"
};

function structureText(analysis) {
    const value = analysis?.marketStructure?.structure;

    if (!value || value === "UNKNOWN") return "Unknown";
    if (value === "RANGING") return "Ranging";

    return direction(value);
}

function lastEventText(analysis, chart) {
    const event = analysis?.marketStructure?.lastStructureEvent;

    if (!event) return "None";

    const lastIndex = (chart?.offset || 0) + (chart?.candles?.length || 0) - 1;
    const ago = lastIndex - event.brokenIndex;

    return (
        `${esc(event.event)} ${esc(directionWord(event.direction))}` +
        `<span class="muted">, ${ago} ${ago === 1 ? "bar" : "bars"} ago</span>`
    );
}

function sequenceText(analysis, state) {
    const label = esc(SEQUENCE_TEXT[state] || humanize(state));

    if (state === "ACTIVE" && analysis?.activeSequence?.ageBars != null) {
        return `${label}<span class="muted">, ${analysis.activeSequence.ageBars} bars old</span>`;
    }

    return label;
}

function setupText(analysis) {
    const setup = analysis?.setupConfirmation;

    if (!setup) return "–";

    const label = esc(SETUP_TEXT[setup.status] || humanize(setup.status));

    if (!setup.direction) return label;

    return (
        `${label} ${esc(directionWord(setup.direction))}` +
        `<span class="muted">, ${setup.score} of 6</span>`
    );
}

function indicatorText(analysis) {
    const { rsi, ema20, ema50 } = analysis?.indicators || {};

    const parts = [];

    parts.push(rsi == null ? "RSI –" : `RSI ${rsi.toFixed(1)}`);

    if (ema20 != null && ema50 != null) {
        parts.push(ema20 > ema50 ? "EMA 20 above 50" : "EMA 20 below 50");
    }

    return parts.join("<br>");
}

export function renderCompare(data) {
    const analysis = data.analysis;
    const decision = analysis.multiTimeframeDecision || {};

    const columns = TIMEFRAMES.map(tf => ({
        ...tf,
        a: analysis.timeframes?.[tf.id],
        d: decision.timeframes?.[tf.id] || {},
        chart: analysis.chart?.[tf.id]
    }));

    const head = columns.map(col =>
        `<th scope="col"><span class="col-id">${col.id}</span><span class="col-role">${col.role}</span></th>`
    ).join("");

    const row = (name, cell) =>
        `<tr><th scope="row">${name}</th>${columns.map(col => `<td>${cell(col)}</td>`).join("")}</tr>`;

    return (
        `<section class="compare" aria-labelledby="compare-title">` +
        `<h2 id="compare-title" class="label">Timeframes side by side</h2>` +
        `<div class="table-scroll"><table class="matrix">` +
        `<thead><tr><td></td>${head}</tr></thead><tbody>` +
        row("Direction used", col => direction(col.d.direction)) +
        row("Market structure", col => structureText(col.a)) +
        row("Last structure event", col => lastEventText(col.a, col.chart)) +
        row("Sequence", col => sequenceText(col.a, col.d.sequence)) +
        row("Active event", col => esc(humanize(col.d.activeEvent))) +
        row("Setup confirmation", col => setupText(col.a)) +
        row("Order block and FVG retest", col => esc(RETEST_TEXT[col.a?.obFvgRetest?.status] || humanize(col.a?.obFvgRetest?.status))) +
        row("Indicators", col => indicatorText(col.a)) +
        `</tbody></table></div>` +
        `</section>`
    );
}
