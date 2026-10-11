/*
 * Generates the two sample payloads the dashboard can load without
 * a live backend (demo/wait.json and demo/ready.json).
 *
 *   node frontend/scripts/make-demo.mjs
 *
 * Candles are synthetic: one 5-minute series is aggregated up to
 * 15M, 1H and 4H so every timeframe agrees on price. The analysis
 * itself is the real backend engine output.
 *
 * demo/ready.json is the same analysis with the final decision
 * forced to BUY_READY, so the "signal fired" layout can be previewed.
 * Its `demoNote` says so, and the dashboard shows that note.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { analyzeMultiTimeframe } from "../../backend/src/services/multiTimeframeAnalyzer.js";
import { generateTradeLevels } from "../../backend/src/services/setupEngine.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "demo");

const END_TIME = Date.UTC(2026, 9, 10, 19, 40);
const STEP_5M = 5 * 60 * 1000;

function rng(seed) {
    let s = seed >>> 0;
    return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

function gaussian(r) {
    return (r() + r() + r() + r() - 2) * 1.7;
}

// 5-minute base series with slow trends and volatility clusters.
function baseSeries(seed, count, start = 67000) {
    const r = rng(seed);
    const out = [];
    let price = start;

    for (let i = 0; i < count; i++) {
        const trend =
            Math.sin(i / 900 + seed) * 0.00018 +
            Math.sin(i / 210 + seed * 2) * 0.00028;

        const vol = 0.0011 * (1 + 1.4 * Math.abs(Math.sin(i / 140 + seed)));

        const open = price;
        const close = open * (1 + trend + gaussian(r) * vol);
        const wick = () => Math.abs(gaussian(r)) * vol * open * 0.6;

        out.push({
            time: END_TIME - (count - 1 - i) * STEP_5M,
            open,
            high: Math.max(open, close) + wick(),
            low: Math.min(open, close) - wick(),
            close,
            volume: 20 + r() * 60 * (1 + Math.abs(close - open) / open * 800)
        });

        price = close;
    }

    return out;
}

function aggregate(series, factor) {
    const out = [];
    const usable = series.length - (series.length % factor);
    const from = series.length - usable;

    for (let i = from; i < series.length; i += factor) {
        const group = series.slice(i, i + factor);

        out.push({
            time: group[0].time,
            open: group[0].open,
            high: Math.max(...group.map(c => c.high)),
            low: Math.min(...group.map(c => c.low)),
            close: group[group.length - 1].close,
            volume: group.reduce((sum, c) => sum + c.volume, 0)
        });
    }

    return out;
}

function build(seed) {
    const raw = baseSeries(seed, 200 * 48);

    // Scale so every sample ends near the same, realistic price.
    const factor = 67000 / raw[raw.length - 1].close;

    const base = raw.map(c => ({
        time: c.time,
        open: c.open * factor,
        high: c.high * factor,
        low: c.low * factor,
        close: c.close * factor,
        volume: c.volume
    }));

    return {
        candles5M: base.slice(-200),
        candles15M: aggregate(base, 3).slice(-200),
        candles1H: aggregate(base, 12).slice(-200),
        candles4H: aggregate(base, 48).slice(-200)
    };
}

function round(value) {
    return Math.round(value * 100) / 100;
}

// Search for seeds that show interesting, different states.
let waiting = null;
let almost = null;

for (let seed = 1; seed <= 400 && !(waiting && almost); seed++) {
    const candles = build(seed);
    const result = analyzeMultiTimeframe(candles);
    const decision = result.multiTimeframeDecision;
    const bias = decision.higherTimeframeBias;

    if (bias === "NEUTRAL") continue;

    if (!almost && (decision.state === "WAITING_FOR_RETEST" || decision.state === "WAITING_FOR_CONFIRMATION")) {
        almost = { seed, candles, result };
    }

    if (!waiting && decision.state === "WAITING_FOR_SETUP") {
        waiting = { seed, candles, result };
    }
}

const chosen = waiting || almost;
const preview = almost || waiting;

if (!chosen || !preview) {
    throw new Error("No suitable demo seed found");
}

function envelope(result, extra = {}) {
    return {
        success: true,
        market: "crypto",
        symbol: "BTCUSDT",
        sample: true,
        analysis: result,
        ...extra
    };
}

// 1. Real engine output.
writeFileSync(
    join(outDir, "wait.json"),
    JSON.stringify(envelope(chosen.result, {
        demoNote: "Sample data: synthetic candles analysed by the real engine."
    }))
);

// 2. Same engine, decision forced to the ready state.
const forced = structuredClone(preview.result);
const bias = forced.multiTimeframeDecision.higherTimeframeBias;
const isBuy = bias === "BULLISH";

forced.multiTimeframeDecision = {
    ...forced.multiTimeframeDecision,
    state: isBuy ? "BUY_READY" : "SELL_READY",
    direction: bias,
    setupDirection: bias,
    entryDirection: bias,
    retestStatus: "CONFIRMED",
    confidence: 14,
    reasons: [
        `4H and 1H both support ${bias} direction`,
        `15M ${bias} setup aligns with higher-timeframe bias`,
        `5M ${bias} confirmation aligns with 15M setup`,
        `5M ${bias} active event confirmed`,
        `5M ${bias} OB/FVG retest confirmed`,
        `5M ${bias} entry aligns with higher-timeframe bias`
    ]
};

forced.finalSignal = isBuy ? "BUY" : "SELL";
forced.status = isBuy ? "BUY_READY" : "SELL_READY";
forced.bias = { fourHour: bias, oneHour: bias };
forced.setup = { fifteenMinute: isBuy ? "BUY" : "SELL" };
forced.entry = { fiveMinute: isBuy ? "BUY" : "SELL" };

forced.tradeSetup = generateTradeLevels({
    decision: forced.multiTimeframeDecision,
    fifteenMinute: forced.timeframes["15M"],
    fiveMinute: forced.timeframes["5M"]
});

writeFileSync(
    join(outDir, "ready.json"),
    JSON.stringify(envelope(forced, {
        demoNote: "Sample preview: the final decision is forced to the ready state to show the layout. It is not a real signal."
    }))
);

const brief = r => ({
    state: r.multiTimeframeDecision.state,
    bias: r.multiTimeframeDecision.higherTimeframeBias,
    price5M: round(r.timeframes["5M"].price)
});

console.log("wait.json ", { seed: chosen.seed, ...brief(chosen.result) });
console.log("ready.json", { seed: preview.seed, ...brief(forced), levels: forced.tradeSetup });
