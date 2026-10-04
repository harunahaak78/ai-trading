export function detectActiveEvent({
    marketEvent,
    marketSequence,
    activeSequence,
    marketStructure
}) {
    const result = {
        active: false,
        confirmed: false,
        direction: null,

        status: "NO_EVENT",

        event: null,

        confidence: 0,

        currentEvent: null,
        activeSequence: null,
        formingSequence: null,

        reasons: []
    };

    /*
    --------------------------------------------------
    1. Check for an ACTIVE CONFIRMED SEQUENCE
    --------------------------------------------------
    */

    if (
        activeSequence &&
        activeSequence.active &&
        activeSequence.valid &&
        !activeSequence.invalidated
    ) {
        result.active = true;
        result.confirmed = true;

        result.direction =
            activeSequence.direction;

        result.status = "ACTIVE";

        result.event = "ACTIVE_SEQUENCE";

        result.confidence = 3;

        result.activeSequence =
            activeSequence;

        result.reasons.push(
            `${activeSequence.direction} active sequence confirmed`
        );

        if (
            activeSequence.sequence &&
            activeSequence.sequence.sweep
        ) {
            result.reasons.push(
                `${activeSequence.sequence.sweep.type} detected`
            );
        }

        if (
            activeSequence.sequence &&
            activeSequence.sequence.displacement
        ) {
            result.reasons.push(
                `${activeSequence.direction} displacement confirmed`
            );
        }

        if (
            activeSequence.sequence &&
            activeSequence.sequence.structureBreak
        ) {
            result.reasons.push(
                `${activeSequence.direction} BOS confirmed`
            );
        }
    }

    /*
    --------------------------------------------------
    2. Check the current market event
    --------------------------------------------------
    */

    if (
        marketEvent &&
        marketEvent.detected
    ) {
        result.currentEvent =
            marketEvent;

        /*
        If there is no active sequence yet,
        use the current confirmed market event.
        */

        if (!result.active) {
            if (
                marketEvent.confirmed &&
                marketEvent.direction
            ) {
                result.active = true;
                result.confirmed = true;

                result.direction =
                    marketEvent.direction;

                result.status = "CONFIRMED";

                result.event =
                    marketEvent.event ||
                    "MARKET_EVENT";

                result.confidence =
                    marketEvent.confidence || 1;

                result.reasons.push(
                    `${marketEvent.direction} market event confirmed`
                );
            }
        }

        /*
        --------------------------------------------------
        Detect an opposing current event
        --------------------------------------------------
        */

        if (
            result.active &&
            marketEvent.direction &&
            marketEvent.direction !==
                result.direction
        ) {
            result.reasons.push(
                `Opposing ${marketEvent.direction} market event detected`
            );

            /*
            Do not immediately invalidate the active
            sequence unless the opposing event is
            structurally confirmed.
            */

            if (
                marketEvent.confirmed &&
                marketEvent.structureBreak
            ) {
                result.status =
                    "OPPOSING_EVENT_CONFIRMED";

                result.reasons.push(
                    "Opposing event has confirmed structure break"
                );

                result.active = false;
                result.confirmed = false;

                result.direction =
                    marketEvent.direction;

                result.event =
                    marketEvent.event ||
                    "OPPOSING_MARKET_EVENT";

                result.confidence =
                    marketEvent.confidence || 1;
            } else {
                result.reasons.push(
                    "Opposing event is not strong enough to invalidate the active sequence"
                );
            }
        }
    }

    /*
    --------------------------------------------------
    3. Check for a newer FORMING sequence
    --------------------------------------------------
    */

    if (
        marketSequence &&
        marketSequence.detected
    ) {
        /*
        A forming sequence is useful information,
        but should not automatically replace a
        confirmed active sequence.
        */

        if (
            !marketSequence.confirmed
        ) {
            result.formingSequence =
                marketSequence;

            /*
            If there is already an active sequence,
            report the forming sequence as a warning.
            */

            if (
                result.active &&
                marketSequence.direction &&
                marketSequence.direction !==
                    result.direction
            ) {
                result.status =
                    "ACTIVE_WITH_OPPOSING_FORMATION";

                result.reasons.push(
                    `New ${marketSequence.direction} sequence is forming`
                );

                result.reasons.push(
                    "Existing confirmed sequence remains active until opposing structure is confirmed"
                );
            }

            /*
            If there is no active confirmed sequence,
            the forming sequence becomes the current state.
            */

            if (!result.active) {
                result.direction =
                    marketSequence.direction;

                result.status = "FORMING";

                result.event =
                    "FORMING_SEQUENCE";

                result.confidence =
                    marketSequence.score || 1;

                result.reasons.push(
                    `${marketSequence.direction} sequence is forming`
                );

                result.reasons.push(
                    "Waiting for structure confirmation"
                );
            }
        }
    }

    /*
    --------------------------------------------------
    4. Check market structure
    --------------------------------------------------
    */

    if (
        marketStructure &&
        marketStructure.lastStructureEvent
    ) {
        const structureEvent =
            marketStructure.lastStructureEvent;

        if (
            result.active &&
            structureEvent.direction &&
            structureEvent.direction !==
                result.direction
        ) {
            /*
            A newer opposing structure event is
            important because it can invalidate
            the previous sequence.
            */

            if (
                structureEvent.brokenIndex != null &&
                result.activeSequence &&
                result.activeSequence.sequence &&
                result.activeSequence.sequence
                    .structureBreak &&
                structureEvent.brokenIndex >
                    result.activeSequence.sequence
                        .structureBreak.index
            ) {
                result.active = false;
                result.confirmed = false;

                result.direction =
                    structureEvent.direction;

                result.status =
                    "STRUCTURE_REVERSAL";

                result.event =
                    structureEvent.event ||
                    "STRUCTURE_BREAK";

                result.confidence = 3;

                result.reasons.push(
                    `Newer ${structureEvent.direction} structure event invalidated the previous sequence`
                );
            }
        }
    }

    /*
    --------------------------------------------------
    5. Final fallback
    --------------------------------------------------
    */

    if (!result.active && !result.formingSequence) {
        result.status = "NO_ACTIVE_EVENT";

        result.reasons.push(
            "No confirmed active event or forming sequence"
        );
    }

    return result;
}