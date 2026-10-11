import assert from "node:assert/strict";

import {
    timeToU, uToTime, clampView, defaultView, zoomAt, panBy, isFollowing,
    priceRange, niceTicks, distanceToSegment, formatCountdown, MIN_VISIBLE
} from "../src/chartMath.js";

import {
    mergeCandles, isForexClosed, candlesNeeded, pollDelay
} from "../src/live.js";

import { isValidDrawing } from "../src/drawings.js";

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
const eq = (a, b, msg) => { assert.deepEqual(a, b, msg); checks++; };
const near = (a, b, msg, eps = 1e-9) => { assert.ok(Math.abs(a - b) < eps, `${msg}: ${a} vs ${b}`); checks++; };

const M = 300_000; // 5 minutes
const candle = (i, extra = {}) => ({ time: 1_000_000 + i * M, open: 10, high: 12, low: 9, close: 11, volume: 1, ...extra });
const series = n => Array.from({ length: n }, (_, i) => candle(i));

/* ---------- time <-> u ---------- */

{
    const c = series(50);

    near(timeToU(c, M, c[0].time), 0, "first candle open is u=0");
    near(timeToU(c, M, c[10].time), 10, "candle 10 open is u=10");
    near(timeToU(c, M, c[10].time + M / 2), 10.5, "middle of candle 10");
    near(timeToU(c, M, c[49].time + M * 3), 52, "three candles into the future");
    near(timeToU(c, M, c[0].time - M * 2), -2, "two candles before the data");

    for (const t of [c[0].time, c[7].time + 12345, c[30].time + M - 1, c[49].time + 7 * M]) {
        near(uToTime(c, M, timeToU(c, M, t)), t, "round trip", 1e-3);
    }

    near(uToTime(c, M, 10.5), c[10].time + M / 2, "u to time inside the data");
    near(uToTime(c, M, 55), c[49].time + 6 * M, "u to time in the future");
    near(uToTime(c, M, -3), c[0].time - 3 * M, "u to time before the data");

    // A weekend gap: candle 5 is followed by one 2 days later.
    const gap = series(10).map((x, i) => (i > 5 ? { ...x, time: x.time + 2 * 86_400_000 } : x));
    const inGap = gap[5].time + 86_400_000;
    ok(timeToU(gap, M, inGap) <= 6 + 1e-9 && timeToU(gap, M, inGap) >= 5, "time in a gap stays between its neighbours");
    near(timeToU(gap, M, gap[6].time), 6, "candle after the gap");

    eq(timeToU([], M, 5), 0, "empty series");
}

/* ---------- view ---------- */

{
    const n = 200;
    const v = defaultView(n, 1200);

    ok(v.count === 100, "desktop shows 100 candles");
    ok(v.right > n, "a little empty space on the right");
    ok(isFollowing(v, n), "default view follows the latest candle");
    ok(defaultView(n, 390).count === 45, "phone shows fewer candles");
    ok(defaultView(15, 1200).count <= 30, "tiny data set never asks for more than it has");

    // Zoom in keeps the point under the cursor fixed.
    const base = { right: 150, count: 100 };
    const anchorFrac = 0.25;
    const anchorBefore = base.right - base.count + anchorFrac * base.count;
    const zin = zoomAt(base, n, anchorFrac, 0.5);
    near(zin.count, 50, "zoom in halves the count");
    near(zin.right - zin.count + anchorFrac * zin.count, anchorBefore, "anchor point does not move when zooming in");

    const zout = zoomAt(zin, n, 0.8, 2);
    near(zout.count, 100, "zoom out doubles the count");

    ok(zoomAt(base, n, 0.5, 0.0001).count === MIN_VISIBLE, "cannot zoom in past the minimum");
    ok(zoomAt(base, n, 0.5, 1000).count === n, "cannot zoom out past all candles");

    // Pan.
    const p = panBy({ right: 150, count: 100 }, n, -20);
    near(p.right, 130, "pan left");
    ok(panBy({ right: 150, count: 100 }, n, 1e6).right <= n + 50, "cannot pan far into the future");
    ok(panBy({ right: 150, count: 100 }, n, -1e6).right >= 90, "cannot pan far into the past");
    ok(!isFollowing(p, n), "panned away from the latest candle");

    const c = clampView({ right: -50, count: 5 }, n);
    ok(c.count === MIN_VISIBLE && c.right >= 0.9 * c.count, "clampView repairs impossible values");
}

/* ---------- price scale ---------- */

{
    const c = series(20).map((x, i) => ({ ...x, high: 100 + i, low: 90 + i }));

    eq(priceRange(c, 0, 20), { low: 90, high: 119 }, "range over all candles");
    eq(priceRange(c, 5, 8), { low: 95, high: 107 }, "range over a few candles");
    eq(priceRange(c, -50, 3), { low: 90, high: 102 }, "range clamps to the data");
    eq(priceRange(c, 100, 120), { low: 109, high: 119 }, "view fully in the future uses the last candle");
    eq(priceRange([], 0, 5), null, "no candles, no range");

    const ticks = niceTicks(82400, 83200, 5);
    ok(ticks.length >= 3 && ticks.every(t => t >= 82400 && t <= 83200), "ticks are inside the range");
    ok(new Set(ticks.map(t => t % 50)).size === 1, "ticks are round numbers");
    const fx = niceTicks(1.0815, 1.0845, 5);
    ok(fx.length >= 3 && fx.every(t => t >= 1.0815 && t <= 1.0845), "forex-sized ticks");
    eq(niceTicks(5, 5, 5), [], "flat range has no ticks");
}

/* ---------- hit testing and countdown ---------- */

{
    near(distanceToSegment(5, 5, 0, 0, 10, 0), 5, "distance to a horizontal segment");
    near(distanceToSegment(-3, 0, 0, 0, 10, 0), 3, "distance beyond the end uses the end point");
    near(distanceToSegment(3, 4, 0, 0, 0, 0), 5, "zero-length segment");

    eq(formatCountdown(754_000), "12:34", "minutes and seconds");
    eq(formatCountdown(4_000_000), "1:06:40", "hours");
    eq(formatCountdown(-5), "00:00", "never negative");
    eq(formatCountdown(59_999), "00:59", "rounds down");
}

/* ---------- merging candles ---------- */

{
    const base = series(5);

    const same = mergeCandles(base, base.map(c => ({ ...c })));
    ok(same.changed === false && same.candles === base, "identical candles change nothing and keep the same array");

    const updated = mergeCandles(base, [{ ...base[4], close: 99, high: 99 }]);
    ok(updated.changed && updated.candles.length === 5 && updated.candles[4].close === 99, "forming candle is replaced");
    ok(base[4].close === 11, "the original array is not modified");

    const added = mergeCandles(base, [candle(5), candle(6)]);
    ok(added.candles.length === 7 && added.candles[6].time === candle(6).time, "new candles are appended in order");

    const older = mergeCandles(base, [candle(-2), candle(-1)]);
    ok(older.candles.length === 7 && older.candles[0].time === candle(-2).time, "older candles are prepended in order");

    const shuffled = mergeCandles(base, [candle(7), candle(5), candle(6)]);
    ok(shuffled.candles.every((c, i, a) => i === 0 || a[i - 1].time < c.time), "result is sorted");

    const addOnly = mergeCandles(base, [{ ...base[4], close: 1 }, candle(5)], { addOnly: true });
    ok(addOnly.candles[4].close === 11 && addOnly.candles.length === 6, "addOnly keeps existing candles and adds missing ones");

    const bad = mergeCandles(base, [{ time: NaN, open: 1, high: 1, low: 1, close: 1 }, { time: 5, open: "x" }, null]);
    ok(!bad.changed, "invalid candles are ignored");
}

/* ---------- forex hours ---------- */

{
    const at = (iso) => isForexClosed(Date.parse(iso));

    ok(!at("2026-10-07T10:00:00Z"), "Wednesday is open");
    ok(!at("2026-10-09T21:59:00Z"), "Friday 21:59 UTC is open");
    ok(at("2026-10-09T22:00:00Z"), "Friday 22:00 UTC is closed");
    ok(at("2026-10-10T12:00:00Z"), "Saturday is closed");
    ok(at("2026-10-11T09:44:00Z"), "Sunday morning is closed");
    ok(at("2026-10-11T20:59:00Z"), "Sunday 20:59 UTC is closed");
    ok(!at("2026-10-11T21:00:00Z"), "Sunday 21:00 UTC is open");
    ok(!at("2026-10-12T00:00:00Z"), "Monday is open");
}

/* ---------- polling ---------- */

{
    eq(candlesNeeded(1000, 1000 + M, M), 3, "up to date asks for the minimum");
    eq(candlesNeeded(1000, 1000 + 20 * M, M), 22, "asks for the candles that were missed plus two");
    eq(candlesNeeded(0, 1e15, M), 500, "never asks for more than 500");
    eq(candlesNeeded(undefined, 5, M), 50, "no data yet asks for 50");

    eq(pollDelay({ baseMs: 2000 }), 2000, "normal delay");
    eq(pollDelay({ baseMs: 2000, closed: true }), 60_000, "slow when the market is closed");
    eq(pollDelay({ baseMs: 90_000, closed: true }), 90_000, "closed never speeds up a slow setting");
    eq(pollDelay({ baseMs: 2000, failures: 1 }), 4000, "backs off after one failure");
    eq(pollDelay({ baseMs: 2000, failures: 3 }), 16_000, "and again");
    eq(pollDelay({ baseMs: 2000, failures: 50 }), 120_000, "backoff stops at two minutes");
    eq(pollDelay({ baseMs: 2000, failures: 1, retryAfterMs: 45_000 }), 45_000, "waits as long as the server asked");
}

/* ---------- drawings ---------- */

{
    const point = { time: 1, price: 2 };

    ok(isValidDrawing({ id: "a", type: "trend", points: [point, point] }), "valid trend line");
    ok(isValidDrawing({ id: "a", type: "hline", points: [point] }), "valid horizontal line");
    ok(!isValidDrawing({ id: "a", type: "trend", points: [point] }), "trend line needs two points");
    ok(!isValidDrawing({ id: "a", type: "hline", points: [point, point] }), "horizontal line needs one point");
    ok(!isValidDrawing({ id: "a", type: "circle", points: [point] }), "unknown type");
    ok(!isValidDrawing({ id: "a", type: "hline", points: [{ time: NaN, price: 1 }] }), "bad numbers");
    ok(!isValidDrawing(null) && !isValidDrawing({}), "garbage");
}

console.log(`chart maths, merging, polling and drawings: ${checks} checks passed`);
