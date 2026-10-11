/*
 * Gate model.
 *
 * The multi-timeframe decision engine works as a sequence of gates.
 * A signal is only issued when every gate passes, in order. This
 * module turns the engine's final `state` into a list of gates with
 * a status (passed, blocked, pending) and a plain-language detail,
 * so the dashboard can show exactly where the signal is stuck.
 *
 * Pure functions, no DOM.
 */

import { capitalize, directionWord } from "./format.js";

export const GATES = [
    { id: "bias", name: "Bias", timeframe: "4H and 1H" },
    { id: "setup", name: "Setup", timeframe: "15M" },
    { id: "confirmation", name: "Confirmation", timeframe: "5M" },
    { id: "retest", name: "First test", timeframe: "5M" },
    { id: "entry", name: "Entry", timeframe: "" }
];

// The most points the decision engine can award.
export const MAX_CONFIDENCE = 14;

/*
 * Index of the gate that stopped the signal, or -1 when every
 * gate passed.
 */
export function blockedGateIndex(decision) {
    const state = decision?.state;

    switch (state) {
        case "BUY_READY":
        case "SELL_READY":
            return -1;

        case "NO_BIAS":
            return 0;

        case "CONFLICT": {
            // Either 4H vs 1H (bias gate) or 5M vs 15M (confirmation gate).
            const d4 = decision.timeframes?.["4H"]?.direction;
            const d1 = decision.timeframes?.["1H"]?.direction;

            const biasConflict =
                d4 && d1 &&
                d4 !== "NEUTRAL" &&
                d1 !== "NEUTRAL" &&
                d4 !== d1;

            return biasConflict ? 0 : 2;
        }

        case "WAITING_FOR_SETUP":
        case "PULLBACK_TO_ZONE":
            return 1;

        case "BULLISH_SETUP":
        case "BEARISH_SETUP":
        case "WAITING_FOR_CONFIRMATION":
        case "COUNTER_TREND_BULLISH":
        case "COUNTER_TREND_BEARISH":
            return 2;

        case "WAITING_FOR_RETEST":
        case "WAITING_FOR_HTF_ZONE":
            return 3;

        default:
            return 0;
    }
}

function retestDetail(status) {
    switch (status) {
        case "WAITING_FOR_FIRST_TEST":
        case "WAITING_FOR_RETEST":
            return "Waiting for price to test the order block or fair value gap for the first time.";
        case "FIRST_TEST_IN_PROGRESS":
        case "RETEST_ACTIVE":
            return "Price is testing the zone for the first time. Waiting for it to hold.";
        case "FIRST_TEST_PASSED":
            return "The first test already held a while ago, so that entry has passed.";
        case "RETEST_IN_PROGRESS":
            return "Price is retesting the zone (it was tested before). Waiting for it to hold.";
        case "RETEST_PASSED":
            return "The retest already held a while ago, so that entry has passed.";
        case "ZONE_BROKEN":
            return "Price closed through the zone, so it did not hold.";
        case "NO_RETEST_ZONE":
        case "NO_RETEST":
        case "NONE":
        case undefined:
        case null:
            return "No order block or fair value gap to retest on 5M yet.";
        case "INVALIDATED_BY_STRUCTURE_REVERSAL":
            return "The earlier zone was invalidated by a structure reversal.";
        case "SEQUENCE_STALE":
            return "The earlier sequence is too old to trade.";
        default:
            return "No valid first test on 5M yet.";
    }
}

function blockedDetail(id, decision) {
    const tf = decision.timeframes || {};
    const d4 = directionWord(tf["4H"]?.direction);
    const d1 = directionWord(tf["1H"]?.direction);
    const d15 = directionWord(tf["15M"]?.direction);
    const d5 = directionWord(tf["5M"]?.direction);
    const bias = directionWord(decision.higherTimeframeBias);

    switch (id) {
        case "bias":
            if (decision.state === "CONFLICT") {
                return `4H is ${d4} but 1H is ${d1}.`;
            }
            return "Neither 4H nor 1H shows a clear direction.";

        case "setup":
            if (d15 === "neutral") {
                return "15M has no directional setup yet.";
            }
            return `15M is ${d15}, against the ${bias} bias. That is a pullback, so waiting for 15M to turn back ${bias}.`;

        case "confirmation":
            if (d5 === "neutral") {
                return "5M has no confirmed direction yet.";
            }
            if (d5 !== d15) {
                return `5M is ${d5} but the 15M setup is ${d15}.`;
            }
            return `5M is ${d5}, but its market event is not confirmed yet.`;

        case "retest":
            if (decision.state === "WAITING_FOR_HTF_ZONE") {
                return "Price is not at a 4H/1H zone. Waiting for it to return to one.";
            }
            return retestDetail(decision.retestStatus);

        default:
            return "No entry until every gate above passes.";
    }
}

function passedDetail(id, decision) {
    const tf = decision.timeframes || {};
    const d4 = directionWord(tf["4H"]?.direction);
    const d1 = directionWord(tf["1H"]?.direction);
    const d15 = directionWord(tf["15M"]?.direction);
    const d5 = directionWord(tf["5M"]?.direction);
    const bias = directionWord(decision.higherTimeframeBias);

    switch (id) {
        case "bias":
            return `${capitalize(bias)} bias. 4H is ${d4}, 1H is ${d1}.`;
        case "setup":
            return `15M is ${d15}, matching the ${bias} bias.`;
        case "confirmation":
            return `5M is ${d5}, agrees with 15M, and its event is confirmed.`;
        case "retest":
            return "Price is inside both the order block and the fair value gap on 5M.";
        default:
            return decision.state === "BUY_READY"
                ? "Buy signal issued."
                : "Sell signal issued.";
    }
}

function pendingDetail(id, decision) {
    const bias = directionWord(decision.higherTimeframeBias);

    switch (id) {
        case "bias":
            return "Needs 4H and 1H pointing the same way.";
        case "setup":
            return bias === "neutral"
                ? "Needs a 15M setup in the bias direction."
                : `Needs a ${bias} setup on 15M.`;
        case "confirmation":
            return "Needs 5M to agree with the 15M setup.";
        case "retest":
            return "Needs price back inside an order block and fair value gap.";
        default:
            return "No entry until every gate above passes.";
    }
}

/*
 * Build the gate list for a decision.
 *
 * Returns { gates, blockedIndex, tone }.
 *   gates[i].status is "passed", "blocked" or "pending".
 *   tone is "buy", "sell" or "wait" and drives the colour.
 */
export function buildGates(decision) {
    const blockedIndex = blockedGateIndex(decision || {});

    const gates = GATES.map((gate, index) => {
        let status = "pending";

        if (blockedIndex === -1 || index < blockedIndex) {
            status = "passed";
        } else if (index === blockedIndex) {
            status = "blocked";
        }

        let detail;

        if (status === "passed") detail = passedDetail(gate.id, decision || {});
        else if (status === "blocked") detail = blockedDetail(gate.id, decision || {});
        else detail = pendingDetail(gate.id, decision || {});

        return { ...gate, status, detail };
    });

    let tone = "wait";
    if (decision?.state === "BUY_READY") tone = "buy";
    if (decision?.state === "SELL_READY") tone = "sell";

    return { gates, blockedIndex, tone };
}

/*
 * One-sentence explanation of the current state, for the
 * headline of the decision panel.
 */
export function describeState(decision) {
    const state = decision?.state;
    const bias = directionWord(decision?.higherTimeframeBias);
    const tf = decision?.timeframes || {};

    switch (state) {
        case "BUY_READY":
            return "Every gate passed. Bullish bias, a 15M setup, and the 5M zone test holding.";
        case "SELL_READY":
            return "Every gate passed. Bearish bias, a 15M setup, and the 5M zone test holding.";
        case "NO_BIAS":
            return "No clear direction on 4H or 1H, so there is nothing to trade yet.";
        case "CONFLICT": {
            const index = blockedGateIndex(decision);

            if (index === 0) {
                return `4H is ${directionWord(tf["4H"]?.direction)} but 1H is ${directionWord(tf["1H"]?.direction)}. Waiting for them to agree.`;
            }

            return `5M is ${directionWord(tf["5M"]?.direction)} but the 15M setup is ${directionWord(tf["15M"]?.direction)}. Waiting for them to agree.`;
        }
        case "PULLBACK_TO_ZONE":
            return `Higher timeframes lean ${bias}. 15M is pulling back into a 4H/1H zone. Waiting for 15M to turn back ${bias}.`;
        case "WAITING_FOR_SETUP":
            return `Higher timeframes lean ${bias}. 15M has no matching setup yet.`;
        case "WAITING_FOR_CONFIRMATION":
        case "BULLISH_SETUP":
        case "BEARISH_SETUP":
            return `The 15M ${bias} setup is in place. Waiting for 5M to confirm.`;
        case "WAITING_FOR_RETEST":
            return `Direction is ${bias} and 5M agrees. Waiting for the first test of the order block and fair value gap to hold.`;
        case "WAITING_FOR_HTF_ZONE":
            return `Direction is ${bias} and 5M agrees, but price is not at a 4H/1H zone. Waiting for it to return to one.`;
        case "COUNTER_TREND_BULLISH":
        case "COUNTER_TREND_BEARISH":
            return "5M is moving against the higher-timeframe bias, so no standard signal is issued.";
        default:
            return "Waiting for the analysis.";
    }
}
