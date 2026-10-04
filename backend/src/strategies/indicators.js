export function calculateEMA(candles, period) {
    if (candles.length < period) {
        return null;
    }

    const multiplier = 2 / (period + 1);

    let ema = candles
        .slice(0, period)
        .reduce((sum, candle) => sum + candle.close, 0) / period;

    for (let i = period; i < candles.length; i++) {
        ema =
            (candles[i].close - ema) * multiplier +
            ema;
    }

    return ema;
}


export function calculateRSI(candles, period = 14) {
    if (candles.length <= period) {
        return null;
    }

    let gains = 0;
    let losses = 0;

    for (let i = candles.length - period; i < candles.length; i++) {
        const change =
            candles[i].close - candles[i - 1].close;

        if (change > 0) {
            gains += change;
        } else {
            losses += Math.abs(change);
        }
    }

    if (losses === 0) {
        return 100;
    }

    const averageGain = gains / period;
    const averageLoss = losses / period;

    const rs = averageGain / averageLoss;

    return 100 - (100 / (1 + rs));
}