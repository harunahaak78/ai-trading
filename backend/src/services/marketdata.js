import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const BINANCE_URL =
    "https://api.binance.com/api/v3/klines";

const TWELVE_DATA_URL =
    "https://api.twelvedata.com/time_series";


/*
 * ==========================================
 * CRYPTO — BINANCE
 * ==========================================
 */

export async function getCryptoCandles(
    symbol = "BTCUSDT",
    interval = "15m",
    limit = 200
) {

    const response = await axios.get(
        BINANCE_URL,
        {
            params: {
                symbol: symbol.toUpperCase(),
                interval,
                limit
            }
        }
    );

    return response.data.map(candle => ({

        time: Number(candle[0]),

        open: Number(candle[1]),

        high: Number(candle[2]),

        low: Number(candle[3]),

        close: Number(candle[4]),

        volume: Number(candle[5])

    }));
}


/*
 * ==========================================
 * FOREX — TWELVE DATA
 * ==========================================
 */

export async function getForexCandles(
    symbol = "EUR/USD",
    interval = "15min",
    outputsize = 200
) {

    if (!process.env.TWELVE_DATA_API_KEY) {
        throw new Error(
            "TWELVE_DATA_API_KEY is not configured"
        );
    }

    const response = await axios.get(
        TWELVE_DATA_URL,
        {
            params: {
                symbol,
                interval,
                outputsize,
                apikey:
                    process.env.TWELVE_DATA_API_KEY
            }
        }
    );

    if (response.data.status === "error") {
        throw new Error(
            response.data.message
        );
    }

    return response.data.values
        .reverse()
        .map(candle => ({

            time: new Date(
                candle.datetime
            ).getTime(),

            open: Number(candle.open),

            high: Number(candle.high),

            low: Number(candle.low),

            close: Number(candle.close),

            volume:
                candle.volume
                    ? Number(candle.volume)
                    : 0

        }));
}

export async function getMultiTimeframeCryptoCandles(
    symbol = "BTCUSDT"
) {
    const [
        candles4H,
        candles1H,
        candles15M,
        candles5M
    ] = await Promise.all([
        getCryptoCandles(symbol, "4h", 200),
        getCryptoCandles(symbol, "1h", 200),
        getCryptoCandles(symbol, "15m", 200),
        getCryptoCandles(symbol, "5m", 200)
    ]);

    return {
        candles4H,
        candles1H,
        candles15M,
        candles5M
    };
}