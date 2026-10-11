import { generateMultiTimeframeDecision } from "../src/strategies/multiTimeframeDecisionEngine.js";
let fails = 0;
const ok = (n, c) => { if (!c) fails++; console.log(c ? "PASS" : "FAIL", n); };
const tf = (dir, price, zones = []) => ({
  price, signal: "WAIT",
  marketStructure: { structure: dir },
  structureReconciliation: { state: "ALIGNED", direction: dir },
  supplyDemand: { zones },
});
const probe = (a15, price) => generateMultiTimeframeDecision({
  analysis4H: tf("BULLISH", price, [{ type: "DEMAND", low: 99, high: 101 }]),
  analysis1H: tf("BULLISH", price),
  analysis15M: tf(a15, price),
  analysis5M: tf("NEUTRAL", price),
});
const d = probe("BEARISH", 100);
console.log(d.state, d.reasons.join(" | "));
ok("15M pullback in 4H demand zone -> PULLBACK_TO_ZONE", d.state === "PULLBACK_TO_ZONE");
ok("never a trade signal", d.direction === "NEUTRAL");
ok("zone reported", d.higherTimeframeZone?.status === "IN_ZONE");
const f = probe("BEARISH", 110);
ok("far from zone -> WAITING_FOR_SETUP", f.state === "WAITING_FOR_SETUP");

// Entry gate: full bullish stack, with and without a 4H/1H zone nearby.
const full = (price, zones) => {
  const mk = (dir, extra = {}) => ({ ...tf(dir, price, zones), ...extra });
  const ev = { active: true, confirmed: true, direction: "BULLISH" };
  return generateMultiTimeframeDecision({
    analysis4H: mk("BULLISH", { supplyDemand: { zones } }),
    analysis1H: mk("BULLISH"),
    analysis15M: mk("BULLISH"),
    analysis5M: mk("BULLISH", { activeEvent: ev, obFvgRetest: { detected: true, confirmed: true } }),
  });
};
const at = full(100, [{ type: "DEMAND", low: 99, high: 101 }]);
ok("full stack at 4H demand zone -> BUY_READY", at.state === "BUY_READY");
ok("entryType carried through", at.entryType === "FIRST_TEST" || at.entryType === "RETEST", String(at.entryType));
const away = full(130, [{ type: "DEMAND", low: 99, high: 101 }]);
ok("full stack far from zone -> WAITING_FOR_HTF_ZONE", away.state === "WAITING_FOR_HTF_ZONE" && away.direction === "NEUTRAL");
const none = full(100, []);
ok("no zone -> WAITING_FOR_HTF_ZONE", none.state === "WAITING_FOR_HTF_ZONE");
process.exit(fails ? 1 : 0);
