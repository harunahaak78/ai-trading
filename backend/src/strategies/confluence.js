export function calculateConfluence({
    structure,
    liquidity,
    orderBlock,
    fairValueGap,
    supplyDemand,
    rsi,
    emaFast,
    emaSlow
}) {
    let bullishScore = 0;
    let bearishScore = 0;

    /*
     * =========================
     * MARKET STRUCTURE
     * =========================
     */

    if (structure.structure === "BULLISH") {
        bullishScore += 2;
    }

    if (structure.structure === "BEARISH") {
        bearishScore += 2;
    }

    /*
     * =========================
     * LIQUIDITY
     * =========================
     */

    if (
        liquidity.type === "SELL_SIDE_SWEEP"
    ) {
        bullishScore += 2;
    }

    if (
        liquidity.type === "BUY_SIDE_SWEEP"
    ) {
        bearishScore += 2;
    }

    /*
     * =========================
     * ORDER BLOCK
     * =========================
     */

    if (orderBlock.type === "BULLISH") {
        bullishScore += 2;
    }

    if (orderBlock.type === "BEARISH") {
        bearishScore += 2;
    }

    /*
     * =========================
     * FAIR VALUE GAP
     * =========================
     */

    if (fairValueGap.type === "BULLISH") {
        bullishScore += 1;
    }

    if (fairValueGap.type === "BEARISH") {
        bearishScore += 1;
    }

    /*
     * =========================
     * SUPPLY & DEMAND
     * =========================
     */

    if (
        supplyDemand.detected &&
        supplyDemand.inZone
    ) {
        if (supplyDemand.type === "DEMAND") {
            bullishScore += 2;
        }

        if (supplyDemand.type === "SUPPLY") {
            bearishScore += 2;
        }
    }

    /*
     * =========================
     * RSI
     * =========================
     */

    if (rsi !== null) {
        if (rsi > 50) {
            bullishScore += 1;
        }

        if (rsi < 50) {
            bearishScore += 1;
        }
    }

    /*
     * =========================
     * EMA
     * =========================
     */

    if (
        emaFast !== null &&
        emaSlow !== null
    ) {
        if (emaFast > emaSlow) {
            bullishScore += 1;
        }

        if (emaFast < emaSlow) {
            bearishScore += 1;
        }
    }

    /*
     * =========================
     * FINAL SIGNAL
     * =========================
     */

    let direction = "WAIT";

    if (
        bullishScore >= 7 &&
        bullishScore > bearishScore
    ) {
        direction = "BUY";
    }

    if (
        bearishScore >= 7 &&
        bearishScore > bullishScore
    ) {
        direction = "SELL";
    }

    const confidenceScore =
        Math.max(
            bullishScore,
            bearishScore
        );

    return {
        direction,

        bullishScore,

        bearishScore,

        confidenceScore
    };
}