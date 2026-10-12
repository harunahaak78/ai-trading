import fs from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.PAPER_DATA_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "paper-")), "paper.json");
process.env.PAPER_PAIRS = "crypto:BTCUSDT";
process.env.CRYPTO_LIVE_MS = "50";
process.env.CRYPTO_ANALYSIS_MS = "100";

const t = await import("../src/paper/trader.js");
let fails = 0;
const ok = (n, c, d = "") => { if (!c) fails++; console.log(c ? "PASS" : "FAIL", n, c ? "" : d); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const M5 = 300000;
const now0 = Math.floor(Date.now() / M5) * M5;
let phase = "signal";
const candle = (i, o, h, l, c) => ({ time: now0 + i * M5, open: o, high: h, low: l, close: c });
const series = () => {
  const base = Array.from({ length: 30 }, (_, i) => candle(i - 30, 100, 100.5, 99.5, 100));
  if (phase === "signal") return [...base, candle(0, 100, 100.2, 99.8, 100)];
  if (phase === "win") return [...base, candle(0, 100, 100.2, 99.8, 100), candle(1, 100, 103.5, 100, 103)];
  return base;
};
t.deps.getMultiTimeframeCandles = async () => {
  const c = series();
  return { candles4H: c, candles1H: c, candles15M: c, candles5M: c, fetchedAt: Date.now(), stale: false };
};
t.deps.getCandles = async () => ({ candles: series(), fetchedAt: Date.now(), stale: false });
t.deps.analyzeMultiTimeframe = () => ({
  finalSignal: phase === "signal" ? "BUY" : "WAIT",
  status: "BUY_READY",
  multiTimeframeDecision: { state: "BUY_READY", confidence: 9, reasons: ["test reason"], entryType: "FIRST_TEST", timeframes: { "4H": { direction: "BULLISH" } } },
  tradeSetup: { status: "READY", direction: "BUY", entry: 100, stopLoss: 99, takeProfit1: 102, takeProfit2: 103, entryType: "FIRST_TEST" },
  timeframes: { "5M": { obFvgRetest: { zone: { low: 99.5, high: 100.5 }, firstTest: { index: 25, entryType: "FIRST_TEST" } } } },
});

t.startPaperTrader();
await sleep(700);
let o = t.overview();
ok("a ready signal opens a demo trade", o.open.length === 1, JSON.stringify(o.log));
ok("risk is 1% of $1000", o.open[0] && Math.abs(o.open[0].riskAmount - 10) < 0.1);
ok("signal is journaled with its reasons", o.open[0]?.why.reasons[0] === "test reason" && o.open[0].entryType === "FIRST_TEST");
await sleep(500);
ok("the same signal is not traded twice", t.journal().length === 1, String(t.journal().length));

phase = "win";
await sleep(700);
o = t.overview();
const trade = t.journal()[0];
ok("trade closes at target 2", trade.status === "CLOSED" && trade.closeReason === "TAKE_PROFIT_2", JSON.stringify([trade.status, trade.closeReason]));
ok("balance grew by about 25 minus 0.1% crypto fees", o.summary.balance > 1021 && o.summary.balance < 1025, String(o.summary.balance));
ok("log has entry, exits and close", ["ENTRY", "EXIT", "CLOSED"].every(x => o.log.some(l => l.type === x)), o.log.map(l => l.type).join());

t.setRunning(false);
phase = "signal";
t.deps.analyzeMultiTimeframe = (...a) => ({ ...({
  finalSignal: "BUY", status: "BUY_READY",
  multiTimeframeDecision: { state: "BUY_READY", reasons: [], timeframes: {} },
  tradeSetup: { status: "READY", direction: "BUY", entry: 100, stopLoss: 99, takeProfit1: 102, takeProfit2: 103, entryType: "RETEST" },
  timeframes: { "5M": { obFvgRetest: { zone: { low: 1, high: 2 }, firstTest: { index: 1 } } } } }) });
await sleep(500);
ok("paused: no new entries", t.journal().length === 1);

t.stopPaperTrader();
const saved = JSON.parse(fs.readFileSync(process.env.PAPER_DATA_FILE, "utf8"));
ok("state saved to file", saved.account.trades.length === 1 && saved.account.trades[0].status === "CLOSED");
process.exit(fails ? 1 : 0);
