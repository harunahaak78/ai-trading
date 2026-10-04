export function confirmSetup({
    candles,
    marketEvent,
    displacement,
    marketStructure,
    orderBlock,
    fairValueGap,
    supplyDemand
}) {
    const result = {
        confirmed: false,
        direction: null,

        liquiditySweep: false,
        displacement: false,
        structureBreak: false,
        orderBlock: false,
        fairValueGap: false,
        zoneConfluence: false,

        score: 0,

        reasons: []
    };

    /*
     * --------------------------------------------------
     * 1. DETERMINE SETUP DIRECTION
     * --------------------------------------------------
     *
     * SELL-SIDE SWEEP -> bullish reaction
     * BUY-SIDE SWEEP  -> bearish reaction
     */

    let setupDirection = null;

    if (
        marketEvent &&
        marketEvent.liquiditySweep
    ) {
        if (
            marketEvent.liquiditySweep.type ===
            "SELL_SIDE_SWEEP"
        ) {
            setupDirection = "BULLISH";
        }

        if (
            marketEvent.liquiditySweep.type ===
            "BUY_SIDE_SWEEP"
        ) {
            setupDirection = "BEARISH";
        }
    }

    /*
     * If there is no liquidity sweep,
     * we do not have a valid setup direction.
     */

    if (!setupDirection) {
        result.reasons.push(
            "No liquidity sweep establishing setup direction"
        );

        return result;
    }

    result.direction = setupDirection;

    /*
     * --------------------------------------------------
     * 2. LIQUIDITY SWEEP
     * --------------------------------------------------
     */

    if (
        marketEvent.detected &&
        marketEvent.liquiditySweep
    ) {
        result.liquiditySweep = true;
        result.score += 1;

        result.reasons.push(
            `${marketEvent.liquiditySweep.type} detected`
        );
    }

    /*
     * --------------------------------------------------
     * 3. DISPLACEMENT
     * --------------------------------------------------
     *
     * Displacement must agree with setup direction.
     */

    if (
        displacement &&
        displacement.detected &&
        displacement.direction ===
            setupDirection
    ) {
        result.displacement = true;
        result.score += 1;

        result.reasons.push(
            `${setupDirection} displacement confirmed`
        );
    } else {
        result.reasons.push(
            `No ${setupDirection.toLowerCase()} displacement`
        );
    }

    /*
     * --------------------------------------------------
     * 4. STRUCTURE BREAK
     * --------------------------------------------------
     *
     * The displacement must break structure.
     */

    if (
        displacement &&
        displacement.detected &&
        displacement.breaksStructure &&
        displacement.direction ===
            setupDirection
    ) {
        result.structureBreak = true;
        result.score += 1;

        result.reasons.push(
            `${setupDirection} structure break confirmed`
        );
    } else {
        result.reasons.push(
            "No direction-aligned structure break"
        );
    }

    /*
     * --------------------------------------------------
     * 5. ORDER BLOCK
     * --------------------------------------------------
     *
     * IMPORTANT:
     *
     * detected must be TRUE
     * inZone must be TRUE
     * type must match setup direction
     */

    if (
        orderBlock &&
        orderBlock.detected === true &&
        orderBlock.inZone === true &&
        orderBlock.type ===
            setupDirection
    ) {
        result.orderBlock = true;
        result.score += 1;

        result.reasons.push(
            `${setupDirection} order block is active`
        );
    } else {
        result.reasons.push(
            `No active ${setupDirection.toLowerCase()} order block`
        );
    }

    /*
     * --------------------------------------------------
     * 6. FAIR VALUE GAP
     * --------------------------------------------------
     *
     * The FVG must:
     *
     * - exist
     * - match direction
     * - currently overlap price
     */

    let fvgInZone = false;

    if (
        candles &&
        candles.length > 0 &&
        fairValueGap &&
        fairValueGap.type
    ) {
        const current =
            candles[candles.length - 1];

        const currentHigh =
            current.high;

        const currentLow =
            current.low;

        const fvgHigh =
            fairValueGap.top;

        const fvgLow =
            fairValueGap.bottom;

        /*
         * Price overlaps the FVG.
         */

        fvgInZone =
            currentLow <= fvgHigh &&
            currentHigh >= fvgLow;
    }

    if (
        fairValueGap &&
        fairValueGap.type ===
            setupDirection &&
        fvgInZone
    ) {
        result.fairValueGap = true;
        result.score += 1;

        result.reasons.push(
            `${setupDirection} FVG is being interacted with`
        );
    } else {
        result.reasons.push(
            `No active ${setupDirection.toLowerCase()} FVG`
        );
    }

    /*
     * --------------------------------------------------
     * 7. SUPPLY / DEMAND CONFLUENCE
     * --------------------------------------------------
     *
     * Bullish -> DEMAND
     * Bearish -> SUPPLY
     *
     * It must also be IN ZONE.
     */

    const expectedZone =
        setupDirection === "BULLISH"
            ? "DEMAND"
            : "SUPPLY";

    if (
        supplyDemand &&
        supplyDemand.detected === true &&
        supplyDemand.inZone === true &&
        supplyDemand.type ===
            expectedZone
    ) {
        result.zoneConfluence = true;
        result.score += 1;

        result.reasons.push(
            `${expectedZone} zone is active`
        );
    } else {
        result.reasons.push(
            `No active ${expectedZone.toLowerCase()} zone`
        );
    }

    /*
     * --------------------------------------------------
     * 8. FINAL CONFIRMATION
     * --------------------------------------------------
     *
     * The core sequence is:
     *
     * Liquidity sweep
     * +
     * Directional displacement
     * +
     * Structure break
     *
     * OB / FVG / Supply-Demand provide
     * additional confluence.
     */

    if (
        result.liquiditySweep &&
        result.displacement &&
        result.structureBreak
    ) {
        result.confirmed = true;

        result.reasons.push(
            "Core market-event sequence confirmed"
        );
    } else {
        result.reasons.push(
            "Core market-event sequence incomplete"
        );
    }

    return result;
}