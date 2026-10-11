export function generateTradeSetup({
    higherTimeframe,
    oneHour,
    fifteenMinute,
    fiveMinute
}) {
    const result = {
        direction: "WAIT",
        status: "NO_SETUP",

        entry: null,
        stopLoss: null,
        takeProfit1: null,
        takeProfit2: null,

        riskReward: null,

        reasons: []
    };

    /*
     * ------------------------------------------------
     * 1. DETERMINE HIGHER-TIMEFRAME DIRECTION
     * ------------------------------------------------
     */

    let htfDirection = "NEUTRAL";

    if (
        higherTimeframe.marketStructure.structure ===
        "BULLISH"
    ) {
        htfDirection = "BULLISH";
    }

    if (
        higherTimeframe.marketStructure.structure ===
        "BEARISH"
    ) {
        htfDirection = "BEARISH";
    }

    /*
     * ------------------------------------------------
     * 2. CHECK 1H STRUCTURE
     * ------------------------------------------------
     */

    let oneHourDirection = "NEUTRAL";

    if (
        oneHour.marketStructure.structure ===
        "BULLISH"
    ) {
        oneHourDirection = "BULLISH";
    }

    if (
        oneHour.marketStructure.structure ===
        "BEARISH"
    ) {
        oneHourDirection = "BEARISH";
    }

    /*
     * ------------------------------------------------
     * 3. REQUIRE HTF + 1H AGREEMENT
     * ------------------------------------------------
     */

    if (
        htfDirection === "NEUTRAL" ||
        oneHourDirection === "NEUTRAL"
    ) {
        result.reasons.push(
            "Higher timeframes are not aligned"
        );

        return result;
    }

    if (
        htfDirection !== oneHourDirection
    ) {
        result.reasons.push(
            "4H and 1H direction conflict"
        );

        return result;
    }

    /*
     * ------------------------------------------------
     * 4. DETERMINE TRADE DIRECTION
     * ------------------------------------------------
     */

    const direction =
        htfDirection === "BULLISH"
            ? "BUY"
            : "SELL";

    result.direction = direction;

    /*
     * ------------------------------------------------
     * 5. CHECK 15M STRUCTURE
     * ------------------------------------------------
     */

    const fifteenStructure =
        fifteenMinute.marketStructure.structure;

    if (
        direction === "BUY" &&
        fifteenStructure !== "BULLISH"
    ) {
        result.status = "WAITING_FOR_BULLISH_SETUP";

        result.reasons.push(
            "Waiting for 15M bullish structure"
        );

        return result;
    }

    if (
        direction === "SELL" &&
        fifteenStructure !== "BEARISH"
    ) {
        result.status = "WAITING_FOR_BEARISH_SETUP";

        result.reasons.push(
            "Waiting for 15M bearish structure"
        );

        return result;
    }

    /*
     * ------------------------------------------------
     * 6. CHECK 5M CONFIRMATION
     * ------------------------------------------------
     */

    if (
        direction === "BUY" &&
        fiveMinute.signal !== "BUY"
    ) {
        result.status =
            "WAITING_FOR_5M_CONFIRMATION";

        result.reasons.push(
            "Waiting for 5M BUY confirmation"
        );

        return result;
    }

    if (
        direction === "SELL" &&
        fiveMinute.signal !== "SELL"
    ) {
        result.status =
            "WAITING_FOR_5M_CONFIRMATION";

        result.reasons.push(
            "Waiting for 5M SELL confirmation"
        );

        return result;
    }

    /*
     * ------------------------------------------------
     * 7-12. ENTRY, STOP, TARGETS, RISK / REWARD
     * ------------------------------------------------
     */

    return applyLevels({
        result,
        direction,
        fifteenMinute,
        fiveMinute,
        readyReason: "All timeframe conditions confirmed"
    });
}


/*
 * ==========================================================
 * TRADE LEVELS DRIVEN BY THE MULTI-TIMEFRAME DECISION
 * ==========================================================
 *
 * The decision engine is authoritative for direction. Levels
 * are only produced when it says BUY_READY or SELL_READY, so
 * the numbers can never disagree with the final signal.
 */

export function generateTradeLevels({
    decision,
    fifteenMinute,
    fiveMinute,
    fallbackStopPct = 0.005
}) {
    const result = {
        direction: "WAIT",
        status: "NO_SETUP",

        entry: null,
        stopLoss: null,
        takeProfit1: null,
        takeProfit2: null,

        riskReward: null,

        reasons: []
    };

    const state = decision?.state;

    if (state !== "BUY_READY" && state !== "SELL_READY") {
        result.reasons.push(
            state
                ? `No trade levels: decision state is ${state}`
                : "No trade levels: no decision available"
        );

        return result;
    }

    const direction =
        state === "BUY_READY"
            ? "BUY"
            : "SELL";

    result.direction = direction;

    return applyLevels({
        result,
        direction,
        fifteenMinute,
        fiveMinute,
        fallbackStopPct,
        readyReason: "Levels derived from the multi-timeframe decision"
    });
}


/*
 * ==========================================================
 * SHARED LEVEL CALCULATION
 * ==========================================================
 *
 * Entry   = latest 5M price
 * Stop    = far edge of the 15M demand/supply zone, but only if
 *           it sits on the correct side of entry. Otherwise a
 *           percentage stop is used (0.5% by default, set per
 *           market in config/marketProfiles.js).
 * Targets = 2R and 3R
 */

function applyLevels({
    result,
    direction,
    fifteenMinute,
    fiveMinute,
    readyReason,
    fallbackStopPct = 0.005
}) {
    const entry = fiveMinute.price;

    result.entry = entry;

    const zone = fifteenMinute.supplyDemand;

    // "ZONE" when the stop sits at a supply/demand zone,
    // "PERCENT" when the fallback distance is used.
    result.stopMethod = "PERCENT";
    result.stopPercent = fallbackStopPct;

    if (direction === "BUY") {
        const zoneStop =
            zone &&
            zone.detected &&
            zone.type === "DEMAND" &&
            zone.zone
                ? zone.zone.low
                : null;

        if (zoneStop != null && zoneStop < entry) {
            result.stopLoss = zoneStop;
            result.stopMethod = "ZONE";
        } else {
            result.stopLoss = entry * (1 - fallbackStopPct);
        }
    } else {
        const zoneStop =
            zone &&
            zone.detected &&
            zone.type === "SUPPLY" &&
            zone.zone
                ? zone.zone.high
                : null;

        if (zoneStop != null && zoneStop > entry) {
            result.stopLoss = zoneStop;
            result.stopMethod = "ZONE";
        } else {
            result.stopLoss = entry * (1 + fallbackStopPct);
        }
    }

    const risk = Math.abs(entry - result.stopLoss);

    if (!(risk > 0)) {
        result.direction = "WAIT";
        result.status = "INVALID_SETUP";

        result.reasons.push("Invalid risk calculation");

        return result;
    }

    if (direction === "BUY") {
        result.takeProfit1 = entry + risk * 2;
        result.takeProfit2 = entry + risk * 3;
    } else {
        result.takeProfit1 = entry - risk * 2;
        result.takeProfit2 = entry - risk * 3;
    }

    result.riskReward = {
        tp1: 2,
        tp2: 3
    };

    result.status = "READY";

    result.reasons.push(readyReason);

    return result;
}
