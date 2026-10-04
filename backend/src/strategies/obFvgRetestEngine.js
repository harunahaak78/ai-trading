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
    // RETEST CONFIRMATION
    // --------------------------------------------------

    if (
        result.priceInOrderBlock &&
        result.priceInFVG
    ) {
        result.confirmed = true;

        result.status =
            "RETEST_CONFIRMED";

        result.score += 2;

        result.reasons.push(
            "Price is inside both OB and FVG"
        );

        return result;
    }

    if (
        result.priceInOrderBlock ||
        result.priceInFVG
    ) {
        result.retestActive = true;

        result.status =
            "RETEST_ACTIVE";

        result.reasons.push(
            "Price has entered a valid retest zone"
        );

        return result;
    }

    if (
        result.orderBlock ||
        result.fairValueGap
    ) {
        result.status =
            "WAITING_FOR_RETEST";

        result.reasons.push(
            "Waiting for price to return to the zone"
        );

        return result;
    }

    result.status =
        "NO_RETEST_ZONE";

    return result;
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