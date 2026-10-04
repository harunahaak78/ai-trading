export function detectFairValueGap(candles) {
    const gaps = [];

    for (let i = 2; i < candles.length; i++) {
        const first = candles[i - 2];
        const middle = candles[i - 1];
        const third = candles[i];

        // Bullish FVG
        if (third.low > first.high) {
            gaps.push({
                type: "BULLISH",
                top: third.low,
                bottom: first.high,
                index: i
            });
        }

        // Bearish FVG
        if (third.high < first.low) {
            gaps.push({
                type: "BEARISH",
                top: first.low,
                bottom: third.high,
                index: i
            });
        }
    }

    return gaps;
}