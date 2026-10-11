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
process.exit(fails ? 1 : 0);
