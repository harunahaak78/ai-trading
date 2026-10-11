export function detectObFvgRetest({
    candles,
    direction,
    orderBlock,
    fairValueGaps,
    marketSequence,
    activeSequence,
    structureReconciliation
}) {
    const result = {
        detected: false,
        retestActive: false,
        confirmed: false,

        direction: direction || null,

        orderBlock: null,
        fairValueGap: null,

        priceInOrderBlock: false,
        priceInFVG: false,

        zoneConfluence: false,

        distanceToOrderBlock: null,
        distanceToFVG: null,

        score: 0,

        status: "NO_RETEST",

        reasons: []
    };

    if (
        !Array.isArray(candles) ||
        candles.length === 0
    ) {
        result.reasons.push(
            "No candle data available"
        );

        return result;
    }

    if (!direction) {
        result.reasons.push(
            "No setup direction"
        );

        return result;
    }

    const current =
        candles[candles.length - 1];

    const currentPrice =
        current.close;

    // --------------------------------------------------
    // MARKET SEQUENCE CHECK
    // --------------------------------------------------

    if (
        !marketSequence ||
        !marketSequence.detected
    ) {
        result.reasons.push(
            "No market sequence detected"
        );

        return result;
    }

        // --------------------------------------------------
    // STRUCTURE REVERSAL CHECK
    // --------------------------------------------------

    const reconciliationState =
        structureReconciliation?.state || null;

    const reconciliationDirection =
        structureReconciliation?.direction || null;

    const sequenceDirection =
        marketSequence?.direction || null;

    const sequenceIsReversed =
        reconciliationState ===
            "REVERSAL_CONFIRMED" &&
        reconciliationDirection &&
        sequenceDirection &&
        reconciliationDirection !==
            sequenceDirection;

    if (sequenceIsReversed) {
        return {
            detected: false,
            retestActive: false,
            confirmed: false,

            direction:
                reconciliationDirection,

            orderBlock: null,
            fairValueGap: null,

            priceInOrderBlock: false,
            priceInFVG: false,

            zoneConfluence: false,

            distanceToOrderBlock: null,
            distanceToFVG: null,

            score: 0,

            status:
                "INVALIDATED_BY_STRUCTURE_REVERSAL",

            reasons: [
                `${sequenceDirection} market sequence is no longer valid`,
                `Structure reconciliation confirms ${reconciliationDirection} reversal`,
                "Old OB/FVG retest zones are ignored",
                "Waiting for a new direction-aligned market sequence"
            ]
        };
    }

    if (
        marketSequence.direction !==
        direction
    ) {
        result.reasons.push(
            "Market sequence direction does not match setup direction"
        );

        return result;
    }

    if (
        !marketSequence.confirmed
    ) {
        result.reasons.push(
            "Market sequence is not structurally confirmed"
        );

        return result;
    }

    result.detected = true;
        // --------------------------------------------------
    // ACTIVE SEQUENCE CHECK
    // --------------------------------------------------

    if (
        activeSequence &&
        activeSequence.stale
    ) {
        return {
            detected: false,
            retestActive: false,
            confirmed: false,

            direction:
                direction,

            orderBlock: null,
            fairValueGap: null,

            priceInOrderBlock: false,
            priceInFVG: false,

            zoneConfluence: false,

            distanceToOrderBlock: null,
            distanceToFVG: null,

            score: 0,

            status:
                "SEQUENCE_STALE",

            reasons: [
                `${direction} market sequence is stale`,
                `Sequence age: ${activeSequence.ageBars} bars`,
                "Old OB/FVG retest zones are ignored",
                "Waiting for a new active market sequence"
            ]
        };
    }

    result.score += 1;

    result.reasons.push(
        `${direction} market sequence confirmed`
    );

    // --------------------------------------------------
    // ORDER BLOCK
    // --------------------------------------------------

    if (
        orderBlock &&
        orderBlock.detected &&
        orderBlock.type === direction &&
        orderBlock.high != null &&
        orderBlock.low != null
    ) {
        result.orderBlock = {
            type:
                orderBlock.type,

            high:
                orderBlock.high,

            low:
                orderBlock.low,

            index:
                orderBlock.index,

            strength:
                orderBlock.strength
        };

        result.score += 1;

        result.reasons.push(
            `${direction} order block detected`
        );

        const inOrderBlock =
            currentPrice >=
                orderBlock.low &&
            currentPrice <=
                orderBlock.high;

        result.priceInOrderBlock =
            inOrderBlock;

        result.distanceToOrderBlock =
            calculateDistanceToZone(
                currentPrice,
                orderBlock.low,
                orderBlock.high
            );

        if (inOrderBlock) {
            result.retestActive = true;

            result.score += 1;

            result.reasons.push(
                "Price is inside the order block"
            );
        }
    } else {
        result.reasons.push(
            `No active ${direction.toLowerCase()} order block`
        );
    }

    // --------------------------------------------------
    // FVG
    // --------------------------------------------------

    const relevantFVG =
        findRelevantFVG({
            fairValueGaps,
            direction,
            sequence:
                marketSequence.sequence
        });

    if (relevantFVG) {
        result.fairValueGap = {
            type:
                relevantFVG.type,

            top:
                relevantFVG.top,

            bottom:
                relevantFVG.bottom,

            index:
                relevantFVG.index
        };

        result.score += 1;

        result.reasons.push(
            `${direction} FVG detected`
        );

        const inFVG =
            currentPrice >=
                relevantFVG.bottom &&
            currentPrice <=
                relevantFVG.top;

        result.priceInFVG =
            inFVG;

        result.distanceToFVG =
            calculateDistanceToZone(
                currentPrice,
                relevantFVG.bottom,
                relevantFVG.top
            );

        if (inFVG) {
            result.retestActive = true;

            result.score += 1;

            result.reasons.push(
                "Price is inside the FVG"
            );
        }
    } else {
        result.reasons.push(
            `No relevant ${direction.toLowerCase()} FVG`
        );
    }

    // --------------------------------------------------
    // OB + FVG CONFLUENCE
    // --------------------------------------------------

    if (
        result.orderBlock &&
        result.fairValueGap
    ) {
      const zonesAreOverlapping =
        zonesOverlap(
            result.orderBlock.low,
            result.orderBlock.high,
            result.fairValueGap.bottom,
            result.fairValueGap.top
        );

    if (zonesAreOverlapping) {
        result.zoneConfluence =
            true;

            result.score += 2;

            result.reasons.push(
                "Order block and FVG overlap"
            );
        }
    }

    // --------------------------------------------------
    // FIRST TEST AND HOLD
    //
    // The entry is the FIRST time price trades into the zone, once
    // it holds. A later return to the same zone is a retest and is
    // not used. The zone is the OB/FVG overlap when they overlap,
    // otherwise the order block (or the FVG when there is no OB).
    // --------------------------------------------------

    if (
        result.orderBlock ||
        result.fairValueGap
    ) {
        const zone = pickZone(result);

        const firstTest = evaluateFirstTest({
            candles,
            direction,
            low: zone.low,
            high: zone.high,
            startIndex: zone.startIndex
        });

        result.zone = {
            low: zone.low,
            high: zone.high,
            source: zone.source
        };

        result.firstTest = firstTest;
        result.status = firstTest.status;

        if (
            firstTest.status === "FIRST_TEST_HELD" ||
            firstTest.status === "RETEST_HELD"
        ) {
            result.confirmed = true;
            result.score += 2;
        }

        result.reasons.push(firstTest.reason);

        return result;
    }

    result.status =
        "NO_RETEST_ZONE";

    return result;
}


// ======================================================
// FIRST TEST EVALUATION
// ======================================================

const FIRST_TEST_MAX_BARS = 12;

function pickZone(result) {
    const ob = result.orderBlock;
    const fvg = result.fairValueGap;

    if (ob && fvg && zonesOverlap(ob.low, ob.high, fvg.bottom, fvg.top)) {
        return {
            low: Math.max(ob.low, fvg.bottom),
            high: Math.min(ob.high, fvg.top),
            startIndex: Math.max((ob.index ?? 0) + 1, fvg.index ?? 0),
            source: "OB_FVG_OVERLAP"
        };
    }

    if (ob) {
        return {
            low: ob.low,
            high: ob.high,
            startIndex: (ob.index ?? 0) + 1,
            source: "ORDER_BLOCK"
        };
    }

    return {
        low: fvg.bottom,
        high: fvg.top,
        startIndex: fvg.index ?? 0,
        source: "FVG"
    };
}

// Walks the candles after the zone formed and reports whether price
// has tested it yet, and whether that first test held.
function evaluateFirstTest({ candles, direction, low, high, startIndex }) {
    const bullish = direction === "BULLISH";
    const last = candles.length - 1;
    const from = Math.max(startIndex + 1, 0);

    const touches = c => bullish ? c.low <= high : c.high >= low;
    const breaks = c => bullish ? c.close < low : c.close > high;
    const clear = c => bullish ? c.low > high : c.high < low;

    let firstTouch = -1;
    let episodes = 0;
    let inside = false;
    let broken = false;
    let lastTouchIndex = -1;
    let episodeStart = -1;

    for (let i = from; i <= last; i++) {
        const c = candles[i];

        if (touches(c)) {
            if (!inside) { episodes += 1; episodeStart = i; }
            inside = true;
            if (firstTouch === -1) firstTouch = i;
            lastTouchIndex = i;
            if (breaks(c)) broken = true;
        } else if (clear(c)) {
            inside = false;
        }
    }

    if (firstTouch === -1) {
        return {
            status: "WAITING_FOR_FIRST_TEST",
            held: false,
            reason: "Price has not tested the zone yet. Waiting for the first test"
        };
    }

    if (broken) {
        return {
            status: "ZONE_BROKEN",
            held: false,
            index: firstTouch,
            reason: "Price closed through the zone, so it did not hold"
        };
    }

    // The first touch is the first test. Any later return to the
    // zone is a retest. Both can be entries, and the result says which.
    const isRetest = episodes > 1;
    const entryType = isRetest ? "RETEST" : "FIRST_TEST";
    const label = isRetest ? "retest" : "first test";
    const prefix = isRetest ? "RETEST" : "FIRST_TEST";
    const testStart = isRetest ? episodeStart : firstTouch;
    const bars = last - testStart;

    if (bars > FIRST_TEST_MAX_BARS) {
        return {
            status: `${prefix}_PASSED`,
            entryType,
            held: true,
            index: testStart,
            bars,
            reason: `The ${label} held ${bars} bars ago. The entry has passed`
        };
    }

    // Held: the test candle(s) closed back in the trade direction, or
    // price has already moved clear of the zone in that direction.
    const touch = candles[lastTouchIndex];
    const closedWithBias = bullish ? touch.close > touch.open : touch.close < touch.open;
    const lastClose = candles[last].close;
    const movedAway = clear(candles[last]) || (bullish ? lastClose > high : lastClose < low);

    if (closedWithBias || movedAway) {
        return {
            status: `${prefix}_HELD`,
            entryType,
            held: true,
            index: testStart,
            bars,
            reason: isRetest
                ? "Price retested the zone (not the first test) and held"
                : "Price tested the zone for the first time and held"
        };
    }

    return {
        status: `${prefix}_IN_PROGRESS`,
        entryType,
        held: false,
        index: testStart,
        bars,
        reason: isRetest
            ? "Price is retesting the zone. Waiting for it to hold"
            : "Price is testing the zone for the first time. Waiting for it to hold"
    };
}


// ======================================================
// FIND RELEVANT FVG
// ======================================================

function findRelevantFVG({
    fairValueGaps,
    direction,
    sequence
}) {
    if (
        !Array.isArray(
            fairValueGaps
        ) ||
        fairValueGaps.length === 0
    ) {
        return null;
    }

    let candidates =
        fairValueGaps.filter(
            fvg =>
                fvg.type ===
                direction
        );

    if (
        candidates.length === 0
    ) {
        return null;
    }

    // Prefer FVG created after
    // the displacement.

    if (
        sequence &&
        sequence.displacement
    ) {
        const displacementIndex =
            sequence.displacement.index;

        const afterDisplacement =
            candidates.filter(
                fvg =>
                    fvg.index >
                    displacementIndex
            );

        if (
            afterDisplacement.length > 0
        ) {
            candidates =
                afterDisplacement;
        }
    }

    // Most recent relevant FVG.

    return candidates[
        candidates.length - 1
    ];
}


// ======================================================
// ZONE OVERLAP
// ======================================================

function zonesOverlap(
    low1,
    high1,
    low2,
    high2
) {
    return (
        low1 <= high2 &&
        high1 >= low2
    );
}


// ======================================================
// DISTANCE TO ZONE
// ======================================================

function calculateDistanceToZone(
    price,
    low,
    high
) {
    if (
        price >= low &&
        price <= high
    ) {
        return 0;
    }

    if (price < low) {
        return low - price;
    }

    return price - high;
}