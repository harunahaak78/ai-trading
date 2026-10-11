/*
 * What the analysis draws on top of the candles: order blocks, fair value
 * gaps, supply and demand zones, the sweep, the break of structure and the
 * trade levels.
 *
 * The analysis refers to candles by index, and those indices only make
 * sense for the candle list it was calculated from. The live chart keeps
 * adding candles, so every overlay is converted to a time here. That keeps
 * it on the right candle however the chart grows or scrolls.
 *
 * Pure functions, no DOM.
 */

import { directionTone } from "./format.js";

/*
 * Time of candle `index` of the analysed list. `chart` is what the backend
 * sent: { offset, candles }, where `offset` is the index of the first
 * candle sent. Indices outside the list are extrapolated.
 */
export function timeOfIndex(chart, intervalMs, index) {
    const candles = chart?.candles || [];
    const offset = chart?.offset || 0;

    if (candles.length === 0 || !Number.isFinite(index)) return null;

    const k = index - offset;

    if (k < 0) return candles[0].time + k * intervalMs;

    if (k >= candles.length) {
        return candles[candles.length - 1].time + (k - candles.length + 1) * intervalMs;
    }

    return candles[k].time;
}

export function currentSequence(analysis) {
    if (analysis?.activeSequence?.active && analysis.activeSequence.sequence) {
        return analysis.activeSequence.sequence;
    }

    if (analysis?.marketSequence?.detected && analysis.marketSequence.sequence) {
        return analysis.marketSequence.sequence;
    }

    return null;
}

function zonesOf(analysis, chart, intervalMs) {
    const zones = [];

    const at = index => timeOfIndex(chart, intervalMs, index ?? 0);

    const ob = analysis?.orderBlock;

    if (ob && ob.type && ob.high != null && ob.low != null) {
        zones.push({
            kind: "ob",
            tone: directionTone(ob.type),
            label: `${ob.type === "BULLISH" ? "Bullish" : "Bearish"} order block`,
            high: ob.high,
            low: ob.low,
            startTime: at(ob.index),
            // The engine says whether price is in the block.
            inside: Boolean(ob.inZone)
        });
    }

    const fvg = analysis?.fairValueGap;

    if (fvg && fvg.type && fvg.top != null && fvg.bottom != null) {
        zones.push({
            kind: "fvg",
            tone: directionTone(fvg.type),
            label: `${fvg.type === "BULLISH" ? "Bullish" : "Bearish"} fair value gap`,
            high: fvg.top,
            low: fvg.bottom,
            startTime: at(fvg.index),
            // The engine gives no flag. The chart works it out from the
            // live candle, so it follows the price as it moves.
            inside: null
        });
    }

    const sd = analysis?.supplyDemand;

    if (sd && sd.detected && sd.zone) {
        zones.push({
            kind: "sd",
            tone: sd.type === "DEMAND" ? "buy" : "sell",
            label: sd.type === "DEMAND" ? "Demand zone" : "Supply zone",
            high: sd.zone.high,
            low: sd.zone.low,
            startTime: at(sd.zone.index),
            inside: Boolean(sd.inZone)
        });
    }

    return zones.filter(zone => zone.startTime != null);
}

function levelsOf(tradeSetup, timeframe) {
    if (
        !tradeSetup ||
        tradeSetup.status !== "READY" ||
        (timeframe !== "5M" && timeframe !== "15M")
    ) {
        return [];
    }

    return [
        { id: "tp2", label: "Target 3R", price: tradeSetup.takeProfit2, dash: "1 4" },
        { id: "tp1", label: "Target 2R", price: tradeSetup.takeProfit1, dash: "1 4" },
        { id: "entry", label: "Entry", price: tradeSetup.entry, dash: "" },
        { id: "stop", label: "Stop", price: tradeSetup.stopLoss, dash: "6 4" }
    ].filter(level => level.price != null);
}

/*
 * Everything the chart overlays for one timeframe.
 *
 *   zones         order block, fair value gap, supply or demand zone
 *   sweep         { type, level, fromTime, time } or null
 *   bos           { direction, level, fromTime, time } or null
 *   displacement  time of the displacement candle, or null
 *   levels        entry, stop and targets, only when a signal is ready
 */
export function buildOverlays({ analysis, tradeSetup, chart, intervalMs, timeframe }) {
    const at = index => timeOfIndex(chart, intervalMs, index);

    const sequence = currentSequence(analysis);

    let sweep = null;

    if (sequence?.sweep && sequence.sweep.level != null) {
        const s = sequence.sweep;

        sweep = {
            type: s.type,
            level: s.level,
            fromTime: at(s.swingIndex ?? s.index),
            time: at(s.index)
        };
    }

    let bos = null;

    const brk = sequence?.structureBreak;

    if (brk && brk.brokenLevel != null) {
        bos = {
            direction: brk.direction,
            level: brk.brokenLevel,
            fromTime: at(brk.referenceSwingIndex ?? brk.index),
            time: at(brk.index)
        };
    }

    return {
        zones: zonesOf(analysis, chart, intervalMs),
        sweep: sweep && sweep.time != null ? sweep : null,
        bos: bos && bos.time != null ? bos : null,
        displacement: sequence?.displacement ? at(sequence.displacement.index) : null,
        levels: levelsOf(tradeSetup, timeframe)
    };
}

export const NO_OVERLAYS = {
    zones: [],
    sweep: null,
    bos: null,
    displacement: null,
    levels: []
};
