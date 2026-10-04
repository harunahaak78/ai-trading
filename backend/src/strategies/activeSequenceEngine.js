export function detectActiveSequence({
    candles,
    marketStructure,
    marketSequence,
    maxSequenceAge = 20
}) {
    const result = {
        active: false,
        valid: false,
        stale: false,
        invalidated: false,

        direction: null,

        ageBars: null,

        sequence: null,

        status: "NO_SEQUENCE",

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

    if (
        !marketSequence ||
        !marketSequence.detected
    ) {
        result.reasons.push(
            "No market sequence detected"
        );

        return result;
    }

    const sequence =
        marketSequence.sequence;

    if (
        !sequence ||
        !sequence.sweep ||
        !sequence.displacement
    ) {
        result.reasons.push(
            "Incomplete market sequence"
        );

        return result;
    }

    const direction =
        marketSequence.direction;

    result.direction = direction;
    result.sequence = sequence;

    /*
     * ------------------------------------------------
     * CASE 1
     * Sequence has not completed BOS yet.
     * ------------------------------------------------
     */

    if (
        !marketSequence.confirmed ||
        !sequence.structureBreak
    ) {
        result.status = "FORMING";

        result.reasons.push(
            `${direction} sequence is forming`
        );

        if (sequence.sweep) {
            result.reasons.push(
                `${sequence.sweep.type} detected`
            );
        }

        if (sequence.displacement) {
            result.reasons.push(
                `${direction} displacement detected`
            );
        }

        result.valid = true;

        return result;
    }

    /*
     * ------------------------------------------------
     * CASE 2
     * Calculate sequence age.
     * ------------------------------------------------
     */

    const structureBreakIndex =
        sequence.structureBreak.index;

    const currentIndex =
        candles.length - 1;

    const ageBars =
        currentIndex -
        structureBreakIndex;

    result.ageBars = ageBars;

    /*
     * ------------------------------------------------
     * CASE 3
     * Sequence is too old.
     * ------------------------------------------------
     */

    if (
        ageBars > maxSequenceAge
    ) {
        result.stale = true;
        result.status = "STALE";

        result.reasons.push(
            `Sequence is ${ageBars} bars old`
        );

        result.reasons.push(
            `Maximum allowed age is ${maxSequenceAge} bars`
        );

        return result;
    }

    /*
     * ------------------------------------------------
     * CASE 4
     * Check latest market structure event.
     * ------------------------------------------------
     */

    const latestStructureEvent =
        marketStructure?.lastStructureEvent;

    if (
        latestStructureEvent &&
        latestStructureEvent.brokenIndex != null
    ) {
        const latestEventIndex =
            latestStructureEvent.brokenIndex;

        const latestEventDirection =
            latestStructureEvent.direction;

        /*
         * If a newer opposite-direction
         * structure event occurred,
         * invalidate the sequence.
         */

        if (
            latestEventIndex >
                structureBreakIndex &&
            latestEventDirection !==
                direction
        ) {
            result.invalidated = true;

            result.status =
                "INVALIDATED";

            result.reasons.push(
                `Sequence direction: ${direction}`
            );

            result.reasons.push(
                `Newer ${latestEventDirection} structure event detected`
            );

            result.reasons.push(
                "Previous sequence is no longer active"
            );

            return result;
        }
    }

    /*
     * ------------------------------------------------
     * CASE 5
     * Sequence is still valid and recent.
     * ------------------------------------------------
     */

    result.active = true;
    result.valid = true;

    result.status = "ACTIVE";

    result.reasons.push(
        `${direction} market sequence is active`
    );

    result.reasons.push(
        `Sequence age: ${ageBars} bars`
    );

    result.reasons.push(
        `${direction} BOS confirmed`
    );

    return result;
}