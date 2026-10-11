/*
 * Small in-memory cache and rate limiter for market data requests.
 *
 * Why: the dashboard asks for fresh candles every few seconds, and
 * several browser tabs may be open at once. The cache lets them all
 * share one upstream request, and the rate limiter keeps the backend
 * under the per-minute limit of the forex data provider.
 */

const store = new Map();
const inflight = new Map();

const MAX_ENTRIES = 400;

function prune(now) {
    if (store.size <= MAX_ENTRIES) return;

    for (const [key, entry] of store) {
        if (now - entry.fetchedAt > entry.keepMs) {
            store.delete(key);
        }
    }

    while (store.size > MAX_ENTRIES) {
        store.delete(store.keys().next().value);
    }
}

/*
 * cached(key, { ttlMs, staleMs }, loader)
 *
 *   ttlMs    how long a result is fresh.
 *   staleMs  when the loader fails, a result younger than this is
 *            returned anyway, marked stale: true.
 *
 * Concurrent calls with the same key share one loader run.
 */
export function cached(key, { ttlMs, staleMs = 0 }, loader) {
    const now = Date.now();
    const hit = store.get(key);

    if (hit && now - hit.fetchedAt < ttlMs) {
        return Promise.resolve({
            value: hit.value,
            fetchedAt: hit.fetchedAt,
            stale: false,
            cached: true
        });
    }

    if (inflight.has(key)) {
        return inflight.get(key);
    }

    // Starting in a microtask guarantees the in-flight entry exists
    // before the loader can finish, even if it fails immediately.
    const promise = Promise.resolve().then(async () => {
        try {
            const value = await loader();
            const fetchedAt = Date.now();

            store.set(key, {
                value,
                fetchedAt,
                keepMs: Math.max(ttlMs, staleMs)
            });

            prune(fetchedAt);

            return { value, fetchedAt, stale: false, cached: false };
        } catch (error) {
            if (hit && staleMs > 0 && Date.now() - hit.fetchedAt < staleMs) {
                return {
                    value: hit.value,
                    fetchedAt: hit.fetchedAt,
                    stale: true,
                    cached: true,
                    error: error.message
                };
            }

            throw error;
        } finally {
            inflight.delete(key);
        }
    });

    inflight.set(key, promise);

    return promise;
}

export function clearCache() {
    store.clear();
    inflight.clear();
}

/*
 * Rate limiter: at most `perMinute` calls in any 60 seconds.
 *
 * A call over the limit waits for a free slot. If the wait would be
 * longer than `maxWaitMs`, it fails with a 429 error that says how
 * long to wait, so the dashboard can back off instead of hanging.
 */
export function createRateLimiter({ perMinute, maxWaitMs = 15_000 }) {
    const stamps = [];

    return async function acquire() {
        const started = Date.now();

        for (;;) {
            const now = Date.now();

            while (stamps.length && now - stamps[0] >= 60_000) {
                stamps.shift();
            }

            if (stamps.length < perMinute) {
                stamps.push(now);
                return;
            }

            const wait = 60_000 - (now - stamps[0]) + 5;

            if (now - started + wait > maxWaitMs) {
                const error = new Error(
                    `Request limit reached (${perMinute} per minute). Try again in ${Math.ceil(wait / 1000)} seconds.`
                );

                error.status = 429;
                error.retryAfterMs = wait;

                throw error;
            }

            await new Promise(resolve => setTimeout(resolve, wait));
        }
    };
}
