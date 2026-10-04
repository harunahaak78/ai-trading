export function detectDisplacement(candles) {
    if (!Array.isArray(candles) || candles.length < 20) {
        return {
            detected: false,
            direction: null,
            strength: 0,
            breaksStructure: false,
            brokenLevel: null
        };
    }

    const current =
        candles[candles.length - 1];

    /*
     * Calculate the average candle body
     * from the previous 10 candles.
     */

    const previousCandles =
        candles.slice(-11, -1);

    const averageBody =
        previousCandles.reduce(
            (sum, candle) =>
                sum +
                Math.abs(
                    candle.close -
                    candle.open
                ),
            0
        ) / previousCandles.length;

    const currentBody =
        Math.abs(
            current.close -
            current.open
        );

    /*
     * Displacement requires the current
     * candle body to be significantly larger
     * than the recent average.
     */

    const displacementRatio =
        averageBody > 0
            ? currentBody / averageBody
            : 0;

    const isDisplacement =
        displacementRatio >= 1.5;

    if (!isDisplacement) {
        return {
            detected: false,
            direction: null,
            strength: displacementRatio,
            breaksStructure: false,
            brokenLevel: null
        };
    }

    /*
     * Recent structure levels.
     */

    const structureCandles =
        candles.slice(-11, -1);

    const recentHigh =
        Math.max(
            ...structureCandles.map(
                candle => candle.high
            )
        );

    const recentLow =
        Math.min(
            ...structureCandles.map(
                candle => candle.low
            )
        );

    /*
     * BULLISH DISPLACEMENT
     */

    if (
        current.close > current.open
    ) {
        const breaksStructure =
            current.close > recentHigh;

        return {
            detected: true,
            direction: "BULLISH",
            strength: displacementRatio,
            breaksStructure,
            brokenLevel:
                breaksStructure
                    ? recentHigh
                    : null
        };
    }

    /*
     * BEARISH DISPLACEMENT
     */

    if (
        current.close < current.open
    ) {
        const breaksStructure =
            current.close < recentLow;

        return {
            detected: true,
            direction: "BEARISH",
            strength: displacementRatio,
            breaksStructure,
            brokenLevel:
                breaksStructure
                    ? recentLow
                    : null
        };
    }

    return {
        detected: false,
        direction: null,
        strength: displacementRatio,
        breaksStructure: false,
        brokenLevel: null
    };
}