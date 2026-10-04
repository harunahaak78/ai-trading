export function reconcileMarketStructure({
    analysis,
    higherTimeframeDirection = null,
    maxSequenceAge = 30
}) {
    const result = {
        state: "NO_STRUCTURE",
        direction: "NEUTRAL",
        sequenceDirection: null,
        structureDirection: null,
        latestStructureEvent: null,
        sequence: null,
        ageBars: null,
        valid: false,
        reasons: []
    };

    if (!analysis) {
        result.reasons.push("No market analysis available");
        return result;
    }

    const marketStructure = analysis.marketStructure || {};
    const marketSequence = analysis.marketSequence || {};
    const activeSequence = analysis.activeSequence || {};
    const activeEvent = analysis.activeEvent || {};

    const structureDirection =
        normalizeDirection(marketStructure.structure);

    const sequenceDirection =
        normalizeDirection(marketSequence.direction);

    const latestStructureEvent =
        marketStructure.lastStructureEvent || null;

    result.structureDirection = structureDirection;
    result.sequenceDirection = sequenceDirection;
    result.latestStructureEvent = latestStructureEvent;

    /*
     * ---------------------------------------------------------
     * 1. NO STRUCTURE
     * ---------------------------------------------------------
     */

    if (
        !structureDirection &&
        !sequenceDirection &&
        !latestStructureEvent
    ) {
        result.state = "NO_STRUCTURE";
        result.direction = "NEUTRAL";
        result.reasons.push("No usable market structure detected");
        return result;
    }

    /*
     * ---------------------------------------------------------
     * 2. ACTIVE CONFIRMED SEQUENCE
     * ---------------------------------------------------------
     */

    if (
        activeSequence &&
        activeSequence.active &&
        activeSequence.valid &&
        activeSequence.direction
    ) {
        const activeDirection =
            normalizeDirection(activeSequence.direction);

        result.direction = activeDirection;
        result.sequence = activeSequence.sequence || null;

        if (
            activeSequence.ageBars != null &&
            activeSequence.ageBars > maxSequenceAge
        ) {
            result.state = "STALE";
            result.valid = false;
            result.ageBars = activeSequence.ageBars;

            result.reasons.push(
                `${activeDirection} sequence is ${activeSequence.ageBars} bars old`
            );

            result.reasons.push(
                `Maximum allowed sequence age is ${maxSequenceAge} bars`
            );

            return result;
        }

        /*
         * If the latest structure event is opposite to the
         * active sequence and happened after the sequence BOS,
         * the sequence is no longer aligned.
         */

        const sequenceBreakIndex =
            activeSequence.sequence?.structureBreak?.index;

        const structureEventIndex =
            latestStructureEvent?.brokenIndex;

        const structureEventDirection =
            normalizeDirection(latestStructureEvent?.direction);

        if (
            structureEventDirection &&
            structureEventDirection !== activeDirection &&
            structureEventIndex != null &&
            sequenceBreakIndex != null &&
            structureEventIndex > sequenceBreakIndex
        ) {
            const eventType =
                latestStructureEvent?.event || "STRUCTURE_BREAK";

            if (eventType === "CHOCH") {
                result.state = "COUNTER_TREND_CONFIRMED";
                result.direction = structureEventDirection;
                result.valid = true;

                result.reasons.push(
                    `${activeDirection} sequence existed previously`
                );

                result.reasons.push(
                    `Newer ${structureEventDirection} CHOCH detected`
                );

                result.reasons.push(
                    "Market is showing a confirmed counter-trend structure event"
                );

                return result;
            }

            if (eventType === "BOS") {
                result.state = "REVERSAL_CONFIRMED";
                result.direction = structureEventDirection;
                result.valid = true;

                result.reasons.push(
                    `Previous ${activeDirection} sequence was invalidated`
                );

                result.reasons.push(
                    `Newer ${structureEventDirection} BOS confirmed`
                );

                result.reasons.push(
                    "Market structure has confirmed a directional reversal"
                );

                return result;
            }

            result.state = "COUNTER_TREND_CONFIRMED";
            result.direction = structureEventDirection;
            result.valid = true;

            result.reasons.push(
                `Newer ${structureEventDirection} structure event detected`
            );

            return result;
        }

        /*
         * Active sequence and structure are aligned.
         */

        if (
            structureDirection &&
            structureDirection === activeDirection
        ) {
            result.state = "ALIGNED";
            result.direction = activeDirection;
            result.valid = true;
            result.ageBars = activeSequence.ageBars;

            result.reasons.push(
                `${activeDirection} active sequence agrees with market structure`
            );

            if (activeSequence.ageBars != null) {
                result.reasons.push(
                    `Sequence age: ${activeSequence.ageBars} bars`
                );
            }

            return result;
        }

        /*
         * No opposing structure event.
         * Keep the active sequence valid.
         */

        result.state = "ALIGNED";
        result.direction = activeDirection;
        result.valid = true;
        result.ageBars = activeSequence.ageBars;

        result.reasons.push(
            `${activeDirection} active sequence remains valid`
        );

        return result;
    }

    /*
     * ---------------------------------------------------------
     * 3. CONFIRMED MARKET SEQUENCE BUT NOT ACTIVE
     * ---------------------------------------------------------
     */

    if (
        marketSequence &&
        marketSequence.detected &&
        marketSequence.confirmed &&
        sequenceDirection
    ) {
        result.sequence = marketSequence.sequence || null;

        const sequenceBreakIndex =
            marketSequence.sequence?.structureBreak?.index;

        const structureEventIndex =
            latestStructureEvent?.brokenIndex;

        const structureEventDirection =
            normalizeDirection(latestStructureEvent?.direction);

        /*
         * Newer opposing structure event.
         */

        if (
            structureEventDirection &&
            structureEventDirection !== sequenceDirection &&
            structureEventIndex != null &&
            sequenceBreakIndex != null &&
            structureEventIndex > sequenceBreakIndex
        ) {
            if (latestStructureEvent.event === "BOS") {
                result.state = "REVERSAL_CONFIRMED";
                result.direction = structureEventDirection;
                result.valid = true;

                result.reasons.push(
                    `${sequenceDirection} sequence is no longer controlling structure`
                );

                result.reasons.push(
                    `Newer ${structureEventDirection} BOS detected`
                );

                return result;
            }

            result.state = "COUNTER_TREND_CONFIRMED";
            result.direction = structureEventDirection;
            result.valid = true;

            result.reasons.push(
                `${sequenceDirection} sequence exists historically`
            );

            result.reasons.push(
                `Newer ${structureEventDirection} structure event detected`
            );

            return result;
        }

        /*
         * Sequence agrees with current structure.
         */

        if (
            structureDirection &&
            structureDirection === sequenceDirection
        ) {
            result.state = "ALIGNED";
            result.direction = sequenceDirection;
            result.valid = true;

            result.reasons.push(
                `${sequenceDirection} sequence agrees with market structure`
            );

            return result;
        }

        /*
         * Sequence exists but current structure does not clearly
         * confirm the same direction.
         */

        result.state = "STALE";
        result.direction = sequenceDirection;
        result.valid = false;

        result.reasons.push(
            `${sequenceDirection} sequence exists but current structure does not confirm it`
        );

        return result;
    }

    /*
     * ---------------------------------------------------------
     * 4. CURRENT STRUCTURE WITHOUT CONFIRMED SEQUENCE
     * ---------------------------------------------------------
     */

    if (structureDirection) {
        result.direction = structureDirection;
        result.valid = true;

        if (
            latestStructureEvent &&
            normalizeDirection(latestStructureEvent.direction) &&
            normalizeDirection(latestStructureEvent.direction) !==
                structureDirection
        ) {
            result.state = "COUNTER_TREND_FORMING";

            result.reasons.push(
                `Current structure is ${structureDirection}`
            );

            result.reasons.push(
                `Latest event is ${latestStructureEvent.direction}`
            );

            result.reasons.push(
                "A possible counter-trend is forming"
            );

            return result;
        }

        result.state = "ALIGNED";

        result.reasons.push(
            `Current market structure is ${structureDirection}`
        );

        return result;
    }

    /*
     * ---------------------------------------------------------
     * 5. FORMING ACTIVE EVENT / SEQUENCE
     * ---------------------------------------------------------
     */

    if (
        activeEvent &&
        activeEvent.active &&
        activeEvent.direction
    ) {
        const eventDirection =
            normalizeDirection(activeEvent.direction);

        result.direction = eventDirection;
        result.state = "COUNTER_TREND_FORMING";
        result.valid = true;

        result.reasons.push(
            `${eventDirection} active market event detected`
        );

        result.reasons.push(
            "Waiting for complete structure confirmation"
        );

        return result;
    }

    /*
     * ---------------------------------------------------------
     * FALLBACK
     * ---------------------------------------------------------
     */

    result.state = "NO_STRUCTURE";
    result.direction = "NEUTRAL";
    result.valid = false;

    result.reasons.push(
        "No reliable structure relationship could be established"
    );

    return result;
}


function normalizeDirection(direction) {
    if (!direction) {
        return null;
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

    return null;
}