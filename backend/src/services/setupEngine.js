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
     * 7. ENTRY PRICE
     * ------------------------------------------------
     */

    const entry =
        fiveMinute.price;

    result.entry = entry;

    /*
     * ------------------------------------------------
     * 8. STOP LOSS
     * ------------------------------------------------
     */

    if (direction === "BUY") {

        const demandZone =
            fifteenMinute.supplyDemand;

        if (
            demandZone.detected &&
            demandZone.type === "DEMAND"
        ) {
            result.stopLoss =
                demandZone.zone.low;
        } else {
            result.stopLoss =
                entry * 0.995;
        }
    }

    if (direction === "SELL") {

        const supplyZone =
            fifteenMinute.supplyDemand;

        if (
            supplyZone.detected &&
            supplyZone.type === "SUPPLY"
        ) {
            result.stopLoss =
                supplyZone.zone.high;
        } else {
            result.stopLoss =
                entry * 1.005;
        }
    }

    /*
     * ------------------------------------------------
     * 9. RISK
     * ------------------------------------------------
     */

    const risk =
        Math.abs(
            entry -
            result.stopLoss
        );

    if (risk <= 0) {
        result.direction = "WAIT";
        result.status = "INVALID_SETUP";

        result.reasons.push(
            "Invalid risk calculation"
        );

        return result;
    }

    /*
     * ------------------------------------------------
     * 10. TAKE PROFITS
     * ------------------------------------------------
     */

    if (direction === "BUY") {

        result.takeProfit1 =
            entry + risk * 2;

        result.takeProfit2 =
            entry + risk * 3;
    }

    if (direction === "SELL") {

        result.takeProfit1 =
            entry - risk * 2;

        result.takeProfit2 =
            entry - risk * 3;
    }

    /*
     * ------------------------------------------------
     * 11. RISK / REWARD
     * ------------------------------------------------
     */

    result.riskReward = {
        tp1: 2,
        tp2: 3
    };

    /*
     * ------------------------------------------------
     * 12. FINAL SETUP
     * ------------------------------------------------
     */

    result.status = "READY";

    result.reasons.push(
        "All timeframe conditions confirmed"
    );

    return result;
}