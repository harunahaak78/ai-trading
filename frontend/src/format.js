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
export function humanize(code) {
    if (!code) return "None";
    return capitalize(String(code).toLowerCase().replace(/_/g, " "));
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

export function formatPrice(value) {
    if (value == null || Number.isNaN(Number(value))) return "–";

    const n = Number(value);
    const abs = Math.abs(n);

    let digits = 2;
    if (abs < 1) digits = 5;
    else if (abs < 10) digits = 4;
    else if (abs < 1000) digits = 3;

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
