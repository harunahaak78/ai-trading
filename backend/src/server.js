import express from "express";
import cors from "cors";
import dotenv from "dotenv";

import analysisRouter from "./routes/analysis.js";
import marketRouter from "./routes/market.js";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 5000;

app.use(cors());

app.use(express.json());


// ===============================
// HOME
// ===============================

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "AI Trading Analyzer API is running",
        version: "V1"
    });
});


// ===============================
// ROUTES
// ===============================

app.use(
    "/api/analysis",
    analysisRouter
);

app.use(
    "/api/market",
    marketRouter
);


// ===============================
// SERVER
// ===============================

app.listen(PORT, () => {
    console.log(
        `AI Trading API running on port ${PORT}`
    );
});