/*
 * Live updates.
 *
 * The page asks the backend for the newest few candles every couple of
 * seconds (crypto) or every 15 seconds (forex) and merges them into the
 * chart, so the last candle keeps moving and new candles appear without
 * reloading anything.
 *
 * The helpers at the top are pure and can be tested alone. The feed at
 * the bottom owns the timers.
 */

export const TIMEFRAMES = {
    "4H": { api: "4h", ms: 4 * 60 * 60_000 },
    "1H": { api: "1h", ms: 60 * 60_000 },
    "15M": { api: "15m", ms: 15 * 60_000 },
    "5M": { api: "5m", ms: 5 * 60_000 }
};

export function isValidCandle(candle) {
    return (
        candle &&
        [candle.time, candle.open, candle.high, candle.low, candle.close]
            .every(Number.isFinite)
    );
}

/*
 * Merge candles into a series (sorted, one candle per time).
 *
 * By default a candle with a time already in the series replaces it,
 * which is how the forming candle updates. With addOnly, existing
 * candles are kept and only missing ones are added, which is how older
 * or slightly stale data is merged without undoing newer ticks.
 *
 * Returns { candles, changed }. When nothing changed the original
 * array is returned, so callers can skip redrawing.
 */
export function mergeCandles(series, incoming, { addOnly = false } = {}) {
    const byTime = new Map(series.map(candle => [candle.time, candle]));

    let changed = false;

    for (const candle of incoming) {
        if (!isValidCandle(candle)) continue;

        const existing = byTime.get(candle.time);

        if (!existing) {
            byTime.set(candle.time, candle);
            changed = true;
            continue;
        }

        if (
            !addOnly &&
            (existing.open !== candle.open ||
                existing.high !== candle.high ||
                existing.low !== candle.low ||
                existing.close !== candle.close ||
                existing.volume !== candle.volume)
        ) {
            byTime.set(candle.time, candle);
            changed = true;
        }
    }

    if (!changed) {
        return { candles: series, changed: false };
    }

    return {
        candles: [...byTime.values()].sort((a, b) => a.time - b.time),
        changed: true
    };
}

/*
 * Forex trades from Sunday evening to Friday evening (UTC). The window
 * here is a little wider than the real one, so the page never misses
 * the open. Outside it the page only checks once a minute.
 */
export function isForexClosed(nowMs) {
    const date = new Date(nowMs);

    const day = date.getUTCDay();
    const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();

    if (day === 6) return true;
    if (day === 5 && minutes >= 22 * 60) return true;
    if (day === 0 && minutes < 21 * 60) return true;

    return false;
}

// How many candles to ask for so nothing is missed since the last one.
export function candlesNeeded(lastTime, nowMs, intervalMs) {
    if (!Number.isFinite(lastTime)) return 50;

    const missed = Math.ceil((nowMs - lastTime) / intervalMs) + 2;

    return Math.min(500, Math.max(3, missed));
}

/*
 * Time until the next poll. Slower while the market is closed, and
 * slower again after failures (doubling, up to two minutes), or as
 * long as the server asked us to wait.
 */
export function pollDelay({
    baseMs,
    closed = false,
    failures = 0,
    retryAfterMs = 0
}) {
    let delay = closed ? Math.max(baseMs, 60_000) : baseMs;

    if (failures > 0) {
        delay = Math.min(120_000, delay * 2 ** Math.min(failures, 6));
    }

    return Math.max(delay, retryAfterMs || 0);
}

/* ---------- feed ---------- */

/*
 * createLiveFeed({ fetchCandles, onCandles, onStatus })
 *
 *   fetchCandles({ market, symbol, tf, limit, signal }) -> { candles, stale }
 *   onCandles(candles, target, result)
 *   onStatus({ state, message, lastTickAt, retryInMs })
 *
 * states: "live", "delayed", "closed", "hidden", "error"
 *
 * start(target) begins polling and replaces any earlier target:
 *   { market, symbol, tf, baseMs, getLastTime() }
 */
export function createLiveFeed({ fetchCandles, onCandles, onStatus }) {
    let target = null;
    let timer = null;
    let controller = null;
    let run = 0;
    let failures = 0;
    let retryAfterMs = 0;

    function emit(status) {
        onStatus?.(status);
    }

    function clearTimer() {
        clearTimeout(timer);
        timer = null;
    }

    function stop() {
        run++;
        clearTimer();

        if (controller) controller.abort();
        controller = null;
        target = null;
        failures = 0;
        retryAfterMs = 0;
    }

    function schedule(closed) {
        clearTimer();

        if (!target) return;

        const delay = pollDelay({
            baseMs: target.baseMs,
            closed,
            failures,
            retryAfterMs
        });

        timer = setTimeout(poll, delay);
    }

    async function poll() {
        clearTimer();

        if (!target) return;

        if (document.hidden) {
            // Nothing is watching. visibilitychange polls again.
            emit({ state: "hidden" });
            return;
        }

        const mine = run;
        const current = target;
        const now = Date.now();

        const closed =
            current.market === "forex" && isForexClosed(now);

        const limit = closed
            ? 3
            : candlesNeeded(
                current.getLastTime?.(),
                now,
                TIMEFRAMES[current.tf].ms
            );

        if (controller) controller.abort();
        controller = new AbortController();

        try {
            const result = await fetchCandles({
                market: current.market,
                symbol: current.symbol,
                tf: current.tf,
                limit,
                signal: controller.signal
            });

            if (mine !== run) return;

            failures = 0;
            retryAfterMs = 0;

            onCandles?.(result.candles, current, result);

            emit(
                closed
                    ? { state: "closed", lastTickAt: Date.now() }
                    : result.stale
                        ? { state: "delayed", lastTickAt: Date.now() }
                        : { state: "live", lastTickAt: Date.now() }
            );
        } catch (error) {
            if (error.name === "AbortError" || mine !== run) return;

            failures++;
            retryAfterMs = error.retryAfterMs || 0;

            emit({
                state: "error",
                message: error.message,
                retryInMs: pollDelay({
                    baseMs: current.baseMs,
                    closed,
                    failures,
                    retryAfterMs
                })
            });
        }

        if (mine === run) schedule(closed);
    }

    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && target) {
            poll();
        }
    });

    return {
        start(next) {
            stop();
            target = next;
            poll();
        },

        stop() {
            stop();
        },

        pollNow() {
            if (target) poll();
        },

        get active() {
            return target !== null;
        }
    };
}
