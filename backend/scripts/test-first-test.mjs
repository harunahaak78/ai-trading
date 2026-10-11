import { detectObFvgRetest } from "../src/strategies/obFvgRetestEngine.js";
let fails = 0;
const ok = (n, c, d = "") => { if (!c) fails++; console.log(c ? "PASS" : "FAIL", n, c ? "" : d); };
const c = (o, h, l, cl) => ({ open: o, high: h, low: l, close: cl });
// Bullish OB 99..101 formed at index 2. Candles after it vary per case.
const base = [c(105,106,104,105), c(104,105,102,103), c(101,101,99,100), c(100,108,100,107)];
const run = tail => detectObFvgRetest({
  candles: [...base, ...tail], direction: "BULLISH",
  orderBlock: { detected: true, type: "BULLISH", high: 101, low: 99, index: 2, strength: 1 },
  fairValueGaps: [],
  marketSequence: { detected: true, confirmed: true, direction: "BULLISH" },
  activeSequence: { stale: false }, structureReconciliation: null,
});
const away = c(108,110,107,109);
let r = run([away, c(109,111,108,110)]);
ok("no touch yet -> WAITING_FOR_FIRST_TEST", r.status === "WAITING_FOR_FIRST_TEST" && !r.confirmed, r.status);
r = run([away, c(108,108,100,107)]);   // wick into zone, closes bullish... within zone? low 100<=101
ok("first touch closing bullish -> FIRST_TEST_HELD", r.status === "FIRST_TEST_HELD" && r.confirmed, r.status);
r = run([away, c(101,101,99.5,100)]); // touches, bearish close inside zone
ok("touch with bearish close, not clear -> IN_PROGRESS", r.status === "FIRST_TEST_IN_PROGRESS" && !r.confirmed, r.status);
r = run([away, c(102,102,98,98.5)]);
ok("close below zone -> ZONE_BROKEN", r.status === "ZONE_BROKEN" && !r.confirmed, r.status);
r = run([c(108,108,100,107), away, c(109,109,100.5,108)]);
ok("second return -> ALREADY_TESTED, no entry", r.status === "ALREADY_TESTED" && !r.confirmed, r.status);
const long = Array.from({ length: 14 }, () => c(109,111,108,110));
r = run([c(108,108,100,107), ...long]);
ok("held long ago -> FIRST_TEST_PASSED, no entry", r.status === "FIRST_TEST_PASSED" && !r.confirmed, r.status);
process.exit(fails ? 1 : 0);
