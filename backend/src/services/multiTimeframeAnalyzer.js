import { analyzeMarket } from "./analyzer.js";
import { generateTradeSetup, generateTradeLevels } from "./setupEngine.js";
import { generateMultiTimeframeDecision } from "../strategies/multiTimeframeDecisionEngine.js";
import { profileFor } from "../config/marketProfiles.js";

export function analyzeMultiTimeframe({
    candles4H,
    candles1H,
    candles15M,
    candles5M,
    market = "crypto"
}) {
    if (
        !Array.isArray(candles4H) ||
        !Array.isArray(candles1H) ||
        !Array.isArray(candles15M) ||
        !Array.isArray(candles5M)
    ) {
        throw new Error("All four timeframes are required");
    }

    // --------------------------------------------------
    // ANALYZE EACH TIMEFRAME
    // --------------------------------------------------

    const profile = profileFor(market);

    const options = {
        equalTolerance: profile.equalTolerance
    };

    const analysis4H = analyzeMarket(candles4H, options);
    const analysis1H = analyzeMarket(candles1H, options);
    const analysis15M = analyzeMarket(candles15M, options);
    const analysis5M = analyzeMarket(candles5M, options);

    // --------------------------------------------------
    // MULTI-TIMEFRAME DECISION ENGINE
    // --------------------------------------------------

    const multiTimeframeDecision = generateMultiTimeframeDecision({
        analysis4H,
        analysis1H,
        analysis15M,
        analysis5M
    });

    // --------------------------------------------------
    // TRADE LEVELS
    //
    // Driven by the decision engine, so entry, stop and
    // targets only exist when the final signal is BUY or SELL.
    // --------------------------------------------------

    const tradeSetup = generateTradeLevels({
        decision: multiTimeframeDecision,
        fifteenMinute: analysis15M,
        fiveMinute: analysis5M,
        fallbackStopPct: profile.fallbackStopPct
    });

    // --------------------------------------------------
    // LEGACY TRADE SETUP
    //
    // Keep this temporarily for debugging.
    // It is NOT authoritative for finalSignal.
    // --------------------------------------------------

    const legacyTradeSetup = generateTradeSetup({
        higherTimeframe: analysis4H,
        oneHour: analysis1H,
        fifteenMinute: analysis15M,
        fiveMinute: analysis5M
    });

    // --------------------------------------------------
    // FINAL SIGNAL
    //
    // The decision engine is now authoritative.
    // --------------------------------------------------

    let finalSignal = "WAIT";
    let status = "WAIT";

    switch (multiTimeframeDecision.state) {
        case "BUY_READY":
            finalSignal = "BUY";
            status = "BUY_READY";
            break;

        case "SELL_READY":
            finalSignal = "SELL";
            status = "SELL_READY";
            break;

        case "PULLBACK_TO_ZONE":
            finalSignal = "WAIT";
            status = "PULLBACK_TO_ZONE";
            break;

        case "CONFLICT":
            finalSignal = "WAIT";
            status = "CONFLICT";
            break;

        case "WAIT_FOR_CONFIRMATION":
            finalSignal = "WAIT";
            status = "WAITING_FOR_CONFIRMATION";
            break;

        case "BULLISH_BIAS":
            finalSignal = "WAIT";
            status = "BULLISH_BIAS";
            break;

        case "BEARISH_BIAS":
            finalSignal = "WAIT";
            status = "BEARISH_BIAS";
            break;

        default:
            finalSignal = "WAIT";
            status = "WAIT";
            break;
    }

    // --------------------------------------------------
    // HIGHER-TIMEFRAME BIAS
    // --------------------------------------------------

    const higherTimeframeBias =
        multiTimeframeDecision.higherTimeframeBias || "NEUTRAL";

    // --------------------------------------------------
    // SETUP DIRECTION
    // --------------------------------------------------

    const setupDirection =
        multiTimeframeDecision.setupDirection || "NEUTRAL";

    let fifteenMinuteSetup = "WAIT";

    if (setupDirection === "BULLISH") {
        fifteenMinuteSetup = "BUY";
    }

    if (setupDirection === "BEARISH") {
        fifteenMinuteSetup = "SELL";
    }

    // --------------------------------------------------
    // ENTRY DIRECTION
    // --------------------------------------------------

    const entryDirection =
        multiTimeframeDecision.entryDirection || "NEUTRAL";

    let fiveMinuteConfirmation = "WAIT";

    if (entryDirection === "BULLISH") {
        fiveMinuteConfirmation = "BUY";
    }

    if (entryDirection === "BEARISH") {
        fiveMinuteConfirmation = "SELL";
    }

    // --------------------------------------------------
    // FINAL RESPONSE
    // --------------------------------------------------

    return {
        market,

        finalSignal,
        status,

        multiTimeframeDecision,

        bias: {
            fourHour: higherTimeframeBias,
            oneHour: getDirectionFromAnalysis(analysis1H)
        },

        setup: {
            fifteenMinute: fifteenMinuteSetup
        },

        entry: {
            fiveMinute: fiveMinuteConfirmation
        },

        tradeSetup,

        legacyTradeSetup,

        timeframes: {
            "4H": trimForResponse(analysis4H),
            "1H": trimForResponse(analysis1H),
            "15M": trimForResponse(analysis15M),
            "5M": trimForResponse(analysis5M)
        },

        // Candles for charting. Zone and swing indices in each
        // timeframe's analysis refer to the full candle array, so
        // `offset` is the index of the first candle sent.
        chart: {
            "4H": toChart(candles4H),
            "1H": toChart(candles1H),
            "15M": toChart(candles15M),
            "5M": toChart(candles5M)
        },

        analyzedAt: new Date().toISOString()
    };
}


// --------------------------------------------------
// CHART DATA
// --------------------------------------------------

function toChart(candles, size = 300) {
    const offset = Math.max(0, candles.length - size);

    return {
        offset,
        candles: candles.slice(offset)
    };
}

/*
 * The market sequence engine logs the same sentence once per swing
 * it checks, which made each timeframe's `reasons` list hundreds of
 * lines long, mostly repeats. Keep each line once, in order.
 * Only the response is trimmed; the engines are untouched.
 */

function trimForResponse(analysis) {
    const reasons = analysis?.marketSequence?.reasons;

    if (!Array.isArray(reasons)) {
        return analysis;
    }

    return {
        ...analysis,
        marketSequence: {
            ...analysis.marketSequence,
            reasons: [...new Set(reasons)]
        }
    };
}


// --------------------------------------------------
// HELPER
// --------------------------------------------------

function getDirectionFromAnalysis(analysis) {
    if (!analysis) {
        return "NEUTRAL";
    }

    /*
     * =========================================================
     * PRIORITY 1
     * Structure reconciliation
     *
     * This is the authoritative current structure state.
     * It must override stale sequences or historical events.
     * =========================================================
     */

    if (
        analysis.structureReconciliation &&
        analysis.structureReconciliation.valid &&
        analysis.structureReconciliation.direction
    ) {
        const reconciliation =
            analysis.structureReconciliation;

        if (
            reconciliation.state === "REVERSAL_CONFIRMED" ||
            reconciliation.state === "COUNTER_TREND_CONFIRMED" ||
            reconciliation.state === "ALIGNED"
        ) {
            return normalizeDirection(
                reconciliation.direction
            );
        }
    }

    /*
     * =========================================================
     * PRIORITY 2
     * Active confirmed event
     * =========================================================
     */

    if (
        analysis.activeEvent &&
        analysis.activeEvent.active &&
        analysis.activeEvent.confirmed &&
        analysis.activeEvent.direction
    ) {
        return normalizeDirection(
            analysis.activeEvent.direction
        );
    }

    /*
     * =========================================================
     * PRIORITY 3
     * Active confirmed sequence
     * =========================================================
     */

    if (
        analysis.activeSequence &&
        analysis.activeSequence.active &&
        analysis.activeSequence.valid &&
        analysis.activeSequence.direction
    ) {
        return normalizeDirection(
            analysis.activeSequence.direction
        );
    }

    /*
     * =========================================================
     * PRIORITY 4
     * Confirmed market sequence
     * =========================================================
     */

    if (
        analysis.marketSequence &&
        analysis.marketSequence.confirmed &&
        analysis.marketSequence.direction
    ) {
        return normalizeDirection(
            analysis.marketSequence.direction
        );
    }

    /*
     * =========================================================
     * PRIORITY 5
     * Confirmed market event
     * =========================================================
     */

    if (
        analysis.marketEvent &&
        analysis.marketEvent.confirmed &&
        analysis.marketEvent.direction
    ) {
        return normalizeDirection(
            analysis.marketEvent.direction
        );
    }

    /*
     * =========================================================
     * PRIORITY 6
     * Raw market structure
     * =========================================================
     */

    if (
        analysis.marketStructure &&
        analysis.marketStructure.structure
    ) {
        return normalizeDirection(
            analysis.marketStructure.structure
        );
    }

    return "NEUTRAL";
}


/*
 * =========================================================
 * NORMALIZE DIRECTION
 * =========================================================
 */

function normalizeDirection(direction) {
    if (!direction) {
        return "NEUTRAL";
    }

    const value =
        String(direction).toUpperCase();

    if (
        value === "BULLISH" ||
        value === "BUY" ||
        value === "LONG"
    ) {
        return "BULLISH";
    }

    if (
        value === "BEARISH" ||
        value === "SELL" ||
        value === "SHORT"
    ) {
        return "BEARISH";
    }

    return "NEUTRAL";
}