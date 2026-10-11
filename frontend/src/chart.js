/*
 * Candlestick chart, drawn as an SVG string.
 *
 * Colour rules (see styles.css):
 *   blue   = bullish / buy      orange = bearish / sell
 * Bullish candles are hollow and bearish candles are filled, so the
 * direction never depends on colour alone.
 *
 * Zones differ by fill style as well as by label:
 *   order block      tinted fill
 *   fair value gap   hatched fill
 *   supply / demand  dashed outline
 */

import {
    esc,
    formatPrice,
    formatAxisTime,
    formatDateTime,
    formatPercent,
    formatVolume,
    directionTone
} from "./format.js";

const MARGIN = { top: 14, right: 78, bottom: 28, left: 10 };

/* ---------- scales ---------- */

function niceStep(rough) {
    const power = Math.pow(10, Math.floor(Math.log10(rough)));
    const fraction = rough / power;

    let nice = 10;
    if (fraction <= 1) nice = 1;
    else if (fraction <= 2) nice = 2;
    else if (fraction <= 2.5) nice = 2.5;
    else if (fraction <= 5) nice = 5;

    return nice * power;
}

function niceTicks(min, max, target) {
    const step = niceStep((max - min) / target);
    const ticks = [];

    for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
        ticks.push(v);
    }

    return ticks;
}

/* ---------- overlays ---------- */

function collectZones(analysis, lastCandle) {
    const zones = [];

    const overlaps = (low, high) =>
        lastCandle.low <= high && lastCandle.high >= low;

    const ob = analysis?.orderBlock;

    if (ob && ob.type && ob.high != null && ob.low != null) {
        zones.push({
            kind: "ob",
            tone: directionTone(ob.type),
            label: `${ob.type === "BULLISH" ? "Bullish" : "Bearish"} order block`,
            high: ob.high,
            low: ob.low,
            index: ob.index ?? 0,
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
            index: fvg.index ?? 0,
            inside: overlaps(fvg.bottom, fvg.top)
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
            index: sd.zone.index ?? 0,
            inside: Boolean(sd.inZone)
        });
    }

    return zones;
}

function currentSequence(analysis) {
    if (analysis?.activeSequence?.active && analysis.activeSequence.sequence) {
        return analysis.activeSequence.sequence;
    }

    if (analysis?.marketSequence?.detected && analysis.marketSequence.sequence) {
        return analysis.marketSequence.sequence;
    }

    return null;
}

function levelsFor(tradeSetup, timeframe) {
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

/* ---------- main builder ---------- */

export function buildChart({
    chart,
    analysis,
    tradeSetup,
    timeframe,
    width,
    height
}) {
    const candles = chart?.candles || [];
    const offset = chart?.offset || 0;
    const n = candles.length;

    if (n === 0) {
        return { svg: "", candles, width, height, left: 0, step: 1, offset, timeframe };
    }

    const plotLeft = MARGIN.left;
    const plotRight = width - MARGIN.right;
    const plotTop = MARGIN.top;
    const plotBottom = height - MARGIN.bottom;
    const plotW = plotRight - plotLeft;
    const plotH = plotBottom - plotTop;
    const step = plotW / n;
    const bodyW = Math.max(1.5, Math.min(14, step * 0.62));

    const last = candles[n - 1];

    // Price range: candles, plus trade levels when they are not far away.
    let lo = Math.min(...candles.map(c => c.low));
    let hi = Math.max(...candles.map(c => c.high));
    const candleRange = hi - lo || 1;

    const levels = levelsFor(tradeSetup, timeframe);

    if (levels.length) {
        const prices = levels.map(l => l.price);
        const extLo = Math.min(lo, ...prices);
        const extHi = Math.max(hi, ...prices);

        if (extHi - extLo <= candleRange * 2.4) {
            lo = extLo;
            hi = extHi;
        }
    }

    const pad = (hi - lo) * 0.05;
    lo -= pad;
    hi += pad;

    const y = price => plotTop + ((hi - price) / (hi - lo)) * plotH;
    const inRange = price => price >= lo && price <= hi;

    // Global candle index -> x of the candle centre.
    const xc = index => plotLeft + (index - offset + 0.5) * step;
    // Global candle index -> x of the candle's left edge, clamped to the plot.
    const xl = index => plotLeft + Math.max(0, index - offset) * step;

    const out = [];

    out.push(
        `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ` +
        `role="img" tabindex="0" aria-label="${esc(
            `${timeframe} candlestick chart. Last close ${formatPrice(last.close)}. ` +
            `Use the left and right arrow keys to read individual candles.`
        )}">`
    );

    out.push(
        `<defs>` +
        `<clipPath id="plot-clip"><rect x="${plotLeft}" y="${plotTop}" width="${plotW}" height="${plotH}"/></clipPath>` +
        `<pattern id="hatch-buy" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
        `<line class="hatch buy" x1="0" y1="0" x2="0" y2="6"/></pattern>` +
        `<pattern id="hatch-sell" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
        `<line class="hatch sell" x1="0" y1="0" x2="0" y2="6"/></pattern>` +
        `</defs>`
    );

    // Grid and price axis.
    const yTicks = niceTicks(lo, hi, 5);

    for (const tick of yTicks) {
        const ty = y(tick);

        out.push(`<line class="grid" x1="${plotLeft}" x2="${plotRight}" y1="${ty.toFixed(1)}" y2="${ty.toFixed(1)}"/>`);
        out.push(`<text class="axis" x="${plotRight + 8}" y="${(ty + 4).toFixed(1)}">${esc(formatPrice(tick))}</text>`);
    }

    // Time axis.
    const labelCount = width < 520 ? 3 : width < 760 ? 4 : 6;
    const every = Math.max(1, Math.floor(n / labelCount));

    for (let i = Math.floor(every / 2); i < n; i += every) {
        const tx = xc(i + offset);

        out.push(`<line class="tick" x1="${tx.toFixed(1)}" x2="${tx.toFixed(1)}" y1="${plotBottom}" y2="${plotBottom + 4}"/>`);
        out.push(
            `<text class="axis axis-x" x="${tx.toFixed(1)}" y="${plotBottom + 18}">` +
            `${esc(formatAxisTime(candles[i].time, timeframe))}</text>`
        );
    }

    // Clipped content.
    out.push(`<g clip-path="url(#plot-clip)">`);

    // Zones, drawn behind the candles. Supply/demand first, FVG last.
    const zones = collectZones(analysis, last)
        .filter(zone => zone.high >= lo && zone.low <= hi)
        .sort((a, b) => ({ sd: 0, ob: 1, fvg: 2 }[a.kind] - { sd: 0, ob: 1, fvg: 2 }[b.kind]));

    const labels = [];

    for (const zone of zones) {
        const x0 = xl(zone.index);
        const top = y(Math.min(zone.high, hi));
        const bottom = y(Math.max(zone.low, lo));
        const h = Math.max(1.5, bottom - top);

        const fill = zone.kind === "fvg" ? `url(#hatch-${zone.tone})` : "";

        out.push(
            `<rect class="zone zone-${zone.kind} ${zone.tone}${zone.inside ? " inside" : ""}" ` +
            `x="${x0.toFixed(1)}" y="${top.toFixed(1)}" width="${(plotRight - x0).toFixed(1)}" height="${h.toFixed(1)}"` +
            `${fill ? ` fill="${fill}"` : ""}/>`
        );

        labels.push({ zone, top, h });
    }

    // Candles.
    const displacementIndex = currentSequence(analysis)?.displacement?.index;

    for (let i = 0; i < n; i++) {
        const c = candles[i];
        const up = c.close >= c.open;
        const cx = xc(i + offset);

        const bodyTop = y(Math.max(c.open, c.close));
        const bodyH = Math.max(1, Math.abs(y(c.open) - y(c.close)));

        const marked = displacementIndex === i + offset;

        out.push(
            `<g class="candle ${up ? "up" : "down"}${marked ? " displaced" : ""}">` +
            `<line class="wick" x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(c.high).toFixed(1)}" y2="${y(c.low).toFixed(1)}"/>` +
            `<rect class="body" x="${(cx - bodyW / 2).toFixed(1)}" y="${bodyTop.toFixed(1)}" width="${bodyW.toFixed(1)}" height="${bodyH.toFixed(1)}"/>` +
            `</g>`
        );
    }

    // Sweep and structure break from the current sequence.
    const sequence = currentSequence(analysis);

    if (sequence?.sweep && sequence.sweep.index >= offset && inRange(sequence.sweep.level)) {
        const s = sequence.sweep;
        const sy = y(s.level);
        const from = xc(Math.max(s.swingIndex ?? s.index, offset));
        const to = xc(s.index);
        const above = s.type === "BUY_SIDE_SWEEP";

        out.push(`<line class="marker-line" x1="${from.toFixed(1)}" x2="${to.toFixed(1)}" y1="${sy.toFixed(1)}" y2="${sy.toFixed(1)}"/>`);
        out.push(
            `<text class="marker-label" x="${to.toFixed(1)}" y="${(sy + (above ? -7 : 15)).toFixed(1)}" text-anchor="middle">Sweep</text>`
        );
    }

    const brk = sequence?.structureBreak;

    if (brk && brk.index >= offset && brk.brokenLevel != null && inRange(brk.brokenLevel)) {
        const by = y(brk.brokenLevel);
        const from = xc(Math.max(brk.referenceSwingIndex ?? brk.index, offset));
        const to = xc(brk.index);
        const bullish = brk.direction === "BULLISH";

        out.push(`<line class="marker-line" x1="${from.toFixed(1)}" x2="${to.toFixed(1)}" y1="${by.toFixed(1)}" y2="${by.toFixed(1)}"/>`);
        out.push(
            `<text class="marker-label" x="${to.toFixed(1)}" y="${(by + (bullish ? -7 : 15)).toFixed(1)}" text-anchor="middle">BOS</text>`
        );
    }

    // Trade levels.
    for (const level of levels) {
        if (!inRange(level.price)) continue;

        const ly = y(level.price);

        out.push(
            `<line class="level level-${level.id}" x1="${plotLeft}" x2="${plotRight}" y1="${ly.toFixed(1)}" y2="${ly.toFixed(1)}"` +
            `${level.dash ? ` stroke-dasharray="${level.dash}"` : ""}/>`
        );
    }

    out.push(`</g>`);

    // Zone labels (outside the clip so they stay readable), stacked to avoid overlap.
    const usedY = [];

    for (const { zone, top, h } of labels) {
        let ly = h >= 16 ? top + 12 : top - 4;

        while (usedY.some(used => Math.abs(used - ly) < 12)) {
            ly += 12;
        }

        usedY.push(ly);

        if (ly < plotTop + 8 || ly > plotBottom - 2) continue;

        out.push(
            `<text class="zone-label ${zone.tone}" x="${(plotRight - 6).toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="end">` +
            `${esc(zone.label)}${zone.inside ? " (price inside)" : ""}</text>`
        );
    }

    // Level labels on the right axis.
    for (const level of levels) {
        if (!inRange(level.price)) continue;

        out.push(
            `<text class="level-label" x="${plotRight + 8}" y="${(y(level.price) - 4).toFixed(1)}">${esc(level.label)}</text>`
        );
    }

    // Current price tag.
    const cy = y(last.close);

    out.push(`<line class="last-line" x1="${plotLeft}" x2="${plotRight}" y1="${cy.toFixed(1)}" y2="${cy.toFixed(1)}"/>`);
    out.push(`<rect class="last-tag" x="${plotRight + 2}" y="${(cy - 9).toFixed(1)}" width="${MARGIN.right - 4}" height="18" rx="3"/>`);
    out.push(`<text class="last-text" x="${plotRight + 8}" y="${(cy + 4).toFixed(1)}">${esc(formatPrice(last.close))}</text>`);

    // Crosshair, moved by attachChartHover.
    out.push(`<line class="xhair" x1="0" x2="0" y1="${plotTop}" y2="${plotBottom}" visibility="hidden"/>`);

    out.push(`</svg>`);

    return {
        svg: out.join(""),
        candles,
        offset,
        timeframe,
        width,
        height,
        left: plotLeft,
        step,
        plotTop,
        plotBottom
    };
}

/* ---------- hover and keyboard ---------- */

export function attachChartHover(host, model) {
    const svg = host.querySelector(".chart-svg");
    const tip = host.querySelector(".chart-tip");

    if (!svg || !tip || !model.candles.length) return;

    const xhair = svg.querySelector(".xhair");
    let current = null;

    function show(index) {
        const i = Math.max(0, Math.min(model.candles.length - 1, index));
        current = i;

        const c = model.candles[i];
        const x = model.left + (i + 0.5) * model.step;

        xhair.setAttribute("x1", x);
        xhair.setAttribute("x2", x);
        xhair.setAttribute("visibility", "visible");

        const change = ((c.close - c.open) / c.open) * 100;

        tip.innerHTML =
            `<strong>${esc(formatDateTime(c.time))}</strong>` +
            `<span>Open ${esc(formatPrice(c.open))}</span>` +
            `<span>High ${esc(formatPrice(c.high))}</span>` +
            `<span>Low ${esc(formatPrice(c.low))}</span>` +
            `<span>Close ${esc(formatPrice(c.close))}</span>` +
            `<span>Change ${esc(formatPercent(change))}</span>` +
            `<span>Volume ${esc(formatVolume(c.volume))}</span>`;

        tip.hidden = false;

        const hostWidth = host.clientWidth;
        const tipWidth = tip.offsetWidth;
        const flip = x + 16 + tipWidth > hostWidth - MARGIN.right;

        tip.style.left = `${Math.max(4, flip ? x - 16 - tipWidth : x + 16)}px`;
    }

    function hide() {
        current = null;
        xhair.setAttribute("visibility", "hidden");
        tip.hidden = true;
    }

    svg.addEventListener("pointermove", event => {
        const rect = svg.getBoundingClientRect();
        const scale = model.width / rect.width;
        const x = (event.clientX - rect.left) * scale;
        const index = Math.floor((x - model.left) / model.step);

        if (index < 0 || index >= model.candles.length) {
            hide();
            return;
        }

        show(index);
    });

    svg.addEventListener("pointerleave", hide);
    svg.addEventListener("blur", hide);

    svg.addEventListener("keydown", event => {
        if (event.key === "ArrowLeft") {
            event.preventDefault();
            show((current ?? model.candles.length) - 1);
        }

        if (event.key === "ArrowRight") {
            event.preventDefault();
            show((current ?? -1) + 1);
        }

        if (event.key === "Escape") {
            hide();
        }
    });
}
