export function detectLiquidityEngine(candles) {
    if (!Array.isArray(candles) || candles.length < 20) {
        return {
            detected: false,
            type: null,
            level: null,
            strength: 0
        };
    }

    const current =
        candles[candles.length - 1];

    const previous =
        candles.slice(-11, -1);

    const recentHigh =
        Math.max(
            ...previous.map(candle => candle.high)
        );

    const recentLow =
        Math.min(
            ...previous.map(candle => candle.low)
        );

    /*
     * BUY-SIDE LIQUIDITY SWEEP
     *
     * Price takes previous highs
     * and closes back below them.
     */

    if (
        current.high > recentHigh &&
        current.close < recentHigh
    ) {
        return {
            detected: true,
            type: "BUY_SIDE_SWEEP",
            level: recentHigh,
            strength:
                current.high - recentHigh
        };
    }

    /*
     * SELL-SIDE LIQUIDITY SWEEP
     *
     * Price takes previous lows
     * and closes back above them.
     */

    if (
        current.low < recentLow &&
        current.close > recentLow
    ) {
        return {
            detected: true,
            type: "SELL_SIDE_SWEEP",
            level: recentLow,
            strength:
                recentLow - current.low
        };
    }

    /*
     * NO SWEEP
     */

    return {
        detected: false,
        type: null,
        level: null,
        strength: 0
    };
}