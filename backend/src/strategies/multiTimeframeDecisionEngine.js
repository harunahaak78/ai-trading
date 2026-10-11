export function generateMultiTimeframeDecision({
    analysis4H,
    analysis1H,
    analysis15M,
    analysis5M
}) {
    const result = {
        state: "NO_BIAS",

        // Actionable direction.
        // Only becomes BUY/SELL when the system is actually ready.
        direction: "NEUTRAL",

        // Separate higher-timeframe bias from actionable direction.
        biasDirection: "NEUTRAL",

        confidence: 0,

        higherTimeframeBias: "NEUTRAL",
        setupDirection: "NEUTRAL",
        entryDirection: "NEUTRAL",

        retestStatus: "NONE",

        reasons: [],

        timeframes: {
            "4H": {},
            "1H": {},
            "15M": {},
            "5M": {}
        }
    };

    const direction4H = getDirection(analysis4H);
    const direction1H = getDirection(analysis1H);
    const direction15M = getDirection(analysis15M);
    const direction5M = getDirection(analysis5M);

    result.timeframes["4H"] = {
        role: "HIGHER_TIMEFRAME_BIAS",
        direction: direction4H,
        activeEvent: getActiveEventName(analysis4H),
        sequence: getSequenceState(analysis4H)
    };

    result.timeframes["1H"] = {
        role: "BIAS_CONFIRMATION",
        direction: direction1H,
        activeEvent: getActiveEventName(analysis1H),
        sequence: getSequenceState(analysis1H)
    };

    result.timeframes["15M"] = {
        role: "SETUP",
        direction: direction15M,
        activeEvent: getActiveEventName(analysis15M),
        sequence: getSequenceState(analysis15M)
    };

    result.timeframes["5M"] = {
        role: "ENTRY_CONFIRMATION",
        direction: direction5M,
        activeEvent: getActiveEventName(analysis5M),
        sequence: getSequenceState(analysis5M)
    };

    /*
    ============================================================
    STEP 1
    DETERMINE HIGHER-TIMEFRAME BIAS
    ============================================================
    */

    if (
        direction4H !== "NEUTRAL" &&
        direction1H === direction4H
    ) {
        result.higherTimeframeBias = direction4H;
        result.biasDirection = direction4H;

        result.confidence += 2;

        result.reasons.push(
            `4H and 1H both support ${direction4H} direction`
        );
    } else if (
        direction4H !== "NEUTRAL" &&
        direction1H !== "NEUTRAL" &&
        direction1H !== direction4H
    ) {
        result.state = "CONFLICT";
        result.higherTimeframeBias = "NEUTRAL";
        result.biasDirection = "NEUTRAL";

        result.reasons.push(
            `4H ${direction4H} conflicts with 1H ${direction1H}`
        );

        return result;
    } else if (direction4H !== "NEUTRAL") {
        result.higherTimeframeBias = direction4H;
        result.biasDirection = direction4H;

        result.confidence += 1;

        result.reasons.push(
            `4H provides ${direction4H} higher-timeframe bias`
        );
    } else if (direction1H !== "NEUTRAL") {
        result.higherTimeframeBias = direction1H;
        result.biasDirection = direction1H;

        result.confidence += 1;

        result.reasons.push(
            `1H provides ${direction1H} higher-timeframe bias`
        );
    } else {
        result.state = "NO_BIAS";

        result.reasons.push(
            "No clear higher-timeframe directional bias"
        );

        return result;
    }

    /*
    ============================================================
    STEP 2
    ANALYZE 15M SETUP
    ============================================================
    */

    if (direction15M === "NEUTRAL") {
        result.state = "WAITING_FOR_SETUP";
        result.setupDirection = "NEUTRAL";

        result.reasons.push(
            "15M has no confirmed directional setup"
        );

        return result;
    }

    result.setupDirection = direction15M;

    /*
    ------------------------------------------------------------
    SAME-DIRECTION SETUP
    ------------------------------------------------------------
    */

    if (direction15M === result.higherTimeframeBias) {
        result.confidence += 2;

        result.reasons.push(
            `15M ${direction15M} setup aligns with higher-timeframe bias`
        );

        result.state =
            direction15M === "BULLISH"
                ? "BULLISH_SETUP"
                : "BEARISH_SETUP";
    }

    /*
    ------------------------------------------------------------
    COUNTER-TREND SETUP
    ------------------------------------------------------------
    */

    if (direction15M !== result.higherTimeframeBias) {
        // A 15M move against the bias is normally a pullback. It is
        // not a signal, but when price is testing a 4H/1H zone it is
        // exactly what we wait for before the 15M turns back.
        const zone = findHigherTimeframeZone({
            analysis4H,
            analysis1H,
            bias: result.higherTimeframeBias,
            price: analysis15M?.price
        });

        result.state = "WAITING_FOR_SETUP";
        result.setupDirection = "NEUTRAL";
        result.direction = "NEUTRAL";
        result.higherTimeframeZone = zone;

        const zoneName =
            result.higherTimeframeBias === "BULLISH"
                ? "demand"
                : "supply";

        result.reasons.push(
            `15M ${direction15M} move is a pullback against the ${result.higherTimeframeBias} higher-timeframe bias`
        );

        if (zone && zone.status === "IN_ZONE") {
            result.state = "PULLBACK_TO_ZONE";
            result.reasons.push(
                `Price is testing the ${zone.timeframe} ${zoneName} zone`
            );
        } else if (zone && zone.status === "NEAR") {
            result.state = "PULLBACK_TO_ZONE";
            result.reasons.push(
                `Price is approaching the ${zone.timeframe} ${zoneName} zone`
            );
        } else {
            result.reasons.push(
                `Price has not reached a 4H/1H ${zoneName} zone yet`
            );
        }

        result.reasons.push(
            `Waiting for 15M to turn back ${result.higherTimeframeBias}`
        );

        return result;
    }

    /*
    ============================================================
    STEP 3
    CHECK 15M OB/FVG RETEST
    ============================================================
    */

    /*
     * 15M setup confirmation (sweep -> displacement -> BOS, read
     * from recent history) adds confidence when it agrees with
     * the setup direction. It does not change the state.
     */

    const setup15M = analysis15M?.setupConfirmation;

    if (
        setup15M &&
        setup15M.confirmed &&
        setup15M.direction === direction15M
    ) {
        result.confidence += 1;

        result.reasons.push(
            `15M setup confirmed (${setup15M.score}/6 confluence, ${String(setup15M.source || "").toLowerCase().replace("_", " ")})`
        );
    }

    const retest15M = analysis15M?.obFvgRetest;

    if (retest15M) {
        result.retestStatus = retest15M.status || "NONE";

        if (retest15M.confirmed) {
            result.confidence += 2;

            result.reasons.push(
                `15M OB/FVG retest confirmed for ${retest15M.direction || direction15M}`
            );
        } else if (retest15M.detected) {
            result.reasons.push(
                `15M ${retest15M.status || "RETEST_ACTIVE"}`
            );
        }
    }

    /*
    ============================================================
    STEP 4
    ANALYZE 5M ENTRY CONFIRMATION
    ============================================================
    */

    if (direction5M === "NEUTRAL") {
        result.entryDirection = "NEUTRAL";

        if (
            result.state === "BULLISH_SETUP" ||
            result.state === "BEARISH_SETUP"
        ) {
            result.state = "WAITING_FOR_CONFIRMATION";
        }

        result.reasons.push(
            "5M has no confirmed entry direction"
        );

        return result;
    }

    result.entryDirection = direction5M;

    /*
    ============================================================
    STEP 5
    5M MUST AGREE WITH 15M
    ============================================================
    */

    if (direction5M !== direction15M) {
        result.state = "CONFLICT";

        result.direction = "NEUTRAL";

        result.reasons.push(
            `5M ${direction5M} conflicts with 15M ${direction15M} setup`
        );

        return result;
    }

    result.confidence += 2;

    result.reasons.push(
        `5M ${direction5M} confirmation aligns with 15M setup`
    );

    /*
    ============================================================
    STEP 6
    CHECK 5M ACTIVE EVENT
    ============================================================
    */

    const activeEvent5M = analysis5M?.activeEvent;

    const fiveMinuteConfirmed =
        activeEvent5M &&
        activeEvent5M.active &&
        activeEvent5M.confirmed &&
        activeEvent5M.direction === direction5M;

    if (fiveMinuteConfirmed) {
        result.confidence += 2;

        result.reasons.push(
            `5M ${direction5M} active event confirmed`
        );
    } else {
        result.state = "WAITING_FOR_CONFIRMATION";

        result.direction = "NEUTRAL";

        result.reasons.push(
            "5M active event is not sufficiently confirmed"
        );

        return result;
    }

    /*
    ============================================================
    STEP 7
    CHECK 5M OB/FVG RETEST
    ============================================================
    */

    const retest5M = analysis5M?.obFvgRetest;

    if (retest5M) {
        if (retest5M.confirmed) {
            result.confidence += 3;

            result.retestStatus = "CONFIRMED";

            result.reasons.push(
                `5M ${direction5M} OB/FVG retest confirmed`
            );
        } else if (retest5M.detected) {
            result.retestStatus =
                retest5M.status || "WAITING_FOR_RETEST";

            result.state = "WAITING_FOR_RETEST";
            result.direction = "NEUTRAL";

            result.reasons.push(
                `5M ${direction5M} setup detected but OB/FVG retest is not confirmed`
            );

            return result;
        } else {
            result.state = "WAITING_FOR_RETEST";
            result.direction = "NEUTRAL";

            result.reasons.push(
                `5M ${direction5M} structure confirmed but no valid OB/FVG retest`
            );

            return result;
        }
    } else {
        result.state = "WAITING_FOR_RETEST";
        result.direction = "NEUTRAL";

        result.reasons.push(
            "5M OB/FVG retest analysis is unavailable"
        );

        return result;
    }

    /*
    ============================================================
    STEP 8
    FINAL DIRECTION
    ============================================================
    */

    result.direction = direction5M;

    /*
    ============================================================
    STEP 9
    SAME-TREND ENTRY
    ============================================================
    */

    if (direction5M === result.higherTimeframeBias) {
        if (direction5M === "BULLISH") {
            result.state = "BUY_READY";
        } else {
            result.state = "SELL_READY";
        }

        result.reasons.push(
            `5M ${direction5M} entry aligns with higher-timeframe bias`
        );

        return result;
    }

    /*
    ============================================================
    STEP 10
    COUNTER-TREND ENTRY
    ============================================================
    */

    if (direction5M !== result.higherTimeframeBias) {
        result.state =
            direction5M === "BULLISH"
                ? "COUNTER_TREND_BULLISH"
                : "COUNTER_TREND_BEARISH";

        result.direction = "NEUTRAL";

        result.reasons.push(
            `5M ${direction5M} confirmation is counter-trend against ${result.higherTimeframeBias} bias`
        );

        result.reasons.push(
            "No standard BUY/SELL signal issued for counter-trend setup"
        );

        return result;
    }

    return result;
}


/*
============================================================
DIRECTION EXTRACTION
============================================================
*/

function getDirection(analysis) {
    if (!analysis) {
        return "NEUTRAL";
    }

    /*
     * Structure reconciliation has the highest priority.
     * It exists specifically to determine whether an older
     * sequence is still valid after newer structure develops.
     */

    if (
        analysis.structureReconciliation &&
        analysis.structureReconciliation.valid &&
        analysis.structureReconciliation.direction
    ) {
        const reconciliation =
            analysis.structureReconciliation;

        if (
            reconciliation.state === "REVERSAL_CONFIRMED" ||
            reconciliation.state === "COUNTER_TREND_CONFIRMED" ||
            reconciliation.state === "ALIGNED"
        ) {
            return normalizeDirection(
                reconciliation.direction
            );
        }
    }

    /*
     * Confirmed active event
     */

    if (
        analysis.activeEvent &&
        analysis.activeEvent.active &&
        analysis.activeEvent.confirmed &&
        analysis.activeEvent.direction
    ) {
        return normalizeDirection(
            analysis.activeEvent.direction
        );
    }

    /*
     * Active sequence
     */

    if (
        analysis.activeSequence &&
        analysis.activeSequence.active &&
        analysis.activeSequence.valid &&
        analysis.activeSequence.direction
    ) {
        return normalizeDirection(
            analysis.activeSequence.direction
        );
    }

    /*
     * Confirmed market sequence
     */

    if (
        analysis.marketSequence &&
        analysis.marketSequence.confirmed &&
        analysis.marketSequence.direction
    ) {
        return normalizeDirection(
            analysis.marketSequence.direction
        );
    }

    /*
     * Confirmed market event
     */

    if (
        analysis.marketEvent &&
        analysis.marketEvent.confirmed &&
        analysis.marketEvent.direction
    ) {
        return normalizeDirection(
            analysis.marketEvent.direction
        );
    }

    /*
     * Basic market structure
     */

    if (
        analysis.marketStructure &&
        analysis.marketStructure.structure
    ) {
        return normalizeDirection(
            analysis.marketStructure.structure
        );
    }

    return "NEUTRAL";
}


/*
============================================================
ACTIVE EVENT NAME
============================================================
*/

function getActiveEventName(analysis) {
    if (
        analysis?.activeEvent?.active &&
        analysis?.activeEvent?.event
    ) {
        return analysis.activeEvent.event;
    }

    if (
        analysis?.marketEvent?.detected &&
        analysis?.marketEvent?.event
    ) {
        return analysis.marketEvent.event;
    }

    if (
        analysis?.marketStructure?.lastStructureEvent?.event
    ) {
        return analysis.marketStructure.lastStructureEvent.event;
    }

    return null;
}


/*
============================================================
SEQUENCE STATE
============================================================
*/

function getSequenceState(analysis) {
    if (
        analysis?.activeSequence?.active &&
        analysis?.activeSequence?.valid
    ) {
        return "ACTIVE";
    }

    if (
        analysis?.marketSequence?.confirmed
    ) {
        return "CONFIRMED";
    }

    if (
        analysis?.marketSequence?.detected
    ) {
        return "FORMING";
    }

    return "NONE";
}


/*
============================================================
NORMALIZE DIRECTION
============================================================
*/

function normalizeDirection(direction) {
    if (!direction) {
        return "NEUTRAL";
    }

    const value = String(direction).toUpperCase();

    if (
        value === "BULLISH" ||
        value === "BUY" ||
        value === "LONG"
    ) {
        return "BULLISH";
    }

    if (
        value === "BEARISH" ||
        value === "SELL" ||
        value === "SHORT"
    ) {
        return "BEARISH";
    }

    return "NEUTRAL";
}

/*
============================================================
HIGHER-TIMEFRAME ZONE
============================================================

The nearest 4H/1H demand zone (bullish bias) or supply zone
(bearish bias), and whether price is inside it or close to it.
*/

function findHigherTimeframeZone({ analysis4H, analysis1H, bias, price }) {
    if (!Number.isFinite(price)) return null;

    const type = bias === "BULLISH" ? "DEMAND" : bias === "BEARISH" ? "SUPPLY" : null;
    if (!type) return null;

    let best = null;

    for (const [timeframe, analysis] of [["4H", analysis4H], ["1H", analysis1H]]) {
        const zones = analysis?.supplyDemand?.zones;
        if (!Array.isArray(zones)) continue;

        for (const z of zones.slice(-5)) {
            if (z.type !== type) continue;

            const height = z.high - z.low;
            const gap =
                price > z.high ? price - z.high
                : price < z.low ? z.low - price
                : 0;

            // A zone broken through the wrong way is no longer a test.
            const broken =
                type === "DEMAND" ? price < z.low - height
                                  : price > z.high + height;
            if (broken) continue;

            const status =
                gap === 0 ? "IN_ZONE"
                : gap <= Math.max(height, price * 0.001) ? "NEAR"
                : "FAR";

            if (!best || gap < best.gap) {
                best = { timeframe, type, high: z.high, low: z.low, gap, status };
            }
        }
    }

    return best;
}
