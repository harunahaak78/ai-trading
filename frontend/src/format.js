/*
 * Small formatting helpers. Pure functions, no DOM.
 */

const ESCAPES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
};

export function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ESCAPES[ch]);
}

export function capitalize(text) {
    const value = String(text ?? "");
    return value.charAt(0).toUpperCase() + value.slice(1);
}

// "WAITING_FOR_RETEST" -> "Waiting for retest"
const ACRONYMS = new Set(["bos", "choch", "fvg", "ob"]);

// "SELL_SIDE_SWEEP_BULLISH_BOS" -> "Sell side sweep bullish BOS"
export function humanize(code) {
    if (!code) return "None";

    const words = String(code)
        .toLowerCase()
        .split("_")
        .map(word => (ACRONYMS.has(word) ? word.toUpperCase() : word));

    return capitalize(words.join(" "));
}

// "BULLISH" -> "bullish"; anything unknown -> "neutral"
export function directionWord(direction) {
    const value = String(direction ?? "").toUpperCase();
    if (value === "BULLISH") return "bullish";
    if (value === "BEARISH") return "bearish";
    return "neutral";
}

export function directionTone(direction) {
    const word = directionWord(direction);
    if (word === "bullish") return "buy";
    if (word === "bearish") return "sell";
    return "wait";
}

export function directionGlyph(direction) {
    const word = directionWord(direction);
    if (word === "bullish") return "▲";
    if (word === "bearish") return "▼";
    return "–";
}

// Forex prices are quoted to a fifth decimal (a pipette), so the page
// needs to know which market it is showing.
let priceMarket = "crypto";

export function setPriceMarket(market) {
    priceMarket = market === "forex" ? "forex" : "crypto";
}

export function formatPrice(value) {
    if (value == null || Number.isNaN(Number(value))) return "–";

    const n = Number(value);
    const abs = Math.abs(n);

    let digits = 2;

    if (priceMarket === "forex") {
        // EUR/USD 1.08234    USD/JPY 149.623
        if (abs < 10) digits = 5;
        else if (abs < 1000) digits = 3;
    } else {
        if (abs < 1) digits = 5;
        else if (abs < 10) digits = 4;
        else if (abs < 1000) digits = 3;
    }

    return n.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
    });
}

export function formatPercent(value, digits = 2) {
    if (value == null || Number.isNaN(Number(value))) return "–";
    const n = Number(value);
    return `${n > 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

const DATE_TIME = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
});

const DATE_ONLY = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric"
});

const TIME_ONLY = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
});

export function formatDateTime(ms) {
    return DATE_TIME.format(new Date(ms));
}

// Axis labels depend on how long one candle lasts.
export function formatAxisTime(ms, timeframe) {
    const date = new Date(ms);

    if (timeframe === "4H") return DATE_ONLY.format(date);
    if (timeframe === "1H") return DATE_TIME.format(date);
    return TIME_ONLY.format(date);
}

export function formatClock(ms) {
    return new Date(ms).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
    });
}

export function formatVolume(value) {
    if (value == null || Number.isNaN(Number(value))) return "–";
    return Number(value).toLocaleString("en-US", { maximumFractionDigits: 1 });
}
