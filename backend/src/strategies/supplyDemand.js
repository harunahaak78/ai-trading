export function detectSupplyDemand(candles) {
    if (!candles || candles.length < 10) {
        return {
            detected: false,
            type: null,
            zone: null,
            inZone: false
        };
    }

    const zones = [];

    for (let i = 2; i < candles.length - 1; i++) {
        const base = candles[i];
        const confirmation = candles[i + 1];

        const baseBody = Math.abs(
            base.close - base.open
        );

        const baseRange = base.high - base.low;

        if (baseRange <= 0) {
            continue;
        }

        const bodyRatio =
            baseBody / baseRange;

        /*
         * =========================
         * DEMAND
         * =========================
         */

        const bullishDisplacement =
            confirmation.close > confirmation.open &&
            confirmation.close > base.high &&
            (
                confirmation.close -
                confirmation.open
            ) > baseBody;

        if (
            base.close < base.open &&
            bodyRatio < 0.7 &&
            bullishDisplacement
        ) {
            zones.push({
                type: "DEMAND",
                high: base.high,
                low: base.low,
                index: i
            });
        }

        /*
         * =========================
         * SUPPLY
         * =========================
         */

        const bearishDisplacement =
            confirmation.close < confirmation.open &&
            confirmation.close < base.low &&
            (
                confirmation.open -
                confirmation.close
            ) > baseBody;

        if (
            base.close > base.open &&
            bodyRatio < 0.7 &&
            bearishDisplacement
        ) {
            zones.push({
                type: "SUPPLY",
                high: base.high,
                low: base.low,
                index: i
            });
        }
    }

    if (zones.length === 0) {
        return {
            detected: false,
            type: null,
            zone: null,
            inZone: false
        };
    }

    const currentPrice =
        candles[candles.length - 1].close;

    /*
     * Start with the newest zone
     */

    const latestZone =
        zones[zones.length - 1];

    const inZone =
        currentPrice >= latestZone.low &&
        currentPrice <= latestZone.high;

    return {
        detected: true,

        type: latestZone.type,

        inZone,

        zone: {
            high: latestZone.high,
            low: latestZone.low,
            index: latestZone.index
        },

        zones
    };
}