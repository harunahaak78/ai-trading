export function detectMarketStructure(candles) {
    if (!Array.isArray(candles) || candles.length < 20) {
        return {
            structure: "UNKNOWN",
            event: "NONE",
            direction: null,
            brokenLevel: null,
            brokenIndex: null,
            bos: false,
            choch: false,
            swingHighs: [],
            swingLows: []
        };
    }

    // --------------------------------------------------
    // 1. DETECT SWING HIGHS AND SWING LOWS
    // --------------------------------------------------

    const swingHighs = [];
    const swingLows = [];

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

    if (
        swingHighs.length < 2 ||
        swingLows.length < 2
    ) {
        return {
            structure: "UNKNOWN",
            event: "NONE",
            direction: null,
            brokenLevel: null,
            brokenIndex: null,
            bos: false,
            choch: false,
            swingHighs,
            swingLows
        };
    }

    // --------------------------------------------------
    // 2. DETERMINE CURRENT STRUCTURE
    // --------------------------------------------------

    const previousHigh =
        swingHighs[swingHighs.length - 2];

    const latestHigh =
        swingHighs[swingHighs.length - 1];

    const previousLow =
        swingLows[swingLows.length - 2];

    const latestLow =
        swingLows[swingLows.length - 1];

    let structure = "RANGING";

    if (
        latestHigh.price > previousHigh.price &&
        latestLow.price > previousLow.price
    ) {
        structure = "BULLISH";
    } else if (
        latestHigh.price < previousHigh.price &&
        latestLow.price < previousLow.price
    ) {
        structure = "BEARISH";
    }

    // --------------------------------------------------
    // 3. FIND HISTORICAL STRUCTURE EVENTS
    // --------------------------------------------------

    const structureEvents = [];

    // ----------------------------------------------
    // BULLISH BREAKS
    // ----------------------------------------------

    for (const swingHigh of swingHighs) {
        const level = swingHigh.price;
        const startIndex = swingHigh.index + 1;

        for (
            let i = startIndex;
            i < candles.length;
            i++
        ) {
            const candle = candles[i];

            if (candle.close > level) {
                structureEvents.push({
                    event: "BULLISH_BREAK",
                    direction: "BULLISH",
                    level,
                    brokenIndex: i,
                    swingIndex: swingHigh.index
                });

                break;
            }
        }
    }

    // ----------------------------------------------
    // BEARISH BREAKS
    // ----------------------------------------------

    for (const swingLow of swingLows) {
        const level = swingLow.price;
        const startIndex = swingLow.index + 1;

        for (
            let i = startIndex;
            i < candles.length;
            i++
        ) {
            const candle = candles[i];

            if (candle.close < level) {
                structureEvents.push({
                    event: "BEARISH_BREAK",
                    direction: "BEARISH",
                    level,
                    brokenIndex: i,
                    swingIndex: swingLow.index
                });

                break;
            }
        }
    }

    // --------------------------------------------------
    // 4. SORT EVENTS CHRONOLOGICALLY
    // --------------------------------------------------

    structureEvents.sort(
        (a, b) =>
            a.brokenIndex -
            b.brokenIndex
    );

    // --------------------------------------------------
    // 5. CLASSIFY BOS / CHOCH
    // --------------------------------------------------

    let previousDirection = null;
    let latestStructureEvent = null;

    for (const event of structureEvents) {

        let classifiedEvent = "BOS";

        if (
            previousDirection &&
            previousDirection !== event.direction
        ) {
            classifiedEvent = "CHOCH";
        }

        latestStructureEvent = {
            ...event,
            classifiedEvent
        };

        previousDirection =
            event.direction;
    }

    // --------------------------------------------------
    // 6. RETURN LATEST HISTORICAL EVENT
    // --------------------------------------------------

    if (latestStructureEvent) {

        const isBullish =
            latestStructureEvent.direction ===
            "BULLISH";

        const isBearish =
            latestStructureEvent.direction ===
            "BEARISH";

        return {
            structure:
                latestStructureEvent.direction,

            event:
                latestStructureEvent.classifiedEvent,

            direction:
                latestStructureEvent.direction,

            brokenLevel:
                latestStructureEvent.level,

            brokenIndex:
                latestStructureEvent.brokenIndex,

            bos:
                latestStructureEvent.classifiedEvent ===
                "BOS",

            choch:
                latestStructureEvent.classifiedEvent ===
                "CHOCH",

            swingHighs,
            swingLows,

            lastStructureEvent: {
                direction:
                    latestStructureEvent.direction,

                event:
                    latestStructureEvent.classifiedEvent,

                level:
                    latestStructureEvent.level,

                brokenIndex:
                    latestStructureEvent.brokenIndex
            }
        };
    }

    // --------------------------------------------------
    // 7. NO STRUCTURE BREAK
    // --------------------------------------------------

    return {
        structure,

        event: "NONE",

        direction:
            structure === "BULLISH"
                ? "BULLISH"
                : structure === "BEARISH"
                    ? "BEARISH"
                    : null,

        brokenLevel: null,

        brokenIndex: null,

        bos: false,

        choch: false,

        swingHighs,

        swingLows,

        lastStructureEvent: null
    };
}