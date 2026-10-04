import express from "express";
import { analyzeMarket } from "../services/analyzer.js";

const router = express.Router();

router.post("/", async (req, res) => {
    try {
        const { candles } = req.body;

        if (!Array.isArray(candles)) {
            return res.status(400).json({
                success: false,
                message: "Candles must be an array"
            });
        }

        const analysis = analyzeMarket(candles);

        return res.json({
            success: true,
            data: analysis
        });

    } catch (error) {
        console.error("Analysis error:", error);

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

export default router;