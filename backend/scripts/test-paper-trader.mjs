import { newAccount, openTrade, updateTrades, summarize, symbolKey, quoteToUsd } from "../src/services/paperTrader.js";
let fails = 0;
const ok = (n, c, d = "") => { if (!c) fails++; console.log(c ? "PASS" : "FAIL", n, c ? "" : d); };
const near = (a, b, e = 0.02) => Math.abs(a - b) <= e;
const c = (time, o, h, l, cl) => ({ time, open: o, high: h, low: l, close: cl });
const T0 = 1_000_000;
const sig = (o = {}) => ({ market: "crypto", symbol: "BTCUSDT", direction: "BUY", entryType: "FIRST_TEST",
  entry: 100, stop: 99, tp1: 102, tp2: 103, candleTime: T0, now: 5_000, ...o });

// Sizing: 1% of 1000 = $10 risk, stop distance 1 -> 10 units, notional 1000 (<= 5x)
let a = newAccount();
let r = openTrade(a, sig());
ok("opens a trade", r.opened);
ok("risks 1% = $10", near(r.trade.riskUsd, 10), r.trade.riskUsd);
ok("units = 10", near(r.trade.units, 10, 1e-9));

// Leverage cap: tight stop would need a huge size
a = newAccount();
r = openTrade(a, sig({ stop: 99.99, tp1: 100.02, tp2: 100.03 }));
ok("notional capped at 5x balance", r.trade.notionalUsd <= 5000.01 && r.trade.sizeCapped, r.trade.notionalUsd);
ok("capped trade risks less than 1%", r.trade.riskUsd < 10);

// Bad levels
a = newAccount();
ok("rejects stop on wrong side", !openTrade(a, sig({ stop: 101 })).opened);
ok("rejects non BUY/SELL", !openTrade(a, sig({ direction: "WAIT" })).opened);

// Full stop loss: -$10
a = newAccount(); openTrade(a, sig());
let closed = updateTrades(a, symbolKey("crypto","BTCUSDT"), [c(T0,100,100,100,100), c(T0+300000,100,100.5,98.9,99.2)], 9_000);
ok("stop loss closes the trade", closed.length === 1 && closed[0].outcome === "LOSS");
ok("loss = -$10, balance 990", near(a.balance, 990) && near(closed[0].pnlUsd, -10), a.balance);
ok("R multiple = -1", closed[0].rMultiple === -1);

// TP1 then TP2: half at 2R (+10), half at 3R (+15) = +25
a = newAccount(); openTrade(a, sig());
closed = updateTrades(a, symbolKey("crypto","BTCUSDT"), [c(T0,100,100,100,100), c(T0+300000,100,102.2,100.2,102), c(T0+600000,102,103.5,101.5,103)], 9_000);
ok("TP1 then TP2 closes", closed.length === 1 && closed[0].exits.map(e => e.reason).join() === "TP1,TP2", closed[0]?.exits.map(e=>e.reason).join());
ok("pnl = +$25", near(a.balance, 1025), a.balance);
ok("R multiple = 2.5", closed[0].rMultiple === 2.5);

// TP1 then back to entry: half at 2R (+10), rest at breakeven (0)
a = newAccount(); openTrade(a, sig());
closed = updateTrades(a, symbolKey("crypto","BTCUSDT"), [c(T0,100,100,100,100), c(T0+300000,100,102.2,100.5,101.5), c(T0+600000,101.5,101.8,99.9,100.2)], 9_000);
ok("TP1 then breakeven stop", closed.length === 1 && closed[0].closeReason === "BREAKEVEN_STOP" && near(a.balance, 1010), a.balance);
ok("breakeven-after-TP1 counts as a win", closed[0].outcome === "WIN");

// Candle touching both stop and target -> stop first
a = newAccount(); openTrade(a, sig());
closed = updateTrades(a, symbolKey("crypto","BTCUSDT"), [c(T0,100,100,100,100), c(T0+300000,100,102.5,98.5,100)], 9_000);
ok("stop and target in one candle -> stop first", closed[0]?.exits[0].reason === "STOP_LOSS");

// Entry candle: earlier wicks in the entry candle are ignored
a = newAccount(); openTrade(a, sig());
closed = updateTrades(a, symbolKey("crypto","BTCUSDT"), [c(T0,100,100.4,98.0,100)], 9_000);
ok("entry candle's old wick is ignored", closed.length === 0 && a.trades[0].status === "OPEN");

// Idempotent: re-checking the same candles changes nothing
updateTrades(a, symbolKey("crypto","BTCUSDT"), [c(T0,100,100.4,98.0,100), c(T0+300000,100,101,99.5,100.8)], 9_000);
const snap = JSON.stringify(a.trades[0]);
updateTrades(a, symbolKey("crypto","BTCUSDT"), [c(T0,100,100.4,98.0,100), c(T0+300000,100,101,99.5,100.8)], 9_500);
ok("re-checking candles is idempotent", JSON.stringify(a.trades[0]) === snap);

// SELL side
a = newAccount(); openTrade(a, sig({ direction: "SELL", entry: 100, stop: 101, tp1: 98, tp2: 97 }));
closed = updateTrades(a, symbolKey("crypto","BTCUSDT"), [c(T0,100,100,100,100), c(T0+300000,100,100.5,97.8,98), c(T0+600000,98,98.2,96.8,97)], 9_000);
ok("SELL hits TP1 and TP2 for +$25", closed.length === 1 && near(a.balance, 1025), a.balance);

// One trade per pair, cooldown, max open
a = newAccount(); openTrade(a, sig());
ok("second trade on same pair rejected", !openTrade(a, sig()).opened);
updateTrades(a, symbolKey("crypto","BTCUSDT"), [c(T0,100,100,100,100), c(T0+300000,100,100.5,98.9,99.2)], 9_000);
ok("cooldown blocks an immediate re-entry", !openTrade(a, sig({ now: 10_000 })).opened);
ok("allowed again after the cooldown", openTrade(a, sig({ now: 9_000 + 3_700_000 })).opened);
a = newAccount();
openTrade(a, sig({ symbol: "AAAUSDT" })); openTrade(a, sig({ symbol: "BBBUSDT" })); openTrade(a, sig({ symbol: "CCCUSDT" }));
ok("max 3 open trades", !openTrade(a, sig({ symbol: "DDDUSDT" })).opened);

// Forex conversion
ok("EURUSD pnl already in USD", quoteToUsd("forex","EURUSD",1.1) === 1);
ok("USDCAD pnl converted by 1/price", near(quoteToUsd("forex","USDCAD",1.25), 0.8, 1e-9));
ok("EURGBP not supported", quoteToUsd("forex","EURGBP",0.85) === null);
a = newAccount();
r = openTrade(a, sig({ market: "forex", symbol: "EURUSD", entry: 1.1, stop: 1.099, tp1: 1.102, tp2: 1.103 }));
ok("forex EURUSD risks $10", near(r.trade.riskUsd, 10, 0.05), r.trade.riskUsd);
ok("forex cross rejected", !openTrade(newAccount(), sig({ market: "forex", symbol: "EURGBP" })).opened);

// Summary
a = newAccount(); openTrade(a, sig());
updateTrades(a, symbolKey("crypto","BTCUSDT"), [c(T0,100,100,100,100), c(T0+300000,100,102.2,100.2,102), c(T0+600000,102,103.5,101.5,103)], 9_000);
const s = summarize(a);
ok("summary: 1 trade, 100% win, +2.5%", s.trades === 1 && s.winRatePct === 100 && s.returnPct === 2.5 && s.avgR === 2.5, JSON.stringify(s));
process.exit(fails ? 1 : 0);
