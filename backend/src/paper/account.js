/*
 * PAPER TRADING ACCOUNT (simulation only)
 *
 * No real orders are ever sent. This keeps a demo balance, opens a
 * simulated trade when the analysis says BUY or SELL, follows it
 * candle by candle, and writes every step to a journal.
 *
 * Rules:
 *  - Risk per trade is a fixed share of the current balance.
 *  - No leverage: a trade can never be bigger than the free cash.
 *  - Half the position closes at target 1 (2R) and the stop moves to
 *    the entry. The rest closes at target 2 (3R) or at the entry.
 *  - If one candle touches both the stop and a target, the stop is
 *    assumed to have been hit first (the cautious choice).
 *  - A fee is charged on the value of every entry and exit.
 *    Spread and slippage are not modelled.
 */

export const DEFAULTS = {
    startingBalance: 1000,
    riskPct: 0.01,
    maxOpenTrades: 3,
    feePct: { crypto: 0.001, forex: 0 }
};

export function createAccount(settings = {}) {
    const s = { ...DEFAULTS, ...settings };

    return {
        settings: {
            startingBalance: s.startingBalance,
            riskPct: s.riskPct,
            maxOpenTrades: s.maxOpenTrades,
            feePct: { ...DEFAULTS.feePct, ...(settings.feePct || {}) }
        },
        balance: s.startingBalance,
        createdAt: Date.now(),
        nextId: 1,
        trades: [],
        // Entries already taken, so a signal that stays on does not repeat.
        taken: {}
    };
}

const round = (n, d = 6) => Number(Number(n).toFixed(d));
const sign = direction => (direction === "BUY" ? 1 : -1);

export function openTrades(account, symbol = null) {
    return account.trades.filter(
        t => t.status === "OPEN" && (symbol === null || t.symbol === symbol)
    );
}

function reservedCash(account) {
    return openTrades(account).reduce(
        (sum, t) => sum + t.remainingQty * t.entry,
        0
    );
}

/*
 * Opens a trade from a ready signal. Returns { trade } or { skipped }.
 */
export function openTrade(account, signal, now = Date.now()) {
    const { market, symbol, direction, entry, stop, tp1, tp2 } = signal;

    if (direction !== "BUY" && direction !== "SELL") {
        return { skipped: "No BUY or SELL signal" };
    }

    if (![entry, stop, tp1, tp2].every(Number.isFinite)) {
        return { skipped: "Signal is missing entry, stop or targets" };
    }

    const risk = Math.abs(entry - stop);

    if (!(risk > 0)) return { skipped: "Stop equals entry" };

    if (openTrades(account, symbol).length > 0) {
        return { skipped: "A trade is already open on this pair" };
    }

    if (openTrades(account).length >= account.settings.maxOpenTrades) {
        return { skipped: "Maximum open trades reached" };
    }

    const key = signal.entryKey || null;

    if (key && account.taken[`${symbol}|${key}`]) {
        return { skipped: "This setup was already traded" };
    }

    const riskAmount = account.balance * account.settings.riskPct;
    const free = account.balance - reservedCash(account);

    let qty = riskAmount / risk;
    let cappedByCash = false;

    if (qty * entry > free) {
        qty = free / entry;
        cappedByCash = true;
    }

    if (!(qty > 0) || qty * entry < 10) {
        return { skipped: "Not enough free cash" };
    }

    const feePct = account.settings.feePct[market] ?? 0;
    const entryFee = qty * entry * feePct;

    const trade = {
        id: account.nextId++,
        status: "OPEN",
        market,
        symbol,
        direction,
        entryType: signal.entryType || null,
        openedAt: now,
        entry: round(entry),
        stop: round(stop),
        initialStop: round(stop),
        tp1: round(tp1),
        tp2: round(tp2),
        qty: round(qty, 8),
        remainingQty: round(qty, 8),
        notional: round(qty * entry, 2),
        riskAmount: round(Math.abs(entry - stop) * qty, 2),
        cappedByCash,
        fees: round(entryFee, 4),
        realizedPnl: 0,
        tp1Hit: false,
        exits: [],
        // Why the system took it, as it stood at the entry.
        why: {
            state: signal.state || null,
            confidence: signal.confidence ?? null,
            reasons: signal.reasons || [],
            bias: signal.bias || null
        },
        closedAt: null,
        closeReason: null,
        pnl: null,
        rMultiple: null
    };

    account.trades.push(trade);

    if (key) account.taken[`${symbol}|${key}`] = now;

    account.balance = round(account.balance - entryFee, 4);

    return { trade };
}

function closePart(account, trade, qty, price, reason, time, feePct) {
    const gross = sign(trade.direction) * (price - trade.entry) * qty;
    const fee = qty * price * feePct;

    trade.exits.push({
        time,
        price: round(price),
        qty: round(qty, 8),
        reason,
        pnl: round(gross - fee, 4)
    });

    trade.remainingQty = round(trade.remainingQty - qty, 8);
    trade.realizedPnl = round(trade.realizedPnl + gross, 4);
    trade.fees = round(trade.fees + fee, 4);

    account.balance = round(account.balance + gross - fee, 4);
}

function finish(trade, reason, time) {
    trade.status = "CLOSED";
    trade.closedAt = time;
    trade.closeReason = reason;
    trade.remainingQty = 0;
    trade.pnl = round(trade.realizedPnl - trade.fees, 2);
    trade.rMultiple =
        trade.riskAmount > 0 ? round(trade.pnl / trade.riskAmount, 2) : null;
}

/*
 * Moves the open trades of one pair along using candles (oldest first).
 * The candle that contains the entry only counts by its close, because
 * its high and low may have happened before the entry.
 */
export function updateTrades(account, symbol, candles, intervalMs, now = Date.now()) {
    const changed = [];

    for (const trade of openTrades(account, symbol)) {
        const feePct = account.settings.feePct[trade.market] ?? 0;
        const dir = sign(trade.direction);

        for (const candle of candles) {
            if (trade.status !== "OPEN") break;

            const end = candle.time + intervalMs;

            if (end <= trade.openedAt) continue;

            const containsEntry = candle.time <= trade.openedAt;

            const high = containsEntry ? candle.close : candle.high;
            const low = containsEntry ? candle.close : candle.low;

            const stopHit = dir === 1 ? low <= trade.stop : high >= trade.stop;
            const tp1Reached = dir === 1 ? high >= trade.tp1 : low <= trade.tp1;
            const tp2Reached = dir === 1 ? high >= trade.tp2 : low <= trade.tp2;

            const time = Math.min(end, now);

            if (stopHit) {
                const reason =
                    trade.tp1Hit && trade.stop === trade.entry
                        ? "BREAKEVEN_STOP"
                        : "STOP_LOSS";

                closePart(account, trade, trade.remainingQty, trade.stop, reason, time, feePct);
                finish(trade, reason, time);
                changed.push(trade);
                break;
            }

            if (!trade.tp1Hit && tp1Reached) {
                const half = round(trade.qty / 2, 8);

                closePart(account, trade, half, trade.tp1, "TAKE_PROFIT_1", time, feePct);
                trade.tp1Hit = true;
                trade.stop = trade.entry;
                changed.push(trade);
            }

            if (trade.tp1Hit && tp2Reached) {
                closePart(account, trade, trade.remainingQty, trade.tp2, "TAKE_PROFIT_2", time, feePct);
                finish(trade, "TAKE_PROFIT_2", time);
                changed.push(trade);
                break;
            }
        }
    }

    return changed;
}

/*
 * Open profit or loss at a given price, before the exit fee.
 */
export function floatingPnl(trade, price) {
    if (trade.status !== "OPEN" || !Number.isFinite(price)) return 0;

    return round(
        sign(trade.direction) * (price - trade.entry) * trade.remainingQty,
        2
    );
}

export function summarize(account, prices = {}) {
    const closed = account.trades.filter(t => t.status === "CLOSED");
    const open = openTrades(account);

    const wins = closed.filter(t => t.pnl > 0);
    const losses = closed.filter(t => t.pnl < 0);

    const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

    const floating = open.reduce(
        (s, t) => s + floatingPnl(t, prices[t.symbol]),
        0
    );

    // Realized balance after each closed trade, for the equity curve.
    let running = account.settings.startingBalance;
    let peak = running;
    let maxDrawdown = 0;

    const curve = [{ time: account.createdAt, balance: running }];

    for (const t of [...closed].sort((a, b) => a.closedAt - b.closedAt)) {
        running = round(running + t.pnl, 2);
        peak = Math.max(peak, running);
        maxDrawdown = Math.max(maxDrawdown, peak - running);
        curve.push({ time: t.closedAt, balance: running });
    }

    const rs = closed.map(t => t.rMultiple).filter(Number.isFinite);

    return {
        startingBalance: account.settings.startingBalance,
        balance: round(account.balance, 2),
        floatingPnl: round(floating, 2),
        equity: round(account.balance + floating, 2),
        returnPct: round(
            ((account.balance - account.settings.startingBalance) /
                account.settings.startingBalance) * 100,
            2
        ),
        openTrades: open.length,
        closedTrades: closed.length,
        wins: wins.length,
        losses: losses.length,
        breakeven: closed.length - wins.length - losses.length,
        winRate: closed.length ? round((wins.length / closed.length) * 100, 1) : null,
        profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : null,
        totalR: round(rs.reduce((s, r) => s + r, 0), 2),
        averageR: rs.length ? round(rs.reduce((s, r) => s + r, 0) / rs.length, 2) : null,
        bestTrade: closed.length ? Math.max(...closed.map(t => t.pnl)) : null,
        worstTrade: closed.length ? Math.min(...closed.map(t => t.pnl)) : null,
        maxDrawdown: round(maxDrawdown, 2),
        curve
    };
}
