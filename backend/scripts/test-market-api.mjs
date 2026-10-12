/*
 * Starts the mock market server and the real backend, then checks
 * the market API end to end.
 *
 *   node scripts/test-market-api.mjs
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(here, "..");

const MOCK = 5099;
const MAIN = 5056;
const LIMITED = 5057;

const children = [];
const results = [];

function check(name, condition, detail = "") {
    results.push({ name, ok: Boolean(condition), detail });
}

function start(file, env) {
    const child = spawn(process.execPath, [file], {
        cwd: backendDir,
        env: { ...process.env, PAPER_ENABLED: "false", ...env },
        stdio: ["ignore", "pipe", "pipe"]
    });

    child.stdout.on("data", () => {});
    child.stderr.on("data", () => {});
    children.push(child);

    return child;
}

async function waitFor(url) {
    for (let i = 0; i < 60; i++) {
        try {
            const response = await fetch(url);
            if (response.ok) return;
        } catch {
            // not up yet
        }

        await new Promise(resolve => setTimeout(resolve, 150));
    }

    throw new Error(`Timed out waiting for ${url}`);
}

const get = async (port, pathAndQuery) => {
    const response = await fetch(`http://localhost:${port}${pathAndQuery}`);
    return { status: response.status, body: await response.json() };
};

const mock = pathAndQuery => get(MOCK, pathAndQuery);

const backendEnv = port => ({
    PORT: String(port),
    BINANCE_BASE_URL: `http://localhost:${MOCK}`,
    TWELVE_DATA_BASE_URL: `http://localhost:${MOCK}`,
    TWELVE_DATA_API_KEY: "test-key",
    CRYPTO_LIVE_MS: "2000",
    FOREX_LIVE_MS: "2000"
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

try {
    start("scripts/mock-market.mjs", { MOCK_PORT: String(MOCK) });
    start("src/server.js", { ...backendEnv(MAIN), TWELVE_DATA_RPM: "40" });
    start("src/server.js", { ...backendEnv(LIMITED), TWELVE_DATA_RPM: "3" });

    await waitFor(`http://localhost:${MOCK}/__mock/stats`);
    await waitFor(`http://localhost:${MAIN}/health`);
    await waitFor(`http://localhost:${LIMITED}/health`);

    // ---------- settings ----------
    {
        const { body } = await get(MAIN, "/api/market/config");

        check("config: forex is configured", body.forexConfigured === true);
        check("config: forex pair list has EUR/USD, USD/CAD, AUD/USD",
            ["EUR/USD", "USD/CAD", "AUD/USD"].every(p => body.pairs.forex.includes(p)));
        check("config: live timings present",
            body.live.crypto.liveMs === 2000 && body.live.forex.analysisMs > 0);
        check("config: never exposes the API key",
            !JSON.stringify(body).includes("test-key"));
    }

    // ---------- crypto candles ----------
    {
        const { status, body } = await get(MAIN, "/api/market/candles?market=crypto&symbol=ethusdt&interval=5m&limit=3");

        check("crypto candles: 200 and 3 candles",
            status === 200 && body.success && body.candles.length === 3);
        check("crypto candles: symbol upper-cased", body.symbol === "ETHUSDT");
        check("crypto candles: oldest first, 5 minutes apart",
            body.candles[1].time - body.candles[0].time === 300_000 &&
            body.candles[2].time - body.candles[1].time === 300_000);
        check("crypto candles: numbers, high >= low",
            body.candles.every(c => [c.open, c.high, c.low, c.close].every(Number.isFinite) && c.high >= c.low));
        check("crypto candles: reports interval length", body.intervalMs === 300_000);

        // Two quick calls share one upstream request.
        const before = (await mock("/__mock/stats")).body.counts.binance;
        await get(MAIN, "/api/market/candles?market=crypto&symbol=SOLUSDT&interval=5m&limit=3");
        await get(MAIN, "/api/market/candles?market=crypto&symbol=SOLUSDT&interval=5m&limit=3");
        const after = (await mock("/__mock/stats")).body.counts.binance;

        check("crypto candles: repeat call is served from cache", after - before === 1, `upstream calls: ${after - before}`);

        // The cache expires, so the live candle keeps moving.
        await sleep(1700);
        await get(MAIN, "/api/market/candles?market=crypto&symbol=SOLUSDT&interval=5m&limit=3");
        const later = (await mock("/__mock/stats")).body.counts.binance;

        check("crypto candles: fresh data is fetched after the cache expires", later - after === 1);
    }

    // ---------- forex candles ----------
    {
        const { status, body } = await get(MAIN, "/api/market/candles?market=forex&symbol=EURUSD&interval=5m&limit=3");

        check("forex candles: 200 and 3 candles",
            status === 200 && body.success && body.candles.length === 3, JSON.stringify(body).slice(0, 160));
        check("forex candles: pair shown as EUR/USD", body.symbol === "EUR/USD");
        check("forex candles: prices look like EUR/USD",
            body.candles.every(c => c.close > 1.0 && c.close < 1.2));
        check("forex candles: times are UTC (aligned to the 5 minute grid)",
            body.candles.every(c => c.time % 300_000 === 0));
        check("forex candles: no volume reported as 0", body.candles.every(c => c.volume === 0));

        const slash = await get(MAIN, "/api/market/candles?market=forex&symbol=usd/cad&interval=15m&limit=2");
        check("forex candles: 'usd/cad' accepted", slash.body.success && slash.body.symbol === "USD/CAD");

        const dash = await get(MAIN, "/api/market/candles?market=forex&symbol=AUD-USD&interval=1h&limit=2");
        check("forex candles: 'AUD-USD' accepted", dash.body.success && dash.body.symbol === "AUD/USD");
    }

    // ---------- history (scrolling back) ----------
    {
        const first = await get(MAIN, "/api/market/candles?market=crypto&symbol=BTCUSDT&interval=15m&limit=10");
        const oldest = first.body.candles[0].time;

        const older = await get(MAIN, `/api/market/candles?market=crypto&symbol=BTCUSDT&interval=15m&limit=10&before=${oldest}`);

        check("history crypto: 10 older candles, all before the cut-off",
            older.body.success && older.body.candles.length === 10 &&
            older.body.candles.every(c => c.time < oldest));
        check("history crypto: joins the newer candles without a gap",
            oldest - older.body.candles[9].time === 900_000);

        const fx = await get(MAIN, "/api/market/candles?market=forex&symbol=EURUSD&interval=15m&limit=10");
        const fxOldest = fx.body.candles[0].time;
        const fxOlder = await get(MAIN, `/api/market/candles?market=forex&symbol=EURUSD&interval=15m&limit=10&before=${fxOldest}`);

        check("history forex: 10 older candles, all before the cut-off",
            fxOlder.body.success && fxOlder.body.candles.length === 10 &&
            fxOlder.body.candles.every(c => c.time < fxOldest), JSON.stringify(fxOlder.body).slice(0, 160));
        check("history forex: joins the newer candles without a gap",
            fxOldest - fxOlder.body.candles[9].time === 900_000);
    }

    // ---------- analysis ----------
    {
        const crypto = await get(MAIN, "/api/market/analyze/multi?market=crypto&symbol=BTCUSDT");
        const old = await get(MAIN, "/api/market/analyze/crypto/multi?symbol=BTCUSDT");

        check("analysis crypto: succeeds", crypto.body.success && crypto.body.analysis.finalSignal);
        check("analysis crypto: older address still works", old.body.success && old.body.symbol === "BTCUSDT");
        check("analysis crypto: market is reported", crypto.body.analysis.market === "crypto");

        const forex = await get(MAIN, "/api/market/analyze/multi?market=forex&symbol=EURUSD");
        const a = forex.body.analysis;

        check("analysis forex: succeeds", forex.body.success && a && a.finalSignal, JSON.stringify(forex.body).slice(0, 200));
        check("analysis forex: symbol shown as EUR/USD", forex.body.symbol === "EUR/USD");
        check("analysis forex: all four timeframes analysed",
            ["4H", "1H", "15M", "5M"].every(tf => a.timeframes[tf] && a.chart[tf].candles.length === 200));
        check("analysis forex: price is a currency price", a.timeframes["5M"].price > 1 && a.timeframes["5M"].price < 1.2);
        // NaN turns into null in JSON, so check the key numbers directly.
        check("analysis forex: price and indicators are real numbers on every timeframe",
            ["4H", "1H", "15M", "5M"].every(tf => {
                const t = a.timeframes[tf];
                return [t.price, t.indicators.rsi, t.indicators.ema20, t.indicators.ema50].every(Number.isFinite);
            }));
        check("analysis forex: chart candles are real numbers",
            ["4H", "1H", "15M", "5M"].every(tf =>
                a.chart[tf].candles.every(c => [c.time, c.open, c.high, c.low, c.close].every(Number.isFinite))));
        check("analysis forex: sequence reasons have no repeats",
            ["4H", "1H", "15M", "5M"].every(tf => {
                const r = a.timeframes[tf].marketSequence.reasons;
                return r.length === new Set(r).size;
            }));

        const shortcut = await get(MAIN, "/api/market/analyze/forex/multi?symbol=USDCAD");
        check("analysis forex: shortcut address works", shortcut.body.success && shortcut.body.symbol === "USD/CAD");

        const fxPath = await get(MAIN, "/api/market/analyze/multi?market=forex&symbol=AUDUSD");
        check("analysis forex: AUD/USD works", fxPath.body.success && fxPath.body.analysis.market === "forex");
    }

    // ---------- validation ----------
    {
        const badPair = await get(MAIN, "/api/market/candles?market=forex&symbol=EUR&interval=5m");
        check("validation: bad forex pair gives 400 and a clear message",
            badPair.status === 400 && /EUR\/USD/.test(badPair.body.message));

        const badMarket = await get(MAIN, "/api/market/candles?market=stocks&symbol=AAPL");
        check("validation: unknown market gives 400", badMarket.status === 400);

        const badInterval = await get(MAIN, "/api/market/candles?market=crypto&symbol=BTCUSDT&interval=7m");
        check("validation: unknown interval gives 400", badInterval.status === 400);

        const badCrypto = await get(MAIN, "/api/market/candles?market=crypto&symbol=BT&interval=5m");
        check("validation: bad crypto symbol gives 400", badCrypto.status === 400);

        const unknownPair = await get(MAIN, "/api/market/candles?market=forex&symbol=ZZZYYY&interval=5m");
        check("validation: unknown pair gives 400 from the provider", unknownPair.status === 400, unknownPair.body.message);
    }

    // ---------- provider failures ----------
    {
        await mock("/__mock/set?binance=451");
        const blocked = await get(MAIN, "/api/market/candles?market=crypto&symbol=XRPUSDT&interval=5m&limit=3");

        check("failure: Binance 451 is passed on in the message",
            !blocked.body.success && /451/.test(blocked.body.message), blocked.body.message);

        await mock("/__mock/set");

        // Forex limit: serve recent data when possible, otherwise a clear 429.
        await get(MAIN, "/api/market/candles?market=forex&symbol=GBPUSD&interval=5m&limit=3");
        await sleep(1500);
        await mock("/__mock/set?twelve=429");

        const stale = await get(MAIN, "/api/market/candles?market=forex&symbol=GBPUSD&interval=5m&limit=3");

        check("failure: forex limit with recent data returns it marked stale",
            stale.body.success && stale.body.stale === true, JSON.stringify(stale.body).slice(0, 160));

        const noData = await get(MAIN, "/api/market/candles?market=forex&symbol=NZDUSD&interval=5m&limit=3");

        check("failure: forex limit with no data gives 429 and a message",
            noData.status === 429 && /limit/i.test(noData.body.message), `${noData.status} ${noData.body.message}`);

        await mock("/__mock/set");
    }

    // ---------- our own rate limiter (3 per minute) ----------
    {
        const pairs = ["EURUSD", "USDCAD", "AUDUSD", "GBPUSD", "USDJPY"];
        const out = [];

        for (const pair of pairs) {
            out.push(await get(LIMITED, `/api/market/candles?market=forex&symbol=${pair}&interval=5m&limit=3`));
        }

        const ok = out.filter(r => r.body.success).length;
        const limited = out.filter(r => r.status === 429);

        check("rate limit: first 3 forex calls succeed", ok === 3, `succeeded: ${ok}`);
        check("rate limit: the rest get 429 with a retry time",
            limited.length === 2 && limited.every(r => r.body.retryAfterMs > 0), JSON.stringify(limited[0]?.body));
    }

    // ---------- the API key must never be sent to the browser ----------
    {
        const sample = await get(MAIN, "/api/market/analyze/multi?market=forex&symbol=EURUSD");
        check("security: responses never contain the API key", !JSON.stringify(sample.body).includes("test-key"));
    }

} catch (error) {
    check("test run completed without crashing", false, error.stack || error.message);
} finally {
    for (const child of children) child.kill();
}

const failed = results.filter(r => !r.ok);

for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${!r.ok && r.detail ? `\n      ${r.detail}` : ""}`);
}

console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);

process.exit(failed.length ? 1 : 0);
