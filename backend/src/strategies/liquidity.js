export function detectLiquiditySweep(candles) {
    if (candles.length < 5) {
        return {
            detected: false,
            type: null
        };
    }

    const current = candles[candles.length - 1];

    const recentCandles = candles.slice(-6, -1);

    const previousHigh = Math.max(
        ...recentCandles.map(candle => candle.high)
    );

    const previousLow = Math.min(
        ...recentCandles.map(candle => candle.low)
    );

    // Buy-side liquidity sweep
    if (
        current.high > previousHigh &&
        current.close < previousHigh
    ) {
        return {
            detected: true,
            type: "BUY_SIDE_SWEEP"
        };
    }

    // Sell-side liquidity sweep
    if (
        current.low < previousLow &&
        current.close > previousLow
    ) {
        return {
            detected: true,
            type: "SELL_SIDE_SWEEP"
        };
    }

    return {
        detected: false,
        type: null
    };
}