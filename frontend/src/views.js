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

export function renderError(message, market = "crypto") {
    const provider =
        market === "forex"
            ? `that it can reach Twelve Data and that <code>TWELVE_DATA_API_KEY</code> is set in <code>backend/.env</code>`
            : `that it can reach Binance`;

    return (
        `<div class="notice error" role="alert">` +
        `<p><strong>Could not load the analysis.</strong></p>` +
        `<p>${esc(message)}</p>` +
        `<p>Check that the backend is running (<code>npm start</code> in <code>backend/</code>) ` +
        `and ${provider}. You can also switch the data source to a sample.</p>` +
        `<button type="button" class="btn" data-action="refresh">Try again</button>` +
        `</div>`
    );
}

/* ---------- pair chips ---------- */

export function renderPairs(pairs, current) {
    return (pairs || []).map(pair =>
        `<button type="button" class="chip" data-pair="${esc(pair)}" ` +
        `aria-pressed="${pair.replace(/[^A-Z0-9]/gi, "").toUpperCase() === String(current || "").replace(/[^A-Z0-9]/gi, "").toUpperCase()}">` +
        `${esc(pair)}</button>`
    ).join("");
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
        `<p class="fine">${esc(stopExplanation(setup))} Targets are 2 and 3 times the risk.</p>`
    );
}

function stopExplanation(setup) {
    if (setup.stopMethod === "ZONE") {
        return "The stop sits at the far edge of the 15M demand or supply zone.";
    }

    const percent = Number(setup.stopPercent);

    const distance = Number.isFinite(percent)
        ? `${+(percent * 100).toFixed(2)}%`
        : "a fixed distance";

    return (
        `No 15M demand or supply zone sits on the correct side of entry, ` +
        `so the stop is ${distance} from entry.`
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

const TOOLS = [
    { id: "cursor", label: "Move", title: "Drag the chart and select lines (M)" },
    { id: "trend", label: "Trend line", title: "Click two points to draw a line (T)" },
    { id: "hline", label: "Horizontal line", title: "Click a price to draw a line (H)" }
];

/*
 * Built once. After that the page only updates the parts that change
 * (tabs, tool buttons, the live status), so the chart is never rebuilt
 * while it is running.
 */
export function renderChartSection({ timeframe, showTable, snap, tool }) {
    const tabs = TIMEFRAMES.map(tf => {
        const selected = tf.id === timeframe;

        return (
            `<button type="button" role="tab" class="tab" data-tf="${tf.id}" ` +
            `aria-selected="${selected}" tabindex="${selected ? 0 : -1}">` +
            `<span class="tab-id">${tf.id}</span><span class="tab-role">${tf.role}</span></button>`
        );
    }).join("");

    const tools = TOOLS.map(item =>
        `<button type="button" class="tool-btn" data-tool="${item.id}" title="${esc(item.title)}" ` +
        `aria-pressed="${item.id === tool}">${item.label}</button>`
    ).join("");

    return (
        `<section class="chart-section" aria-labelledby="chart-title">` +

        `<div class="chart-head">` +
        `<h2 id="chart-title" class="label">Chart</h2>` +
        `<div class="tabs" role="tablist" aria-label="Timeframe">${tabs}</div>` +
        `</div>` +

        `<div class="chart-tools" role="toolbar" aria-label="Chart tools">` +

        `<div class="tool-group" role="group" aria-label="Draw">` +
        tools +
        `<label class="check small"><input type="checkbox" id="snap"${snap ? " checked" : ""}>` +
        `<span>Snap to candles</span></label>` +
        `</div>` +

        `<div class="tool-group" role="group" aria-label="Lines">` +
        `<button type="button" class="tool-btn" data-action="delete-line" disabled>Delete line</button>` +
        `<button type="button" class="tool-btn" data-action="clear-lines" disabled>Clear all lines</button>` +
        `</div>` +

        `<div class="tool-group" role="group" aria-label="View">` +
        `<button type="button" class="tool-btn icon" data-action="zoom-out" aria-label="Zoom out" title="Zoom out (-)">&minus;</button>` +
        `<button type="button" class="tool-btn icon" data-action="zoom-in" aria-label="Zoom in" title="Zoom in (+)">+</button>` +
        `<button type="button" class="tool-btn" data-action="reset-view" title="Show the latest candles again (0)">Reset view</button>` +
        `</div>` +

        `<p class="live-pill" id="live-pill" role="status" aria-live="polite" data-state="idle">` +
        `<span class="live-dot" aria-hidden="true"></span><span id="live-text">Waiting for data</span></p>` +

        `</div>` +

        `<div class="chart" id="chart-host" tabindex="-1"></div>` +

        `<p class="chart-hint">Scroll to zoom. Drag to move. Double click to reset. ` +
        `Pick a line tool to draw. Lines are saved in this browser.</p>` +

        renderLegend() +

        `<button type="button" class="link-btn" data-action="toggle-table" aria-expanded="${showTable}">` +
        `${showTable ? "Hide" : "Show"} candle data</button>` +
        `<div id="table-slot"></div>` +

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
        `<li>${swatch("sw-line")} Your lines</li>` +
        `</ul>`
    );
}

export function renderCandleTable({ timeframe, candles }) {
    const rows = (candles || []).slice(-30).reverse();

    if (!rows.length) {
        return `<p class="empty">No candles to show.</p>`;
    }

    const body = rows.map(c =>
        `<tr><th scope="row">${esc(formatDateTime(c.time))}</th>` +
        `<td>${esc(formatPrice(c.open))}</td><td>${esc(formatPrice(c.high))}</td>` +
        `<td>${esc(formatPrice(c.low))}</td><td>${esc(formatPrice(c.close))}</td>` +
        `<td>${c.volume ? esc(formatVolume(c.volume)) : "–"}</td></tr>`
    ).join("");

    return (
        `<div class="table-scroll"><table class="data">` +
        `<caption>Latest 30 ${esc(timeframe)} candles, newest first</caption>` +
        `<thead><tr><th scope="col">Time</th><th scope="col">Open</th><th scope="col">High</th>` +
        `<th scope="col">Low</th><th scope="col">Close</th><th scope="col">Volume</th></tr></thead>` +
        `<tbody>${body}</tbody></table></div>`
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
    FIRST_TEST_HELD: "First test held",
    FIRST_TEST_IN_PROGRESS: "Testing now",
    WAITING_FOR_FIRST_TEST: "Waiting",
    FIRST_TEST_PASSED: "Entry passed",
    ALREADY_TESTED: "Already tested",
    ZONE_BROKEN: "Broken",
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
        row("Order block and FVG first test", col => esc(RETEST_TEXT[col.a?.obFvgRetest?.status] || humanize(col.a?.obFvgRetest?.status))) +
        row("Indicators", col => indicatorText(col.a)) +
        `</tbody></table></div>` +
        `</section>`
    );
}
