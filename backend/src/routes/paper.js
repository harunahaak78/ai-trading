import express from "express";

import {
    overview,
    journal,
    setRunning,
    addPair,
    removePair,
    resetAccount
} from "../paper/trader.js";
import { HttpError, statusOf } from "../services/marketdata.js";

const router = express.Router();

function fail(res, error) {
    res.status(statusOf(error)).json({ success: false, message: error.message });
}

function marketOf(value) {
    const market = String(value || "").toLowerCase();
    if (market !== "crypto" && market !== "forex") {
        throw new HttpError(400, "market must be crypto or forex.");
    }
    return market;
}

// Everything the dashboard needs in one call.
router.get("/", (req, res) => {
    try {
        res.json({ success: true, ...overview() });
    } catch (error) {
        fail(res, error);
    }
});

// The journal: every trade, newest first.
router.get("/journal", (req, res) => {
    try {
        res.json({
            success: true,
            trades: journal({ limit: req.query.limit, status: req.query.status || null })
        });
    } catch (error) {
        fail(res, error);
    }
});

// Pause or resume new entries. Open trades are always followed.
router.post("/control", (req, res) => {
    try {
        setRunning(req.body?.running !== false);
        res.json({ success: true, ...overview() });
    } catch (error) {
        fail(res, error);
    }
});

router.post("/watch", (req, res) => {
    try {
        const result = addPair(marketOf(req.body?.market), req.body?.symbol);
        res.json({ success: true, ...result });
    } catch (error) {
        fail(res, error);
    }
});

router.delete("/watch", (req, res) => {
    try {
        const result = removePair(marketOf(req.query.market), req.query.symbol);
        res.json({ success: true, ...result });
    } catch (error) {
        fail(res, error);
    }
});

// Starts the demo account over. Needs { "confirm": true }.
router.post("/reset", (req, res) => {
    try {
        if (req.body?.confirm !== true) {
            throw new HttpError(400, "Send { \"confirm\": true } to reset the account and journal.");
        }
        resetAccount(req.body?.startingBalance ?? 1000);
        res.json({ success: true, ...overview() });
    } catch (error) {
        fail(res, error);
    }
});

export default router;
