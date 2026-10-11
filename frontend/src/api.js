/*
 * Loads the multi-timeframe analysis from the backend, or a bundled
 * sample.
 *
 * The API address is the page's own origin by default, because the
 * backend serves this dashboard. To point the page at a backend
 * somewhere else, add ?api=http://localhost:5000 to the URL.
 */

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

export async function loadAnalysis({ source, symbol, signal }) {
    if (source !== "live") {
        const response = await fetch(`demo/${source}.json`, { signal });

        if (!response.ok) {
            throw new Error("The sample data file is missing.");
        }

        return response.json();
    }

    const url =
        `${API_BASE}/api/market/analyze/crypto/multi?symbol=${encodeURIComponent(symbol)}`;

    let response;

    try {
        response = await fetch(url, { signal });
    } catch (error) {
        if (error.name === "AbortError") throw error;

        throw new Error(`Could not reach the backend at ${API_BASE || location.origin}.`);
    }

    const body = await response.json().catch(() => null);

    if (!response.ok || !body || !body.success) {
        throw new Error(
            body && body.message
                ? explain(body.message)
                : `The backend answered with status ${response.status}.`
        );
    }

    return body;
}
