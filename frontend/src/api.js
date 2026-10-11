/*
 * Talks to the backend, or loads a bundled sample.
 *
 * The API address is the page's own origin by default, because the
 * backend serves this dashboard. To point the page at a backend
 * somewhere else, add ?api=http://localhost:5000 to the URL.
 */

import { TIMEFRAMES } from "./live.js";

const params = new URLSearchParams(location.search);

export const API_BASE = (params.get("api") || "").replace(/\/$/, "");

function explain(message) {
    const text = String(message || "");

    if (/status code 451/.test(text)) {
        return "Binance refused the request from this server's location (HTTP 451).";
    }

    if (/status code 400/.test(text)) {
        return "Binance did not accept that symbol. Try one like BTCUSDT.";
    }

    if (/status code 429|status code 418/.test(text)) {
        return "Binance is rate limiting this server. Wait a minute and try again.";
    }

    return text;
}

/*
 * Where to look for the backend, in order.
 *
 * Normally the page and the API share one address, because the backend
 * serves the page. When the page is opened from another local port
 * (for example an editor's live preview), also try the backend's default
 * address so it still connects.
 */

const DEFAULT_BACKEND = "http://localhost:5000";

let workingBase = null;

function backendCandidates() {
    if (API_BASE) return [API_BASE];

    const bases = [""];

    const isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";

    if (isLocal && location.port !== "5000") {
        bases.push(DEFAULT_BACKEND);
    }

    if (workingBase !== null && bases.includes(workingBase)) {
        return [workingBase, ...bases.filter(base => base !== workingBase)];
    }

    return bases;
}

/*
 * GET a backend path and return its JSON. Throws an Error with a
 * plain-language message; `retryAfterMs` is set when the server asked
 * to be left alone for a while.
 */
async function request(path, { signal } = {}) {
    let lastFailure = null;

    for (const base of backendCandidates()) {
        let response;

        try {
            response = await fetch(`${base}${path}`, { signal });
        } catch (error) {
            if (error.name === "AbortError") throw error;

            lastFailure = `Could not reach the backend at ${base || location.origin}.`;
            continue;
        }

        const body = await response.json().catch(() => null);

        // The backend answered. Any reply with its JSON shape is final,
        // even an error such as Binance refusing a symbol.
        if (body && typeof body.success === "boolean") {
            if (!body.success) {
                const error = new Error(
                    explain(body.message) ||
                    `The backend answered with status ${response.status}.`
                );

                error.status = response.status;
                error.retryAfterMs = body.retryAfterMs || 0;

                throw error;
            }

            workingBase = base;
            return body;
        }

        // Not our backend (for example a plain file server answering 404).
        lastFailure =
            `${base || location.origin} answered with status ${response.status} but it is not the trading backend.`;
    }

    throw new Error(lastFailure || "Could not reach the backend.");
}

/* ---------- public calls ---------- */

export async function loadAnalysis({ source, market, symbol, signal }) {
    if (source !== "live") {
        const response = await fetch(`demo/${source}.json`, { signal });

        if (!response.ok) {
            throw new Error("The sample data file is missing.");
        }

        return response.json();
    }

    return request(
        `/api/market/analyze/multi?market=${encodeURIComponent(market)}` +
        `&symbol=${encodeURIComponent(symbol)}`,
        { signal }
    );
}

// The newest `limit` candles, or the `limit` candles before `before`.
export async function loadCandles({ market, symbol, tf, limit, before, signal }) {
    const interval = TIMEFRAMES[tf]?.api;

    if (!interval) {
        throw new Error(`Unknown timeframe ${tf}.`);
    }

    return request(
        `/api/market/candles?market=${encodeURIComponent(market)}` +
        `&symbol=${encodeURIComponent(symbol)}` +
        `&interval=${interval}` +
        `&limit=${limit}` +
        (before ? `&before=${before}` : ""),
        { signal }
    );
}

// Pair lists and refresh speeds. The page works without it.
export async function loadConfig() {
    try {
        return await request("/api/market/config");
    } catch {
        return null;
    }
}
