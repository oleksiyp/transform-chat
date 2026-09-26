export const meta = { description: 'Market data (Binance public API: REST + WebSocket), technical indicators, and market_* tools. Provides "market".' };

const REST = ['https://data-api.binance.vision/api/v3', 'https://api.binance.com/api/v3'];
const WS = ['wss://data-stream.binance.vision/stream', 'wss://stream.binance.com:9443/stream'];
export const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];

// ---------- indicators (arrays aligned with input, null during warm-up) ----------
function sma(v, n) {
  const out = new Array(v.length).fill(null); let s = 0;
  for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= n) s -= v[i - n]; if (i >= n - 1) out[i] = s / n; }
  return out;
}
function ema(v, n) {
  const out = new Array(v.length).fill(null); const k = 2 / (n + 1); let e = null;
  for (let i = 0; i < v.length; i++) {
    if (i < n - 1) continue;
    e = e == null ? v.slice(0, n).reduce((a, b) => a + b, 0) / n : v[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}
function rsi(c, n = 14) {
  const out = new Array(c.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) {
    const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; out[i] = 100 - 100 / (1 + g / (l || 1e-12)); } }
    else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = 100 - 100 / (1 + g / (l || 1e-12)); }
  }
  return out;
}
function atr(k, n = 14) {
  const tr = k.map((b, i) => i ? Math.max(b.high - b.low, Math.abs(b.high - k[i - 1].close), Math.abs(b.low - k[i - 1].close)) : b.high - b.low);
  const out = new Array(k.length).fill(null); let a = null;
  for (let i = 0; i < k.length; i++) {
    if (i < n - 1) continue;
    a = a == null ? tr.slice(0, n).reduce((x, y) => x + y, 0) / n : (a * (n - 1) + tr[i]) / n;
    out[i] = a;
  }
  return out;
}
function bollinger(c, n = 20, m = 2) {
  const mid = sma(c, n);
  const upper = [], lower = [];
  for (let i = 0; i < c.length; i++) {
    if (mid[i] == null) { upper.push(null); lower.push(null); continue; }
    let s = 0; for (let j = i - n + 1; j <= i; j++) s += (c[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / n); upper.push(mid[i] + m * sd); lower.push(mid[i] - m * sd);
  }
  return { mid, upper, lower };
}
function macd(c, f = 12, s = 26, sig = 9) {
  const ef = ema(c, f), es = ema(c, s);
  const line = c.map((_, i) => ef[i] != null && es[i] != null ? ef[i] - es[i] : null);
  const start = line.findIndex(x => x != null);
  const sigArr = new Array(c.length).fill(null);
  if (start >= 0) ema(line.slice(start), sig).forEach((x, i) => { sigArr[start + i] = x; });
  return { line, signal: sigArr, hist: line.map((x, i) => x != null && sigArr[i] != null ? x - sigArr[i] : null) };
}
// Swing points: local extremes over a +/- w bar window.
function swings(k, w = 5) {
  const highs = [], lows = [];
  for (let i = w; i < k.length - w; i++) {
    const win = k.slice(i - w, i + w + 1);
    if (k[i].high === Math.max(...win.map(b => b.high))) highs.push({ time: k[i].time, price: k[i].high });
    if (k[i].low === Math.min(...win.map(b => b.low))) lows.push({ time: k[i].time, price: k[i].low });
  }
  return { highs, lows };
}
const indicators = { sma, ema, rsi, atr, bollinger, macd, swings };

// Adaptive rounding for prices.
export function round(p) {
  if (p == null || !isFinite(p)) return p;
  const a = Math.abs(p);
  const d = a >= 1000 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 6 : 8;
  return +p.toFixed(d);
}

export default function setup(ctx) {
  const sockets = new Set();

  async function rest(path, params = {}) {
    const qs = new URLSearchParams(params).toString();
    let lastErr;
    for (const base of REST) {
      try {
        const r = await fetch(`${base}${path}${qs ? '?' + qs : ''}`);
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.msg || `HTTP ${r.status}`);
        return body;
      } catch (e) { lastErr = e; if (/Invalid symbol|Invalid interval/i.test(e.message)) break; }
    }
    throw lastErr;
  }

  const norm = s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const mapTicker = t => ({
    symbol: t.symbol, price: +t.lastPrice, change: +t.priceChange, changePct: +t.priceChangePercent,
    high: +t.highPrice, low: +t.lowPrice, open: +t.openPrice, volume: +t.volume, quoteVolume: +t.quoteVolume, trades: t.count,
  });

  async function quote(symbols) {
    const list = [].concat(symbols).map(norm);
    const data = list.length === 1
      ? [await rest('/ticker/24hr', { symbol: list[0] })]
      : await rest('/ticker/24hr', { symbols: JSON.stringify(list) });
    return data.map(mapTicker);
  }

  async function candles(symbol, interval = '1h', limit = 500) {
    const rows = await rest('/klines', { symbol: norm(symbol), interval, limit: Math.min(1000, limit) });
    return rows.map(r => ({ time: Math.floor(r[0] / 1000), open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] }));
  }

  async function top({ quoteAsset = 'USDT', sort = 'volume', limit = 15 } = {}) {
    const all = (await rest('/ticker/24hr')).map(mapTicker)
      .filter(t => t.symbol.endsWith(quoteAsset) && t.quoteVolume > 1e6 && !/(UP|DOWN|BULL|BEAR)USDT$/.test(t.symbol));
    const key = { volume: t => -t.quoteVolume, gainers: t => -t.changePct, losers: t => t.changePct }[sort] || (t => -t.quoteVolume);
    return all.sort((a, b) => key(a) - key(b)).slice(0, limit);
  }

  // Combined stream subscription with auto-reconnect. Returns unsubscribe().
  function subscribe(streams, onMessage) {
    let ws, closed = false, attempt = 0, timer;
    const open = () => {
      ws = new WebSocket(`${WS[attempt % WS.length]}?streams=${streams.map(s => s.toLowerCase()).join('/')}`);
      ws.onmessage = e => { try { const m = JSON.parse(e.data); onMessage(m.data, m.stream); } catch {} };
      ws.onopen = () => { attempt = 0; };
      ws.onclose = () => { if (!closed) { attempt++; timer = setTimeout(open, Math.min(10000, 1000 * attempt)); } };
    };
    open();
    const handle = { close() { closed = true; clearTimeout(timer); ws?.close(); sockets.delete(handle); } };
    sockets.add(handle);
    return () => handle.close();
  }

  function analyze(k) {
    const c = k.map(b => b.close), last = k.at(-1), n = k.length - 1;
    const s20 = sma(c, 20), s50 = sma(c, 50), s200 = sma(c, 200), e21 = ema(c, 21);
    const r = rsi(c), a = atr(k), bb = bollinger(c), m = macd(c);
    const rets = c.slice(1).map((x, i) => Math.log(x / c[i]));
    const mean = rets.reduce((x, y) => x + y, 0) / rets.length;
    const sd = Math.sqrt(rets.reduce((x, y) => x + (y - mean) ** 2, 0) / rets.length);
    const sw = swings(k);
    const hi = Math.max(...k.map(b => b.high)), lo = Math.min(...k.map(b => b.low));
    const pct = (x, y) => y ? +((x / y - 1) * 100).toFixed(2) : null;
    const avgVol20 = k.slice(-21, -1).reduce((x, b) => x + b.volume, 0) / 20;
    return {
      last: { time: new Date(last.time * 1000).toISOString(), open: round(last.open), high: round(last.high), low: round(last.low), close: round(last.close), volume: +last.volume.toFixed(2) },
      range: { bars: k.length, from: new Date(k[0].time * 1000).toISOString(), high: round(hi), low: round(lo), changePct: pct(last.close, k[0].close) },
      trend: {
        sma20: round(s20[n]), sma50: round(s50[n]), sma200: round(s200[n]), ema21: round(e21[n]),
        priceVsSma50Pct: pct(last.close, s50[n]), priceVsSma200Pct: pct(last.close, s200[n]),
        sma20Slope5Pct: s20[n - 5] ? pct(s20[n], s20[n - 5]) : null,
      },
      momentum: {
        rsi14: r[n] != null ? +r[n].toFixed(1) : null,
        macd: m.line[n] != null ? { line: round(m.line[n]), signal: round(m.signal[n]), hist: round(m.hist[n]), histPrev: round(m.hist[n - 1]) } : null,
      },
      volatility: {
        atr14: round(a[n]), atrPct: a[n] ? +((a[n] / last.close) * 100).toFixed(2) : null,
        bbUpper: round(bb.upper[n]), bbLower: round(bb.lower[n]),
        bbWidthPct: bb.mid[n] ? +(((bb.upper[n] - bb.lower[n]) / bb.mid[n]) * 100).toFixed(2) : null,
        stdevLogRetPct: +(sd * 100).toFixed(3),
      },
      volume: { last: +last.volume.toFixed(2), avg20: +avgVol20.toFixed(2), ratio: avgVol20 ? +(last.volume / avgVol20).toFixed(2) : null },
      swingHighs: sw.highs.slice(-6).map(p => round(p.price)),
      swingLows: sw.lows.slice(-6).map(p => round(p.price)),
      recent: k.slice(-12).map(b => [new Date(b.time * 1000).toISOString().slice(0, 16), round(b.open), round(b.high), round(b.low), round(b.close), +b.volume.toFixed(1)]),
    };
  }

  ctx.provide('market', { rest, quote, candles, top, subscribe, analyze, indicators, round, norm, INTERVALS });
  ctx.onDispose(() => [...sockets].forEach(s => s.close()));
  setTimeout(() => ctx.emit('market:ready', {}));

  ctx.tool({
    name: 'market_quote',
    description: '24h ticker stats (price, change %, high/low, volume) for Binance spot symbols, e.g. ["BTCUSDT","ETHUSDT"].',
    input_schema: { type: 'object', properties: { symbols: { type: 'array', items: { type: 'string' } } }, required: ['symbols'] },
    run: async ({ symbols }) => (await quote(symbols)).map(t => ({ ...t, price: round(t.price), high: round(t.high), low: round(t.low) })),
  });

  ctx.tool({
    name: 'market_analyze',
    description: 'Fetch OHLCV candles and compute a technical summary: SMA20/50/200, EMA21, RSI14, MACD, ATR, Bollinger, volatility, volume ratio, recent swing highs/lows, last 12 candles [time,o,h,l,c,v].',
    input_schema: {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
        interval: { type: 'string', enum: INTERVALS },
        limit: { type: 'integer', description: 'bars to load, default 300, max 1000' },
      },
      required: ['symbol', 'interval'],
    },
    run: async ({ symbol, interval, limit = 300 }) => ({ symbol: norm(symbol), interval, ...analyze(await candles(symbol, interval, limit)) }),
  });

  ctx.tool({
    name: 'market_top',
    description: 'Screen Binance spot pairs by 24h quote volume, top gainers or top losers (liquid pairs only).',
    input_schema: {
      type: 'object',
      properties: {
        sort: { type: 'string', enum: ['volume', 'gainers', 'losers'] },
        quoteAsset: { type: 'string', description: 'default USDT' },
        limit: { type: 'integer' },
      },
    },
    run: async input => (await top(input)).map(t => ({ symbol: t.symbol, price: round(t.price), changePct: t.changePct, quoteVolume: Math.round(t.quoteVolume) })),
  });
}
