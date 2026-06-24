/* ================================================
   QUANTSIGNAL AI v21 — app.js
   Splash → Onboard → Main App
   Live: Bybit V5 + Fear&Greed + CoinGecko
   ================================================ */
'use strict';

// ── Telegram SDK ─────────────────────────────
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); tg.setHeaderColor('#050A12'); tg.setBackgroundColor('#050A12'); }

// ── State ────────────────────────────────────
const S = {
  prices: {}, changes: {}, volumes: {},
  mcap: null, mcapChg: null, fg: null, fgLabel: null,
  sparkData: [], returnData: [],
  ws: null, wsRetry: 0,
};

// ── Utils ─────────────────────────────────────
const $ = id => document.getElementById(id);
const fmt = (n, d=0) => n ? '$' + Number(n).toLocaleString('en-US', {minimumFractionDigits:d, maximumFractionDigits:d}) : '—';
const fmtPct = n => n===null ? '—' : (Number(n)>=0?'+':'')+Number(n).toFixed(2)+'%';
const cls = n => Number(n) >= 0 ? 'pos' : 'neg';

// ── SPLASH ANIMATION ─────────────────────────
function runSplash() {
  const fill = $('splash-fill');
  const txt  = $('splash-text');
  const msgs = ['Загрузка данных рынка...', 'Подключение к Bybit...', 'Инициализация AI...', 'Готово!'];
  let pct = 0, msgIdx = 0;
  const iv = setInterval(() => {
    pct += Math.random() * 18 + 5;
    if (pct > 100) pct = 100;
    fill.style.width = pct + '%';
    const mIdx = Math.floor(pct / 30);
    if (mIdx < msgs.length && mIdx !== msgIdx) { msgIdx = mIdx; txt.textContent = msgs[msgIdx]; }
    if (pct >= 100) {
      clearInterval(iv);
      setTimeout(() => { showScreen('screen-onboard'); }, 400);
    }
  }, 120);
}

// ── SCREEN TRANSITIONS ─────────────────────── 
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
    s.classList.add('hidden');
  });
  const el = $(id);
  if (el) { el.classList.remove('hidden'); el.classList.add('active'); }
}

function showTab(id) {
  document.querySelectorAll('.tab-screen').forEach(s => s.classList.remove('active'));
  const el = $(id);
  if (el) el.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.screen === id);
  });
}

// ── NAVIGATION INIT ───────────────────────────
function initNav() {
  // Onboard → Main
  $('onboard-btn').addEventListener('click', () => {
    showScreen('main-app');
    fetchAll();
    connectWS();
  });

  // Bottom nav
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.dataset.screen));
  });

  // Signal filter tabs
  document.querySelectorAll('.ftab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.ftab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
    });
  });

  // AI filter
  document.querySelectorAll('.ai-ftab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.ai-ftab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
    });
  });

  // Stats filter
  document.querySelectorAll('.sftab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.sftab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
    });
  });

  // Markets back
  const mb = $('markets-back');
  if (mb) mb.addEventListener('click', () => showTab('tab-home'));
  const hb = $('heatmap-back');
  if (hb) hb.addEventListener('click', () => showTab('tab-home'));

  // Market filter tabs
  document.querySelectorAll('.mftab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.mftab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
    });
  });

  // Heatmap period
  document.querySelectorAll('.hmtab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.hmtab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
    });
  });
}

// ── PLAN PERIOD TOGGLE ────────────────────────
window.setPlanPeriod = (p) => {
  document.querySelectorAll('.ptog').forEach(b => b.classList.remove('active'));
  $('ptog-' + p).classList.add('active');
};
window.showScreen = showScreen;

// ── DATA FETCH ────────────────────────────────
async function fetchBybit() {
  const syms = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','TONUSDT','DOGEUSDT','ADAUSDT'];
  try {
    const r = await fetch('https://api.bybit.com/v5/market/tickers?category=linear');
    const j = await r.json();
    if (j.retCode !== 0) throw new Error('bybit error');
    (j.result?.list || []).forEach(t => {
      const sym = t.symbol.replace('USDT','');
      if (syms.includes(t.symbol)) {
        S.prices[sym]  = parseFloat(t.lastPrice);
        S.changes[sym] = parseFloat(t.price24hPcnt) * 100;
        S.volumes[sym] = parseFloat(t.volume24h) * parseFloat(t.lastPrice);
      }
    });
    if (!S.sparkData.length && S.prices.BTC) {
      S.sparkData = Array.from({length:20}, (_,i) => S.prices.BTC * (1 + Math.sin(i*0.5)*0.008 + (Math.random()-0.5)*0.004));
    }
    if (!S.returnData.length) {
      S.returnData = Array.from({length:30}, (_,i) => 10000 * (1 + i*0.009 + Math.sin(i*0.4)*0.015));
    }
    updateAllUI();
  } catch (e) { loadDemo(); }
}

async function fetchGlobal() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/global');
    const j = await r.json();
    if (!j.data) throw new Error();
    S.mcap    = j.data.total_market_cap.usd / 1e12;
    S.mcapChg = j.data.market_cap_change_percentage_24h_usd;
    updateMcapUI();
  } catch { S.mcap = 2.41; S.mcapChg = 2.35; updateMcapUI(); }
}

async function fetchFG() {
  try {
    const r = await fetch('https://api.alternative.me/fng/?limit=1');
    const j = await r.json();
    S.fg = parseInt(j.data[0].value);
    S.fgLabel = j.data[0].value_classification;
    updateFGUI();
  } catch { S.fg = 20; S.fgLabel = 'Extreme Fear'; updateFGUI(); }
}

function loadDemo() {
  S.prices  = {BTC:67821,ETH:3215,SOL:168,BNB:602,XRP:0.5123,TON:6.21,DOGE:0.1456,ADA:0.4567};
  S.changes = {BTC:+1.85,ETH:+2.48,SOL:+3.12,BNB:+1.24,XRP:+1.06,TON:+2.05,DOGE:+0.88,ADA:+1.15};
  S.volumes = {BTC:28.4e9,ETH:15.3e9,SOL:4.9e9,BNB:1.9e9,XRP:1.2e9,TON:612e6,DOGE:678e6,ADA:512e6};
  S.mcap = 2.41; S.mcapChg = 2.35;
  S.fg = 20; S.fgLabel = 'Extreme Fear';
  S.sparkData  = Array.from({length:20},(_,i)=>67821*(1+Math.sin(i*0.5)*0.01));
  S.returnData = Array.from({length:30},(_,i)=>10000*(1+i*0.009+Math.sin(i*0.4)*0.015));
  updateAllUI();
}

async function fetchAll() {
  await Promise.allSettled([fetchBybit(), fetchGlobal(), fetchFG()]);
}

// ── WEBSOCKET ─────────────────────────────────
function connectWS() {
  try {
    S.ws = new WebSocket('wss://stream.bybit.com/v5/public/linear');
    S.ws.onopen = () => {
      S.wsRetry = 0;
      S.ws.send(JSON.stringify({op:'subscribe',args:['tickers.BTCUSDT','tickers.ETHUSDT','tickers.SOLUSDT','tickers.BNBUSDT']}));
    };
    S.ws.onmessage = e => {
      try {
        const d = JSON.parse(e.data);
        if (d.topic?.startsWith('tickers.') && d.data) {
          const sym = d.topic.replace('tickers.','').replace('USDT','');
          if (d.data.lastPrice)     S.prices[sym]  = parseFloat(d.data.lastPrice);
          if (d.data.price24hPcnt !== undefined) S.changes[sym] = parseFloat(d.data.price24hPcnt)*100;
          if (sym==='BTC' && d.data.lastPrice) {
            S.sparkData.push(parseFloat(d.data.lastPrice));
            if (S.sparkData.length>40) S.sparkData.shift();
          }
          updateAllUI();
        }
      } catch {}
    };
    S.ws.onerror = () => {};
    S.ws.onclose = () => { S.wsRetry++; if(S.wsRetry<5) setTimeout(connectWS, 3000*S.wsRetry); };
  } catch { loadDemo(); }
}

// ── UI UPDATES ────────────────────────────────
function updateAllUI() {
  updateMcapUI();
  updateFGUI();
  updateGainers();
  updateSignals();
  updateMarkets();
  updateHeatmap();
  drawSparkline($('h-sparkline'), S.sparkData, '#1EC8DC');
  drawSparkline($('return-sparkline'), S.returnData, '#00D890');
  drawDonut();
  drawBrainCanvas();
}

function updateMcapUI() {
  const el = $('h-mcap'), chg = $('h-mcap-chg');
  if (!el) return;
  if (S.mcap) { el.textContent = '$' + S.mcap.toFixed(2) + 'T'; }
  if (S.mcapChg !== null) {
    chg.textContent = fmtPct(S.mcapChg);
    chg.className = 'hc-chg ' + cls(S.mcapChg);
  }
}

const FG_RU = {'Extreme Fear':'Крайний страх','Fear':'Страх','Neutral':'Нейтральный','Greed':'Жадность','Extreme Greed':'Крайняя жадность'};

function updateFGUI() {
  if (S.fg === null) return;
  const chip = $('h-fg-val'), bar = $('h-fg-bar');
  if (!chip) return;
  const lbl = FG_RU[S.fgLabel] || S.fgLabel || '';
  chip.textContent = S.fg + ' · ' + lbl;
  chip.style.color = S.fg < 25 ? '#FF3060' : S.fg < 50 ? '#FF8000' : S.fg < 75 ? '#1EC8DC' : '#00D890';
  if (bar) bar.style.width = S.fg + '%';
}

function updateGainers() {
  const coins = [
    {sym:'SOL',icon:'◎',cls:'sol'}, {sym:'BTC',icon:'₿',cls:'btc'},
    {sym:'ETH',icon:'Ξ',cls:'eth'}, {sym:'BNB',icon:'B',cls:'bnb'},
  ];
  const el = $('gainers-list');
  if (!el) return;
  el.innerHTML = coins.map(c => {
    const chg = S.changes[c.sym];
    return `<div class="gainer-row">
      <div class="coin-icon ${c.cls}">${c.icon}</div>
      <span class="coin-sym">${c.sym}</span>
      <span class="coin-chg ${cls(chg)}">${fmtPct(chg)}</span>
    </div>`;
  }).join('');
}

// ── SIGNALS DATA ──────────────────────────────
const SIGNALS_DATA = [
  {pair:'BTC/USDT',sym:'BTC',icon:'₿',dir:'LONG',entry:67821,target1:68200,target2:69000,sl:66800,conf:94,time:'45 мин назад',quality:'Высокая уверенность'},
  {pair:'ETH/USDT',sym:'ETH',icon:'Ξ',dir:'LONG',entry:3215,target1:3350,target2:3500,sl:3150,conf:87,time:'32 мин назад',quality:'Средняя уверенность'},
  {pair:'SOL/USDT',sym:'SOL',icon:'◎',dir:'SHORT',entry:168.42,target1:160,target2:155,sl:168.50,conf:72,time:'1 ч назад',quality:'Средняя уверенность'},
];

function updateSignals() {
  const el = $('signals-list');
  if (!el || el.children.length) return;
  el.innerHTML = SIGNALS_DATA.map(s => {
    const isLong = s.dir === 'LONG';
    const price = S.prices[s.sym] || s.entry;
    return `
    <div class="signal-card ${isLong?'long':'short'}-card">
      <div class="sc-top">
        <div class="sc-pair-row">
          <div class="sc-coin-ic ${s.sym.toLowerCase()}">${s.icon}</div>
          <div>
            <div class="sc-pair">${s.pair}</div>
            <div class="sc-time">${s.time}</div>
          </div>
        </div>
        <span class="sc-dir-badge ${isLong?'long':'short'}-badge">${s.dir}</span>
      </div>
      <div class="sc-levels">
        <div class="sc-level">
          <div class="scl-label">Вход</div>
          <div class="scl-val">${price.toLocaleString('en-US',{maximumFractionDigits:2})}</div>
        </div>
        <div class="sc-level">
          <div class="scl-label">Цель</div>
          <div class="scl-val green">${s.target1.toLocaleString()}</div>
        </div>
        <div class="sc-level">
          <div class="scl-label">SL</div>
          <div class="scl-val red">${s.sl.toLocaleString()}</div>
        </div>
      </div>
      <div class="sc-bottom">
        <div class="sc-conf-bar-wrap">
          <div class="sc-conf-label">Уверенность</div>
          <div class="sc-conf-bar"><div class="sc-conf-fill" style="width:${s.conf}%"></div></div>
        </div>
        <span class="sc-conf-pct">${s.conf}%</span>
        <span class="sc-quality" style="margin-left:8px">${s.quality}</span>
      </div>
    </div>`;
  }).join('');
}

// ── MARKETS ───────────────────────────────────
const MARKET_COINS = [
  {sym:'BTC',icon:'₿',cls:'btc',name:'Bitcoin'},
  {sym:'ETH',icon:'Ξ',cls:'eth',name:'Ethereum'},
  {sym:'SOL',icon:'◎',cls:'sol',name:'Solana'},
  {sym:'BNB',icon:'B',cls:'bnb',name:'BNB'},
  {sym:'XRP',icon:'✕',cls:'sol',name:'XRP'},
  {sym:'TON',icon:'◆',cls:'btc',name:'TON'},
  {sym:'DOGE',icon:'Ð',cls:'bnb',name:'Dogecoin'},
  {sym:'ADA',icon:'₳',cls:'eth',name:'Cardano'},
];

function fmtVol(v) {
  if (!v) return '—';
  if (v>=1e9) return '$' + (v/1e9).toFixed(2)+'B';
  if (v>=1e6) return '$' + (v/1e6).toFixed(1)+'M';
  return '$' + v.toFixed(0);
}
function fmtPrice(p, sym) {
  if (!p) return '—';
  const d = ['BTC','ETH','BNB'].includes(sym) ? 2 : sym==='XRP'||sym==='DOGE'||sym==='ADA' ? 4 : 2;
  return p.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
}

function updateMarkets() {
  const el = $('market-list');
  if (!el) return;
  el.innerHTML = MARKET_COINS.map(c => {
    const p = S.prices[c.sym], ch = S.changes[c.sym], v = S.volumes[c.sym];
    return `
    <div class="market-row">
      <div class="mr-pair-wrap">
        <div class="mr-icon ${c.cls}">${c.icon}</div>
        <div><div class="mr-pair">${c.sym}/USDT</div><div class="mr-type">Фьючерс</div></div>
      </div>
      <div class="mr-price">${fmtPrice(p,c.sym)}</div>
      <div class="mr-chg ${cls(ch)}">${fmtPct(ch)}</div>
      <div class="mr-vol">${fmtVol(v)}</div>
    </div>`;
  }).join('');
}

// ── HEATMAP ───────────────────────────────────
const HM_COINS = [
  'BTC','ETH','SOL','BNB',
  'XRP','TON','DOGE','ADA',
  {sym:'AVAX',chg:+2.71},{sym:'LINK',chg:+1.08},{sym:'TRX',chg:+0.74},{sym:'LTC',chg:+1.12},
  {sym:'DOT',chg:+1.21},{sym:'MATIC',chg:+0.95},{sym:'BCH',chg:+1.80},{sym:'UNI',chg:+1.58},
  {sym:'LDO',chg:+1.18},{sym:'APT',chg:+2.22},{sym:'ARB',chg:+1.07},{sym:'SUI',chg:+1.24},
];

function heatColor(chg) {
  if (chg > 4)   return '#006644';
  if (chg > 2)   return '#00875A';
  if (chg > 0)   return '#0B6E4F';
  if (chg > -2)  return '#8B2000';
  return '#BF2600';
}

function updateHeatmap() {
  const el = $('heatmap-grid');
  if (!el || el.children.length) return;
  el.innerHTML = HM_COINS.map(c => {
    const sym = typeof c === 'string' ? c : c.sym;
    const chg = typeof c === 'string' ? (S.changes[sym] ?? null) : c.chg;
    const v = chg !== null ? chg : 0;
    const bg = heatColor(v);
    return `<div class="hm-cell" style="background:${bg}">
      <div class="hm-sym">${sym}</div>
      <div class="hm-chg">${v>=0?'+':''}${v.toFixed(2)}%</div>
    </div>`;
  }).join('');
}

// ── CANVAS DRAWINGS ───────────────────────────
function drawSparkline(canvas, data, color) {
  if (!canvas || !data.length) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || canvas.width, H = canvas.height;
  canvas.width = W;
  ctx.clearRect(0,0,W,H);
  const d = data.slice(-20);
  const mn = Math.min(...d), mx = Math.max(...d), rng = mx-mn||1;
  const x = i => (i/(d.length-1))*W;
  const y = v => H - ((v-mn)/rng)*(H-6)-3;

  const grad = ctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0, color+'40');
  grad.addColorStop(1, color+'00');

  ctx.beginPath();
  d.forEach((v,i) => i===0 ? ctx.moveTo(x(i),y(v)) : ctx.lineTo(x(i),y(v)));
  ctx.strokeStyle = color; ctx.lineWidth=2; ctx.lineJoin='round'; ctx.stroke();

  ctx.lineTo(x(d.length-1),H); ctx.lineTo(x(0),H); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();
}

function drawDonut() {
  const canvas = $('donut-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W=120,H=120,cx=60,cy=60,r=48,ir=30;
  ctx.clearRect(0,0,W,H);
  const segs = [{v:45,c:'#1EC8DC'},{v:20,c:'#FF8000'},{v:15,c:'#00D890'},{v:20,c:'#5A7090'}];
  let start = -Math.PI/2;
  segs.forEach(s => {
    const angle = (s.v/100)*Math.PI*2;
    ctx.beginPath();
    ctx.arc(cx,cy,r,start,start+angle);
    ctx.arc(cx,cy,ir,start+angle,start,true);
    ctx.closePath();
    ctx.fillStyle = s.c; ctx.fill();
    start += angle;
  });
}

function drawBrainCanvas() {
  const canvas = $('ai-brain-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W=200,H=120;
  ctx.clearRect(0,0,W,H);

  // Background
  const bg = ctx.createRadialGradient(100,60,10,100,60,90);
  bg.addColorStop(0,'rgba(30,200,220,0.08)');
  bg.addColorStop(1,'rgba(5,10,18,0)');
  ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

  // Neural network nodes
  const nodes = [
    [30,30],[60,15],[90,35],[120,20],[150,35],[175,25],
    [20,65],[55,55],[85,70],[115,55],[145,65],[175,60],
    [30,95],[65,85],[100,100],[135,88],[165,95],[190,85],
  ];
  ctx.strokeStyle='#1EC8DC'; ctx.lineWidth=0.7; ctx.globalAlpha=0.25;
  for (let i=0;i<nodes.length;i++) {
    for (let j=i+1;j<nodes.length;j++) {
      if (Math.hypot(nodes[i][0]-nodes[j][0],nodes[i][1]-nodes[j][1])<70) {
        ctx.beginPath(); ctx.moveTo(nodes[i][0],nodes[i][1]); ctx.lineTo(nodes[j][0],nodes[j][1]); ctx.stroke();
      }
    }
  }
  ctx.globalAlpha=1;
  nodes.forEach(([x,y],i) => {
    ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2);
    ctx.fillStyle = i%3===0 ? '#FF8000' : '#1EC8DC';
    ctx.globalAlpha=0.8; ctx.fill(); ctx.globalAlpha=1;
    // Glow
    const g=ctx.createRadialGradient(x,y,0,x,y,8);
    g.addColorStop(0,i%3===0?'rgba(255,128,0,0.3)':'rgba(30,200,220,0.3)');
    g.addColorStop(1,'transparent');
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,8,0,Math.PI*2); ctx.fill();
  });
}

// ── INIT ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  runSplash();
  // Periodic refresh
  setInterval(fetchAll, 30000);
  setInterval(() => {
    drawSparkline($('h-sparkline'), S.sparkData, '#1EC8DC');
    drawSparkline($('return-sparkline'), S.returnData, '#00D890');
  }, 5000);
});
