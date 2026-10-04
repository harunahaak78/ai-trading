export function confirmSequenceStructure({
    candles,
    sequence,
    liquidityMap,
    maxBarsAfterDisplacement = 8,
    maxReferenceAge = 30
}) {
    const result = {
        detected: false,
        confirmed: false,
        direction: null,
        event: null,
        brokenLevel: null,
        brokenIndex: null,
        referenceSwingIndex: null,
        displacementIndex: null,
        barsAfterDisplacement: null,
        reasons: []
    };

    if (!Array.isArray(candles) || candles.length === 0) {
        result.reasons.push("No candle data available");
        return result;
    }

    if (!sequence || !sequence.displacement) {
        result.reasons.push("No displacement found");
        return result;
    }

    if (!liquidityMap) {
        result.reasons.push("Liquidity map is required");
        return result;
    }

    const direction = sequence.direction;
    const displacement = sequence.displacement;
    const displacementIndex = displacement.index;

    result.direction = direction;
    result.displacementIndex = displacementIndex;

    if (displacementIndex == null) {
        result.reasons.push("Displacement index is missing");
        return result;
    }

    /*
     * ---------------------------------------------------------
     * BULLISH SEQUENCE
     *
     * SELL-SIDE SWEEP
     *        ↓
     * BULLISH DISPLACEMENT
     *        ↓
     * BREAK LAST RELEVANT SWING HIGH
     *        ↓
     * BULLISH STRUCTURE CONFIRMATION
     * ---------------------------------------------------------
     */

    if (direction === "BULLISH") {
        const swingHighs = Array.isArray(liquidityMap.swingHighs)
            ? liquidityMap.swingHighs
            : [];

        const eligibleHighs = swingHighs
            .filter(swing =>
                swing &&
                swing.index < displacementIndex &&
                displacementIndex - swing.index <= maxReferenceAge
            )
            .sort((a, b) => b.index - a.index);

        if (eligibleHighs.length === 0) {
            result.reasons.push(
                "No relevant swing high existed before bullish displacement"
            );
            return result;
        }

        const reference = eligibleHighs[0];

        result.referenceSwingIndex = reference.index;
        result.brokenLevel = reference.price;

        const endIndex = Math.min(
            candles.length - 1,
            displacementIndex + maxBarsAfterDisplacement
        );

        for (
            let i = displacementIndex + 1;
            i <= endIndex;
            i++
        ) {
            const candle = candles[i];

            if (!candle) continue;

            if (candle.close > reference.price) {
                result.detected = true;
                result.confirmed = true;
                result.event = "BULLISH_STRUCTURE_BREAK";
                result.brokenIndex = i;
                result.barsAfterDisplacement =
                    i - displacementIndex;

                result.reasons.push(
                    `Bullish candle closed above protected swing high ${reference.price}`
                );

                result.reasons.push(
                    `Structure broke ${result.barsAfterDisplacement} bars after displacement`
                );

                return result;
            }
        }

        result.reasons.push(
            `No bullish structure break within ${maxBarsAfterDisplacement} bars after displacement`
        );

        return result;
    }

    /*
     * ---------------------------------------------------------
     * BEARISH SEQUENCE
     *
     * BUY-SIDE SWEEP
     *        ↓
     * BEARISH DISPLACEMENT
     *        ↓
     * BREAK LAST RELEVANT SWING LOW
     *        ↓
     * BEARISH STRUCTURE CONFIRMATION
     * ---------------------------------------------------------
     */

    if (direction === "BEARISH") {
        const swingLows = Array.isArray(liquidityMap.swingLows)
            ? liquidityMap.swingLows
            : [];

        const eligibleLows = swingLows
            .filter(swing =>
                swing &&
                swing.index < displacementIndex &&
                displacementIndex - swing.index <= maxReferenceAge
            )
            .sort((a, b) => b.index - a.index);

        if (eligibleLows.length === 0) {
            result.reasons.push(
                "No relevant swing low existed before bearish displacement"
            );
            return result;
        }

        const reference = eligibleLows[0];

        result.referenceSwingIndex = reference.index;
        result.brokenLevel = reference.price;

        const endIndex = Math.min(
            candles.length - 1,
            displacementIndex + maxBarsAfterDisplacement
        );

        for (
            let i = displacementIndex + 1;
            i <= endIndex;
            i++
        ) {
            const candle = candles[i];

            if (!candle) continue;

            if (candle.close < reference.price) {
                result.detected = true;
                result.confirmed = true;
                result.event = "BEARISH_STRUCTURE_BREAK";
                result.brokenIndex = i;
                result.barsAfterDisplacement =
                    i - displacementIndex;

                result.reasons.push(
                    `Bearish candle closed below protected swing low ${reference.price}`
                );

                result.reasons.push(
                    `Structure broke ${result.barsAfterDisplacement} bars after displacement`
                );

                return result;
            }
        }

        result.reasons.push(
            `No bearish structure break within ${maxBarsAfterDisplacement} bars after displacement`
        );

        return result;
    }

    result.reasons.push(
        `Unsupported sequence direction: ${direction}`
    );

    return result;
}