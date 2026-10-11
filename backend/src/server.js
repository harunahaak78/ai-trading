import path from "node:path";
import { fileURLToPath } from "node:url";

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
// HEALTH CHECK
// ===============================

app.get("/health", (req, res) => {
    res.json({
        success: true,
        message: "AI Trading Analyzer API is running",
        version: "V1"
    });
});


// ===============================
// DASHBOARD
//
// The frontend is plain HTML, CSS and JavaScript modules,
// so the backend can serve it directly. Open
// http://localhost:5000 after starting the server.
// ===============================

const frontendDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../frontend"
);

app.use(express.static(frontendDir));


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