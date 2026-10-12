/*
 * Paper trading panel: a simulated $1,000 account that runs on the
 * backend and journals every trade. Nothing here sends real orders.
 */

import {
    loadPaper,
    loadJournal,
    setPaperRunning,
    watchPair,
    unwatchPair,
    resetPaper
} from "./api.js";

import { esc, formatPrice, formatDateTime, humanize } from "./format.js";

const REFRESH_MS = 5000;

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const money = n => (n == null ? "—" : usd.format(n));
const signed = n =>
    n == null ? "—" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${usd.format(Math.abs(n))}`;
const tone = n => (n > 0 ? "up" : n < 0 ? "down" : "flat");

const RESULT = {
    OPEN: "Open",
    STOP_LOSS: "Stop loss",
    BREAKEVEN_STOP: "Breakeven after target 1",
    TAKE_PROFIT_1: "Target 1",
    TAKE_PROFIT_2: "Target 2"
};

const ENTRY_TYPE = { FIRST_TEST: "First test", RETEST: "Retest" };

const SIGNAL_TEXT = {
    BUY: "Buy ready",
    SELL: "Sell ready"
};

function price(trade, value) {
    // formatPrice follows the market of the chart on screen, so use
    // plain precision here, which works for every pair in the journal.
    if (value == null) return "—";
    const digits = trade.market === "forex" ? 5 : value >= 100 ? 2 : 4;
    return Number(value).toFixed(digits);
}

function tiles(s) {
    const t = (label, value, extra = "") =>
        `<div class="paper-tile"><dt>${label}</dt><dd class="${extra}">${value}</dd></div>`;

    return (
        `<dl class="paper-tiles">` +
        t("Balance", money(s.balance)) +
        t("Equity", money(s.equity)) +
        t("Return", `${s.returnPct > 0 ? "+" : ""}${s.returnPct}%`, tone(s.returnPct)) +
        t("Open P/L", signed(s.floatingPnl), tone(s.floatingPnl)) +
        t("Win rate", s.winRate == null ? "—" : `${s.winRate}%`) +
        t("Trades", `${s.closedTrades} closed, ${s.openTrades} open`) +
        t("Total R", s.closedTrades ? `${s.totalR > 0 ? "+" : ""}${s.totalR}R` : "—", tone(s.totalR)) +
        t("Max drawdown", money(s.maxDrawdown)) +
        `</dl>`
    );
}

function watching(data, current) {
    const chips = data.watchlist.map(w => {
        const note = w.error
            ? "problem"
            : w.stale
                ? "delayed data"
                : SIGNAL_TEXT[w.signal] || (w.status ? humanize(w.status) : "starting");

        return (
            `<span class="paper-chip">` +
            `<strong>${esc(w.symbol)}</strong> ` +
            `<span class="muted">${esc(note)}</span>` +
            `<button type="button" class="chip-x" data-paper="unwatch" ` +
            `data-market="${esc(w.market)}" data-symbol="${esc(w.symbol)}" ` +
            `aria-label="Stop watching ${esc(w.symbol)}">×</button>` +
            `</span>`
        );
    }).join("");

    const watched = current &&
        data.watchlist.some(w => w.market === current.market && w.symbol === current.symbol);

    const add = current && !watched
        ? `<button type="button" class="link-btn" data-paper="watch">Trade ${esc(current.symbol)} too</button>`
        : "";

    return (
        `<div class="paper-watch"><span class="label">Watching</span> ` +
        (chips || `<span class="muted">No pairs yet.</span>`) +
        add +
        `</div>`
    );
}

function openTable(trades) {
    if (!trades.length) {
        return `<p class="empty">No open trades. One opens when the analysis says Buy or Sell.</p>`;
    }

    const rows = trades.map(t => (
        `<tr>` +
        `<th scope="row">${esc(t.symbol)}</th>` +
        `<td class="${t.direction === "BUY" ? "up" : "down"}">${esc(t.direction)}</td>` +
        `<td>${esc(ENTRY_TYPE[t.entryType] || "—")}</td>` +
        `<td>${price(t, t.entry)}</td>` +
        `<td>${price(t, t.lastPrice)}</td>` +
        `<td>${price(t, t.stop)}${t.tp1Hit ? ` <span class="muted">(at entry)</span>` : ""}</td>` +
        `<td>${price(t, t.tp1)}${t.tp1Hit ? ` <span class="muted">done</span>` : ""}</td>` +
        `<td>${price(t, t.tp2)}</td>` +
        `<td class="${tone(t.floatingPnl + t.realizedPnl)}">${signed(t.floatingPnl)}</td>` +
        `</tr>`
    )).join("");

    return (
        `<div class="table-scroll"><table class="matrix paper-table">` +
        `<thead><tr><th>Pair</th><th>Side</th><th>Entry type</th><th>Entry</th><th>Now</th>` +
        `<th>Stop</th><th>Target 1</th><th>Target 2</th><th>Open P/L</th></tr></thead>` +
        `<tbody>${rows}</tbody></table></div>`
    );
}

function why(t) {
    const reasons = (t.why?.reasons || []).map(r => `<li>${esc(r)}</li>`).join("");
    const bias = t.why?.bias
        ? Object.entries(t.why.bias)
            .map(([tf, d]) => `${tf} ${esc(String(d || "neutral").toLowerCase())}`)
            .join(", ")
        : "";

    const exits = t.exits.map(e =>
        `<li>${esc(formatDateTime(e.time))}: ${esc(RESULT[e.reason] || e.reason)} at ${price(t, e.price)} (${signed(e.pnl)})</li>`
    ).join("");

    return (
        `<details class="paper-why" data-id="${t.id}">` +
        `<summary>Why</summary>` +
        (bias ? `<p class="fine">Direction at entry: ${bias}.</p>` : "") +
        (reasons ? `<ul class="fine">${reasons}</ul>` : "") +
        `<p class="fine">Stop ${price(t, t.initialStop)}, targets ${price(t, t.tp1)} and ${price(t, t.tp2)}. ` +
        `Size ${t.qty} (${money(t.notional)}), risk ${money(t.riskAmount)}, fees ${money(t.fees)}.</p>` +
        (exits ? `<p class="fine">Exits:</p><ul class="fine">${exits}</ul>` : "") +
        `</details>`
    );
}

function journalTable(trades) {
    if (!trades.length) {
        return `<p class="empty">The journal is empty. Every trade will be listed here with the reason it was taken.</p>`;
    }

    const rows = trades.map(t => {
        const result = t.status === "OPEN" ? "Open" : RESULT[t.closeReason] || humanize(t.closeReason);
        const pl = t.status === "OPEN" ? null : t.pnl;

        return (
            `<tr>` +
            `<td>#${t.id}</td>` +
            `<td>${esc(formatDateTime(t.openedAt))}</td>` +
            `<th scope="row">${esc(t.symbol)}</th>` +
            `<td class="${t.direction === "BUY" ? "up" : "down"}">${esc(t.direction)}</td>` +
            `<td>${t.entryType === "RETEST" ? `<span class="tag tag-retest">Retest</span>` : esc(ENTRY_TYPE[t.entryType] || "—")}</td>` +
            `<td>${price(t, t.entry)}</td>` +
            `<td>${esc(result)}</td>` +
            `<td class="${tone(pl)}">${signed(pl)}</td>` +
            `<td class="${tone(t.rMultiple)}">${t.rMultiple == null ? "—" : `${t.rMultiple > 0 ? "+" : ""}${t.rMultiple}R`}</td>` +
            `<td>${why(t)}</td>` +
            `</tr>`
        );
    }).join("");

    return (
        `<div class="table-scroll"><table class="matrix paper-table">` +
        `<thead><tr><th>#</th><th>Opened</th><th>Pair</th><th>Side</th><th>Entry type</th>` +
        `<th>Entry</th><th>Result</th><th>P/L</th><th>R</th><th></th></tr></thead>` +
        `<tbody>${rows}</tbody></table></div>`
    );
}

function activity(log) {
    if (!log.length) return "";

    return (
        `<h3 class="label">Activity</h3>` +
        `<ul class="paper-log">` +
        log.slice(0, 12).map(l =>
            `<li><span class="muted">${esc(formatDateTime(l.time))}</span> ` +
            `<strong>${esc(l.symbol)}</strong> ${esc(l.text)}</li>`
        ).join("") +
        `</ul>`
    );
}

function view(data, trades, current, error) {
    const paused = !data.running;

    return (
        `<div class="paper-head">` +
        `<div>` +
        `<h2 class="paper-title" id="paper-h">Paper trading</h2>` +
        `<p class="fine"><strong>Demo only.</strong> A simulated ` +
        `${money(data.settings.startingBalance)} account. No real orders or money. ` +
        `Risk is ${+(data.settings.riskPct * 100).toFixed(2)}% of the balance per trade.</p>` +
        `</div>` +
        `<div class="paper-actions">` +
        `<button type="button" class="btn ${paused ? "" : "btn-quiet"}" data-paper="toggle">` +
        `${paused ? "Resume entries" : "Pause entries"}</button>` +
        `<button type="button" class="btn btn-quiet" data-paper="reset">Reset account</button>` +
        `</div>` +
        `</div>` +
        (paused
            ? `<p class="notice">New entries are paused. Open trades are still followed to their stop or target.</p>`
            : "") +
        (error
            ? `<p class="notice error" role="alert">${esc(error)}</p>`
            : "") +
        tiles(data.summary) +
        watching(data, current) +
        `<h3 class="label">Open trades</h3>` +
        openTable(data.open) +
        `<h3 class="label">Journal</h3>` +
        journalTable(trades) +
        activity(data.log)
    );
}

export function createPaperPanel(host, { getCurrent }) {
    let timer = null;
    let data = null;
    let trades = [];
    let error = null;
    let lastHtml = "";
    let busy = false;

    function render() {
        let html;

        if (!data) {
            html = error
                ? `<p class="notice error" role="alert">${esc(error)}</p>`
                : `<p class="notice" role="status">Loading the paper account…</p>`;
        } else {
            html = view(data, trades, getCurrent?.(), error);
        }

        if (html === lastHtml) return;

        // Keep opened "Why" rows open across refreshes.
        const open = new Set(
            [...host.querySelectorAll("details[open]")].map(d => d.dataset.id)
        );

        lastHtml = html;
        host.innerHTML = html;

        for (const d of host.querySelectorAll("details[data-id]")) {
            if (open.has(d.dataset.id)) d.open = true;
        }
    }

    async function refresh() {
        if (busy) return;
        busy = true;

        try {
            const [overview, journal] = await Promise.all([loadPaper(), loadJournal(100)]);
            data = overview;
            trades = journal.trades;
            error = null;
        } catch (e) {
            error = data
                ? `Could not refresh the paper account: ${e.message}`
                : `The paper account is not available: ${e.message}`;
        } finally {
            busy = false;
        }

        render();
    }

    function loop() {
        clearTimeout(timer);
        timer = setTimeout(async () => {
            if (!document.hidden) await refresh();
            loop();
        }, REFRESH_MS);
    }

    async function act(fn) {
        try {
            await fn();
            error = null;
        } catch (e) {
            error = e.message;
        }
        await refresh();
        render();
    }

    host.addEventListener("click", event => {
        const button = event.target.closest("[data-paper]");
        if (!button || !data) return;

        const current = getCurrent?.();

        switch (button.dataset.paper) {
            case "toggle":
                act(() => setPaperRunning(!data.running));
                break;

            case "watch":
                if (current) act(() => watchPair(current.market, current.symbol));
                break;

            case "unwatch":
                act(() => unwatchPair(button.dataset.market, button.dataset.symbol));
                break;

            case "reset":
                if (window.confirm(
                    "Reset the demo account to $1,000? This deletes the whole journal and cannot be undone."
                )) {
                    act(() => resetPaper(1000));
                }
                break;

            default:
        }
    });

    return {
        start() {
            refresh();
            loop();
        },
        stop() {
            clearTimeout(timer);
        },
        refresh,
        render
    };
}
