import express from "express";

import {
    HttpError,
    statusOf,
    normalizeSymbol,
    resolveInterval,
    getCandles,
    getCryptoCandles,
    getForexCandles,
    getMultiTimeframeCandles,
    liveSettings,
    forexConfigured
} from "../services/marketdata.js";
import {
    analyzeMultiTimeframe
} from "../services/multiTimeframeAnalyzer.js";
import {
    analyzeMarket
} from "../services/analyzer.js";

const router = express.Router();


// ===============================
// HELPERS
// ===============================

function marketFrom(value, fallback = "crypto") {
    const market = String(value || fallback).toLowerCase();

    if (market !== "crypto" && market !== "forex") {
        throw new HttpError(400, "market must be crypto or forex.");
    }

    return market;
}

function fail(res, label, error) {
    console.error(`${label}:`, error.message);

    const body = {
        success: false,
        message: error.message
    };

    if (error.retryAfterMs) {
        body.retryAfterMs = error.retryAfterMs;
    }

    res.status(statusOf(error)).json(body);
}


// ===============================
// SETTINGS FOR THE DASHBOARD
//
// Pair lists, how fast each market refreshes, and whether
// the forex API key is set (its value is never sent).
// ===============================

const PAIRS = {
    crypto: ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"],

    forex: [
        "EUR/USD",
        "USD/CAD",
        "AUD/USD",
        "GBP/USD",
        "USD/JPY",
        "NZD/USD",
        "USD/CHF",
        "EUR/GBP",
        "EUR/JPY",
        "GBP/JPY"
    ]
};

router.get("/config", (req, res) => {
    res.json({
        success: true,
        ...liveSettings(),
        forexConfigured: forexConfigured(),
        pairs: PAIRS
    });
});


// ===============================
// CANDLES (live updates and history)
//
// GET /api/market/candles?market=forex&symbol=EURUSD&interval=5m
//     &limit=3            how many candles, newest last (max 1000)
//     &before=1760000000000  only candles that opened before this
//                            time, for scrolling back in history
// ===============================

router.get("/candles", async (req, res) => {
    try {
        const market = marketFrom(req.query.market);

        const { symbol, display } =
            normalizeSymbol(market, req.query.symbol);

        const { key: interval } =
            resolveInterval(req.query.interval || "5m");

        const limit = Math.min(
            1000,
            Math.max(1, Math.floor(Number(req.query.limit) || 3))
        );

        const before = Number(req.query.before) || null;

        const result = await getCandles({
            market,
            symbol,
            interval,
            limit,
            before,
            purpose: before ? "history" : "live"
        });

        res.json({
            success: true,
            market,
            symbol: display,
            interval,
            intervalMs: result.intervalMs,
            candles: result.candles,
            fetchedAt: result.fetchedAt,
            stale: result.stale
        });

    } catch (error) {
        fail(res, "Candles error", error);
    }
});


// ===============================
// MULTI-TIMEFRAME ANALYSIS (both markets)
//
// GET /api/market/analyze/multi?market=forex&symbol=EURUSD
// ===============================

async function analyzeMulti(market, rawSymbol) {
    const { symbol, display } = normalizeSymbol(market, rawSymbol);

    const data = await getMultiTimeframeCandles(market, symbol);

    const analysis = analyzeMultiTimeframe({
        candles4H: data.candles4H,
        candles1H: data.candles1H,
        candles15M: data.candles15M,
        candles5M: data.candles5M,
        market
    });

    return {
        success: true,
        market,
        symbol: display,
        stale: data.stale,
        dataFetchedAt: data.fetchedAt,
        analysis
    };
}

router.get("/analyze/multi", async (req, res) => {
    try {
        const market = marketFrom(req.query.market);

        res.json(await analyzeMulti(market, req.query.symbol || (
            market === "forex" ? "EUR/USD" : "BTCUSDT"
        )));

    } catch (error) {
        fail(res, "Multi-timeframe analysis error", error);
    }
});

// Older addresses, kept so existing links still work.

router.get("/analyze/crypto/multi", async (req, res) => {
    try {
        res.json(
            await analyzeMulti("crypto", req.query.symbol || "BTCUSDT")
        );
    } catch (error) {
        fail(res, "Multi-timeframe analysis error", error);
    }
});

router.get("/analyze/forex/multi", async (req, res) => {
    try {
        res.json(
            await analyzeMulti("forex", req.query.symbol || "EUR/USD")
        );
    } catch (error) {
        fail(res, "Multi-timeframe analysis error", error);
    }
});


// ==========================================
// SINGLE-TIMEFRAME CRYPTO ANALYSIS
// ==========================================

router.get("/analyze/crypto", async (req, res) => {
    try {

        const symbol =
            req.query.symbol || "BTCUSDT";

        const interval =
            req.query.interval || "15m";

        const limit =
            Number(req.query.limit) || 200;


        // Get real market candles
        const candles =
            await getCryptoCandles(
                symbol,
                interval,
                limit
            );


        // Analyze the market
        const analysis =
            analyzeMarket(candles);


        res.json({

            success: true,

            market: "crypto",

            symbol,

            interval,

            candleCount:
                candles.length,

            analysis

        });

    } catch (error) {

        fail(res, "Crypto analysis error", error);

    }
});


// ===============================
// FOREX MARKET DATA
// ===============================

router.get("/forex", async (req, res) => {
    try {

        const { symbol } = normalizeSymbol(
            "forex",
            req.query.symbol || "EUR/USD"
        );

        const interval =
            req.query.interval || "15min";

        const limit =
            Number(req.query.limit) || 100;


        const candles =
            await getForexCandles(
                symbol,
                interval,
                limit
            );


        res.json({
            success: true,
            market: "forex",
            symbol,
            interval,
            candles
        });

    } catch (error) {

        fail(res, "Forex error", error);
    }
});


export default router;
