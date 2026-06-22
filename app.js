/* ============================================
   QUANTSIGNAL AI v20 — app.js
   Circuit board bg + Candlestick canvas
   Live Bybit WebSocket + REST fallback
   ============================================ */
'use strict';

// ── Telegram SDK init ────────────────────────
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  tg.setHeaderColor('#050A12');
  tg.setBackgroundColor('#050A12');
}

// ── State ────────────────────────────────────
const state = {
  prices:     { BTC: null, ETH: null, BNB: null, SOL: null },
  changes:    { BTC: null, ETH: null, BNB: null, SOL: null },
  sparkline:  [],
  fg:         null,
  ws:         null,
  wsRetry:    0,
};

// ── Price formatting ─────────────────────────
function fmt(n, digits = 0) {
  if (!n) return '—';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function fmtPct(n) {
  if (n === null || n === undefined) return '—';
  const v = Number(n);
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}
function colorClass(v) { return Number(v) >= 0 ? 'pos' : 'neg'; }

// ── UI Updates ───────────────────────────────
function updatePriceUI() {
  const bp = state.prices.BTC, bc = state.changes.BTC;
  const ep = state.prices.ETH, ec = state.changes.ETH;
  const np = state.prices.BNB, nc = state.changes.BNB;
  const sp = state.prices.SOL, sc = state.changes.SOL;

  const el = (id) => document.getElementById(id);

  if (bp) {
    el('btc-price').textContent = fmt(bp, 0);
    el('btc-change').textContent = fmtPct(bc);
    el('btc-change').className = 'hero-change ' + colorClass(bc);
  }
  if (ep) {
    el('eth-price').textContent = fmt(ep, 0);
    el('eth-chg').textContent   = fmtPct(ec);
    el('eth-chg').className = 'stat-chg ' + colorClass(ec);
  }
  if (np) {
    el('bnb-price').textContent = fmt(np, 1);
    el('bnb-chg').textContent   = fmtPct(nc);
    el('bnb-chg').className = 'stat-chg ' + colorClass(nc);
  }
  if (sp) {
    el('sol-price').textContent = fmt(sp, 1);
    el('sol-chg').textContent   = fmtPct(sc);
    el('sol-chg').className = 'stat-chg ' + colorClass(sc);
  }

  drawSparkline();
}

// ── Sparkline ────────────────────────────────
function drawSparkline() {
  const canvas = document.getElementById('hero-sparkline');
  if (!canvas || state.sparkline.length < 2) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const data = state.sparkline.slice(-30);
  const mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1;
  const x = (i) => (i / (data.length - 1)) * w;
  const y = (v) => h - ((v - mn) / rng) * (h - 6) - 3;

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(30,200,220,0.4)');
  grad.addColorStop(1, 'rgba(30,200,220,0)');

  ctx.beginPath();
  data.forEach((v, i) => i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v)));
  ctx.strokeStyle = '#1EC8DC';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.stroke();

  ctx.lineTo(x(data.length - 1), h);
  ctx.lineTo(x(0), h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
}

// ── Bybit REST Fallback ──────────────────────
async function fetchBybitRest() {
  const syms = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT'];
  try {
    const r = await fetch('https://api.bybit.com/v5/market/tickers?category=linear&limit=10');
    const j = await r.json();
    if (j.retCode !== 0) return;
    (j.result?.list || []).forEach((t) => {
      const sym = t.symbol.replace('USDT', '');
      if (['BTC', 'ETH', 'BNB', 'SOL'].includes(sym)) {
        state.prices[sym]  = parseFloat(t.lastPrice);
        state.changes[sym] = parseFloat(t.price24hPcnt) * 100;
      }
    });
    if (state.sparkline.length === 0 && state.prices.BTC) {
      state.sparkline = Array.from({length: 20}, (_, i) =>
        state.prices.BTC * (1 + (Math.random() - 0.5) * 0.002));
    }
    updatePriceUI();
    updateMarketList();
  } catch (e) {
    console.warn('Bybit REST fallback error', e);
    setDemoData();
  }
}

// ── Demo data fallback ───────────────────────
function setDemoData() {
  const demo = { BTC: 67450, ETH: 3580, BNB: 590, SOL: 165 };
  const demoChg = { BTC: 2.34, ETH: 1.87, BNB: -0.55, SOL: 4.12 };
  Object.assign(state.prices, demo);
  Object.assign(state.changes, demoChg);
  if (state.sparkline.length < 2) {
    state.sparkline = Array.from({length: 30}, (_, i) =>
      67450 + Math.sin(i * 0.4) * 400 + (Math.random() - 0.5) * 200);
  }
  updatePriceUI();
  updateMarketList();
}

// ── Bybit WebSocket ──────────────────────────
function connectWS() {
  try {
    state.ws = new WebSocket('wss://stream.bybit.com/v5/public/linear');
    state.ws.onopen = () => {
      state.wsRetry = 0;
      const sub = {
        op: 'subscribe',
        args: ['tickers.BTCUSDT', 'tickers.ETHUSDT', 'tickers.BNBUSDT', 'tickers.SOLUSDT'],
      };
      state.ws.send(JSON.stringify(sub));
    };
    state.ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.topic?.startsWith('tickers.') && d.data) {
          const sym = d.topic.replace('tickers.', '').replace('USDT', '');
          if (d.data.lastPrice)       state.prices[sym]  = parseFloat(d.data.lastPrice);
          if (d.data.price24hPcnt !== undefined) state.changes[sym] = parseFloat(d.data.price24hPcnt) * 100;
          if (sym === 'BTC' && d.data.lastPrice) {
            state.sparkline.push(parseFloat(d.data.lastPrice));
            if (state.sparkline.length > 60) state.sparkline.shift();
          }
          updatePriceUI();
          updateMarketList();
        }
      } catch (_) {}
    };
    state.ws.onerror = () => {};
    state.ws.onclose = () => {
      state.wsRetry++;
      if (state.wsRetry < 5) setTimeout(connectWS, 3000 * state.wsRetry);
    };
  } catch (e) {
    fetchBybitRest();
  }
}

// ── Fear & Greed ─────────────────────────────
async function fetchFG() {
  try {
    const r = await fetch('https://api.alternative.me/fng/?limit=1');
    const j = await r.json();
    const val = parseInt(j.data?.[0]?.value ?? '55');
    const label = j.data?.[0]?.value_classification ?? '';
    state.fg = { val, label };
    updateFGMeter(val, label);
  } catch {
    updateFGMeter(55, 'Нейтральный');
  }
}

const FG_LABELS = {
  'Extreme Fear': 'Крайний страх',
  'Fear': 'Страх',
  'Neutral': 'Нейтральный',
  'Greed': 'Жадность',
  'Extreme Greed': 'Крайняя жадность',
};

function updateFGMeter(val, label) {
  const num = document.getElementById('fg-number');
  const lbl = document.getElementById('fg-label');
  const arc = document.getElementById('fg-arc-fill');
  if (!num) return;

  num.textContent = val;

  const ruLabel = FG_LABELS[label] || label || 'Нейтральный';
  lbl.textContent = ruLabel;

  // Arc: full arc = 157 dasharray, 0 = fear, 157 = greed
  const fill = Math.round((val / 100) * 157);
  arc.setAttribute('stroke-dashoffset', String(157 - fill));

  let color = '#1EC8DC';
  if (val < 25)      color = '#FF3060';
  else if (val < 45) color = '#FF8000';
  else if (val > 75) color = '#00D890';
  arc.setAttribute('stroke', color);
  num.style.color = color;
}

// ── Market List ──────────────────────────────
const MARKET_COINS = [
  { sym: 'BTC', name: 'Bitcoin',  rank: 1 },
  { sym: 'ETH', name: 'Ethereum', rank: 2 },
  { sym: 'BNB', name: 'BNB',      rank: 3 },
  { sym: 'SOL', name: 'Solana',   rank: 4 },
];

function updateMarketList() {
  const el = document.getElementById('market-list');
  if (!el) return;
  el.innerHTML = MARKET_COINS.map(c => {
    const p = state.prices[c.sym], ch = state.changes[c.sym];
    const digits = c.sym === 'BTC' ? 0 : (c.sym === 'ETH' ? 0 : 1);
    return `
      <div class="market-row">
        <span class="mr-rank">#${c.rank}</span>
        <div style="flex:1">
          <div class="mr-name">${c.name}</div>
          <div class="mr-sym">${c.sym}/USDT</div>
        </div>
        <span class="mr-price">${p ? fmt(p, digits) : '—'}</span>
        <span class="mr-chg ${colorClass(ch)}">${fmtPct(ch)}</span>
      </div>`;
  }).join('');
}

// ── Signals Data ─────────────────────────────
const SIGNALS = [
  { pair: 'BTC/USDT', dir: 'BUY',  conf: 94, time: '2м назад',  strength: 'Высокий' },
  { pair: 'ETH/USDT', dir: 'BUY',  conf: 87, time: '5м назад',  strength: 'Средний' },
  { pair: 'BNB/USDT', dir: 'BUY',  conf: 81, time: '11м назад', strength: 'Средний' },
  { pair: 'SOL/USDT', dir: 'SELL', conf: 72, time: '18м назад', strength: 'Слабый' },
  { pair: 'XRP/USDT', dir: 'BUY',  conf: 78, time: '25м назад', strength: 'Средний' },
  { pair: 'ADA/USDT', dir: 'SELL', conf: 65, time: '32м назад', strength: 'Слабый' },
];

function renderSignalsFull() {
  const el = document.getElementById('signals-full');
  if (!el) return;
  el.innerHTML = SIGNALS.map(s => `
    <div class="signal-card ${s.dir === 'BUY' ? 'buy-card' : 'sell-card'}">
      <div style="flex:1">
        <div class="sc-pair">${s.pair}</div>
        <div style="font-size:10px;color:var(--txt2);margin-top:2px;">${s.time} · ${s.strength} сигнал</div>
      </div>
      <span class="sc-dir">${s.dir}</span>
      <span class="sc-conf">${s.conf}%</span>
    </div>`
  ).join('');
}

// ── AI Chat ──────────────────────────────────
const AI_RESPONSES = {
  btc:    ['BTC сейчас показывает бычью структуру. Ключевая поддержка удерживается. Вероятность роста в ближайшие 4ч — 68%.', 'Bitcoin в зоне накопления. RSI: 58. MACD — позитивный крест. AI рекомендует: осторожный лонг.'],
  eth:    ['ETH движется вместе с BTC. Уровень поддержки держится. Рекомендую наблюдать за пробоем сопротивления.', 'Ethereum укрепляется. Активность DeFi выросла на 12%. Сигнал: умеренно бычий.'],
  сигнал: ['Текущие топ-сигналы: BTC BUY 94%, ETH BUY 87%, BNB BUY 81%. Основаны на 7 технических индикаторах.', 'Сегодня 6 активных сигналов. Точность за последние 7 дней: 78.4%.'],
  рынок:  ['Рынок в фазе умеренного роста. BTC доминирование стабильное. Объёмы выше среднего.', 'Общий тренд — восходящий. Fear & Greed в зоне нейтральной жадности. Хороший момент для позиционирования.'],
  риск:   ['Управление рисками: никогда не вкладывайте более 2-5% портфеля в одну сделку. Всегда ставьте стоп-лосс.', 'QUANTSIGNAL AI предоставляет сигналы, но не является финансовым советником. Торгуйте осознанно.'],
};

function getAIResponse(msg) {
  const m = msg.toLowerCase();
  if (m.includes('btc') || m.includes('биткоин') || m.includes('bitcoin')) return rand(AI_RESPONSES.btc);
  if (m.includes('eth') || m.includes('эфир') || m.includes('ethereum'))   return rand(AI_RESPONSES.eth);
  if (m.includes('сигнал') || m.includes('signal'))                          return rand(AI_RESPONSES.сигнал);
  if (m.includes('рынок') || m.includes('market') || m.includes('тренд'))   return rand(AI_RESPONSES.рынок);
  if (m.includes('риск') || m.includes('risk') || m.includes('убыток'))      return rand(AI_RESPONSES.риск);
  return 'Для анализа спросите про BTC, ETH, сигналы или рыночный тренд. Я всегда готов помочь!';
}

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function appendChat(text, role) {
  const cont = document.getElementById('chat-messages');
  const div  = document.createElement('div');
  div.className = 'chat-msg ' + role;
  div.innerHTML = role === 'bot'
    ? `<div class="msg-avatar">Q</div><div class="msg-bubble">${text}</div>`
    : `<div class="msg-bubble">${text}</div>`;
  cont.appendChild(div);
  cont.scrollTop = cont.scrollHeight;
}

function initChat() {
  const inp  = document.getElementById('chat-input');
  const send = document.getElementById('chat-send');
  function doSend() {
    const v = inp.value.trim();
    if (!v) return;
    appendChat(v, 'user');
    inp.value = '';
    setTimeout(() => appendChat(getAIResponse(v), 'bot'), 600);
  }
  send.addEventListener('click', doSend);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSend(); });
}

// ── Tab Navigation ────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const panel = document.getElementById('tab-' + tab);
      if (panel) panel.classList.add('active');
    });
  });
}

// ── Splash → Main transition ──────────────────
function initSplash() {
  const splash = document.getElementById('splash-screen');
  const main   = document.getElementById('main-app');
  const btn    = document.getElementById('splash-enter-btn');
  btn.addEventListener('click', () => {
    splash.classList.remove('active');
    splash.classList.add('hidden');
    main.classList.remove('hidden');
    main.classList.add('active');
  });
}

// ── Market refresh button ─────────────────────
function initMarketRefresh() {
  const btn = document.getElementById('market-refresh');
  if (!btn) return;
  btn.addEventListener('click', () => {
    btn.style.transform = 'rotate(360deg)';
    setTimeout(() => { btn.style.transform = ''; btn.style.transition = ''; }, 400);
    fetchBybitRest();
  });
}

// ── CIRCUIT BOARD CANVAS ──────────────────────
function initCircuitCanvas() {
  const canvas = document.getElementById('circuit-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    drawCircuit();
  }

  function drawCircuit() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const w = canvas.width, h = canvas.height;
    const GRID = 32;
    const cols = Math.ceil(w / GRID) + 1;
    const rows = Math.ceil(h / GRID) + 1;

    ctx.strokeStyle = '#1EC8DC';
    ctx.lineWidth   = 0.6;

    // Horizontal traces
    for (let r = 0; r < rows; r++) {
      if (Math.random() > 0.4) continue;
      const y = r * GRID;
      let x = 0;
      ctx.beginPath();
      ctx.moveTo(x, y);
      while (x < w) {
        const seg = (Math.floor(Math.random() * 4) + 1) * GRID;
        x += seg;
        ctx.lineTo(Math.min(x, w), y);
        if (Math.random() > 0.7) {
          const jx = Math.min(x, w);
          // Via (dot)
          ctx.moveTo(jx, y);
          ctx.arc(jx, y, 2.5, 0, Math.PI * 2);
          ctx.moveTo(jx, y);
          // vertical branch
          const branchH = (Math.floor(Math.random() * 2) + 1) * GRID * (Math.random() > 0.5 ? 1 : -1);
          ctx.moveTo(jx, y);
          ctx.lineTo(jx, y + branchH);
          ctx.moveTo(jx, y + branchH);
        }
      }
      ctx.stroke();
    }

    // Nodes / pads
    ctx.fillStyle = '#1EC8DC';
    for (let i = 0; i < 25; i++) {
      const px = Math.round(Math.random() * cols) * GRID;
      const py = Math.round(Math.random() * rows) * GRID;
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.globalAlpha = 0.5 + Math.random() * 0.5;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  window.addEventListener('resize', resize);
  resize();
}

// ── CANDLESTICK CANVAS ────────────────────────
(function initCandleCanvas() {
  const canvas = document.getElementById('candle-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const CANDLES   = 22;
  const GAP       = 8;
  let candles     = [];
  let trendPoints = [];
  let animFrame   = 0;

  function genCandles(w, h) {
    candles = [];
    trendPoints = [];
    const candleW = Math.floor((w * 0.55 - GAP * (CANDLES + 1)) / CANDLES);
    let price = h * 0.45;
    for (let i = 0; i < CANDLES; i++) {
      const move = (Math.random() - 0.44) * h * 0.05;
      price += move;
      price = Math.max(h * 0.2, Math.min(h * 0.75, price));
      const body = (Math.random() * 0.06 + 0.02) * h;
      const isUp = Math.random() > 0.4;
      const open  = price - (isUp ? 0 : body);
      const close = price + (isUp ? body : 0);
      const high  = Math.min(open, close) - Math.random() * body * 0.8;
      const low   = Math.max(open, close) + Math.random() * body * 0.8;
      const x = w * 0.43 + GAP + i * (candleW + GAP) + candleW / 2;
      candles.push({ x, open, close, high, low, w: candleW, isUp });
    }
    // Trend line
    for (let i = 0; i < CANDLES; i += 4) {
      trendPoints.push({ x: candles[i].x, y: candles[i].close });
    }
    trendPoints.push({ x: candles[CANDLES - 1].x, y: candles[CANDLES - 1].close });
  }

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    genCandles(canvas.width, canvas.height);
    animFrame = 0;
  }

  function draw() {
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const reveal = Math.min(1, animFrame / 60);

    candles.forEach((c, i) => {
      const progress = Math.min(1, (animFrame - i * 2) / 20);
      if (progress <= 0) return;

      const alpha = progress * 0.75;
      const color = c.isUp ? '#00D890' : '#FF3060';
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1.2;

      // Wick
      ctx.beginPath();
      ctx.moveTo(c.x, c.high);
      ctx.lineTo(c.x, c.low);
      ctx.stroke();

      // Body
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(c.x - c.w / 2, Math.min(c.open, c.close),
                    c.w, Math.abs(c.close - c.open) || 1, 1);
      ctx.fill();
    });

    ctx.globalAlpha = 1;

    // Orange trend line
    if (trendPoints.length > 1 && reveal > 0.3) {
      const lineAlpha = Math.min(1, (reveal - 0.3) / 0.7) * 0.9;
      ctx.globalAlpha = lineAlpha;
      ctx.beginPath();
      ctx.moveTo(trendPoints[0].x, trendPoints[0].y);
      for (let i = 1; i < trendPoints.length; i++) {
        const mx = (trendPoints[i - 1].x + trendPoints[i].x) / 2;
        const my = (trendPoints[i - 1].y + trendPoints[i].y) / 2;
        ctx.quadraticCurveTo(trendPoints[i - 1].x, trendPoints[i - 1].y, mx, my);
      }
      ctx.strokeStyle = '#FF8000';
      ctx.lineWidth   = 2.5;
      ctx.lineJoin    = 'round';
      ctx.shadowColor = '#FF8000';
      ctx.shadowBlur  = 10;
      ctx.stroke();
      ctx.shadowBlur  = 0;
      ctx.globalAlpha = 1;
    }

    animFrame++;
    if (animFrame < CANDLES * 2 + 40) {
      requestAnimationFrame(draw);
    }
  }

  window.addEventListener('resize', () => { resize(); requestAnimationFrame(draw); });
  resize();
  requestAnimationFrame(draw);

  // Redraw every 30s with new candles
  setInterval(() => {
    genCandles(canvas.width, canvas.height);
    animFrame = 0;
    requestAnimationFrame(draw);
  }, 30000);
})();

// ── INIT ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initCircuitCanvas();
  initSplash();
  initTabs();
  initChat();
  initMarketRefresh();
  renderSignalsFull();
  updateMarketList();

  // Data
  connectWS();
  setTimeout(fetchBybitRest, 1000);
  setTimeout(fetchFG, 1500);
  setInterval(fetchBybitRest, 30000);
  setInterval(fetchFG, 300000);
});
