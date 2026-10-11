import assert from "node:assert/strict";
import { buildGates, describeState, blockedGateIndex, GATES } from "../src/lib/gates.js";

const tf = (d4, d1, d15, d5) => ({
    "4H": { direction: d4 }, "1H": { direction: d1 },
    "15M": { direction: d15 }, "5M": { direction: d5 }
});

const statuses = d => buildGates(d).gates.map(g => g.status).join(",");

// every state maps to the right blocking gate
const cases = [
    [{ state: "NO_BIAS", timeframes: tf("NEUTRAL","NEUTRAL","NEUTRAL","NEUTRAL") }, 0, "blocked,pending,pending,pending,pending"],
    [{ state: "CONFLICT", timeframes: tf("BULLISH","BEARISH","NEUTRAL","NEUTRAL") }, 0, "blocked,pending,pending,pending,pending"],
    [{ state: "CONFLICT", timeframes: tf("BULLISH","BULLISH","BULLISH","BEARISH") }, 2, "passed,passed,blocked,pending,pending"],
    [{ state: "WAITING_FOR_SETUP", higherTimeframeBias: "BEARISH", timeframes: tf("BEARISH","BEARISH","NEUTRAL","NEUTRAL") }, 1, "passed,blocked,pending,pending,pending"],
    [{ state: "WAITING_FOR_CONFIRMATION", higherTimeframeBias: "BULLISH", timeframes: tf("BULLISH","BULLISH","BULLISH","NEUTRAL") }, 2, "passed,passed,blocked,pending,pending"],
    [{ state: "WAITING_FOR_RETEST", higherTimeframeBias: "BULLISH", retestStatus: "WAITING_FOR_RETEST", timeframes: tf("BULLISH","BULLISH","BULLISH","BULLISH") }, 3, "passed,passed,passed,blocked,pending"],
    [{ state: "BUY_READY", higherTimeframeBias: "BULLISH", timeframes: tf("BULLISH","BULLISH","BULLISH","BULLISH") }, -1, "passed,passed,passed,passed,passed"],
    [{ state: "SELL_READY", higherTimeframeBias: "BEARISH", timeframes: tf("BEARISH","BEARISH","BEARISH","BEARISH") }, -1, "passed,passed,passed,passed,passed"],
    [{ state: "SOMETHING_NEW" }, 0, "blocked,pending,pending,pending,pending"]
];

for (const [decision, index, expected] of cases) {
    assert.equal(blockedGateIndex(decision), index, decision.state);
    assert.equal(statuses(decision), expected, decision.state);
    assert.equal(buildGates(decision).gates.length, GATES.length);
    assert.ok(describeState(decision).length > 10);
    for (const g of buildGates(decision).gates) assert.ok(g.detail && g.detail.length > 5, `${decision.state}/${g.id} detail`);
}

assert.equal(buildGates({ state: "BUY_READY", timeframes: tf("BULLISH","BULLISH","BULLISH","BULLISH") }).tone, "buy");
assert.equal(buildGates({ state: "SELL_READY", timeframes: tf("BEARISH","BEARISH","BEARISH","BEARISH") }).tone, "sell");
assert.equal(buildGates({ state: "WAITING_FOR_RETEST" }).tone, "wait");
assert.equal(buildGates(undefined).gates[0].status, "blocked"); // never throws on missing data

// retest wording
const d = { state: "WAITING_FOR_RETEST", retestStatus: "RETEST_ACTIVE", higherTimeframeBias: "BULLISH", timeframes: tf("BULLISH","BULLISH","BULLISH","BULLISH") };
assert.match(buildGates(d).gates[3].detail, /both/);
// counter-trend wording on setup gate
const c = { state: "WAITING_FOR_SETUP", higherTimeframeBias: "BULLISH", timeframes: tf("BULLISH","BULLISH","BEARISH","NEUTRAL") };
assert.match(buildGates(c).gates[1].detail, /against the bullish bias/);

console.log(`gates: ${cases.length + 4} checks passed`);
