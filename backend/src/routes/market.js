import express from "express";

import {
    getCryptoCandles,
    getForexCandles,
    getMultiTimeframeCryptoCandles
} from "../services/marketdata.js";
import {
    analyzeMultiTimeframe
} from "../services/multiTimeframeAnalyzer.js";
import {
    analyzeMarket
} from "../services/analyzer.js";

const router = express.Router();


// ===============================
// CRYPTO MARKET DATA
// ===============================

// ==========================================
// CRYPTO MARKET ANALYSIS
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

        console.error(
            "Crypto analysis error:",
            error
        );

        res.status(500).json({

            success: false,

            message: error.message

        });

    }
});

router.get("/analyze/crypto/multi", async (req, res) => {
    try {
        const symbol =
            req.query.symbol || "BTCUSDT";

        const {
            candles4H,
            candles1H,
            candles15M,
            candles5M
        } =
            await getMultiTimeframeCryptoCandles(
                symbol
            );

        const analysis =
            analyzeMultiTimeframe({
                candles4H,
                candles1H,
                candles15M,
                candles5M
            });

        res.json({
            success: true,
            market: "crypto",
            symbol,
            analysis
        });

    } catch (error) {
        console.error(
            "Multi-timeframe analysis error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});



// ===============================
// FOREX MARKET DATA
// ===============================

router.get("/forex", async (req, res) => {
    try {

        const symbol =
            req.query.symbol || "EUR/USD";

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

        console.error(
            "Forex error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});


export default router;