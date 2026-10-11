import axios from "axios";
import dotenv from "dotenv";

import { cached, createRateLimiter } from "./requestCache.js";

dotenv.config();

/*
 * The base addresses can be changed with environment variables.
 * That is only for testing against a local stand-in server.
 */

const BINANCE_URL =
    `${(process.env.BINANCE_BASE_URL || "https://api.binance.com").replace(/\/$/, "")}/api/v3/klines`;

const TWELVE_DATA_URL =
    `${(process.env.TWELVE_DATA_BASE_URL || "https://api.twelvedata.com").replace(/\/$/, "")}/time_series`;


/*
 * ==========================================
 * ERRORS
 * ==========================================
 */

export class HttpError extends Error {
    constructor(status, message, extra = {}) {
        super(message);
        this.status = status;
        Object.assign(this, extra);
    }
}

export function statusOf(error) {
    if (error instanceof HttpError) return error.status;
    if (error && error.status === 429 && error.retryAfterMs) return 429;
    return 500;
}


/*
 * ==========================================
 * INTERVALS AND SYMBOLS
 * ==========================================
 */

export const INTERVALS = {
    "5m": { binance: "5m", twelve: "5min", ms: 5 * 60_000 },
    "15m": { binance: "15m", twelve: "15min", ms: 15 * 60_000 },
    "1h": { binance: "1h", twelve: "1h", ms: 60 * 60_000 },
    "4h": { binance: "4h", twelve: "4h", ms: 4 * 60 * 60_000 }
};

const INTERVAL_ALIASES = {
    "5min": "5m",
    "15min": "15m",
    "60m": "1h",
    "60min": "1h"
};

export function resolveInterval(value) {
    const raw = String(value ?? "").trim().toLowerCase();
    const key = INTERVAL_ALIASES[raw] || raw;

    if (!INTERVALS[key]) {
        throw new HttpError(
            400,
            `Interval must be one of ${Object.keys(INTERVALS).join(", ")}.`
        );
    }

    return { key, ...INTERVALS[key] };
}

/*
 * Crypto symbols look like BTCUSDT.
 * Forex pairs are accepted as EURUSD, EUR/USD, eur-usd and so on,
 * and are sent to the data provider as EUR/USD.
 */

export function normalizeSymbol(market, raw) {
    const text = String(raw ?? "").trim().toUpperCase();

    if (market === "forex") {
        const letters = text.replace(/[^A-Z]/g, "");

        if (letters.length !== 6) {
            throw new HttpError(
                400,
                "Enter a forex pair like EUR/USD or EURUSD."
            );
        }

        const pair = `${letters.slice(0, 3)}/${letters.slice(3)}`;

        return { symbol: pair, display: pair };
    }

    if (!/^[A-Z0-9]{5,15}$/.test(text)) {
        throw new HttpError(
            400,
            "Enter a crypto symbol like BTCUSDT."
        );
    }

    return { symbol: text, display: text };
}


/*
 * ==========================================
 * LIVE TIMING (used by the dashboard)
 * ==========================================
 *
 * Forex is polled, because the free Twelve Data plan has no live
 * stream and limits how many requests can be made. Raise the forex
 * speed with FOREX_LIVE_MS if your plan allows more requests.
 */

function envNumber(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function liveSettings() {
    return {
        live: {
            crypto: {
                liveMs: envNumber("CRYPTO_LIVE_MS", 2000),
                analysisMs: envNumber("CRYPTO_ANALYSIS_MS", 30_000)
            },
            forex: {
                liveMs: envNumber("FOREX_LIVE_MS", 15_000),
                analysisMs: envNumber("FOREX_ANALYSIS_MS", 120_000)
            }
        }
    };
}

export function forexConfigured() {
    return Boolean(process.env.TWELVE_DATA_API_KEY);
}


/*
 * ==========================================
 * CRYPTO — BINANCE
 * ==========================================
 */

export async function getCryptoCandles(
    symbol = "BTCUSDT",
    interval = "15m",
    limit = 200,
    options = {}
) {
    // Known intervals are mapped; anything else (1m, 1d...) goes to
    // Binance as it is, as before.
    const binance =
        INTERVALS[String(interval).toLowerCase()]?.binance ?? interval;

    const params = {
        symbol: symbol.toUpperCase(),
        interval: binance,
        limit
    };

    // Candles that opened before this time (milliseconds).
    if (options.before) {
        params.endTime = Number(options.before) - 1;
    }

    const response = await axios.get(
        BINANCE_URL,
        { params, timeout: 10_000 }
    );

    return response.data.map(candle => ({

        time: Number(candle[0]),

        open: Number(candle[1]),

        high: Number(candle[2]),

        low: Number(candle[3]),

        close: Number(candle[4]),

        volume: Number(candle[5])

    }));
}


/*
 * ==========================================
 * FOREX — TWELVE DATA
 * ==========================================
 */

const forexLimiter = createRateLimiter({
    perMinute: envNumber("TWELVE_DATA_RPM", 8),
    maxWaitMs: 15_000
});

// "2026-10-09 17:00:00" (UTC) -> milliseconds
function parseTwelveTime(text) {
    const value = String(text).trim();

    const iso = value.includes(" ")
        ? `${value.replace(" ", "T")}Z`
        : `${value}T00:00:00Z`;

    return new Date(iso).getTime();
}

function formatTwelveDate(ms) {
    return new Date(ms)
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
}

function twelveError(data) {
    const code = Number(data.code);
    const message = String(data.message || "Twelve Data returned an error.");

    if (code === 429) {
        return new HttpError(
            429,
            `Twelve Data request limit reached. ${message}`,
            { retryAfterMs: 60_000 }
        );
    }

    if (code === 401) {
        return new HttpError(
            502,
            "Twelve Data rejected the API key. Check TWELVE_DATA_API_KEY in backend/.env."
        );
    }

    if (code === 400 || code === 404) {
        return new HttpError(
            400,
            `Twelve Data could not find that pair. ${message}`
        );
    }

    return new HttpError(502, `Twelve Data: ${message}`);
}

export async function getForexCandles(
    symbol = "EUR/USD",
    interval = "15min",
    outputsize = 200,
    options = {}
) {
    if (!forexConfigured()) {
        throw new HttpError(
            503,
            "Forex data needs a Twelve Data API key. Add TWELVE_DATA_API_KEY to backend/.env and restart the server."
        );
    }

    const { twelve } = resolveInterval(interval);

    const params = {
        symbol,
        interval: twelve,
        outputsize,
        timezone: "UTC",
        apikey: process.env.TWELVE_DATA_API_KEY
    };

    // Candles that opened before this time (milliseconds).
    if (options.before) {
        params.end_date = formatTwelveDate(Number(options.before) - 1000);
    }

    await forexLimiter();

    let response;

    try {
        response = await axios.get(
            TWELVE_DATA_URL,
            { params, timeout: 12_000 }
        );
    } catch (error) {
        // Never pass the axios error on as is. Its config holds the API key.
        throw new HttpError(
            502,
            `Could not reach Twelve Data (${error.code || error.message}).`
        );
    }

    const data = response.data;

    if (!data || data.status === "error") {
        throw twelveError(data || {});
    }

    if (!Array.isArray(data.values) || data.values.length === 0) {
        throw new HttpError(
            404,
            `Twelve Data returned no candles for ${symbol}.`
        );
    }

    return data.values
        .slice()
        .reverse()
        .map(candle => ({

            time: parseTwelveTime(candle.datetime),

            open: Number(candle.open),

            high: Number(candle.high),

            low: Number(candle.low),

            close: Number(candle.close),

            // Forex has no real volume.
            volume: candle.volume ? Number(candle.volume) : 0

        }));
}


/*
 * ==========================================
 * CACHED ACCESS FOR BOTH MARKETS
 * ==========================================
 *
 * purpose "live"      small, fresh, polled every few seconds
 * purpose "analysis"  the 200 candles the engines read
 * purpose "history"   older candles for scrolling back
 */

const ANALYSIS_TTL = {
    crypto: { "5m": 4_000, "15m": 8_000, "1h": 20_000, "4h": 60_000 },
    forex: { "5m": 45_000, "15m": 90_000, "1h": 240_000, "4h": 600_000 }
};

function ttlFor(market, purpose, intervalKey) {
    if (purpose === "history") return 300_000;

    if (purpose === "live") {
        const liveMs = liveSettings().live[market].liveMs;
        return Math.max(500, Math.floor(liveMs * 0.7));
    }

    return ANALYSIS_TTL[market][intervalKey];
}

// If the provider fails or limits us, recent forex data is still shown.
const STALE_MS = { crypto: 0, forex: 10 * 60_000 };

export async function getCandles({
    market,
    symbol,
    interval,
    limit = 200,
    before = null,
    purpose = "analysis"
}) {
    const resolved = resolveInterval(interval);

    const key = [
        market,
        symbol,
        resolved.key,
        limit,
        before || 0,
        purpose
    ].join("|");

    const result = await cached(
        key,
        {
            ttlMs: ttlFor(market, purpose, resolved.key),
            staleMs: purpose === "history" ? 0 : STALE_MS[market]
        },
        () =>
            market === "forex"
                ? getForexCandles(symbol, resolved.key, limit, { before })
                : getCryptoCandles(symbol, resolved.key, limit, { before })
    );

    return {
        candles: result.value,
        fetchedAt: result.fetchedAt,
        stale: result.stale,
        intervalMs: resolved.ms
    };
}

export async function getMultiTimeframeCandles(market, symbol) {
    const [h4, h1, m15, m5] = await Promise.all([
        getCandles({ market, symbol, interval: "4h" }),
        getCandles({ market, symbol, interval: "1h" }),
        getCandles({ market, symbol, interval: "15m" }),
        getCandles({ market, symbol, interval: "5m" })
    ]);

    const parts = [h4, h1, m15, m5];

    return {
        candles4H: h4.candles,
        candles1H: h1.candles,
        candles15M: m15.candles,
        candles5M: m5.candles,
        fetchedAt: Math.min(...parts.map(part => part.fetchedAt)),
        stale: parts.some(part => part.stale)
    };
}

// Kept for older callers.
export async function getMultiTimeframeCryptoCandles(symbol = "BTCUSDT") {
    return getMultiTimeframeCandles("crypto", symbol);
}
