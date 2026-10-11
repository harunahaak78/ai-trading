/*
 * ==========================================================
 * SETUP CONFIRMATION
 * ==========================================================
 *
 * A setup is confirmed by the core sequence:
 *
 *   Liquidity sweep -> Directional displacement -> Structure break
 *
 * The three steps rarely happen on the same candle, so the core
 * sequence is read from the market sequence engines first
 * (recent history), and only falls back to the current candle
 * when no usable sequence exists.
 *
 * Core sources, in priority order:
 *
 *   ACTIVE_SEQUENCE   confirmed sequence, still recent and valid
 *   FORMING_SEQUENCE  sweep + displacement seen, waiting for BOS
 *   CURRENT_CANDLE    sweep / displacement on the latest candle
 *
 * A sequence older than `maxSetupAge` bars, or one invalidated
 * by newer opposing structure, never confirms a setup.
 *
 * Order block, FVG and supply/demand are extra confluence. They
 * only score while price is currently interacting with them.
 */

export function confirmSetup({
    candles,
    marketEvent,
    displacement,
    marketStructure,
    orderBlock,
    fairValueGap,
    supplyDemand,
    marketSequence = null,
    activeSequence = null,
    structureReconciliation = null,
    maxSetupAge = 20
}) {
    const result = {
        confirmed: false,
        status: "NO_SETUP",
        direction: null,

        // Where the core sequence came from, and how old it is.
        source: null,
        ageBars: null,

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
     * 1. CORE SEQUENCE (sweep -> displacement -> BOS)
     * --------------------------------------------------
     */

    const core = resolveCoreSetup({
        candles,
        marketEvent,
        displacement,
        marketSequence,
        activeSequence,
        structureReconciliation,
        maxSetupAge
    });

    result.reasons.push(...core.reasons);

    if (!core.direction) {
        result.status = core.status;

        if (core.status === "NO_SETUP") {
            result.reasons.push(
                "No liquidity sweep establishing setup direction"
            );
        }

        return result;
    }

    const setupDirection = core.direction;

    result.direction = setupDirection;
    result.source = core.source;
    result.ageBars = core.ageBars;

    if (core.liquiditySweep) {
        result.liquiditySweep = true;
        result.score += 1;
    }

    if (core.displacement) {
        result.displacement = true;
        result.score += 1;
    }

    if (core.structureBreak) {
        result.structureBreak = true;
        result.score += 1;
    }

    /*
     * --------------------------------------------------
     * 2. ORDER BLOCK
     * --------------------------------------------------
     *
     * detected and inZone must be TRUE, and the type must
     * match the setup direction.
     */

    if (
        orderBlock &&
        orderBlock.detected === true &&
        orderBlock.inZone === true &&
        orderBlock.type === setupDirection
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
     * 3. FAIR VALUE GAP
     * --------------------------------------------------
     *
     * The FVG must match the direction and overlap the
     * current candle.
     */

    let fvgInZone = false;

    if (
        Array.isArray(candles) &&
        candles.length > 0 &&
        fairValueGap &&
        fairValueGap.type &&
        fairValueGap.top != null &&
        fairValueGap.bottom != null
    ) {
        const current = candles[candles.length - 1];

        fvgInZone =
            current.low <= fairValueGap.top &&
            current.high >= fairValueGap.bottom;
    }

    if (
        fairValueGap &&
        fairValueGap.type === setupDirection &&
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
     * 4. SUPPLY / DEMAND
     * --------------------------------------------------
     *
     * Bullish -> DEMAND, Bearish -> SUPPLY, and price must
     * be inside the zone.
     */

    const expectedZone =
        setupDirection === "BULLISH"
            ? "DEMAND"
            : "SUPPLY";

    if (
        supplyDemand &&
        supplyDemand.detected === true &&
        supplyDemand.inZone === true &&
        supplyDemand.type === expectedZone
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
     * 5. FINAL CONFIRMATION
     * --------------------------------------------------
     */

    if (
        result.liquiditySweep &&
        result.displacement &&
        result.structureBreak
    ) {
        result.confirmed = true;
        result.status = "CONFIRMED";

        result.reasons.push(
            "Core market-event sequence confirmed"
        );
    } else {
        result.status =
            result.liquiditySweep && result.displacement
                ? "FORMING"
                : "PARTIAL";

        result.reasons.push(
            "Core market-event sequence incomplete"
        );
    }

    return result;
}


/*
 * ==========================================================
 * CORE SEQUENCE RESOLUTION
 * ==========================================================
 */

function resolveCoreSetup({
    candles,
    marketEvent,
    displacement,
    marketSequence,
    activeSequence,
    structureReconciliation,
    maxSetupAge
}) {
    const out = {
        source: null,
        direction: null,
        liquiditySweep: false,
        displacement: false,
        structureBreak: false,
        ageBars: null,
        status: "NO_SETUP",
        reasons: []
    };

    const lastIndex =
        Array.isArray(candles) && candles.length > 0
            ? candles.length - 1
            : null;

    /*
     * ------------------------------------------------------
     * A. ACTIVE CONFIRMED SEQUENCE
     * ------------------------------------------------------
     */

    const activeSeq = activeSequence?.sequence;

    if (
        activeSequence &&
        activeSequence.active &&
        activeSequence.valid &&
        activeSequence.direction &&
        activeSeq &&
        activeSeq.sweep &&
        activeSeq.displacement &&
        activeSeq.structureBreak
    ) {
        const direction = activeSequence.direction;
        const age = activeSequence.ageBars;
        const reversal = reversalAgainst(
            structureReconciliation,
            direction
        );

        if (reversal) {
            out.status = "INVALIDATED";

            out.reasons.push(
                `${direction} sequence was invalidated by a newer ${reversal} structure event`
            );
        } else if (age != null && age > maxSetupAge) {
            out.status = "STALE";

            out.reasons.push(
                `${direction} sequence is ${age} bars old (maximum ${maxSetupAge})`
            );
        } else {
            out.source = "ACTIVE_SEQUENCE";
            out.direction = direction;
            out.liquiditySweep = true;
            out.displacement = true;
            out.structureBreak = true;
            out.ageBars = age;

            out.reasons.push(
                age != null
                    ? `${direction} sequence is active (${age} bars since structure break)`
                    : `${direction} sequence is active`
            );

            out.reasons.push(`${activeSeq.sweep.type} detected`);
            out.reasons.push(`${direction} displacement confirmed`);
            out.reasons.push(`${direction} structure break confirmed`);

            return out;
        }
    } else if (activeSequence && activeSequence.invalidated) {
        out.status = "INVALIDATED";

        out.reasons.push(
            "Previous sequence was invalidated by newer opposing structure"
        );
    } else if (activeSequence && activeSequence.stale) {
        out.status = "STALE";

        out.reasons.push(
            `Previous sequence is ${activeSequence.ageBars} bars old (maximum ${maxSetupAge})`
        );
    }

    /*
     * ------------------------------------------------------
     * B. FORMING SEQUENCE  and  C. CURRENT-CANDLE EVENT
     *
     * Both can describe the latest action. A current-candle
     * event that already completes the whole chain
     * (sweep -> displacement -> BOS) beats a forming sequence
     * that is still missing its BOS. Otherwise the forming
     * sequence wins because it carries more history.
     * ------------------------------------------------------
     */

    const forming = readFormingSequence({
        marketSequence,
        structureReconciliation,
        lastIndex,
        maxSetupAge
    });

    const candle = readCurrentCandle({
        marketEvent,
        displacement
    });

    const chosen =
        candle && candle.structureBreak
            ? candle
            : forming || candle;

    if (chosen) {
        return {
            ...out,
            ...chosen,
            reasons: [...out.reasons, ...chosen.reasons]
        };
    }

    return out;
}


/*
 * Returns the opposing direction when structure
 * reconciliation says the market has reversed against
 * `direction`, otherwise null.
 */

function reversalAgainst(structureReconciliation, direction) {
    if (
        !structureReconciliation ||
        !structureReconciliation.valid ||
        !structureReconciliation.direction ||
        !direction
    ) {
        return null;
    }

    const reversed =
        structureReconciliation.state === "REVERSAL_CONFIRMED" ||
        structureReconciliation.state === "COUNTER_TREND_CONFIRMED";

    if (
        reversed &&
        structureReconciliation.direction !== "NEUTRAL" &&
        structureReconciliation.direction !== direction
    ) {
        return structureReconciliation.direction;
    }

    return null;
}


/*
 * Sweep + displacement seen on recent candles, BOS still missing.
 */

function readFormingSequence({
    marketSequence,
    structureReconciliation,
    lastIndex,
    maxSetupAge
}) {
    const seq = marketSequence?.sequence;

    if (
        !marketSequence ||
        !marketSequence.detected ||
        marketSequence.confirmed ||
        !marketSequence.direction ||
        !seq ||
        !seq.sweep ||
        !seq.displacement
    ) {
        return null;
    }

    const direction = marketSequence.direction;

    const age =
        lastIndex != null
            ? lastIndex - seq.displacement.index
            : null;

    if (reversalAgainst(structureReconciliation, direction)) {
        return null;
    }

    if (age != null && age > maxSetupAge) {
        return null;
    }

    return {
        source: "FORMING_SEQUENCE",
        direction,
        liquiditySweep: true,
        displacement: true,
        structureBreak: false,
        ageBars: age,
        status: "FORMING",
        reasons: [
            `${direction} sequence is forming`,
            `${seq.sweep.type} detected`,
            `${direction} displacement confirmed`,
            "Waiting for structure break"
        ]
    };
}


/*
 * Sweep / displacement / BOS on the latest candle only.
 */

function readCurrentCandle({ marketEvent, displacement }) {
    const sweep = marketEvent?.liquiditySweep;

    if (!marketEvent || !marketEvent.detected || !sweep) {
        return null;
    }

    let direction = null;

    if (sweep.type === "SELL_SIDE_SWEEP") {
        direction = "BULLISH";
    }

    if (sweep.type === "BUY_SIDE_SWEEP") {
        direction = "BEARISH";
    }

    if (!direction) {
        return null;
    }

    const aligned =
        Boolean(displacement) &&
        displacement.detected &&
        displacement.direction === direction;

    const structureBreak =
        aligned && Boolean(displacement.breaksStructure);

    const reasons = [`${sweep.type} detected`];

    reasons.push(
        aligned
            ? `${direction} displacement confirmed`
            : `No ${direction.toLowerCase()} displacement`
    );

    reasons.push(
        structureBreak
            ? `${direction} structure break confirmed`
            : "No direction-aligned structure break"
    );

    return {
        source: "CURRENT_CANDLE",
        direction,
        liquiditySweep: true,
        displacement: aligned,
        structureBreak,
        ageBars: 0,
        status: "PARTIAL",
        reasons
    };
}
