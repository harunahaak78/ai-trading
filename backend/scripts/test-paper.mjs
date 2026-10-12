import { createAccount, openTrade, updateTrades, summarize, openTrades } from "../src/paper/account.js";
let fails = 0;
const ok = (n, c, d = "") => { if (!c) fails++; console.log(c ? "PASS" : "FAIL", n, c ? "" : d); };
const near = (a, b, e = 0.01) => Math.abs(a - b) <= e;
const M5 = 300000, T0 = 1_000_000_000_000;
const k = (i, o, h, l, c) => ({ time: T0 + i * M5, open: o, high: h, low: l, close: c });
const sig = (extra = {}) => ({ market: "forex", symbol: "EUR/USD", direction: "BUY", entry: 100, stop: 99, tp1: 102, tp2: 103, entryType: "FIRST_TEST", entryKey: "a", state: "BUY_READY", reasons: ["r"], ...extra });

// sizing: 1% of 1000 = $10 risk, $1 stop -> 10 units, $1000 notional (cash cap is exactly met)
let a = createAccount();
let r = openTrade(a, sig(), T0 + 10_000);
ok("opens a trade", !!r.trade && a.trades.length === 1);
ok("risk is 1% of balance", near(r.trade.riskAmount, 10) && near(r.trade.qty, 10), JSON.stringify([r.trade.riskAmount, r.trade.qty]));
ok("one trade per pair", openTrade(a, sig({ entryKey: "b" }), T0).skipped?.includes("already open"));

// full win: entry candle only counts by close; next hits TP1 then TP2
updateTrades(a, "EUR/USD", [k(0, 100, 105, 90, 100)], M5, T0 + 60_000);
ok("entry candle extremes ignored", openTrades(a).length === 1 && !openTrades(a)[0].tp1Hit);
updateTrades(a, "EUR/USD", [k(0, 100, 105, 90, 100), k(1, 100, 102.5, 100, 102)], M5, T0 + 600_000);
let t = a.trades[0];
ok("TP1 closes half, stop to entry", t.tp1Hit && t.stop === 100 && near(t.remainingQty, 5), JSON.stringify([t.tp1Hit, t.stop, t.remainingQty]));
updateTrades(a, "EUR/USD", [k(2, 102, 103.5, 101, 103)], M5, T0 + 900_000);
ok("TP2 closes the rest", t.status === "CLOSED" && t.closeReason === "TAKE_PROFIT_2");
ok("pnl = 5*2 + 5*3 = 25 (forex, no fee)", near(t.pnl, 25), String(t.pnl));
ok("R multiple 2.5", near(t.rMultiple, 2.5), String(t.rMultiple));
ok("balance 1025", near(a.balance, 1025), String(a.balance));

// loss
a = createAccount();
openTrade(a, sig(), T0 + 10_000);
updateTrades(a, "EUR/USD", [k(1, 100, 100.5, 98.8, 99)], M5, T0 + 600_000);
t = a.trades[0];
ok("stop loss closes at stop", t.closeReason === "STOP_LOSS" && near(t.pnl, -10) && near(t.rMultiple, -1));
ok("balance 990", near(a.balance, 990));

// same candle touches stop and target -> stop first
a = createAccount();
openTrade(a, sig(), T0 + 10_000);
updateTrades(a, "EUR/USD", [k(1, 100, 102.5, 98.5, 100)], M5, T0 + 600_000);
ok("stop and target in one candle -> stop", a.trades[0].closeReason === "STOP_LOSS");

// breakeven after TP1
a = createAccount();
openTrade(a, sig(), T0 + 10_000);
updateTrades(a, "EUR/USD", [k(1, 100, 102.5, 100.2, 102), k(2, 102, 102.2, 99.5, 100)], M5, T0 + 900_000);
t = a.trades[0];
ok("breakeven stop after TP1 -> small win", t.closeReason === "BREAKEVEN_STOP" && near(t.pnl, 10), String(t.pnl));

// sell side
a = createAccount();
openTrade(a, sig({ direction: "SELL", entry: 100, stop: 101, tp1: 98, tp2: 97 }), T0 + 10_000);
updateTrades(a, "EUR/USD", [k(1, 100, 100.2, 97.5, 98), k(2, 98, 98.1, 96.5, 97)], M5, T0 + 900_000);
ok("sell wins on the way down", a.trades[0].status === "CLOSED" && near(a.trades[0].pnl, 25), String(a.trades[0].pnl));

// repeated signal is not traded twice
a = createAccount();
openTrade(a, sig(), T0 + 10_000);
updateTrades(a, "EUR/USD", [k(1, 100, 100.5, 98.8, 99)], M5, T0 + 600_000);
ok("same setup not re-entered", openTrade(a, sig(), T0 + 700_000).skipped?.includes("already traded"));
ok("a new setup can trade", !!openTrade(a, sig({ entryKey: "new" }), T0 + 700_000).trade);

// cash cap: tiny stop would imply a bigger position than the cash
a = createAccount();
r = openTrade(a, sig({ stop: 99.9, tp1: 100.2, tp2: 100.3 }), T0);
ok("no leverage: notional <= balance", r.trade.notional <= 1000.01 && r.trade.cappedByCash, String(r.trade.notional));
ok("max open trades", (() => { const b = createAccount({ maxOpenTrades: 1 }); openTrade(b, sig(), T0); return !!openTrade(b, sig({ symbol: "USD/CAD", entryKey: "q" }), T0).skipped; })());

// crypto fee
a = createAccount();
r = openTrade(a, sig({ market: "crypto", symbol: "BTCUSDT", entry: 100, stop: 99, tp1: 102, tp2: 103, entryKey: "c" }), T0 + 10_000);
ok("crypto entry fee charged", r.trade.fees > 0 && a.balance < 1000);

// summary
a = createAccount();
openTrade(a, sig(), T0 + 10_000);
updateTrades(a, "EUR/USD", [k(1, 100, 102.5, 100, 102), k(2, 102, 103.5, 101, 103)], M5, T0 + 900_000);
openTrade(a, sig({ entryKey: "z" }), T0 + 1_000_000);
updateTrades(a, "EUR/USD", [k(4, 100, 100.5, 98.8, 99)], M5, T0 + 2_000_000);
const s = summarize(a);
ok("summary counts", s.closedTrades === 2 && s.wins === 1 && s.losses === 1 && s.winRate === 50, JSON.stringify(s));
ok("summary balance and curve", near(s.balance, 1014.75) && s.curve.length === 3, JSON.stringify([s.balance, s.curve.length]));
ok("profit factor 25/10.25", near(s.profitFactor, 2.44), String(s.profitFactor));
process.exit(fails ? 1 : 0);
