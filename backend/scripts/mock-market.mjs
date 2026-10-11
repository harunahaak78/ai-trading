/*
 * A local stand-in for the Binance and Twelve Data APIs, for testing
 * without internet access or API credits.
 *
 *   node scripts/mock-market.mjs
 *
 * then start the backend pointed at it:
 *
 *   BINANCE_BASE_URL=http://localhost:5099 \
 *   TWELVE_DATA_BASE_URL=http://localhost:5099 \
 *   TWELVE_DATA_API_KEY=test-key  npm start
 *
 * Prices are a smooth, repeatable function of time, so history never
 * changes and the newest candle keeps moving as the clock runs.
 *
 * Environment:
 *   MOCK_PORT   port to listen on (default 5099)
 *   MOCK_NOW    ISO time the mock believes it is "now"; the clock then
 *               runs forward in real time (default: the real time)
 *
 * Control endpoints:
 *   /__mock/set?binance=451&twelve=429    make an API fail (omit to reset)
 *   /__mock/stats                         request counts and recent requests
 */

import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 5099);

const REAL_START = Date.now();
const FAKE_START = process.env.MOCK_NOW
    ? Date.parse(process.env.MOCK_NOW)
    : REAL_START;

const now = () => FAKE_START + (Date.now() - REAL_START);

const BASE = {
    BTCUSDT: 82960,
    ETHUSDT: 3850,
    BNBUSDT: 610,
    SOLUSDT: 172,
    XRPUSDT: 2.35,
    EURUSD: 1.0832,
    USDCAD: 1.392,
    AUDUSD: 0.6581,
    GBPUSD: 1.2954,
    USDJPY: 149.62,
    NZDUSD: 0.5987,
    USDCHF: 0.8821,
    EURGBP: 0.8362,
    EURJPY: 162.1,
    GBPJPY: 193.8
};

const MS = {
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
    "4h": 14_400_000,
    "5min": 300_000,
    "15min": 900_000
};

const state = {
    binance: 0,
    twelve: 0,
    counts: { binance: 0, twelve: 0 },
    recent: []
};

function seedOf(text) {
    let h = 0;

    for (const ch of text) {
        h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    }

    return h;
}

const frac = x => x - Math.floor(x);

function priceAt(symbol, t) {
    const key = symbol.replace("/", "");
    const base = BASE[key] ?? 100;
    const seed = seedOf(key) % 1000;
    const sec = Math.floor(t / 1000);

    const wobble =
        0.004 * Math.sin(t / 3.6e6 + seed) +
        0.0015 * Math.sin(t / 9e5 + seed * 0.7) +
        0.0004 * Math.sin(t / 1.2e5 + seed * 1.3) +
        0.00012 * Math.sin(t / 2e4 + seed);

    const jitter =
        (frac(Math.sin(sec * 12.9898 + seed) * 43758.5453) - 0.5) * 0.00006;

    return base * (1 + wobble + jitter);
}

function decimals(symbol) {
    const base = BASE[symbol.replace("/", "")] ?? 100;

    if (base < 10) return 5;
    if (base < 1000) return 3;
    return 2;
}

function candleAt(symbol, open, ms) {
    const end = Math.min(open + ms - 1000, now());
    const samples = 20;

    let high = -Infinity;
    let low = Infinity;

    for (let i = 0; i <= samples; i++) {
        const p = priceAt(symbol, open + ((end - open) * i) / samples);
        high = Math.max(high, p);
        low = Math.min(low, p);
    }

    return {
        open: priceAt(symbol, open),
        close: priceAt(symbol, end),
        high,
        low
    };
}

// Candle open times, oldest first, ending at the newest one at or
// before `endTime`.
function openTimes(ms, limit, endTime) {
    const last = Math.floor(Math.min(endTime ?? now(), now()) / ms) * ms;

    return Array.from({ length: limit }, (_, k) => last - (limit - 1 - k) * ms);
}

function json(res, status, body) {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
}

function binanceKlines(url, res) {
    state.counts.binance++;

    if (state.binance) {
        return json(res, state.binance, { code: -1, msg: "mock failure" });
    }

    const symbol = (url.searchParams.get("symbol") || "").toUpperCase();
    const ms = MS[url.searchParams.get("interval")];

    if (!BASE[symbol] || !ms) {
        return json(res, 400, { code: -1121, msg: "Invalid symbol." });
    }

    const limit = Math.min(1000, Number(url.searchParams.get("limit")) || 500);
    const endTime = url.searchParams.get("endTime");
    const d = decimals(symbol);

    const rows = openTimes(ms, limit, endTime ? Number(endTime) : undefined)
        .map(open => {
            const c = candleAt(symbol, open, ms);
            const volume = 50 + frac(Math.sin(open) * 1000) * 400;

            return [
                open,
                c.open.toFixed(d),
                c.high.toFixed(d),
                c.low.toFixed(d),
                c.close.toFixed(d),
                volume.toFixed(3),
                open + ms - 1
            ];
        });

    json(res, 200, rows);
}

function twelveSeries(url, res) {
    state.counts.twelve++;

    if (url.searchParams.get("apikey") !== "test-key") {
        return json(res, 200, {
            code: 401,
            message: "**apikey** parameter is incorrect or not specified.",
            status: "error"
        });
    }

    if (state.twelve === 429) {
        return json(res, 200, {
            code: 429,
            message: "You have run out of API credits for the current minute.",
            status: "error"
        });
    }

    const symbol = url.searchParams.get("symbol") || "";
    const key = symbol.replace("/", "");
    const ms = MS[url.searchParams.get("interval")];

    if (!/^[A-Z]{3}\/[A-Z]{3}$/.test(symbol) || !BASE[key] || !ms) {
        return json(res, 200, {
            code: 400,
            message: "**symbol** not found or **interval** invalid.",
            status: "error"
        });
    }

    const limit = Math.min(5000, Number(url.searchParams.get("outputsize")) || 30);
    const endDate = url.searchParams.get("end_date");

    const endTime = endDate
        ? Date.parse(`${endDate.replace(" ", "T")}Z`)
        : undefined;

    const d = decimals(symbol);

    const values = openTimes(ms, limit, endTime)
        .map(open => {
            const c = candleAt(symbol, open, ms);

            return {
                datetime: new Date(open).toISOString().slice(0, 19).replace("T", " "),
                open: c.open.toFixed(d),
                high: c.high.toFixed(d),
                low: c.low.toFixed(d),
                close: c.close.toFixed(d)
            };
        })
        .reverse();

    json(res, 200, {
        meta: { symbol, interval: url.searchParams.get("interval"), timezone: "UTC" },
        values,
        status: "ok"
    });
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    state.recent.push({
        path: url.pathname,
        query: Object.fromEntries(url.searchParams)
    });

    if (state.recent.length > 200) state.recent.shift();

    if (url.pathname === "/__mock/set") {
        state.binance = Number(url.searchParams.get("binance")) || 0;
        state.twelve = Number(url.searchParams.get("twelve")) || 0;

        return json(res, 200, { binance: state.binance, twelve: state.twelve });
    }

    if (url.pathname === "/__mock/stats") {
        return json(res, 200, {
            counts: state.counts,
            recent: state.recent.filter(r => !r.path.startsWith("/__mock")),
            now: new Date(now()).toISOString()
        });
    }

    if (url.pathname === "/api/v3/klines") return binanceKlines(url, res);
    if (url.pathname === "/time_series") return twelveSeries(url, res);

    json(res, 404, { message: "not found" });
});

server.listen(PORT, () => {
    console.log(
        `Mock market data on http://localhost:${PORT} ` +
        `(clock: ${new Date(now()).toISOString()})`
    );
});
