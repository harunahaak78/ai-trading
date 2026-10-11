export function buildLiquidityMap(
    candles,
    { equalTolerance = 0.001 } = {}
) {
    if (!Array.isArray(candles) || candles.length < 20) {
        return {
            swingHighs: [],
            swingLows: [],
            equalHighs: [],
            equalLows: [],
            buySideLiquidity: [],
            sellSideLiquidity: []
        };
    }

    const swingHighs = [];
    const swingLows = [];

    /*
     * Detect swing highs and swing lows.
     */

    for (let i = 2; i < candles.length - 2; i++) {
        const current = candles[i];

        const isSwingHigh =
            current.high > candles[i - 1].high &&
            current.high > candles[i - 2].high &&
            current.high > candles[i + 1].high &&
            current.high > candles[i + 2].high;

        const isSwingLow =
            current.low < candles[i - 1].low &&
            current.low < candles[i - 2].low &&
            current.low < candles[i + 1].low &&
            current.low < candles[i + 2].low;

        if (isSwingHigh) {
            swingHighs.push({
                price: current.high,
                index: i
            });
        }

        if (isSwingLow) {
            swingLows.push({
                price: current.low,
                index: i
            });
        }
    }

    /*
     * Equal highs / lows tolerance.
     *
     * Default 0.001 = 0.1%. Pass `equalTolerance` to change it
     * (forex uses a much tighter value, see config/marketProfiles.js).
     */

    const tolerance = equalTolerance;

    const equalHighs = [];

    for (let i = 0; i < swingHighs.length; i++) {
        for (let j = i + 1; j < swingHighs.length; j++) {
            const price1 = swingHighs[i].price;
            const price2 = swingHighs[j].price;

            const difference =
                Math.abs(price1 - price2) /
                Math.max(price1, price2);

            if (difference <= tolerance) {
                equalHighs.push({
                    price:
                        (price1 + price2) / 2,
                    firstIndex:
                        swingHighs[i].index,
                    secondIndex:
                        swingHighs[j].index
                });
            }
        }
    }

    const equalLows = [];

    for (let i = 0; i < swingLows.length; i++) {
        for (let j = i + 1; j < swingLows.length; j++) {
            const price1 = swingLows[i].price;
            const price2 = swingLows[j].price;

            const difference =
                Math.abs(price1 - price2) /
                Math.max(price1, price2);

            if (difference <= tolerance) {
                equalLows.push({
                    price:
                        (price1 + price2) / 2,
                    firstIndex:
                        swingLows[i].index,
                    secondIndex:
                        swingLows[j].index
                });
            }
        }
    }

    /*
     * Buy-side liquidity normally sits above highs.
     */

    const buySideLiquidity =
        swingHighs.map(level => ({
            type: "BUY_SIDE",
            price: level.price,
            index: level.index
        }));

    /*
     * Sell-side liquidity normally sits below lows.
     */

    const sellSideLiquidity =
        swingLows.map(level => ({
            type: "SELL_SIDE",
            price: level.price,
            index: level.index
        }));

    return {
        swingHighs,
        swingLows,
        equalHighs,
        equalLows,
        buySideLiquidity,
        sellSideLiquidity
    };
}