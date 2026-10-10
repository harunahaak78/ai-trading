import { confirmSequenceStructure } from "./structureConfirmationEngine.js";
import { detectMarketStructure } from "./marketStructure.js";

export function detectMarketSequence({
    candles,
    liquidityMap,
    maxBarsAfterSweep = 10,
    maxBarsAfterDisplacement = 8
}) {
    const result = {
        detected: false,
        confirmed: false,
        direction: null,
        score: 0,
        sequence: null,
        regime: null,
        reasons: []
    };

    if (!Array.isArray(candles) || candles.length === 0) {
        result.reasons.push("No candle data available");
        return result;
    }

    if (!liquidityMap) {
        result.reasons.push("Liquidity map is required");
        return result;
    }

    /*
     * =========================================================
     * STEP 0
     * Determine the latest market structure event.
     *
     * This becomes the current market regime boundary.
     *
     * Example:
     *
     * Old bullish sequence
     *        ↓
     * Bearish BOS
     *        ↓
     * New bearish regime
     *
     * Any bullish sequence before that bearish BOS is historical.
     * =========================================================
     */

    const marketStructure = detectMarketStructure(candles);

    const latestStructureEvent =
        marketStructure?.lastStructureEvent || null;
    const latestStructureIndex =
        latestStructureEvent?.brokenIndex ?? null;
    
    const latestStructureDirection =
        latestStructureEvent?.direction ?? null;
    if (latestStructureEvent) {
        result.reasons.push(
            `Current structure regime: ${latestStructureDirection}`
        );
        
         result.reasons.push(
             `Latest structure event occurred at candle ${latestStructureIndex}`
            );
    }
    

    if (
        latestStructureIndex != null &&
        latestStructureDirection
    ) {
        result.regime = {
            direction: latestStructureDirection,
            structureEvent: latestStructureEvent.event || null,
            structureIndex: latestStructureIndex
        };

        result.reasons.push(
            `Current structure regime: ${latestStructureDirection}`
        );

        result.reasons.push(
            `Latest structure event occurred at candle ${latestStructureIndex}`
        );
    }

    /*
     * =========================================================
     * STEP 1
     * Find ALL historical liquidity sweeps.
     *
     * Important improvement:
     *
     * The old version stopped at the first sweep found for each
     * swing. That can hide a newer sweep of the same liquidity
     * level.
     *
     * We now collect every valid sweep.
     * =========================================================
     */

    const sweeps = [];

    const swingHighs = Array.isArray(liquidityMap.swingHighs)
        ? liquidityMap.swingHighs
        : [];

    const swingLows = Array.isArray(liquidityMap.swingLows)
        ? liquidityMap.swingLows
        : [];

    /*
     * SELL-SIDE SWEEPS
     *
     * Price trades below a previous swing low
     * and closes back above it.
     *
     * This creates a bullish directional candidate.
     */

    for (const swing of swingLows) {
        if (!swing || swing.index == null) {
            continue;
        }

        for (let i = swing.index + 1; i < candles.length; i++) {
            const candle = candles[i];

            if (!candle) {
                continue;
            }

            if (
                candle.low < swing.price &&
                candle.close > swing.price
            ) {
                sweeps.push({
                    type: "SELL_SIDE_SWEEP",
                    direction: "BULLISH",
                    level: swing.price,
                    index: i,
                    swingIndex: swing.index
                });
            }
        }
    }

    /*
     * BUY-SIDE SWEEPS
     *
     * Price trades above a previous swing high
     * and closes back below it.
     *
     * This creates a bearish directional candidate.
     */

    for (const swing of swingHighs) {
        if (!swing || swing.index == null) {
            continue;
        }

        for (let i = swing.index + 1; i < candles.length; i++) {
            const candle = candles[i];

            if (!candle) {
                continue;
            }

            if (
                candle.high > swing.price &&
                candle.close < swing.price
            ) {
                sweeps.push({
                    type: "BUY_SIDE_SWEEP",
                    direction: "BEARISH",
                    level: swing.price,
                    index: i,
                    swingIndex: swing.index
                });
            }
        }
    }

    if (sweeps.length === 0) {
        result.reasons.push(
            "No historical liquidity sweep found"
        );

        return result;
    }

    /*
     * Newest sweep first.
     */
    sweeps.sort((a, b) => b.index - a.index);

    /*
     * =========================================================
     * STEP 2
     * Process sweeps from newest to oldest.
     *
     * The most important rule:
     *
     * If there is a newer opposite structure event, an old sweep
     * cannot create the current market sequence.
     *
     * Example:
     *
     * bullish sweep @ 154
     * bullish displacement @ 155
     * bullish BOS @ 156
     *
     * later:
     *
     * bearish BOS @ 196
     *
     * The bullish sequence is historical.
     *
     * We now wait for:
     *
     * bearish sweep > 196
     * bearish displacement
     * bearish BOS
     * =========================================================
     */

    for (const sweep of sweeps) {

        /*
         * ---------------------------------------------------------
         * CURRENT REGIME FILTER
         * ---------------------------------------------------------
         */

        if (
            latestStructureIndex != null &&
            latestStructureDirection
        ) {
            const structureIsNewer =
                latestStructureIndex > sweep.index;

            const directionOpposesStructure =
                sweep.direction !== latestStructureDirection;

            if (
                structureIsNewer &&
                directionOpposesStructure
            ) {
                result.reasons.push(
                    `${sweep.direction} sweep at ${sweep.index} is historical because the latest structure regime is ${latestStructureDirection} at ${latestStructureIndex}`
                );

                continue;
            }
        }

        /*
         * ---------------------------------------------------------
         * Find displacement after the sweep.
         * ---------------------------------------------------------
         */

        const displacementStart =
            sweep.index + 1;

        const displacementEnd =
            Math.min(
                candles.length - 1,
                sweep.index + maxBarsAfterSweep
            );

        let displacement = null;

        for (
            let i = displacementStart;
            i <= displacementEnd;
            i++
        ) {
            const candle = candles[i];

            if (!candle) {
                continue;
            }

            const body = Math.abs(
                candle.close - candle.open
            );

            const previousCandles =
                candles.slice(
                    Math.max(0, i - 10),
                    i
                );

            if (previousCandles.length < 5) {
                continue;
            }

            const averageBody =
                previousCandles.reduce(
                    (sum, item) =>
                        sum +
                        Math.abs(
                            item.close - item.open
                        ),
                    0
                ) / previousCandles.length;

            if (averageBody === 0) {
                continue;
            }

            const strength =
                body / averageBody;

            /*
             * Bullish displacement
             */

            if (
                sweep.direction === "BULLISH" &&
                candle.close > candle.open &&
                strength >= 1.5
            ) {
                displacement = {
                    index: i,
                    direction: "BULLISH",
                    strength
                };

                break;
            }

            /*
             * Bearish displacement
             */

            if (
                sweep.direction === "BEARISH" &&
                candle.close < candle.open &&
                strength >= 1.5
            ) {
                displacement = {
                    index: i,
                    direction: "BEARISH",
                    strength
                };

                break;
            }
        }

        /*
         * No displacement after this sweep.
         */

        if (!displacement) {
            continue;
        }

        /*
         * ---------------------------------------------------------
         * SECOND REGIME CHECK
         *
         * Make sure the current structure regime did not already
         * reverse between the sweep and displacement.
         * ---------------------------------------------------------
         */

        if (
            latestStructureIndex != null &&
            latestStructureDirection
        ) {
            const reversalOccurredBeforeDisplacement =
                latestStructureIndex >= sweep.index &&
                latestStructureIndex >= displacement.index;

            const displacementOpposesRegime =
                displacement.direction !==
                latestStructureDirection;

            if (
                reversalOccurredBeforeDisplacement &&
                displacementOpposesRegime
            ) {
                result.reasons.push(
                    `${sweep.direction} displacement rejected because ${latestStructureDirection} structure was already established before displacement`
                );

                continue;
            }
        }

        /*
         * =========================================================
         * STEP 3
         * Build candidate sequence.
         * =========================================================
         */

        const sequence = {
            direction: sweep.direction,
            sweep,
            displacement,
            structureBreak: null
        };

        /*
         * =========================================================
         * STEP 4
         * Confirm structure after displacement.
         * =========================================================
         */

        const structureConfirmation =
            confirmSequenceStructure({
                candles,
                sequence,
                liquidityMap,
                maxBarsAfterDisplacement
            });

        /*
         * =========================================================
         * STEP 5
         * CONFIRMED SEQUENCE
         * =========================================================
         */

        if (structureConfirmation.confirmed) {

            sequence.structureBreak = {
                event: structureConfirmation.event,
                direction: structureConfirmation.direction,
                brokenLevel:
                    structureConfirmation.brokenLevel,
                index:
                    structureConfirmation.brokenIndex,
                referenceSwingIndex:
                    structureConfirmation.referenceSwingIndex,
                displacementIndex:
                    structureConfirmation.displacementIndex
            };

            /*
             * -----------------------------------------------------
             * FRESH REVERSAL SEQUENCE VALIDATION
             *
             * A previous CHOCH/BOS only establishes the new regime.
             * It does NOT count as the new sequence's BOS.
             *
             * A sequence that agrees with the latest structure event
             * must be fresh. Sweep, displacement and structure break
             * must all occur AFTER that event:
             *
             *   Liquidity sweep -> Displacement -> NEW structure break
             * -----------------------------------------------------
             */

            if (
                latestStructureIndex != null &&
                latestStructureDirection &&
                sequence.direction === latestStructureDirection
            ) {
                const breakIndex = sequence.structureBreak.index;
                const breakDirection = sequence.structureBreak.direction;

                let rejection = null;

                if (breakIndex <= latestStructureIndex) {
                    rejection = `structure break ${breakIndex} is not newer than latest ${latestStructureDirection} structure event ${latestStructureIndex}`;
                } else if (breakDirection !== sequence.direction) {
                    rejection = `structure confirmation direction is ${breakDirection}`;
                } else if (sequence.displacement.index <= latestStructureIndex) {
                    rejection = `displacement occurred before latest structure event ${latestStructureIndex}`;
                } else if (sequence.sweep.index <= latestStructureIndex) {
                    rejection = `liquidity sweep occurred before latest structure event ${latestStructureIndex}`;
                }

                if (rejection) {
                    result.reasons.push(
                        `${sequence.direction} sequence rejected: ${rejection}`
                    );

                    continue;
                }

                result.reasons.push(
                    `Fresh ${sequence.direction} reversal sequence confirmed after structure event ${latestStructureIndex}`
                );
            }


            if (
                latestStructureIndex != null &&
                latestStructureDirection
            ) {
                const sequenceBreakIndex =
                    sequence.structureBreak.index;

                /*
                 * A sequence that broke before the current regime
                 * is historical.
                 */

                if (
                    sequenceBreakIndex <
                    latestStructureIndex
                ) {
                    result.reasons.push(
                        `${sequence.direction} sequence is historical because its structure break occurred at ${sequenceBreakIndex}, before the latest structure event at ${latestStructureIndex}`
                    );

                    continue;
                }

                /*
                 * A sequence with the wrong direction cannot control
                 * the current regime.
                 */

                if (
                    sequence.direction !==
                    latestStructureDirection
                ) {
                    result.reasons.push(
                        `${sequence.direction} sequence rejected because current structure regime is ${latestStructureDirection}`
                    );

                    continue;
                }
            }

            /*
             * -----------------------------------------------------
             * CONFIRMED CURRENT SEQUENCE
             * -----------------------------------------------------
             */

            result.detected = true;
            result.confirmed = true;
            result.direction = sweep.direction;
            result.score = 3;
            result.sequence = sequence;

            result.reasons.push(
                `${sweep.type} detected`
            );

            result.reasons.push(
                `${sweep.direction} displacement detected`
            );

            result.reasons.push(
                `${structureConfirmation.event} confirmed`
            );

            result.reasons.push(
                `Structure broke ${structureConfirmation.barsAfterDisplacement} bars after displacement`
            );

            result.reasons.push(
                `${sequence.direction} sequence belongs to the current structure regime`
            );

            return result;
        }

        /*
         * =========================================================
         * STEP 6
         * FORMING SEQUENCE
         * =========================================================
         *
         * A forming sequence is only valid if there has NOT been
         * a newer structure event after its displacement.
         * =========================================================
         */

        if (
            latestStructureIndex != null &&
            latestStructureDirection
        ) {
            const newerStructureAfterDisplacement =
                latestStructureIndex >
                displacement.index;

            if (newerStructureAfterDisplacement) {
                // result.reasons.push(
                //     `${sweep.direction} forming sequence expired because a newer ${latestStructureDirection} structure event occurred after displacement`
                // );

                continue;
            }

            /*
             * If the current regime is already opposite, do not
             * keep this sequence alive.
             */

            if (
                sweep.direction !==
                latestStructureDirection &&
                latestStructureIndex >= sweep.index
            ) {
                // result.reasons.push(
                //     `${sweep.direction} forming sequence rejected because current structure regime is ${latestStructureDirection}`
                // );

                continue;
            }
        }

        /*
         * =========================================================
         * VALID FORMING SEQUENCE
         * =========================================================
         */

        result.detected = true;
        result.confirmed = false;
        result.direction = sweep.direction;
        result.score = 2;
        result.sequence = sequence;

        result.reasons.push(
            `${sweep.type} detected`
        );

        result.reasons.push(
            `${sweep.direction} displacement detected`
        );

        result.reasons.push(
            "Waiting for structure confirmation"
        );

        result.reasons.push(
            ...structureConfirmation.reasons
        );

        return result;
    }

    /*
     * =========================================================
     * NO CURRENT SEQUENCE
     * =========================================================
     */

    if (
        latestStructureDirection &&
        latestStructureIndex != null
    ) {
        result.reasons.push(
            `No new ${latestStructureDirection} sequence has formed after the latest structure event`
        );

        result.reasons.push(
            `Waiting for a new ${latestStructureDirection === "BULLISH"
                ? "SELL_SIDE_SWEEP"
                : "BUY_SIDE_SWEEP"}`
        );

        result.reasons.push(
            "Then displacement and structure confirmation are required"
        );
    }

    return result;
}