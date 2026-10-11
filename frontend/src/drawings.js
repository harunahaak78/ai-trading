/*
 * Lines the user draws on the chart.
 *
 * A drawing is stored by time and price, not by pixel, so it stays on
 * the same candles while the chart moves, zooms or gets new candles,
 * and it appears on every timeframe of the same symbol.
 *
 *   { id, type: "trend", points: [ {time, price}, {time, price} ] }
 *   { id, type: "hline", points: [ {time, price} ] }
 *
 * Saved in this browser only (localStorage), per market and symbol.
 */

const PREFIX = "ait.drawings.";
const MAX_DRAWINGS = 200;

const POINTS = { trend: 2, hline: 1 };

function validPoint(point) {
    return (
        point &&
        Number.isFinite(point.time) &&
        Number.isFinite(point.price)
    );
}

export function isValidDrawing(drawing) {
    return Boolean(
        drawing &&
        typeof drawing.id === "string" &&
        POINTS[drawing.type] &&
        Array.isArray(drawing.points) &&
        drawing.points.length === POINTS[drawing.type] &&
        drawing.points.every(validPoint)
    );
}

export function drawingsKey(market, symbol) {
    return `${market}:${symbol}`;
}

export function newDrawingId() {
    return Math.random().toString(36).slice(2, 10);
}

export function loadDrawings(key) {
    try {
        const raw = localStorage.getItem(PREFIX + key);
        const list = JSON.parse(raw || "[]");

        return Array.isArray(list)
            ? list.filter(isValidDrawing).slice(0, MAX_DRAWINGS)
            : [];
    } catch {
        return [];
    }
}

export function saveDrawings(key, list) {
    try {
        localStorage.setItem(
            PREFIX + key,
            JSON.stringify(list.slice(0, MAX_DRAWINGS))
        );
    } catch {
        // Storage can be blocked. Lines then last until the page closes.
    }
}
