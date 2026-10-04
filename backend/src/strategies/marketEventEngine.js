export function detectMarketEvent({
    candles,
    liquidityMap,
    displacement,
    marketStructure
}) {
    if (
        !Array.isArray(candles) ||
        candles.length < 20
    ) {
        return {
            detected: false,
            confirmed: false,
            direction: null,
            event: "NONE",
            liquiditySweep: null,
            displacement: false,
            structureBreak: false,
            confidence: 0
        };
    }

    const current =
        candles[candles.length - 1];

    const currentPrice =
        current.close;

    /*
     * Only consider liquidity from the
     * most recent portion of the chart.
     */

    const minimumIndex =
        Math.max(
            0,
            candles.length - 60
        );

    const recentBuySide =
        liquidityMap.buySideLiquidity
            .filter(
                level =>
                    level.index >= minimumIndex
            );

    const recentSellSide =
        liquidityMap.sellSideLiquidity
            .filter(
                level =>
                    level.index >= minimumIndex
            );

    /*
     * Find the closest swept BUY-SIDE level.
     */

    const sweptBuySide =
        recentBuySide
            .filter(
                level =>
                    current.high > level.price &&
                    current.close < level.price
            )
            .sort(
                (a, b) =>
                    Math.abs(
                        currentPrice - a.price
                    ) -
                    Math.abs(
                        currentPrice - b.price
                    )
            );

    /*
     * Find the closest swept SELL-SIDE level.
     */

    const sweptSellSide =
        recentSellSide
            .filter(
                level =>
                    current.low < level.price &&
                    current.close > level.price
            )
            .sort(
                (a, b) =>
                    Math.abs(
                        currentPrice - a.price
                    ) -
                    Math.abs(
                        currentPrice - b.price
                    )
            );

    let liquiditySweep = null;

    /*
     * Prefer the closest valid sweep.
     */

    if (
        sweptBuySide.length > 0 &&
        sweptSellSide.length > 0
    ) {
        const buyDistance =
            Math.abs(
                currentPrice -
                sweptBuySide[0].price
            );

        const sellDistance =
            Math.abs(
                currentPrice -
                sweptSellSide[0].price
            );

        if (
            sellDistance <= buyDistance
        ) {
            liquiditySweep = {
                type: "SELL_SIDE_SWEEP",
                level:
                    sweptSellSide[0].price,
                index:
                    sweptSellSide[0].index,
                penetration:
                    sweptSellSide[0].price -
                    current.low
            };
        } else {
            liquiditySweep = {
                type: "BUY_SIDE_SWEEP",
                level:
                    sweptBuySide[0].price,
                index:
                    sweptBuySide[0].index,
                penetration:
                    current.high -
                    sweptBuySide[0].price
            };
        }
    } else if (
        sweptSellSide.length > 0
    ) {
        liquiditySweep = {
            type: "SELL_SIDE_SWEEP",
            level:
                sweptSellSide[0].price,
            index:
                sweptSellSide[0].index,
            penetration:
                sweptSellSide[0].price -
                current.low
        };
    } else if (
        sweptBuySide.length > 0
    ) {
        liquiditySweep = {
            type: "BUY_SIDE_SWEEP",
            level:
                sweptBuySide[0].price,
            index:
                sweptBuySide[0].index,
            penetration:
                current.high -
                sweptBuySide[0].price
        };
    }

    /*
     * No liquidity sweep.
     */

    if (!liquiditySweep) {
        return {
            detected: false,
            confirmed: false,
            direction: null,
            event: "NONE",
            liquiditySweep: null,
            displacement:
                displacement.detected,
            structureBreak:
                displacement.breaksStructure,
            confidence: 0
        };
    }

    /*
     * SELL-SIDE SWEEP
     *
     * Potential bullish reversal.
     */

    if (
        liquiditySweep.type ===
        "SELL_SIDE_SWEEP"
    ) {
        if (
            displacement.detected &&
            displacement.direction ===
                "BULLISH" &&
            displacement.breaksStructure
        ) {
            return {
                detected: true,
                confirmed: true,
                direction: "BULLISH",
                event:
                    "SELL_SIDE_SWEEP_BULLISH_BOS",
                liquiditySweep,
                displacement: true,
                structureBreak: true,
                confidence: 3
            };
        }

        if (
            displacement.detected &&
            displacement.direction ===
                "BULLISH"
        ) {
            return {
                detected: true,
                confirmed: false,
                direction: "BULLISH",
                event:
                    "SELL_SIDE_SWEEP_BULLISH_DISPLACEMENT",
                liquiditySweep,
                displacement: true,
                structureBreak: false,
                confidence: 2
            };
        }

        return {
            detected: true,
            confirmed: false,
            direction: "BULLISH",
            event:
                "SELL_SIDE_SWEEP",
            liquiditySweep,
            displacement:
                displacement.detected,
            structureBreak:
                displacement.breaksStructure,
            confidence: 1
        };
    }

    /*
     * BUY-SIDE SWEEP
     *
     * Potential bearish reversal.
     */

    if (
        liquiditySweep.type ===
        "BUY_SIDE_SWEEP"
    ) {
        if (
            displacement.detected &&
            displacement.direction ===
                "BEARISH" &&
            displacement.breaksStructure
        ) {
            return {
                detected: true,
                confirmed: true,
                direction: "BEARISH",
                event:
                    "BUY_SIDE_SWEEP_BEARISH_BOS",
                liquiditySweep,
                displacement: true,
                structureBreak: true,
                confidence: 3
            };
        }

        if (
            displacement.detected &&
            displacement.direction ===
                "BEARISH"
        ) {
            return {
                detected: true,
                confirmed: false,
                direction: "BEARISH",
                event:
                    "BUY_SIDE_SWEEP_BEARISH_DISPLACEMENT",
                liquiditySweep,
                displacement: true,
                structureBreak: false,
                confidence: 2
            };
        }

        return {
            detected: true,
            confirmed: false,
            direction: "BEARISH",
            event:
                "BUY_SIDE_SWEEP",
            liquiditySweep,
            displacement:
                displacement.detected,
            structureBreak:
                displacement.breaksStructure,
            confidence: 1
        };
    }

    return {
        detected: false,
        confirmed: false,
        direction: null,
        event: "NONE",
        liquiditySweep: null,
        displacement: false,
        structureBreak: false,
        confidence: 0
    };
}