/*
 * Settings that depend on the kind of market.
 *
 * Crypto and forex move in very different ranges, so a fixed
 * percentage that suits Bitcoin is far too wide (or too loose)
 * for a currency pair.
 *
 *   equalTolerance   how close two swing highs (or lows) must be,
 *                    as a fraction of price, to count as "equal".
 *                    0.001 = 0.1% (about $83 on Bitcoin).
 *                    0.0002 = 0.02% (about 2 pips on EUR/USD).
 *
 *   fallbackStopPct  stop distance used when no supply or demand
 *                    zone sits on the right side of entry.
 *                    0.005 = 0.5% on crypto.
 *                    0.0015 = 0.15% (about 16 pips on EUR/USD).
 *
 * Change the numbers here to tune either market.
 */

export const MARKET_PROFILES = {
    crypto: {
        equalTolerance: 0.001,
        fallbackStopPct: 0.005
    },

    forex: {
        equalTolerance: 0.0002,
        fallbackStopPct: 0.0015
    }
};

export function profileFor(market) {
    return MARKET_PROFILES[market] || MARKET_PROFILES.crypto;
}
