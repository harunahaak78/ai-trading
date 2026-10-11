/*
 * Interactive live candlestick chart.
 *
 *   zoom      mouse wheel, pinch, the + and - buttons, or the + and - keys
 *   move      drag, or the arrow keys. Double click to reset the view.
 *   draw      trend lines and horizontal lines. Click an existing line to
 *             select it, drag it to move it, drag its ends to change it,
 *             press Delete to remove it.
 *   live      the page feeds new candles in with mergeIn(). The newest
 *             candle keeps moving and a countdown shows when it closes.
 *   history   scrolling back to the first candle asks for older ones.
 *
 * Drawings are stored by time and price (see drawings.js), so they stay on
 * the same candles however the chart moves, and show on every timeframe.
 *
 * The chart owns its candle list, view and drawings. The page tells it what
 * changed (setContext, setCandles, mergeIn, setOverlays) and listens to a
 * few hooks. Nothing here talks to the backend.
 */

import {
    esc,
    formatPrice,
    formatAxisTime,
    formatDateTime,
    formatPercent,
    formatVolume
} from "./format.js";

import { mergeCandles } from "./live.js";

import {
    clamp,
    timeToU,
    uToTime,
    clampView,
    defaultView,
    zoomAt,
    panBy,
    isFollowing,
    priceRange,
    niceTicks,
    distanceToSegment,
    formatCountdown
} from "./chartMath.js";

import {
    loadDrawings,
    saveDrawings,
    drawingsKey,
    newDrawingId
} from "./drawings.js";

import { NO_OVERLAYS } from "./overlays.js";

const MARGIN = { top: 14, right: 84, bottom: 28, left: 8 };

const LINE_HIT = 7;       // pixels from a line that still counts as a click on it
const HANDLE_HIT = 10;    // pixels from a line end that grabs it
const SNAP_PX = 10;       // pixels from a candle price that snaps to it
const MIN_DRAG = 6;       // pixels a drag must travel to finish a line

/*
 * hooks
 *   onTool(tool)           the tool changed (after a line was drawn)
 *   onSelection(selected)  a line was selected or deselected
 *   onDrawings(count)      lines were added or removed
 *   loadOlder({ beforeTime }) -> Promise<candle[]>
 */
export function createLiveChart(host, hooks = {}) {
    const s = {
        ctx: null,
        candles: [],
        view: { right: 0, count: 100 },
        overlays: NO_OVERLAYS,

        drawings: [],
        drawingsKey: null,
        selectedId: null,
        draft: null,

        tool: "cursor",
        snap: true,

        layout: null,
        pointer: null,
        drag: null,
        pointers: new Map(),
        pinch: null,

        older: { loading: false, done: false, retryAt: 0 },
        tickDir: 0,
        message: "Loading candles…"
    };

    let svg = null;
    let mainG = null;
    let draftG = null;
    let crossG = null;
    let tip = null;
    let latestBtn = null;
    let emptyEl = null;

    let builtSize = "";
    let frame = 0;
    let destroyed = false;
    let lastLabel = "";

    /* ---------- small helpers ---------- */

    const ctxKey = () =>
        s.ctx ? `${s.ctx.market}|${s.ctx.symbol}|${s.ctx.tf}` : "";

    const hostWidth = () =>
        Math.max(320, Math.floor(host.clientWidth || 900));

    function requestRender() {
        if (destroyed || frame) return;
        frame = requestAnimationFrame(render);
    }

    function findDrawing(id) {
        return s.drawings.find(d => d.id === id) || null;
    }

    /* ---------- skeleton ---------- */

    function buildSkeleton(width, height) {
        const plotW = width - MARGIN.left - MARGIN.right;
        const plotH = height - MARGIN.top - MARGIN.bottom;

        host.innerHTML =
            `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ` +
            `role="img" tabindex="0">` +
            `<defs>` +
            `<clipPath id="plot-clip"><rect x="${MARGIN.left}" y="${MARGIN.top}" width="${plotW}" height="${plotH}"/></clipPath>` +
            `<pattern id="hatch-buy" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
            `<line class="hatch buy" x1="0" y1="0" x2="0" y2="6"/></pattern>` +
            `<pattern id="hatch-sell" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
            `<line class="hatch sell" x1="0" y1="0" x2="0" y2="6"/></pattern>` +
            `</defs>` +
            `<g class="layer-main"></g>` +
            `<g class="layer-draft" clip-path="url(#plot-clip)"></g>` +
            `<g class="layer-cross" visibility="hidden">` +
            `<line class="cross-v" y1="${MARGIN.top}" y2="${MARGIN.top + plotH}"/>` +
            `<line class="cross-h" x1="${MARGIN.left}" x2="${MARGIN.left + plotW}"/>` +
            `<g class="cross-price"><rect rx="3" height="18" width="${MARGIN.right - 4}"/><text/></g>` +
            `<g class="cross-time"><rect rx="3" height="18" width="112"/><text text-anchor="middle"/></g>` +
            `</g>` +
            `</svg>` +
            `<div class="chart-tip" hidden></div>` +
            `<button type="button" class="chart-latest" hidden>Latest candle</button>` +
            `<p class="chart-empty" hidden></p>`;

        svg = host.querySelector(".chart-svg");
        mainG = svg.querySelector(".layer-main");
        draftG = svg.querySelector(".layer-draft");
        crossG = svg.querySelector(".layer-cross");
        tip = host.querySelector(".chart-tip");
        latestBtn = host.querySelector(".chart-latest");
        emptyEl = host.querySelector(".chart-empty");

        lastLabel = "";
    }

    function ensureSkeleton(width, height) {
        const size = `${width}x${height}`;

        if (!svg || size !== builtSize || !host.contains(svg)) {
            buildSkeleton(width, height);
            builtSize = size;
        }
    }

    /* ---------- render ---------- */

    function render() {
        frame = 0;

        if (destroyed) return;

        const width = hostWidth();
        const height = width < 520 ? 340 : 460;

        ensureSkeleton(width, height);

        const n = s.candles.length;

        host.dataset.candles = String(n);
        host.dataset.tool = s.tool;
        host.dataset.drawings = String(s.drawings.length);

        if (n === 0 || !s.ctx) {
            mainG.innerHTML = "";
            draftG.innerHTML = "";
            hideCross();
            latestBtn.hidden = true;
            emptyEl.textContent = s.message;
            emptyEl.hidden = false;
            s.layout = null;
            return;
        }

        emptyEl.hidden = true;

        const plotLeft = MARGIN.left;
        const plotRight = width - MARGIN.right;
        const plotTop = MARGIN.top;
        const plotBottom = height - MARGIN.bottom;
        const plotW = plotRight - plotLeft;
        const plotH = plotBottom - plotTop;

        const { right, count } = s.view;
        const start = right - count;
        const step = plotW / count;
        const intervalMs = s.ctx.intervalMs;
        const last = s.candles[n - 1];

        const X = u => plotLeft + (u - start) * step;

        /* price range of what is on screen */

        const range = priceRange(s.candles, start, right) || {
            low: last.low,
            high: last.high
        };

        let lo = range.low;
        let hi = range.high;

        const candleRange = hi - lo || Math.abs(hi) * 0.001 || 1;
        const levels = s.overlays.levels;

        if (levels.length) {
            const prices = levels.map(level => level.price);
            const extLo = Math.min(lo, ...prices);
            const extHi = Math.max(hi, ...prices);

            if (extHi - extLo <= candleRange * 2.4) {
                lo = extLo;
                hi = extHi;
            }
        }

        if (!(hi - lo > 0)) {
            const bump = Math.abs(hi) * 0.001 || 1;
            lo -= bump;
            hi += bump;
        }

        const pad = (hi - lo) * 0.07;
        lo -= pad;
        hi += pad;

        const y = price => plotTop + ((hi - price) / (hi - lo)) * plotH;
        const inRange = price => price >= lo && price <= hi;

        s.layout = {
            width, height,
            plotLeft, plotRight, plotTop, plotBottom, plotW, plotH,
            start, step, lo, hi, X, y
        };

        const out = [];

        /* grid and price axis */

        for (const tick of niceTicks(lo, hi, 6)) {
            const ty = y(tick);

            out.push(`<line class="grid" x1="${plotLeft}" x2="${plotRight}" y1="${ty.toFixed(1)}" y2="${ty.toFixed(1)}"/>`);
            out.push(`<text class="axis" x="${plotRight + 8}" y="${(ty + 4).toFixed(1)}">${esc(formatPrice(tick))}</text>`);
        }

        /* time axis, tied to candle numbers so labels do not jump while moving */

        const labelCount = width < 520 ? 3 : width < 760 ? 4 : 6;
        const every = Math.max(1, Math.round(count / labelCount));

        for (let k = Math.ceil(start / every) * every; k < right; k += every) {
            const tx = X(k + 0.5);

            if (tx < plotLeft + 14 || tx > plotRight - 14) continue;

            out.push(`<line class="tick" x1="${tx.toFixed(1)}" x2="${tx.toFixed(1)}" y1="${plotBottom}" y2="${plotBottom + 4}"/>`);
            out.push(
                `<text class="axis axis-x" x="${tx.toFixed(1)}" y="${plotBottom + 18}">` +
                `${esc(formatAxisTime(uToTime(s.candles, intervalMs, k), s.ctx.tf))}</text>`
            );
        }

        /* everything inside the plot is clipped to it */

        out.push(`<g clip-path="url(#plot-clip)">`);

        const labels = [];

        const zones = s.overlays.zones
            .filter(zone => zone.high >= lo && zone.low <= hi)
            .sort((a, b) => ({ sd: 0, ob: 1, fvg: 2 }[a.kind] - { sd: 0, ob: 1, fvg: 2 }[b.kind]));

        for (const zone of zones) {
            const x0 = Math.max(plotLeft, X(timeToU(s.candles, intervalMs, zone.startTime)));

            if (x0 >= plotRight) continue;

            const top = y(Math.min(zone.high, hi));
            const bottom = y(Math.max(zone.low, lo));
            const h = Math.max(1.5, bottom - top);

            const inside = zone.inside ?? (last.low <= zone.high && last.high >= zone.low);
            const fill = zone.kind === "fvg" ? ` fill="url(#hatch-${zone.tone})"` : "";

            out.push(
                `<rect class="zone zone-${zone.kind} ${zone.tone}${inside ? " inside" : ""}" ` +
                `x="${x0.toFixed(1)}" y="${top.toFixed(1)}" width="${(plotRight - x0).toFixed(1)}" height="${h.toFixed(1)}"${fill}/>`
            );

            labels.push({ zone, inside, top, h });
        }

        /* candles */

        const first = Math.max(0, Math.floor(start));
        const lastVisible = Math.min(n - 1, Math.ceil(right) - 1);
        const bodyW = clamp(step * 0.62, 1.5, 18);

        const displacementU = s.overlays.displacement != null
            ? Math.floor(timeToU(s.candles, intervalMs, s.overlays.displacement))
            : null;

        for (let i = first; i <= lastVisible; i++) {
            const c = s.candles[i];
            const up = c.close >= c.open;
            const cx = X(i + 0.5);

            const bodyTop = y(Math.max(c.open, c.close));
            const bodyH = Math.max(1, Math.abs(y(c.open) - y(c.close)));

            out.push(
                `<g class="candle ${up ? "up" : "down"}${displacementU === i ? " displaced" : ""}">` +
                `<line class="wick" x1="${cx.toFixed(1)}" x2="${cx.toFixed(1)}" y1="${y(c.high).toFixed(1)}" y2="${y(c.low).toFixed(1)}"/>` +
                `<rect class="body" x="${(cx - bodyW / 2).toFixed(1)}" y="${bodyTop.toFixed(1)}" width="${bodyW.toFixed(1)}" height="${bodyH.toFixed(1)}"/>` +
                `</g>`
            );
        }

        /* sweep and break of structure */

        const marker = (m, text, above) => {
            if (!m || !inRange(m.level)) return;

            const from = X(timeToU(s.candles, intervalMs, m.fromTime ?? m.time) + 0.5);
            const to = X(timeToU(s.candles, intervalMs, m.time) + 0.5);

            if (to < plotLeft - 40 || from > plotRight) return;

            const my = y(m.level);

            out.push(`<line class="marker-line" x1="${from.toFixed(1)}" x2="${to.toFixed(1)}" y1="${my.toFixed(1)}" y2="${my.toFixed(1)}"/>`);
            out.push(`<text class="marker-label" x="${to.toFixed(1)}" y="${(my + (above ? -7 : 15)).toFixed(1)}" text-anchor="middle">${text}</text>`);
        };

        marker(s.overlays.sweep, "Sweep", s.overlays.sweep?.type === "BUY_SIDE_SWEEP");
        marker(s.overlays.bos, "BOS", s.overlays.bos?.direction === "BULLISH");

        /* trade levels */

        for (const level of levels) {
            if (!inRange(level.price)) continue;

            const ly = y(level.price);

            out.push(
                `<line class="level level-${level.id}" x1="${plotLeft}" x2="${plotRight}" y1="${ly.toFixed(1)}" y2="${ly.toFixed(1)}"` +
                `${level.dash ? ` stroke-dasharray="${level.dash}"` : ""}/>`
            );
        }

        /* lines the user drew */

        const tags = [];

        for (const drawing of s.drawings) {
            const pts = pixelPoints(drawing, s.layout);
            const selected = drawing.id === s.selectedId;

            if (drawing.type === "hline") {
                out.push(
                    `<g class="drawing${selected ? " selected" : ""}">` +
                    `<line class="drawing-line" x1="${plotLeft}" x2="${plotRight}" y1="${pts[0].y.toFixed(1)}" y2="${pts[0].y.toFixed(1)}"/></g>`
                );

                if (pts[0].y > plotTop - 9 && pts[0].y < plotBottom + 9) {
                    tags.push({ y: pts[0].y, price: drawing.points[0].price, selected });
                }
            } else {
                out.push(
                    `<g class="drawing${selected ? " selected" : ""}">` +
                    `<line class="drawing-line" x1="${pts[0].x.toFixed(1)}" y1="${pts[0].y.toFixed(1)}" x2="${pts[1].x.toFixed(1)}" y2="${pts[1].y.toFixed(1)}"/>` +
                    (selected
                        ? pts.map(p => `<circle class="drawing-handle" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5"/>`).join("")
                        : "") +
                    `</g>`
                );
            }
        }

        out.push(`</g>`);

        /* price tags of horizontal lines sit on the axis */

        for (const tag of tags) {
            out.push(
                `<rect class="drawing-tag${tag.selected ? " selected" : ""}" x="${plotRight + 2}" y="${(tag.y - 9).toFixed(1)}" width="${MARGIN.right - 4}" height="18" rx="3"/>` +
                `<text class="drawing-tag-text" x="${plotRight + 8}" y="${(tag.y + 4).toFixed(1)}">${esc(formatPrice(tag.price))}</text>`
            );
        }

        /* zone labels, stacked so they do not overlap */

        const usedY = [];

        for (const { zone, inside, top, h } of labels) {
            let ly = h >= 16 ? top + 12 : top - 4;

            while (usedY.some(used => Math.abs(used - ly) < 12)) {
                ly += 12;
            }

            usedY.push(ly);

            if (ly < plotTop + 8 || ly > plotBottom - 2) continue;

            out.push(
                `<text class="zone-label ${zone.tone}" x="${(plotRight - 6).toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="end">` +
                `${esc(zone.label)}${inside ? " (price inside)" : ""}</text>`
            );
        }

        for (const level of levels) {
            if (!inRange(level.price)) continue;

            out.push(`<text class="level-label" x="${plotRight + 8}" y="${(y(level.price) - 4).toFixed(1)}">${esc(level.label)}</text>`);
        }

        /* latest price, with a countdown to the close of the candle */

        const rawY = y(last.close);
        const onScreen = rawY >= plotTop && rawY <= plotBottom;
        const tagY = clamp(rawY, plotTop + 17, plotBottom - 17);

        const closesIn = last.time + intervalMs - Date.now();
        const counting = closesIn > 0 && closesIn <= intervalMs * 1.01;

        const direction = last.close >= last.open ? "up" : "down";
        const tick = s.tickDir > 0 ? " tick-up" : s.tickDir < 0 ? " tick-down" : "";

        s.tickDir = 0;

        if (onScreen) {
            out.push(`<line class="last-line" x1="${plotLeft}" x2="${plotRight}" y1="${rawY.toFixed(1)}" y2="${rawY.toFixed(1)}"/>`);
        }

        out.push(
            `<rect class="last-tag ${direction}${tick}" x="${plotRight + 2}" y="${(tagY - (counting ? 17 : 9)).toFixed(1)}" ` +
            `width="${MARGIN.right - 4}" height="${counting ? 34 : 18}" rx="3"/>`
        );

        out.push(
            `<text class="last-text" x="${plotRight + 8}" y="${(tagY + (counting ? -3 : 4)).toFixed(1)}">${esc(formatPrice(last.close))}</text>`
        );

        if (counting) {
            out.push(
                `<text class="last-count" x="${plotRight + 8}" y="${(tagY + 11).toFixed(1)}">${formatCountdown(closesIn)}</text>`
            );
        }

        mainG.innerHTML = out.join("");

        renderDraft();

        const label =
            `${s.ctx.symbol} ${s.ctx.tf} candlestick chart. Last price ${formatPrice(last.close)}. ` +
            `Use the arrow keys to move, plus and minus to zoom, and Delete to remove a selected line.`;

        if (label !== lastLabel) {
            svg.setAttribute("aria-label", label);
            lastLabel = label;
        }

        host.dataset.visible = String(Math.round(count));
        host.dataset.following = String(isFollowing(s.view, n));

        latestBtn.hidden = isFollowing(s.view, n);

        if (s.pointer && !s.drag) updateCross();

        maybeLoadOlder(start);
    }

    /* ---------- drawings: geometry ---------- */

    function pixelPoints(drawing, L) {
        return drawing.points.map(point => ({
            x: L.X(timeToU(s.candles, s.ctx.intervalMs, point.time)),
            y: L.y(point.price)
        }));
    }

    // Pixel position -> { time, price }, snapped to the candle when asked.
    function toPoint(p, { snap = s.snap } = {}) {
        const L = s.layout;
        const n = s.candles.length;

        let u = L.start + (p.x - L.plotLeft) / L.step;
        let price = L.hi - ((p.y - L.plotTop) / L.plotH) * (L.hi - L.lo);

        if (snap) {
            const k = Math.floor(u);

            if (k >= 0 && k < n) {
                u = k + 0.5;

                const c = s.candles[k];

                let best = null;

                for (const value of [c.open, c.high, c.low, c.close]) {
                    const d = Math.abs(L.y(value) - p.y);

                    if (d <= SNAP_PX && (best === null || d < best.d)) {
                        best = { value, d };
                    }
                }

                if (best) price = best.value;
            }
        }

        return { time: uToTime(s.candles, s.ctx.intervalMs, u), price };
    }

    function uAt(p) {
        return s.layout.start + (p.x - s.layout.plotLeft) / s.layout.step;
    }

    function priceAt(p) {
        const L = s.layout;
        return L.hi - ((p.y - L.plotTop) / L.plotH) * (L.hi - L.lo);
    }

    // What is under the pointer: { id, part } or null. part is "body" or a point index.
    function hitTest(p) {
        const L = s.layout;

        if (!L) return null;

        const selected = findDrawing(s.selectedId);

        if (selected && selected.type === "trend") {
            const pts = pixelPoints(selected, L);

            for (let i = 0; i < pts.length; i++) {
                if (Math.hypot(p.x - pts[i].x, p.y - pts[i].y) <= HANDLE_HIT) {
                    return { id: selected.id, part: i };
                }
            }
        }

        for (let i = s.drawings.length - 1; i >= 0; i--) {
            const drawing = s.drawings[i];
            const pts = pixelPoints(drawing, L);

            if (drawing.type === "hline") {
                if (
                    Math.abs(p.y - pts[0].y) <= LINE_HIT &&
                    p.x >= L.plotLeft && p.x <= L.plotRight
                ) {
                    return { id: drawing.id, part: "body" };
                }
            } else if (
                distanceToSegment(p.x, p.y, pts[0].x, pts[0].y, pts[1].x, pts[1].y) <= LINE_HIT
            ) {
                return { id: drawing.id, part: "body" };
            }
        }

        return null;
    }

    /* ---------- drawings: state ---------- */

    function persist() {
        if (s.drawingsKey) saveDrawings(s.drawingsKey, s.drawings);

        hooks.onDrawings?.(s.drawings.length);
    }

    function select(id) {
        if (s.selectedId === id) return;

        s.selectedId = id;
        hooks.onSelection?.(Boolean(id));
        requestRender();
    }

    function setTool(tool, notify = false) {
        s.tool = tool;
        s.draft = null;
        s.drag = null;

        if (notify) hooks.onTool?.(tool);

        requestRender();
    }

    function addDrawing(type, points) {
        const drawing = { id: newDrawingId(), type, points };

        s.drawings.push(drawing);
        persist();
        select(drawing.id);
        setTool("cursor", true);
    }

    function renderDraft() {
        if (!draftG) return;

        const L = s.layout;
        const draft = s.draft;

        if (!L || !draft) {
            draftG.innerHTML = "";
            return;
        }

        const a = { x: L.X(timeToU(s.candles, s.ctx.intervalMs, draft.p0.time)), y: L.y(draft.p0.price) };
        const b = { x: L.X(timeToU(s.candles, s.ctx.intervalMs, draft.cur.time)), y: L.y(draft.cur.price) };

        draftG.innerHTML =
            `<line class="drawing-line draft" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>` +
            `<circle class="drawing-handle" cx="${a.x.toFixed(1)}" cy="${a.y.toFixed(1)}" r="5"/>`;
    }

    /* ---------- crosshair and tooltip ---------- */

    function hideCross() {
        crossG?.setAttribute("visibility", "hidden");

        if (tip) tip.hidden = true;
    }

    function updateCross() {
        const L = s.layout;
        const p = s.pointer;

        if (!L || !p || s.pinch) {
            hideCross();
            return;
        }

        if (
            p.x < L.plotLeft || p.x > L.plotRight ||
            p.y < L.plotTop || p.y > L.plotBottom
        ) {
            hideCross();
            return;
        }

        const n = s.candles.length;
        const u = uAt(p);
        const k = Math.floor(u);
        const inCandles = k >= 0 && k < n;

        // Snap the vertical line to the middle of the candle it is over.
        const cx = inCandles ? L.X(k + 0.5) : p.x;

        crossG.setAttribute("visibility", "visible");

        const v = crossG.querySelector(".cross-v");
        v.setAttribute("x1", cx.toFixed(1));
        v.setAttribute("x2", cx.toFixed(1));

        const h = crossG.querySelector(".cross-h");
        h.setAttribute("y1", p.y.toFixed(1));
        h.setAttribute("y2", p.y.toFixed(1));

        const priceBox = crossG.querySelector(".cross-price");
        const priceRect = priceBox.querySelector("rect");
        const priceText = priceBox.querySelector("text");

        priceRect.setAttribute("x", L.plotRight + 2);
        priceRect.setAttribute("y", (p.y - 9).toFixed(1));
        priceText.setAttribute("x", L.plotRight + 8);
        priceText.setAttribute("y", (p.y + 4).toFixed(1));
        priceText.textContent = formatPrice(priceAt(p));

        const timeBox = crossG.querySelector(".cross-time");
        const timeRect = timeBox.querySelector("rect");
        const timeText = timeBox.querySelector("text");

        const labelX = clamp(cx, L.plotLeft + 56, L.plotRight - 56);

        timeRect.setAttribute("x", (labelX - 56).toFixed(1));
        timeRect.setAttribute("y", L.plotBottom + 4);
        timeText.setAttribute("x", labelX.toFixed(1));
        timeText.setAttribute("y", L.plotBottom + 17);
        timeText.textContent = formatDateTime(uToTime(s.candles, s.ctx.intervalMs, inCandles ? k : u));

        if (inCandles && s.tool === "cursor" && !s.drag) {
            const c = s.candles[k];
            const change = c.open ? ((c.close - c.open) / c.open) * 100 : 0;

            tip.innerHTML =
                `<strong>${esc(formatDateTime(c.time))}</strong>` +
                `<span>Open ${esc(formatPrice(c.open))}</span>` +
                `<span>High ${esc(formatPrice(c.high))}</span>` +
                `<span>Low ${esc(formatPrice(c.low))}</span>` +
                `<span>Close ${esc(formatPrice(c.close))}</span>` +
                `<span>Change ${esc(formatPercent(change))}</span>` +
                (c.volume ? `<span>Volume ${esc(formatVolume(c.volume))}</span>` : "");

            tip.hidden = false;

            const width = host.clientWidth;
            const tipWidth = tip.offsetWidth;
            const flip = cx + 16 + tipWidth > width - MARGIN.right;

            tip.style.left = `${Math.max(4, flip ? cx - 16 - tipWidth : cx + 16)}px`;
        } else {
            tip.hidden = true;
        }
    }

    /* ---------- loading older candles ---------- */

    function maybeLoadOlder(start) {
        if (
            start >= 3 ||
            !hooks.loadOlder ||
            s.older.loading ||
            s.older.done ||
            Date.now() < s.older.retryAt ||
            s.candles.length === 0
        ) {
            return;
        }

        const key = ctxKey();

        s.older.loading = true;

        Promise.resolve(hooks.loadOlder({ beforeTime: s.candles[0].time }))
            .then(list => {
                if (destroyed || key !== ctxKey()) return;

                const changed =
                    Array.isArray(list) && list.length > 0
                        ? mergeIn(list, { addOnly: true })
                        : false;

                if (!changed) s.older.done = true;
            })
            .catch(() => {
                s.older.retryAt = Date.now() + 30_000;
            })
            .finally(() => {
                s.older.loading = false;
            });
    }

    /* ---------- candle list ---------- */

    function setCandles(candles) {
        s.candles = mergeCandles([], candles || []).candles;
        s.view = defaultView(s.candles.length, hostWidth());
        s.older = { loading: false, done: false, retryAt: 0 };
        s.tickDir = 0;

        requestRender();
    }

    /*
     * Add candles. A candle with a time the chart already has replaces it
     * (that is how the forming candle moves), unless addOnly is set.
     * The view keeps its place. If it was showing the newest candle it
     * keeps showing it, and if older candles were added at the left it
     * does not jump.
     */
    function mergeIn(incoming, options = {}) {
        const oldN = s.candles.length;
        const oldFirst = oldN ? s.candles[0].time : null;
        const oldLast = oldN ? s.candles[oldN - 1].time : null;
        const oldClose = oldN ? s.candles[oldN - 1].close : null;

        const following = oldN === 0 ? true : isFollowing(s.view, oldN);

        const result = mergeCandles(s.candles, incoming, options);

        if (!result.changed) return false;

        s.candles = result.candles;

        const n = s.candles.length;

        if (oldN === 0) {
            s.view = defaultView(n, hostWidth());
        } else {
            let prepended = 0;
            let appended = 0;

            for (const c of s.candles) {
                if (c.time < oldFirst) prepended++;
                else if (c.time > oldLast) appended++;
            }

            s.view = clampView(
                {
                    right: s.view.right + prepended + (following ? appended : 0),
                    count: s.view.count
                },
                n
            );
        }

        const newClose = s.candles[n - 1].close;

        if (oldClose != null && newClose !== oldClose) {
            s.tickDir = newClose > oldClose ? 1 : -1;
        }

        requestRender();

        return true;
    }

    /* ---------- view controls ---------- */

    function zoom(factor) {
        const n = s.candles.length;

        if (!n) return;

        // Zoom around the right edge when following, otherwise the middle.
        const anchor = isFollowing(s.view, n) ? 1 : 0.5;

        s.view = zoomAt(s.view, n, anchor, factor);
        requestRender();
    }

    function resetView() {
        s.view = defaultView(s.candles.length, hostWidth());
        requestRender();
    }

    function goLatest() {
        const n = s.candles.length;

        s.view = clampView(
            { right: n + Math.round(s.view.count * 0.06) + 2, count: s.view.count },
            n
        );

        requestRender();
    }

    /* ---------- pointer input ---------- */

    function pos(event) {
        const rect = svg.getBoundingClientRect();
        const scale = s.layout ? s.layout.width / rect.width : 1;

        return {
            x: (event.clientX - rect.left) * scale,
            y: (event.clientY - rect.top) * scale
        };
    }

    const inSvg = event => Boolean(svg && event.target.closest?.(".chart-svg"));

    function onPointerDown(event) {
        if (!inSvg(event) || event.button > 0 || !s.layout) return;

        const p = pos(event);

        s.pointers.set(event.pointerId, p);
        svg.focus({ preventScroll: true });

        if (s.pointers.size === 2) {
            startPinch();
            return;
        }

        if (s.pointers.size > 2) return;

        try {
            svg.setPointerCapture(event.pointerId);
        } catch {
            // Not every environment supports capture. Dragging still works inside the chart.
        }

        s.pointer = p;

        const L = s.layout;
        const inPlot =
            p.x >= L.plotLeft && p.x <= L.plotRight &&
            p.y >= L.plotTop && p.y <= L.plotBottom;

        if (s.tool === "hline" && inPlot) {
            addDrawing("hline", [toPoint(p)]);
            return;
        }

        if (s.tool === "trend" && inPlot) {
            if (s.draft && s.draft.awaiting) {
                finishTrend(toPoint(p));
                return;
            }

            const point = toPoint(p);

            s.draft = { p0: point, cur: point, startPx: p, awaiting: false };
            s.drag = { kind: "draw" };
            host.dataset.drag = "draw";
            renderDraft();
            return;
        }

        // Move tool.
        const hit = hitTest(p);

        if (hit) {
            select(hit.id);

            const drawing = findDrawing(hit.id);

            s.drag = {
                kind: hit.part === "body" ? "move" : "handle",
                id: hit.id,
                index: hit.part,
                startPx: p,
                startU: uAt(p),
                startPrice: priceAt(p),
                original: drawing.points.map(point => ({ ...point })),
                moved: false
            };

            host.dataset.drag = s.drag.kind;
            return;
        }

        select(null);

        s.drag = {
            kind: "pan",
            startPx: p,
            startRight: s.view.right,
            moved: false
        };

        host.dataset.drag = "pan";
        hideCross();
    }

    function onPointerMove(event) {
        if (!svg || !s.layout) return;

        if (!inSvg(event) && !s.drag && s.pointers.size === 0) return;

        const p = pos(event);

        if (s.pointers.has(event.pointerId)) {
            s.pointers.set(event.pointerId, p);
        }

        if (s.pinch) {
            updatePinch();
            return;
        }

        s.pointer = p;

        const d = s.drag;

        if (d) {
            const L = s.layout;

            if (d.kind === "draw") {
                s.draft.cur = toPoint(p);
                renderDraft();
            } else {
                if (Math.hypot(p.x - d.startPx.x, p.y - d.startPx.y) > 3) {
                    d.moved = true;
                }

                if (d.kind === "pan") {
                    s.view = clampView(
                        {
                            right: d.startRight - (p.x - d.startPx.x) / L.step,
                            count: s.view.count
                        },
                        s.candles.length
                    );

                    requestRender();
                } else {
                    const drawing = findDrawing(d.id);

                    if (drawing && d.kind === "handle") {
                        drawing.points[d.index] = toPoint(p);
                    } else if (drawing) {
                        const du = uAt(p) - d.startU;
                        const dp = priceAt(p) - d.startPrice;

                        drawing.points = d.original.map(point => ({
                            time: uToTime(
                                s.candles,
                                s.ctx.intervalMs,
                                timeToU(s.candles, s.ctx.intervalMs, point.time) + du
                            ),
                            price: point.price + dp
                        }));
                    }

                    requestRender();
                }
            }

            return;
        }

        if (s.draft && s.draft.awaiting) {
            s.draft.cur = toPoint(p);
            renderDraft();
        }

        updateCross();
    }

    function onPointerUp(event) {
        s.pointers.delete(event.pointerId);

        if (s.pinch) {
            if (s.pointers.size < 2) s.pinch = null;

            s.drag = null;
            host.dataset.drag = "";
            return;
        }

        const d = s.drag;

        if (!d) return;

        const p = pos(event);

        s.drag = null;
        host.dataset.drag = "";

        try {
            svg.releasePointerCapture(event.pointerId);
        } catch {
            // Already released.
        }

        if (d.kind === "draw" && s.draft) {
            if (Math.hypot(p.x - s.draft.startPx.x, p.y - s.draft.startPx.y) >= MIN_DRAG) {
                finishTrend(toPoint(p));
            } else {
                // A click: wait for the second click.
                s.draft.awaiting = true;
            }

            return;
        }

        if ((d.kind === "move" || d.kind === "handle") && d.moved) {
            persist();
        }

        if (event.pointerType === "touch") {
            s.pointer = null;
            hideCross();
        }
    }

    function onPointerCancel(event) {
        s.pointers.delete(event.pointerId);
        s.pinch = null;

        if (s.drag && (s.drag.kind === "move" || s.drag.kind === "handle") && s.drag.moved) {
            persist();
        }

        s.drag = null;
        host.dataset.drag = "";
    }

    function finishTrend(end) {
        const draft = s.draft;

        s.draft = null;

        if (!draft) return;

        if (draft.p0.time === end.time && draft.p0.price === end.price) {
            renderDraft();
            return;
        }

        addDrawing("trend", [draft.p0, end]);
    }

    function startPinch() {
        const [a, b] = [...s.pointers.values()];
        const L = s.layout;

        s.drag = null;
        s.draft = null;
        host.dataset.drag = "";

        s.pinch = {
            distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
            frac: clamp(((a.x + b.x) / 2 - L.plotLeft) / L.plotW, 0, 1),
            view: { ...s.view }
        };

        hideCross();
    }

    function updatePinch() {
        const [a, b] = [...s.pointers.values()];

        if (!a || !b || !s.pinch) return;

        const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;

        s.view = zoomAt(
            s.pinch.view,
            s.candles.length,
            s.pinch.frac,
            s.pinch.distance / distance
        );

        requestRender();
    }

    function onWheel(event) {
        if (!inSvg(event) || !s.layout) return;

        event.preventDefault();

        const L = s.layout;
        const n = s.candles.length;
        const p = pos(event);

        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
        const dx = event.deltaX * unit;
        const dy = event.deltaY * unit;

        if (event.shiftKey || Math.abs(dx) > Math.abs(dy)) {
            s.view = panBy(s.view, n, (dx || dy) / L.step);
        } else {
            const frac = clamp((p.x - L.plotLeft) / L.plotW, 0, 1);

            s.view = zoomAt(s.view, n, frac, Math.exp(clamp(dy, -120, 120) * 0.0016));
        }

        requestRender();
    }

    function onDoubleClick(event) {
        if (!inSvg(event) || s.tool !== "cursor" || !s.layout) return;

        if (hitTest(pos(event))) return;

        resetView();
    }

    function onKeyDown(event) {
        if (!inSvg(event)) return;

        const n = s.candles.length;

        switch (event.key) {
            case "ArrowLeft":
                s.view = panBy(s.view, n, event.shiftKey ? -20 : -5);
                break;

            case "ArrowRight":
                s.view = panBy(s.view, n, event.shiftKey ? 20 : 5);
                break;

            case "+":
            case "=":
                zoom(0.8);
                break;

            case "-":
            case "_":
                zoom(1.25);
                break;

            case "0":
            case "Home":
                resetView();
                break;

            case "End":
                goLatest();
                break;

            case "Delete":
            case "Backspace":
                if (!s.selectedId) return;
                deleteSelected();
                break;

            case "Escape":
                if (s.draft) s.draft = null;
                else if (s.selectedId) select(null);
                else if (s.tool !== "cursor") setTool("cursor", true);
                break;

            case "t":
            case "T":
                setTool("trend", true);
                break;

            case "h":
            case "H":
                setTool("hline", true);
                break;

            case "m":
            case "M":
                setTool("cursor", true);
                break;

            default:
                return;
        }

        event.preventDefault();
        requestRender();
    }

    function onPointerLeave() {
        if (s.drag) return;

        s.pointer = null;
        hideCross();
    }

    function onClick(event) {
        if (event.target.closest?.(".chart-latest")) {
            goLatest();
        }
    }

    /* ---------- drawings: public actions ---------- */

    function deleteSelected() {
        if (!s.selectedId) return;

        s.drawings = s.drawings.filter(drawing => drawing.id !== s.selectedId);
        s.selectedId = null;

        hooks.onSelection?.(false);
        persist();
        requestRender();
    }

    function clearDrawings() {
        if (s.drawings.length === 0) return;

        s.drawings = [];
        s.selectedId = null;

        hooks.onSelection?.(false);
        persist();
        requestRender();
    }

    /* ---------- wiring ---------- */

    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerup", onPointerUp);
    host.addEventListener("pointercancel", onPointerCancel);
    host.addEventListener("pointerleave", onPointerLeave);
    host.addEventListener("wheel", onWheel, { passive: false });
    host.addEventListener("dblclick", onDoubleClick);
    host.addEventListener("keydown", onKeyDown);
    host.addEventListener("click", onClick);

    let resizeTimer = 0;

    const observer = new ResizeObserver(() => {
        clearTimeout(resizeTimer);

        resizeTimer = setTimeout(() => {
            if (Math.abs(hostWidth() - (s.layout?.width ?? 0)) > 1) requestRender();
        }, 100);
    });

    observer.observe(host);

    // Only the countdown text changes every second, so the chart is not redrawn.
    const countdownTimer = setInterval(() => {
        if (destroyed || document.hidden || !s.ctx || !s.candles.length) return;

        const el = mainG?.querySelector(".last-count");

        if (!el) return;

        const last = s.candles[s.candles.length - 1];
        const closesIn = last.time + s.ctx.intervalMs - Date.now();

        el.textContent = closesIn > 0 ? formatCountdown(closesIn) : "00:00";
    }, 1000);

    /* ---------- public ---------- */

    return {
        /*
         * Which market, pair and timeframe the chart shows. Drawings for
         * the pair are loaded from this browser.
         */
        setContext(ctx) {
            const key = drawingsKey(ctx.market, ctx.symbol);

            if (key !== s.drawingsKey) {
                s.drawingsKey = key;
                s.drawings = loadDrawings(key);
                s.selectedId = null;

                hooks.onSelection?.(false);
                hooks.onDrawings?.(s.drawings.length);
            }

            s.ctx = { ...ctx };
            s.draft = null;
            s.drag = null;
            s.overlays = NO_OVERLAYS;

            requestRender();
        },

        matches(ctx) {
            return (
                s.ctx !== null &&
                s.ctx.market === ctx.market &&
                s.ctx.symbol === ctx.symbol &&
                s.ctx.tf === ctx.tf &&
                s.candles.length > 0
            );
        },

        setCandles,
        mergeIn,

        setOverlays(overlays) {
            s.overlays = overlays || NO_OVERLAYS;
            requestRender();
        },

        setMessage(text) {
            s.message = text;
            requestRender();
        },

        setTool(tool) {
            setTool(tool, false);
        },

        setSnap(value) {
            s.snap = Boolean(value);
        },

        zoom,
        resetView,
        goLatest,
        deleteSelected,
        clearDrawings,

        getCandles: () => s.candles,
        lastTime: () => (s.candles.length ? s.candles[s.candles.length - 1].time : null),
        get tool() { return s.tool; },
        get hasSelection() { return Boolean(s.selectedId); },
        get drawingCount() { return s.drawings.length; },

        redraw: requestRender,

        destroy() {
            destroyed = true;

            cancelAnimationFrame(frame);
            clearInterval(countdownTimer);
            clearTimeout(resizeTimer);
            observer.disconnect();

            host.removeEventListener("pointerdown", onPointerDown);
            host.removeEventListener("pointermove", onPointerMove);
            host.removeEventListener("pointerup", onPointerUp);
            host.removeEventListener("pointercancel", onPointerCancel);
            host.removeEventListener("pointerleave", onPointerLeave);
            host.removeEventListener("wheel", onWheel);
            host.removeEventListener("dblclick", onDoubleClick);
            host.removeEventListener("keydown", onKeyDown);
            host.removeEventListener("click", onClick);
        }
    };
}
