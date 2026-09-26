export const meta = { description: 'Trader analytics dashboard: live candlestick chart (SMA/BB/volume) + RSI, watchlist, stats, chart_* tools; chat becomes the AI analyst column.' };

import { createChart, ColorType, CrosshairMode, LineStyle } from 'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.0/+esm';

const DEFAULT_WATCH = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];
const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d', '1w'];
const IND = { sma20: 'SMA20', sma50: 'SMA50', bb: 'BB', vol: 'VOL' };

const prec = p => { const a = Math.abs(p); return a >= 100 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 5 : 8; };
const fmtP = p => p == null || !isFinite(p) ? '—' : p.toLocaleString('en-US', { minimumFractionDigits: prec(p), maximumFractionDigits: prec(p) });
const fmtV = v => v == null ? '—' : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v);
const fmtPct = v => v == null || !isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
const sign = v => v > 0 ? 'td-up' : v < 0 ? 'td-down' : '';

export default async function setup(ctx) {
  const { h } = ctx.use('ui');
  const mkt = () => ctx.use('market');

  const st = {
    symbol: ctx.store.get('symbol', 'BTCUSDT'),
    interval: ctx.store.get('interval', '1h'),
    watch: ctx.store.get('watch', DEFAULT_WATCH),
    ind: { sma20: true, sma50: true, bb: false, vol: true, ...ctx.store.get('ind', {}) },
  };
  const persist = () => { ctx.store.set('symbol', st.symbol); ctx.store.set('interval', st.interval); ctx.store.set('watch', st.watch); ctx.store.set('ind', st.ind); };
  let candles = [];
  const ticks = {};
  let levels = [];

  // ---------- layout ----------
  const app = document.getElementById('app');
  app.classList.add('trader');
  ctx.onDispose(() => app.classList.remove('trader'));
  const brand = document.querySelector('[data-slot="header"] .brand');
  const oldBrand = brand?.textContent;
  if (brand) brand.textContent = 'TRADER//ANALYTICS';
  ctx.onDispose(() => { if (brand) brand.textContent = oldBrand; });

  ctx.css(`
    #app.trader {
      grid-template-columns: minmax(0, 1fr) var(--chat-w, 420px) var(--side-w, 320px);
      grid-template-rows: auto minmax(0, 1fr) auto;
      grid-template-areas: "header header header" "dash main side" "dash composer side";
    }
    #app.trader [data-slot="dash"] { grid-area: dash; min-width: 0; min-height: 0; overflow: hidden; padding: 12px; }
    #app.trader [data-slot="main"] { padding: 12px; border-left: 1px solid var(--border); }
    #app.trader [data-slot="composer"] { border-left: 1px solid var(--border); }
    #app.trader .chat-log, #app.trader .composer, #app.trader .chat-status, #app.trader .attach-tray { max-width: none; }
    #app.trader .empty { margin-top: 6vh; }
    .td { height: 100%; display: grid; grid-template-columns: 210px minmax(0, 1fr); gap: 12px; }
    .td-box { background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); }
    .td-watch { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
    .td-watch h4, .td-stat .k { margin: 0; font: 600 11px/1.4 var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); }
    .td-watch h4 { padding: 10px 12px 6px; }
    .td-list { flex: 1; overflow-y: auto; }
    .td-row { display: grid; grid-template-columns: 1fr auto; gap: 0 6px; padding: 6px 12px; cursor: pointer; border-left: 2px solid transparent; position: relative; }
    .td-row:hover { background: rgba(127,127,127,.08); }
    .td-row.on { border-left-color: var(--accent); background: rgba(127,127,127,.1); }
    .td-row .s { font-weight: 700; letter-spacing: .03em; }
    .td-row .p { font-family: var(--mono); font-size: 12px; text-align: right; }
    .td-row .c { grid-column: 2; font-family: var(--mono); font-size: 11px; text-align: right; }
    .td-row .v { font-family: var(--mono); font-size: 11px; color: var(--muted); }
    .td-row .x { position: absolute; right: 2px; top: 2px; display: none; padding: 0 5px; font-size: 11px; line-height: 16px; }
    .td-row:hover .x { display: block; }
    .td-add { display: flex; gap: 6px; padding: 8px; border-top: 1px solid var(--border); }
    .td-add input { flex: 1; min-width: 0; text-transform: uppercase; }
    .td-center { display: flex; flex-direction: column; gap: 10px; min-width: 0; min-height: 0; }
    .td-bar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 8px 12px; }
    .td-sym { font: 900 22px/1 var(--display, var(--font)); letter-spacing: .05em; }
    .td-price { font: 600 20px/1 var(--mono); }
    .td-chg { font: 500 13px/1 var(--mono); }
    .td-live { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
    .td-live.on { background: var(--ok); box-shadow: 0 0 8px var(--ok); }
    .td-grp { display: flex; gap: 4px; margin-left: auto; flex-wrap: wrap; }
    .td-grp + .td-grp { margin-left: 0; }
    .td-grp button { padding: 4px 8px; font-size: 11.5px; }
    .td-grp button.on { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
    .td-charts { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 6px 4px 4px; }
    .td-chart { flex: 1; min-height: 180px; }
    .td-rsi { height: 110px; border-top: 1px solid var(--border); }
    .td-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; }
    .td-stat { padding: 8px 10px; }
    .td-stat .v { font: 600 15px/1.3 var(--mono); }
    .td-up { color: var(--ok); } .td-down { color: var(--danger); }
    .td-flash-up { animation: tdUp .8s; } .td-flash-down { animation: tdDown .8s; }
    @keyframes tdUp { from { background: rgba(61,255,168,.25); } } @keyframes tdDown { from { background: rgba(255,59,78,.25); } }
    .td-err { color: var(--danger); font-family: var(--mono); font-size: 12px; }
    @media (max-width: 1100px) {
      #app.trader { height: auto; min-height: 100vh; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto 80vh minmax(50vh, auto) auto;
        grid-template-areas: "header" "dash" "main" "composer"; }
      #app.trader [data-slot="main"], #app.trader [data-slot="composer"] { border-left: 0; }
      .td { grid-template-columns: 1fr; grid-template-rows: 120px 1fr; }
    }
  `);

  // ---------- DOM ----------
  const list = h('div', { class: 'td-list' });
  const addInput = h('input', { placeholder: 'Add symbol…' });
  const addBtn = h('button', { onclick: () => addSymbols([addInput.value]).then(() => { addInput.value = ''; }) }, '+');
  addInput.addEventListener('keydown', e => { if (e.key === 'Enter') addBtn.click(); });
  const watchBox = h('div', { class: 'td-box td-watch' }, h('h4', {}, 'Watchlist'), list, h('div', { class: 'td-add' }, addInput, addBtn));

  const symEl = h('span', { class: 'td-sym' });
  const priceEl = h('span', { class: 'td-price' });
  const chgEl = h('span', { class: 'td-chg' });
  const live = h('span', { class: 'td-live', title: 'Live stream' });
  const intBtns = INTERVALS.map(iv => h('button', { onclick: () => select(st.symbol, iv) }, iv));
  const indBtns = Object.entries(IND).map(([k, label]) => h('button', { onclick: () => { st.ind[k] = !st.ind[k]; persist(); applyVisibility(); syncButtons(); } }, label));
  const errEl = h('span', { class: 'td-err' });
  const bar = h('div', { class: 'td-box td-bar' }, live, symEl, priceEl, chgEl, errEl,
    h('div', { class: 'td-grp' }, intBtns), h('div', { class: 'td-grp' }, indBtns));

  const chartEl = h('div', { class: 'td-chart' });
  const rsiEl = h('div', { class: 'td-rsi' });
  const statsEl = h('div', { class: 'td-stats' });
  const center = h('div', { class: 'td-center' }, bar, h('div', { class: 'td-box td-charts' }, chartEl, rsiEl), statsEl);
  ctx.mount('dash', h('div', { class: 'td' }, watchBox, center));

  // ---------- charts ----------
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const colors = () => ({
    text: css('--muted') || '#888', grid: 'rgba(127,127,127,.12)', font: css('--mono') || 'monospace',
    up: css('--ok') || '#26a69a', down: css('--danger') || '#ef5350',
    a1: css('--yellow') || '#f0b90b', a2: css('--cyan') || css('--accent') || '#2962ff', a3: css('--accent') || '#e91e63',
  });
  const baseOpts = c => ({
    autoSize: true,
    layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: c.text, fontFamily: c.font, fontSize: 11 },
    grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
    rightPriceScale: { borderColor: c.grid, minimumWidth: 78 },
    timeScale: { borderColor: c.grid, timeVisible: true, secondsVisible: false, rightOffset: 4 },
    crosshair: { mode: CrosshairMode.Normal },
  });

  let c = colors();
  const chart = createChart(chartEl, { ...baseOpts(c), timeScale: { ...baseOpts(c).timeScale, visible: false } });
  const rsiChart = createChart(rsiEl, baseOpts(c));
  ctx.onDispose(() => { chart.remove(); rsiChart.remove(); });

  const line = (color, extra = {}) => chart.addLineSeries({ color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...extra });
  const cs = chart.addCandlestickSeries({});
  const vol = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
  chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  const s20 = line(c.a1), s50 = line(c.a2);
  const bbU = line(c.text, { lineWidth: 1, lineStyle: LineStyle.Dashed }), bbL = line(c.text, { lineWidth: 1, lineStyle: LineStyle.Dashed });
  const rsiS = rsiChart.addLineSeries({ color: c.a3, lineWidth: 1.5, priceLineVisible: false,
    autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) });
  const rsiLines = [70, 30].map(p => rsiS.createPriceLine({ price: p, color: c.text, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false }));

  function applyTheme() {
    c = colors();
    chart.applyOptions({ ...baseOpts(c), timeScale: { ...baseOpts(c).timeScale, visible: false } });
    rsiChart.applyOptions(baseOpts(c));
    cs.applyOptions({ upColor: c.up, downColor: c.down, borderUpColor: c.up, borderDownColor: c.down, wickUpColor: c.up, wickDownColor: c.down });
    s20.applyOptions({ color: c.a1 }); s50.applyOptions({ color: c.a2 });
    bbU.applyOptions({ color: c.text }); bbL.applyOptions({ color: c.text });
    rsiS.applyOptions({ color: c.a3 }); rsiLines.forEach(l => l.applyOptions({ color: c.text }));
    if (candles.length) vol.setData(candles.map(volPt));
  }
  applyTheme();
  ctx.on('kernel:module', () => setTimeout(applyTheme, 60));

  // keep both panes aligned
  let syncing = false;
  const sync = (from, to) => from.timeScale().subscribeVisibleLogicalRangeChange(r => {
    if (!r || syncing) return; syncing = true; to.timeScale().setVisibleLogicalRange(r); syncing = false;
  });
  sync(chart, rsiChart); sync(rsiChart, chart);

  const volPt = b => ({ time: b.time, value: b.volume, color: (b.close >= b.open ? c.up : c.down) + '66' });
  const pts = arr => arr.map((v, i) => v == null ? { time: candles[i].time } : { time: candles[i].time, value: v });
  function calc() {
    const { sma, rsi, bollinger } = mkt().indicators;
    const cl = candles.map(b => b.close);
    return { s20: sma(cl, 20), s50: sma(cl, 50), bb: bollinger(cl, 20, 2), rsi: rsi(cl, 14) };
  }
  function renderAll() {
    const x = calc();
    cs.setData(candles); vol.setData(candles.map(volPt));
    s20.setData(pts(x.s20)); s50.setData(pts(x.s50)); bbU.setData(pts(x.bb.upper)); bbL.setData(pts(x.bb.lower));
    rsiS.setData(pts(x.rsi));
  }
  function renderLast() {
    const x = calc(), i = candles.length - 1, t = candles[i].time;
    const u = (s, v) => s.update(v == null ? { time: t } : { time: t, value: v });
    cs.update(candles[i]); vol.update(volPt(candles[i]));
    u(s20, x.s20[i]); u(s50, x.s50[i]); u(bbU, x.bb.upper[i]); u(bbL, x.bb.lower[i]); u(rsiS, x.rsi[i]);
  }
  function applyVisibility() {
    s20.applyOptions({ visible: st.ind.sma20 }); s50.applyOptions({ visible: st.ind.sma50 });
    bbU.applyOptions({ visible: st.ind.bb }); bbL.applyOptions({ visible: st.ind.bb });
    vol.applyOptions({ visible: st.ind.vol });
  }

  // ---------- header + stats ----------
  function syncButtons() {
    intBtns.forEach((b, i) => b.classList.toggle('on', INTERVALS[i] === st.interval));
    indBtns.forEach((b, i) => b.classList.toggle('on', !!st.ind[Object.keys(IND)[i]]));
  }
  function renderHeader() {
    const t = ticks[st.symbol];
    const last = candles.at(-1)?.close ?? t?.price;
    symEl.textContent = st.symbol;
    priceEl.textContent = fmtP(last);
    chgEl.textContent = t ? `${fmtPct(t.changePct)} 24h` : '';
    chgEl.className = `td-chg ${sign(t?.changePct)}`;
    document.title = `${st.symbol} ${fmtP(last)} · Trader Analytics`;
  }
  function stat(k, v, cls = '') { return h('div', { class: 'td-box td-stat' }, h('div', { class: 'k' }, k), h('div', { class: `v ${cls}` }, v)); }
  function renderStats() {
    if (candles.length < 30) return;
    const M = mkt(), cl = candles.map(b => b.close), n = cl.length - 1, p = cl[n];
    const r = M.indicators.rsi(cl)[n], a = M.indicators.atr(candles)[n], s50 = M.indicators.sma(cl, 50)[n];
    const bb = M.indicators.bollinger(cl), m = M.indicators.macd(cl);
    const t = ticks[st.symbol];
    const vsS50 = s50 ? (p / s50 - 1) * 100 : null;
    statsEl.replaceChildren(
      stat('24h High', fmtP(t?.high)), stat('24h Low', fmtP(t?.low)), stat('24h Vol', fmtV(t?.quoteVolume)),
      stat('RSI 14', r?.toFixed(1) ?? '—', r > 70 ? 'td-down' : r < 30 ? 'td-up' : ''),
      stat('ATR 14', a ? `${fmtP(a)} · ${((a / p) * 100).toFixed(2)}%` : '—'),
      stat('vs SMA50', fmtPct(vsS50), sign(vsS50)),
      stat('BB width', bb.mid[n] ? `${(((bb.upper[n] - bb.lower[n]) / bb.mid[n]) * 100).toFixed(2)}%` : '—'),
      stat('MACD hist', m.hist[n] != null ? fmtP(m.hist[n]) : '—', sign(m.hist[n])),
    );
  }
  let statsTimer = null;
  const statsSoon = () => { if (!statsTimer) statsTimer = setTimeout(() => { statsTimer = null; renderStats(); }, 1000); };
  ctx.onDispose(() => clearTimeout(statsTimer));

  // ---------- watchlist ----------
  const rows = new Map();
  function renderWatch() {
    rows.clear();
    list.replaceChildren(...st.watch.map(s => {
      const p = h('span', { class: 'p' }), cEl = h('span', { class: 'c' }), v = h('span', { class: 'v' });
      const x = h('button', { class: 'x ghost', title: 'Remove', onclick: e => { e.stopPropagation(); removeSymbols([s]); } }, '×');
      const row = h('div', { class: `td-row ${s === st.symbol ? 'on' : ''}`, onclick: () => select(s) },
        h('span', { class: 's' }, s.replace(/USDT$/, '')), p, v, cEl, x);
      rows.set(s, { row, p, c: cEl, v, last: null });
      updateRow(s);
      return row;
    }));
  }
  function updateRow(s) {
    const r = rows.get(s), t = ticks[s];
    if (!r || !t) return;
    r.p.textContent = fmtP(t.price);
    r.c.textContent = fmtPct(t.changePct); r.c.className = `c ${sign(t.changePct)}`;
    r.v.textContent = fmtV(t.quoteVolume);
    if (r.last != null && t.price !== r.last) {
      r.row.classList.remove('td-flash-up', 'td-flash-down'); void r.row.offsetWidth;
      r.row.classList.add(t.price > r.last ? 'td-flash-up' : 'td-flash-down');
    }
    r.last = t.price;
  }

  // ---------- data + streaming ----------
  let unsub = null, loadSeq = 0;
  function subscribe() {
    unsub?.();
    const syms = [...new Set([...st.watch, st.symbol])];
    const streams = [`${st.symbol.toLowerCase()}@kline_${st.interval}`, ...syms.map(s => `${s.toLowerCase()}@miniTicker`)];
    live.classList.remove('on');
    unsub = mkt().subscribe(streams, d => {
      live.classList.add('on');
      if (d.e === 'kline' && d.s === st.symbol && d.k.i === st.interval && candles.length) {
        const k = d.k, bar = { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v };
        const last = candles.at(-1);
        if (bar.time === last.time) candles[candles.length - 1] = bar;
        else if (bar.time > last.time) { candles.push(bar); if (candles.length > 1000) candles.shift(); }
        else return;
        renderLast(); renderHeader(); statsSoon();
      } else if (d.e === '24hrMiniTicker') {
        ticks[d.s] = { price: +d.c, changePct: (+d.c / +d.o - 1) * 100, high: +d.h, low: +d.l, quoteVolume: +d.q };
        updateRow(d.s);
        if (d.s === st.symbol) renderHeader();
      }
    });
  }
  ctx.onDispose(() => unsub?.());
  ctx.on('market:ready', () => { if (ctx.has('market')) subscribe(); });

  async function loadQuotes() {
    try {
      for (const t of await mkt().quote([...new Set([...st.watch, st.symbol])])) ticks[t.symbol] = t;
      st.watch.forEach(updateRow); renderHeader(); renderStats();
    } catch (e) { errEl.textContent = e.message; }
  }

  async function load() {
    const seq = ++loadSeq;
    errEl.textContent = '';
    syncButtons(); renderHeader();
    rows.forEach((r, s) => r.row.classList.toggle('on', s === st.symbol));
    try {
      const data = await mkt().candles(st.symbol, st.interval, 500);
      if (seq !== loadSeq) return;
      candles = data;
      clearLevels();
      const p = prec(candles.at(-1).close);
      cs.applyOptions({ priceFormat: { type: 'price', precision: p, minMove: 1 / 10 ** p } });
      renderAll(); applyVisibility();
      chart.timeScale().setVisibleLogicalRange({ from: candles.length - 160, to: candles.length + 4 });
      renderHeader(); renderStats();
      subscribe();
      if (!ticks[st.symbol]) loadQuotes();
    } catch (e) {
      if (seq === loadSeq) errEl.textContent = `⚠ ${e.message}`;
    }
  }

  async function select(symbol, interval = st.interval) {
    const s = mkt().norm(symbol);
    if (!INTERVALS.includes(interval)) throw new Error(`interval must be one of ${INTERVALS.join(', ')}`);
    st.symbol = s; st.interval = interval; persist();
    await load();
    if (errEl.textContent) throw new Error(errEl.textContent);
  }

  async function addSymbols(syms) {
    const want = syms.map(s => mkt().norm(s)).filter(s => s && !st.watch.includes(s));
    if (!want.length) return st.watch;
    const valid = [];
    for (const s of want) {
      try { const [t] = await mkt().quote([s]); ticks[s] = t; valid.push(s); }
      catch { ctx.use('ui').toast(`Unknown symbol ${s}`, 'error'); }
    }
    st.watch = [...st.watch, ...valid]; persist(); renderWatch(); subscribe();
    return st.watch;
  }
  function removeSymbols(syms) {
    const drop = new Set(syms.map(s => mkt().norm(s)));
    st.watch = st.watch.filter(s => !drop.has(s)); persist(); renderWatch(); subscribe();
    return st.watch;
  }

  function clearLevels() { levels.forEach(l => cs.removePriceLine(l.line)); levels = []; }
  function addLevels(list) {
    for (const { price, label = '', color } of list) {
      const line = cs.createPriceLine({ price, color: color || c.a3, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: label });
      levels.push({ price, label, line });
    }
  }

  renderWatch();
  loadQuotes();
  await load();

  // ---------- tools + prompt ----------
  function snapshot() {
    const t = ticks[st.symbol];
    return {
      symbol: st.symbol, interval: st.interval, lastPrice: candles.at(-1)?.close, change24hPct: t ? +t.changePct.toFixed(2) : null,
      indicatorsShown: Object.keys(st.ind).filter(k => st.ind[k]), levels: levels.map(({ price, label }) => ({ price, label })),
      watchlist: st.watch.map(s => ({ symbol: s, price: ticks[s]?.price, change24hPct: ticks[s] ? +ticks[s].changePct.toFixed(2) : null })),
    };
  }

  ctx.tool({
    name: 'chart_show',
    description: 'Switch the dashboard chart to a symbol/interval. With no arguments, returns what the user is looking at (symbol, interval, price, levels, watchlist).',
    input_schema: { type: 'object', properties: { symbol: { type: 'string' }, interval: { type: 'string', enum: INTERVALS } } },
    run: async ({ symbol, interval }) => {
      if (symbol || interval) await select(symbol || st.symbol, interval || st.interval);
      return snapshot();
    },
  });
  ctx.tool({
    name: 'chart_levels',
    description: 'Draw horizontal price levels (support, resistance, entry, stop, target) on the current chart. Levels are cleared when the symbol/interval changes.',
    input_schema: {
      type: 'object',
      properties: {
        levels: { type: 'array', items: { type: 'object', properties: { price: { type: 'number' }, label: { type: 'string' }, color: { type: 'string', description: 'CSS color, optional' } }, required: ['price'] } },
        clear: { type: 'boolean', description: 'remove existing levels first' },
      },
      required: ['levels'],
    },
    run: async ({ levels: lv, clear }) => { if (clear) clearLevels(); addLevels(lv); return { symbol: st.symbol, levels: levels.map(({ price, label }) => ({ price, label })) }; },
  });
  ctx.tool({
    name: 'watchlist',
    description: 'Add and/or remove Binance symbols (e.g. "ADAUSDT") from the dashboard watchlist. Returns the list.',
    input_schema: { type: 'object', properties: { add: { type: 'array', items: { type: 'string' } }, remove: { type: 'array', items: { type: 'string' } } } },
    run: async ({ add = [], remove = [] }) => { if (remove.length) removeSymbols(remove); if (add.length) await addSymbols(add); return st.watch; },
  });

  ctx.hook('system', async parts => [...parts, [
    '# Trader analytics app',
    'This page is a trader analytics dashboard (Binance spot crypto data, live). Left: watchlist. Center: candlestick chart with SMA20/SMA50/Bollinger/volume, RSI pane and stats. You are the built-in market analyst in the right-hand column.',
    '- Get data with market_analyze / market_quote / market_top. Never invent prices or indicator values.',
    '- "this chart"/"current" = call chart_show with no args first. chart_show also switches the chart; chart_levels marks support/resistance/entry/stop/target; watchlist edits the list.',
    '- Analysis format: bias, trend, momentum, key levels, scenarios with invalidation. Be concise, use numbers. Mark key levels on the chart when relevant.',
    '- This is analysis, not financial advice; mention it briefly when giving trade ideas.',
  ].join('\n')]);
}
