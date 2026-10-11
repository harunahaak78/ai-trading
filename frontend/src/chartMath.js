/*
 * Chart maths. Pure functions, no DOM, so they can be tested alone.
 *
 * Two coordinate systems are used:
 *
 *   u      a position along the candles. Candle k covers u from k to
 *          k + 1, and its centre is k + 0.5. u can be below 0 or above
 *          the number of candles, which is how lines can be drawn into
 *          the empty space to the right of the latest candle.
 *
 *   time   milliseconds. Drawings are stored as (time, price), so they
 *          stay in place when candles are added and also show up on
 *          every timeframe.
 *
 * The view is { right, count }: `count` candles are visible and `right`
 * is the u at the right edge. The left edge is right - count.
 */

export const MIN_VISIBLE = 10;

export function clamp(value, low, high) {
    return Math.min(high, Math.max(low, value));
}

/* ---------- time <-> u ---------- */

export function timeToU(candles, intervalMs, time) {
    const n = candles.length;

    if (n === 0) return 0;

    if (time <= candles[0].time) {
        return (time - candles[0].time) / intervalMs;
    }

    const last = candles[n - 1];

    if (time >= last.time) {
        return n - 1 + (time - last.time) / intervalMs;
    }

    // Largest index whose candle opened at or before `time`.
    let low = 0;
    let high = n - 1;

    while (low < high) {
        const mid = (low + high + 1) >> 1;

        if (candles[mid].time <= time) low = mid;
        else high = mid - 1;
    }

    // Inside a gap (a weekend, say) the position stops at the next candle.
    return low + Math.min(1, (time - candles[low].time) / intervalMs);
}

export function uToTime(candles, intervalMs, u) {
    const n = candles.length;

    if (n === 0) return 0;

    if (u < 0) {
        return candles[0].time + u * intervalMs;
    }

    if (u >= n) {
        return candles[n - 1].time + (u - (n - 1)) * intervalMs;
    }

    const index = Math.floor(u);

    return candles[index].time + (u - index) * intervalMs;
}

/* ---------- view ---------- */

export function maxCount(n) {
    return Math.max(30, n);
}

export function clampView(view, n) {
    const count = clamp(view.count, MIN_VISIBLE, maxCount(n));

    // Leave at most 10% empty on the left and half a screen on the right.
    const right = clamp(view.right, count * 0.9, n + count * 0.5);

    return { right, count };
}

export function defaultView(n, width) {
    const wanted = width < 520 ? 45 : width < 900 ? 70 : 100;
    const count = clamp(wanted, MIN_VISIBLE, maxCount(n));

    return clampView({ right: n + Math.round(count * 0.06) + 2, count }, n);
}

// Zoom by `factor` (below 1 zooms in) keeping the point at
// `anchorFrac` (0 = left edge, 1 = right edge) where it is.
export function zoomAt(view, n, anchorFrac, factor) {
    const start = view.right - view.count;
    const anchorU = start + anchorFrac * view.count;

    const count = clamp(view.count * factor, MIN_VISIBLE, maxCount(n));
    const newStart = anchorU - anchorFrac * count;

    return clampView({ right: newStart + count, count }, n);
}

export function panBy(view, n, candles) {
    return clampView({ right: view.right + candles, count: view.count }, n);
}

// True when the newest candle is on screen at or left of the right edge.
export function isFollowing(view, n) {
    return view.right >= n - 0.001;
}

/* ---------- price scale ---------- */

export function priceRange(candles, start, end) {
    const n = candles.length;

    if (n === 0) return null;

    const from = clamp(Math.floor(start), 0, n - 1);
    const to = clamp(Math.ceil(end) - 1, 0, n - 1);

    let low = Infinity;
    let high = -Infinity;

    for (let i = from; i <= to; i++) {
        if (candles[i].low < low) low = candles[i].low;
        if (candles[i].high > high) high = candles[i].high;
    }

    if (!Number.isFinite(low) || !Number.isFinite(high)) {
        return null;
    }

    return { low, high };
}

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

export function niceTicks(min, max, target) {
    if (!(max > min)) return [];

    const step = niceStep((max - min) / target);
    const ticks = [];

    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
        ticks.push(v);
    }

    return ticks;
}

/* ---------- hit testing ---------- */

export function distanceToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
        return Math.hypot(px - x1, py - y1);
    }

    const t = clamp(((px - x1) * dx + (py - y1) * dy) / lengthSquared, 0, 1);

    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/* ---------- countdown ---------- */

// 754000 -> "12:34", 4_000_000 -> "1:06:40"
export function formatCountdown(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));

    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;

    const two = value => String(value).padStart(2, "0");

    return hours > 0
        ? `${hours}:${two(minutes)}:${two(seconds)}`
        : `${two(minutes)}:${two(seconds)}`;
}
