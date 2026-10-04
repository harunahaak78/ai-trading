export function detectOrderBlock(candles) {
    if (!Array.isArray(candles) || candles.length < 10) {
        return {
            detected: false,
            type: null,
            high: null,
            low: null,
            index: null,
            strength: 0
        };
    }

    const currentIndex = candles.length - 1;

    const current = candles[currentIndex];

    const lookback = 10;

    const startIndex =
        Math.max(1, currentIndex - lookback);

    let bullishCandidates = [];
    let bearishCandidates = [];

    for (
        let i = startIndex;
        i < currentIndex;
        i++
    ) {
        const candle = candles[i];

        const next = candles[i + 1];

        const body =
            Math.abs(
                candle.close -
                candle.open
            );

        const range =
            candle.high -
            candle.low;

        if (range <= 0) {
            continue;
        }

        const bodyRatio =
            body / range;

        /*
         * BULLISH ORDER BLOCK
         *
         * The candle is bearish.
         * Price then moves strongly upward.
         */

        if (
            candle.close < candle.open
        ) {
            const bullishMove =
                next.close > next.open &&
                next.close > candle.high;

            if (bullishMove) {
                const displacement =
                    Math.abs(
                        next.close -
                        next.open
                    );

                const strength =
                    body > 0
                        ? displacement / body
                        : displacement;

                bullishCandidates.push({
                    type: "BULLISH",
                    high: candle.high,
                    low: candle.low,
                    index: i,
                    strength,
                    bodyRatio
                });
            }
        }

        /*
         * BEARISH ORDER BLOCK
         *
         * The candle is bullish.
         * Price then moves strongly downward.
         */

        if (
            candle.close > candle.open
        ) {
            const bearishMove =
                next.close < next.open &&
                next.close < candle.low;

            if (bearishMove) {
                const displacement =
                    Math.abs(
                        next.close -
                        next.open
                    );

                const strength =
                    body > 0
                        ? displacement / body
                        : displacement;

                bearishCandidates.push({
                    type: "BEARISH",
                    high: candle.high,
                    low: candle.low,
                    index: i,
                    strength,
                    bodyRatio
                });
            }
        }
    }

    /*
     * Select the most recent bullish
     * and bearish candidates.
     */

    const latestBullish =
        bullishCandidates.length > 0
            ? bullishCandidates[
                bullishCandidates.length - 1
            ]
            : null;

    const latestBearish =
        bearishCandidates.length > 0
            ? bearishCandidates[
                bearishCandidates.length - 1
            ]
            : null;

    /*
     * Determine whether current price
     * is interacting with an order block.
     */

    if (latestBullish) {
        const inBullishOB =
            current.close >= latestBullish.low &&
            current.close <= latestBullish.high;

        if (inBullishOB) {
            return {
                detected: true,
                type: "BULLISH",
                high: latestBullish.high,
                low: latestBullish.low,
                index: latestBullish.index,
                strength: latestBullish.strength,
                inZone: true
            };
        }
    }

    if (latestBearish) {
        const inBearishOB =
            current.close >= latestBearish.low &&
            current.close <= latestBearish.high;

        if (inBearishOB) {
            return {
                detected: true,
                type: "BEARISH",
                high: latestBearish.high,
                low: latestBearish.low,
                index: latestBearish.index,
                strength: latestBearish.strength,
                inZone: true
            };
        }
    }

    /*
     * If price isn't currently inside an OB,
     * return the most recent valid candidate.
     */

    if (latestBullish && latestBearish) {
        const bullishDistance =
            Math.abs(
                current.close -
                (
                    latestBullish.high +
                    latestBullish.low
                ) / 2
            );

        const bearishDistance =
            Math.abs(
                current.close -
                (
                    latestBearish.high +
                    latestBearish.low
                ) / 2
            );

        if (
            bullishDistance <= bearishDistance
        ) {
            return {
                detected: false,
                type: "BULLISH",
                high: latestBullish.high,
                low: latestBullish.low,
                index: latestBullish.index,
                strength: latestBullish.strength,
                inZone: false
            };
        }

        return {
            detected: false,
            type: "BEARISH",
            high: latestBearish.high,
            low: latestBearish.low,
            index: latestBearish.index,
            strength: latestBearish.strength,
            inZone: false
        };
    }

    if (latestBullish) {
        return {
            detected: false,
            type: "BULLISH",
            high: latestBullish.high,
            low: latestBullish.low,
            index: latestBullish.index,
            strength: latestBullish.strength,
            inZone: false
        };
    }

    if (latestBearish) {
        return {
            detected: false,
            type: "BEARISH",
            high: latestBearish.high,
            low: latestBearish.low,
            index: latestBearish.index,
            strength: latestBearish.strength,
            inZone: false
        };
    }

    return {
        detected: false,
        type: null,
        high: null,
        low: null,
        index: null,
        strength: 0,
        inZone: false
    };
}