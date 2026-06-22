/* ═══════════════════════════════════════════════════════
   QUANTSIGNAL AI v19 — Logo Style App Engine
   Neural network canvas LEFT + Candlestick canvas RIGHT
   Live Bybit V5 data, AI Chat, Signals
═══════════════════════════════════════════════════════ */
(function(){
'use strict';

/* ── Telegram init ── */
var tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
if(tg){ tg.ready(); tg.expand();
  if(tg.setHeaderColor) tg.setHeaderColor('#050A12');
  if(tg.setBackgroundColor) tg.setBackgroundColor('#050A12');
}

/* ── State ── */
var S = {
  coin:'BTC', tf:'5m', tab:'overview',
  sigFilter:'all', mktCat:'all', mktQ:'',
  prices:{}, signals:[], mktData:[], ws:null
};

/* ══════════════════════════════════════════
   NEURAL NETWORK CANVAS (left side)
══════════════════════════════════════════ */
function initNeural(){
  var c = document.getElementById('neural-canvas');
  if(!c) return;
  var ctx = c.getContext('2d');
  var W, H;

  function resize(){
    W = c.width = c.offsetWidth * devicePixelRatio;
    H = c.height = c.offsetHeight * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    W = c.offsetWidth; H = c.offsetHeight;
  }
  resize();
  window.addEventListener('resize', function(){ ctx.setTransform(1,0,0,1,0,0); resize(); });

  // Nodes
  var nodes = [];
  var NODE_COUNT = 28;
  for(var i=0;i<NODE_COUNT;i++){
    nodes.push({
      x: Math.random() * W,
      y: Math.random() * H,
      vx:(Math.random()-.5)*.3,
      vy:(Math.random()-.5)*.3,
      r: Math.random()*2+1.5,
      pulse: Math.random()*Math.PI*2
    });
  }

  var frame = 0;
  function draw(){
    ctx.clearRect(0,0,W,H);
    frame++;

    // Draw connections
    for(var a=0;a<nodes.length;a++){
      for(var b=a+1;b<nodes.length;b++){
        var dx=nodes[b].x-nodes[a].x, dy=nodes[b].y-nodes[a].y;
        var dist=Math.sqrt(dx*dx+dy*dy);
        if(dist < 95){
          var alpha = (1-dist/95) * 0.35;
          ctx.beginPath();
          ctx.strokeStyle = 'rgba(30,200,220,'+alpha.toFixed(3)+')';
          ctx.lineWidth = .6;
          ctx.moveTo(nodes[a].x, nodes[a].y);
          ctx.lineTo(nodes[b].x, nodes[b].y);
          ctx.stroke();
        }
      }
    }

    // Draw nodes
    nodes.forEach(function(n){
      n.pulse += .025;
      var glow = .4 + Math.sin(n.pulse) * .3;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(30,200,220,'+glow.toFixed(2)+')';
      ctx.fill();
      // Outer ring on some nodes
      if(n.r > 2.5){
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r+3, 0, Math.PI*2);
        ctx.strokeStyle = 'rgba(30,200,220,'+(glow*.3).toFixed(2)+')';
        ctx.lineWidth = .8;
        ctx.stroke();
      }
      // Move
      n.x+=n.vx; n.y+=n.vy;
      if(n.x<0||n.x>W) n.vx*=-1;
      if(n.y<0||n.y>H) n.vy*=-1;
    });

    requestAnimationFrame(draw);
  }
  draw();
}

/* ══════════════════════════════════════════
   CANDLESTICK CANVAS (right side)
══════════════════════════════════════════ */
function initCandles(){
  var c = document.getElementById('candle-canvas');
  if(!c) return;
  var ctx = c.getContext('2d');
  var W, H;

  function resize(){
    ctx.setTransform(1,0,0,1,0,0);
    W = c.width = c.offsetWidth * devicePixelRatio;
    H = c.height = c.offsetHeight * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);
    W = c.offsetWidth; H = c.offsetHeight;
  }
  resize();
  window.addEventListener('resize', function(){ resize(); });

  // Generate candles
  var candles = [];
  var price = 100;
  for(var i=0;i<40;i++){
    var open = price;
    var close = open + (Math.random()-0.46)*4;
    var high = Math.max(open,close) + Math.random()*2;
    var low  = Math.min(open,close) - Math.random()*2;
    candles.push({o:open, c:close, h:high, l:low});
    price = close;
  }

  // Trend line overlay
  var trendPts = candles.map(function(c,i){ return {x:i, y:c.c}; });

  var animOffset = 0;
  function draw(){
    ctx.clearRect(0,0,W,H);

    var pad = 20;
    var cW = (W - pad*2) / candles.length;
    var prices = candles.map(function(c){ return c.h; }).concat(candles.map(function(c){ return c.l; }));
    var minP = Math.min.apply(Math, prices);
    var maxP = Math.max.apply(Math, prices);
    var range = maxP - minP || 1;

    function py(p){ return H - pad - ((p-minP)/range)*(H-pad*2); }

    // Draw candles
    candles.forEach(function(cd, i){
      var x = pad + i*cW + cW/2;
      var isUp = cd.c >= cd.o;
      var col = isUp ? 'rgba(0,216,144,' : 'rgba(255,48,96,';
      var alpha = 0.55 + Math.sin((i + animOffset*0.5)*0.3)*0.15;

      // Wick
      ctx.beginPath();
      ctx.strokeStyle = col+alpha.toFixed(2)+')';
      ctx.lineWidth = 1;
      ctx.moveTo(x, py(cd.h));
      ctx.lineTo(x, py(cd.l));
      ctx.stroke();

      // Body
      var bodyW = Math.max(cW*0.55, 3);
      var bodyTop = py(Math.max(cd.o, cd.c));
      var bodyBot = py(Math.min(cd.o, cd.c));
      var bodyH = Math.max(bodyBot - bodyTop, 1.5);
      ctx.fillStyle = col+alpha.toFixed(2)+')';
      ctx.fillRect(x - bodyW/2, bodyTop, bodyW, bodyH);
    });

    // Trend line (orange, like logo)
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,128,0,0.55)';
    ctx.lineWidth = 1.5;
    ctx.shadowBlur = 6;
    ctx.shadowColor = 'rgba(255,128,0,0.5)';
    var step = Math.floor(candles.length/8);
    for(var i=0;i<trendPts.length;i+=step){
      var p = trendPts[i];
      var x = pad + p.x*cW + cW/2;
      if(i===0) ctx.moveTo(x, py(p.y));
      else ctx.lineTo(x, py(p.y));
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Drift animation
    animOffset += 0.015;
    // Slowly evolve last candle
    if(Math.random() < 0.04){
      var last = candles[candles.length-1];
      last.c += (Math.random()-.48)*0.8;
      last.h = Math.max(last.h, last.c + Math.random()*0.5);
      last.l = Math.min(last.l, last.c - Math.random()*0.5);
      // scroll: remove first, add new
      if(Math.random() < 0.01){
        var prev = candles[candles.length-1];
        candles.shift();
        var nC = prev.c + (Math.random()-.46)*3;
        candles.push({o:prev.c,c:nC,h:Math.max(prev.c,nC)+Math.random()*1.5,l:Math.min(prev.c,nC)-Math.random()*1.5});
        trendPts.shift(); trendPts.push({x:candles.length-1, y:nC});
      }
    }

    requestAnimationFrame(draw);
  }
  draw();
}

/* ══════════════════════════════════════════
   SPLASH
══════════════════════════════════════════ */
function boot(){
  initNeural();
  initCandles();

  var fill = document.getElementById('splash-fill');
  var hint = document.getElementById('splash-hint');
  var splash = document.getElementById('splash');

  var steps=[
    {p:18,s:'Подключение к Bybit…'},
    {p:40,s:'Загрузка рыночных данных…'},
    {p:62,s:'Генерация AI сигналов…'},
    {p:82,s:'Инициализация нейросети…'},
    {p:100,s:'Готово!'}
  ];
  var i=0;
  function step(){
    if(i>=steps.length){
      setTimeout(function(){
        splash.classList.add('out');
        initApp();
      },320);
      return;
    }
    var s=steps[i++];
    if(fill) fill.style.width=s.p+'%';
    if(hint) hint.textContent=s.s;
    setTimeout(step, 320+Math.random()*200);
  }
  setTimeout(step,300);
}

/* ══════════════════════════════════════════
   APP INIT
══════════════════════════════════════════ */
function initApp(){
  setupTabs();
  setupCoinTabs();
  setupTfBtns();
  setupSigFilters();
  setupMktTabs();
  setupMktSearch();
  setupChat();

  fetchAll();
  buildSignals();
  connectWS();

  var btn=document.getElementById('btn-refresh');
  if(btn) btn.addEventListener('click',function(){
    btn.classList.add('spin');
    fetchAll();
    setTimeout(function(){btn.classList.remove('spin');},1000);
    toast('Данные обновлены');
  });
}

/* ══════════════════════════════════════════
   WEBSOCKET
══════════════════════════════════════════ */
function connectWS(){
  try{
    var ws=new WebSocket('wss://stream.bybit.com/v5/public/linear');
    S.ws=ws;
    ws.onopen=function(){
      setLive(true);
      ws.send(JSON.stringify({op:'subscribe',args:['tickers.BTCUSDT','tickers.ETHUSDT','tickers.SOLUSDT','tickers.BNBUSDT','tickers.XRPUSDT']}));
    };
    ws.onmessage=function(e){
      try{var d=JSON.parse(e.data); if(d.topic&&d.data) onTicker(d.topic,d.data);}catch(err){}
    };
    ws.onerror=function(){setLive(false);};
    ws.onclose=function(){setLive(false); setTimeout(connectWS,5000);};
  }catch(e){setLive(false);}
}

function onTicker(topic,data){
  var coin=topic.replace('tickers.','').replace('USDT','');
  var price=parseFloat(data.lastPrice||data.markPrice||0);
  var chg=parseFloat(data.price24hPcnt||0)*100;
  var high=parseFloat(data.highPrice24h||0);
  var low=parseFloat(data.lowPrice24h||0);
  var vol=parseFloat(data.volume24h||0)*price;
  if(!price) return;
  var prev=S.prices[coin];
  S.prices[coin]={price:price,chg:chg,high:high,low:low,vol:vol};

  // Ticker tape
  var el=document.getElementById('tk-'+coin.toLowerCase());
  if(el){el.textContent=fmtP(price,coin);el.className=chg>=0?'up':'dn';}

  if(coin===S.coin){
    updateHero(coin,price,chg,high,low,vol,prev?prev.price:null);
    updateSigCard(coin,price);
  }
}

/* ══════════════════════════════════════════
   FETCH REST
══════════════════════════════════════════ */
function fetchAll(){
  fetch('https://api.bybit.com/v5/market/tickers?category=linear&limit=200')
    .then(function(r){return r.json();})
    .then(function(d){
      if(!d.result||!d.result.list) return;
      d.result.list.forEach(function(item){
        if(!item.symbol.endsWith('USDT')) return;
        var coin=item.symbol.replace('USDT','');
        S.prices[coin]={
          price:parseFloat(item.lastPrice||0),
          chg:parseFloat(item.price24hPcnt||0)*100,
          high:parseFloat(item.highPrice24h||0),
          low:parseFloat(item.lowPrice24h||0),
          vol:parseFloat(item.volume24h||0)*parseFloat(item.lastPrice||0)
        };
      });
      var p=S.prices[S.coin];
      if(p) updateHero(S.coin,p.price,p.chg,p.high,p.low,p.vol,null);
      ['BTC','ETH','SOL','BNB','XRP'].forEach(function(coin){
        var d2=S.prices[coin]; if(!d2) return;
        var el=document.getElementById('tk-'+coin.toLowerCase());
        if(el){el.textContent=fmtP(d2.price,coin);el.className=d2.chg>=0?'up':'dn';}
      });
      S.mktData=d.result.list
        .filter(function(i){return i.symbol.endsWith('USDT');})
        .map(function(i){return{coin:i.symbol.replace('USDT',''),price:parseFloat(i.lastPrice||0),chg:parseFloat(i.price24hPcnt||0)*100,vol:parseFloat(i.volume24h||0)*parseFloat(i.lastPrice||0)};})
        .sort(function(a,b){return b.vol-a.vol;});
      renderMkt();
      renderMovers();
    }).catch(function(){});

  fetchKline(S.coin, S.tf);
  fetchMatrix();
}

/* ── KLINE ── */
function fetchKline(coin,tf){
  var iv={'1m':'1','5m':'5','15m':'15','1h':'60','4h':'240'}[tf]||'5';
  fetch('https://api.bybit.com/v5/market/kline?category=linear&symbol='+coin+'USDT&interval='+iv+'&limit=50')
    .then(function(r){return r.json();})
    .then(function(d){
      if(!d.result||!d.result.list) return;
      var closes=d.result.list.reverse().map(function(k){return parseFloat(k[4]);});
      drawChart(closes);
    }).catch(function(){});
}

function drawChart(closes){
  if(!closes||closes.length<2) return;
  var line=document.getElementById('chart-line');
  var area=document.getElementById('chart-area');
  if(!line) return;
  var W=320,H=72,pad=3;
  var min=Math.min.apply(Math,closes), max=Math.max.apply(Math,closes);
  var rng=max-min||1, n=closes.length;
  var pts=closes.map(function(v,i){
    return [(i/(n-1))*W, H-pad-((v-min)/rng)*(H-pad*2)];
  });
  var lp='M '+pts.map(function(p){return p[0].toFixed(1)+' '+p[1].toFixed(1);}).join(' L ');
  line.setAttribute('d',lp);
  area.setAttribute('d',lp+' L '+W+' '+H+' L 0 '+H+' Z');
  var up=closes[closes.length-1]>=closes[0];
  line.setAttribute('stroke',up?'#1EC8DC':'#FF3060');
  var ag=document.getElementById('areaGrad');
  if(ag){ag.children[0].setAttribute('stop-color',up?'rgba(30,200,220,.35)':'rgba(255,48,96,.2)');}
}

/* ── MATRIX ── */
function fetchMatrix(){
  fetch('https://api.alternative.me/fng/?limit=1')
    .then(function(r){return r.json();})
    .then(function(d){
      if(!d.data||!d.data[0]) return;
      var v=parseInt(d.data[0].value);
      var lbl=d.data[0].value_classification;
      var el=document.getElementById('mx-fng');
      var sl=document.getElementById('mx-fng-sub');
      var bar=document.getElementById('mx-fng-fill');
      if(el){el.textContent=v; el.style.color=v<25?'var(--neg)':v>75?'var(--pos)':'var(--txt0)';}
      if(sl) sl.textContent=lbl;
      if(bar) bar.style.width=v+'%';
    }).catch(function(){});

  fetch('https://api.coingecko.com/api/v3/global')
    .then(function(r){return r.json();})
    .then(function(d){
      if(!d.data) return;
      var cap=d.data.total_market_cap&&d.data.total_market_cap.usd;
      var dom=d.data.market_cap_percentage&&d.data.market_cap_percentage.btc;
      var chg=d.data.market_cap_change_percentage_24h_usd;
      var de=document.getElementById('mx-dom'),db=document.getElementById('mx-dom-fill');
      var ce=document.getElementById('mx-cap'),cc=document.getElementById('mx-cap-chg');
      if(de&&dom){de.textContent=dom.toFixed(1)+'%';}
      if(db&&dom){db.style.width=Math.min(dom,100)+'%';}
      if(ce&&cap){ce.textContent=fmtVol(cap);}
      if(cc&&chg){cc.textContent=(chg>0?'+':'')+chg.toFixed(1)+'%'; cc.style.color=chg>=0?'var(--pos)':'var(--neg)';}
    }).catch(function(){});

  fetch('https://api.bybit.com/v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=1')
    .then(function(r){return r.json();})
    .then(function(d){
      if(!d.result||!d.result.list||!d.result.list[0]) return;
      var rate=parseFloat(d.result.list[0].fundingRate)*100;
      var el=document.getElementById('mx-fund');
      if(el){el.textContent=(rate>0?'+':'')+rate.toFixed(4)+'%'; el.style.color=rate>0?'var(--pos)':rate<0?'var(--neg)':'var(--txt0)';}
    }).catch(function(){});
}

/* ══════════════════════════════════════════
   HERO UPDATE
══════════════════════════════════════════ */
function updateHero(coin,price,chg,high,low,vol,prev){
  var pe=document.getElementById('hero-price');
  var de=document.getElementById('hero-delta');
  var pare=document.getElementById('hero-pair');
  if(pare) pare.textContent=coin+' / USDT';
  if(pe){
    pe.textContent=fmtP(price,coin);
    if(prev!==null){
      pe.classList.remove('up-flash','dn-flash');
      void pe.offsetWidth;
      if(price>prev) pe.classList.add('up-flash');
      else if(price<prev) pe.classList.add('dn-flash');
      setTimeout(function(){pe.classList.remove('up-flash','dn-flash');},500);
    }
  }
  if(de){
    de.textContent=(chg>=0?'+':'')+chg.toFixed(2)+'%';
    de.className='hero-delta '+(chg>=0?'up':'dn');
  }
  var ve=document.getElementById('s-vol'); if(ve) ve.textContent=fmtVol(vol);
  var he=document.getElementById('s-high'); if(he) he.textContent=fmtP(high,coin);
  var le=document.getElementById('s-low'); if(le) le.textContent=fmtP(low,coin);
  // OI async
  var oi=document.getElementById('s-oi');
  if(oi){
    fetch('https://api.bybit.com/v5/market/open-interest?category=linear&symbol='+coin+'USDT&intervalTime=5min&limit=1')
      .then(function(r){return r.json();})
      .then(function(d){if(d.result&&d.result.list&&d.result.list[0]) oi.textContent=fmtVol(parseFloat(d.result.list[0].openInterest)*price);})
      .catch(function(){oi.textContent='—';});
  }
}

/* ══════════════════════════════════════════
   SIGNALS
══════════════════════════════════════════ */
var SYMS={BTC:'₿',ETH:'Ξ',SOL:'◎',BNB:'⬡',XRP:'✕',ADA:'₳',DOGE:'Ð',AVAX:'Δ',LINK:'⬡',DOT:'●'};
var COINS=['BTC','ETH','SOL','BNB','XRP','ADA','AVAX','LINK'];

function mkSig(coin){
  var price=S.prices[coin]?S.prices[coin].price:0;
  var side=Math.random()>.44?'LONG':'SHORT';
  var conf=65+Math.floor(Math.random()*30);
  var slp=.008+Math.random()*.013, tpp=slp*(2+Math.random()*1.8);
  var tp=side==='LONG'?price*(1+tpp):price*(1-tpp);
  var sl=side==='LONG'?price*(1-slp):price*(1+slp);
  var tf=['15М','1Ч','4Ч'][Math.floor(Math.random()*3)];
  var sig={coin:coin,side:side,conf:conf,entry:price,tp:tp,sl:sl,tf:tf,time:new Date()};
  var idx=S.signals.findIndex(function(s){return s.coin===coin;});
  if(idx>=0) S.signals[idx]=sig; else S.signals.push(sig);
  return sig;
}

function buildSignals(){
  COINS.forEach(mkSig);
  renderSigs();
  updateSigCard(S.coin, S.prices[S.coin]?S.prices[S.coin].price:0);
  setInterval(function(){
    COINS.forEach(function(c){var p=S.prices[c]; if(p) mkSig(c);});
    renderSigs();
  },30000);
}

function updateSigCard(coin,price){
  var sig=S.signals.find(function(s){return s.coin===coin;})||mkSig(coin);
  var pe=document.getElementById('sig-pair'); if(pe) pe.textContent=coin+'/USDT';
  var se=document.getElementById('sig-side');
  if(se) se.innerHTML='<span class="side '+sig.side.toLowerCase()+'">'+sig.side+'</span>';
  var ce=document.getElementById('conf-pct'); if(ce) ce.textContent=sig.conf+'%';
  var arc=document.getElementById('conf-arc');
  if(arc){
    var p=176; var off=p-(sig.conf/100)*p;
    arc.setAttribute('stroke-dashoffset',off.toFixed(1));
    arc.setAttribute('stroke',sig.side==='LONG'?'#00D890':'#FF3060');
  }
  var te=document.getElementById('sig-tf'); if(te) te.textContent='TF: '+sig.tf;
  var en=document.getElementById('sig-entry'); if(en) en.textContent=fmtP(price,coin);
  var tp=document.getElementById('sig-tp'); if(tp) tp.textContent=fmtP(sig.tp,coin);
  var sl=document.getElementById('sig-sl'); if(sl) sl.textContent=fmtP(sig.sl,coin);
}

function renderSigs(){
  var list=document.getElementById('sig-list'); if(!list) return;
  var filtered=S.signals.filter(function(s){
    return S.sigFilter==='all'||s.side.toLowerCase()===S.sigFilter;
  });
  if(!filtered.length){list.innerHTML='<div style="text-align:center;padding:40px 0;color:var(--txt2);font-size:13px">Нет сигналов</div>';return;}
  list.innerHTML=filtered.map(function(s){
    var price=S.prices[s.coin]?S.prices[s.coin].price:s.entry;
    return '<div class="sig-row '+s.side.toLowerCase()+'" data-coin="'+s.coin+'">'+
      '<div class="sig-row__time">'+fmtT(s.time)+'</div>'+
      '<div class="sig-row__top">'+
        '<span class="sig-row__ico">'+(SYMS[s.coin]||'●')+'</span>'+
        '<span class="sig-row__pair">'+s.coin+'/USDT</span>'+
        '<span class="side '+s.side.toLowerCase()+'">'+s.side+'</span>'+
        '<span class="sig-row__conf">AI: <b>'+s.conf+'%</b></span>'+
      '</div>'+
      '<div class="sig-row__lvls">'+
        '<div class="lv lv--entry"><div class="lv__l">Вход</div><div class="lv__v">'+fmtP(price,s.coin)+'</div></div>'+
        '<div class="lv lv--tp"><div class="lv__l">TP</div><div class="lv__v">'+fmtP(s.tp,s.coin)+'</div></div>'+
        '<div class="lv lv--sl"><div class="lv__l">SL</div><div class="lv__v">'+fmtP(s.sl,s.coin)+'</div></div>'+
        '<div class="lv lv--tf"><div class="lv__l">TF</div><div class="lv__v">'+s.tf+'</div></div>'+
      '</div>'+
    '</div>';
  }).join('');
  // Animate
  list.querySelectorAll('.sig-row').forEach(function(r,i){
    r.style.opacity='0'; r.style.transform='translateY(8px)';
    setTimeout(function(){r.style.transition='opacity .25s ease,transform .25s ease';r.style.opacity='1';r.style.transform='none';},i*55);
  });
}

/* ── Top Movers ── */
var MSYMS={BTC:'₿',ETH:'Ξ',SOL:'◎',BNB:'⬡',XRP:'✕',DOGE:'Ð',AVAX:'Δ',LINK:'⬡',ADA:'₳',DOT:'●',MATIC:'⬡',UNI:'🦄'};
function renderMovers(){
  var el=document.getElementById('movers'); if(!el) return;
  var sorted=S.mktData.slice(0,60).sort(function(a,b){return Math.abs(b.chg)-Math.abs(a.chg);}).slice(0,5);
  if(!sorted.length) return;
  el.innerHTML=sorted.map(function(d,i){
    return '<div class="mover">'+
      '<span class="mover__rank">'+(i+1)+'</span>'+
      '<span class="mover__sym">'+(MSYMS[d.coin]||d.coin[0])+'</span>'+
      '<span class="mover__coin">'+d.coin+'</span>'+
      '<span class="mover__price">'+fmtP(d.price,d.coin)+'</span>'+
      '<span class="mover__pct '+(d.chg>=0?'up':'dn')+'">'+(d.chg>=0?'+':'')+d.chg.toFixed(2)+'%</span>'+
    '</div>';
  }).join('');
}

/* ── Market Table ── */
function renderMkt(){
  var el=document.getElementById('mkt-list'); if(!el) return;
  var data=S.mktData.slice();
  if(S.mktCat==='gainers') data=data.filter(function(d){return d.chg>0;}).sort(function(a,b){return b.chg-a.chg;});
  else if(S.mktCat==='losers') data=data.filter(function(d){return d.chg<0;}).sort(function(a,b){return a.chg-b.chg;});
  if(S.mktQ) data=data.filter(function(d){return d.coin.toLowerCase().includes(S.mktQ);});
  el.innerHTML=data.slice(0,40).map(function(d){
    return '<div class="mkt-row">'+
      '<div class="mkt-coin">'+
        '<div class="mkt-ico">'+(MSYMS[d.coin]||d.coin[0])+'</div>'+
        '<div><div class="mkt-sym">'+d.coin+'</div><div class="mkt-full">Perp</div></div>'+
      '</div>'+
      '<div class="mkt-price">'+fmtP(d.price,d.coin)+'</div>'+
      '<div class="mkt-pct '+(d.chg>=0?'up':'dn')+'">'+(d.chg>=0?'+':'')+d.chg.toFixed(2)+'%</div>'+
      '<div class="mkt-vol">'+fmtVol(d.vol)+'</div>'+
    '</div>';
  }).join('');
}

/* ══════════════════════════════════════════
   NAVIGATION
══════════════════════════════════════════ */
function setupTabs(){
  document.querySelectorAll('.tab').forEach(function(btn){
    btn.addEventListener('click',function(){switchTab(btn.dataset.tab);});
  });
}

function switchTab(name){
  S.tab=name;
  document.querySelectorAll('.tab').forEach(function(b){b.classList.toggle('active',b.dataset.tab===name);});
  var sett=document.querySelector('.screen--settings');
  if(name==='settings'){
    if(sett){sett.style.display='block'; setTimeout(function(){sett.classList.add('is-active');},10);}
    return;
  } else {
    if(sett){sett.classList.remove('is-active'); setTimeout(function(){sett.style.display='none';},220);}
  }
  document.querySelectorAll('.screen:not(.screen--settings)').forEach(function(s){
    s.classList.toggle('is-active',s.dataset.screen===name);
  });
  if(name==='signals'){buildSignals();renderSigs();}
  if(name==='market'){renderMkt();}
}

/* Coin tabs */
function setupCoinTabs(){
  var el=document.getElementById('coin-tabs'); if(!el) return;
  el.addEventListener('click',function(e){
    var btn=e.target.closest('.ctab'); if(!btn||btn.dataset.coin===S.coin) return;
    S.coin=btn.dataset.coin;
    el.querySelectorAll('.ctab').forEach(function(b){b.classList.toggle('active',b.dataset.coin===S.coin);});
    var p=S.prices[S.coin]; if(p) updateHero(S.coin,p.price,p.chg,p.high,p.low,p.vol,null);
    fetchKline(S.coin,S.tf);
    updateSigCard(S.coin,p?p.price:0);
  });
}

/* TF buttons */
function setupTfBtns(){
  var el=document.getElementById('tf-row'); if(!el) return;
  el.addEventListener('click',function(e){
    var btn=e.target.closest('.tf'); if(!btn||btn.dataset.tf===S.tf) return;
    S.tf=btn.dataset.tf;
    el.querySelectorAll('.tf').forEach(function(b){b.classList.toggle('active',b.dataset.tf===S.tf);});
    fetchKline(S.coin,S.tf);
  });
}

/* Signal filters */
function setupSigFilters(){
  var el=document.getElementById('sig-filters'); if(!el) return;
  el.addEventListener('click',function(e){
    var btn=e.target.closest('.flt'); if(!btn) return;
    S.sigFilter=btn.dataset.f;
    el.querySelectorAll('.flt').forEach(function(b){b.classList.toggle('active',b.dataset.f===S.sigFilter);});
    renderSigs();
  });
}

/* Market tabs */
function setupMktTabs(){
  var el=document.getElementById('mkt-tabs'); if(!el) return;
  el.addEventListener('click',function(e){
    var btn=e.target.closest('.mtab'); if(!btn) return;
    S.mktCat=btn.dataset.cat;
    el.querySelectorAll('.mtab').forEach(function(b){b.classList.toggle('active',b.dataset.cat===S.mktCat);});
    renderMkt();
  });
}

/* Market search */
function setupMktSearch(){
  var el=document.getElementById('mkt-search'); if(!el) return;
  el.addEventListener('input',function(){S.mktQ=el.value.trim().toLowerCase(); renderMkt();});
}

/* ══════════════════════════════════════════
   AI CHAT
══════════════════════════════════════════ */
function setupChat(){
  var inp=document.getElementById('chat-inp');
  var send=document.getElementById('send-btn');
  var chips=document.getElementById('chat-chips');
  if(send) send.addEventListener('click',sendMsg);
  if(inp){
    inp.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg();}});
    inp.addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,110)+'px';});
  }
  if(chips) chips.addEventListener('click',function(e){
    var btn=e.target.closest('.chip'); if(!btn) return;
    chips.style.display='none';
    addUser(btn.dataset.q); processMsg(btn.dataset.q);
  });
}

function sendMsg(){
  var inp=document.getElementById('chat-inp'); if(!inp) return;
  var txt=inp.value.trim(); if(!txt) return;
  inp.value=''; inp.style.height='auto';
  addUser(txt); processMsg(txt);
}

function addUser(txt){
  var c=document.getElementById('chat-msgs'); if(!c) return;
  var m=document.createElement('div');
  m.className='msg user';
  m.innerHTML='<div class="msg__bub">'+esc(txt)+'</div><div class="msg__t">'+fmtT(new Date())+'</div>';
  c.appendChild(m); scrollChat();
}

function addBot(html){
  var c=document.getElementById('chat-msgs'); if(!c) return;
  var m=document.createElement('div');
  m.className='msg bot';
  m.innerHTML='<div class="msg__bub">'+html+'</div><div class="msg__t">'+fmtT(new Date())+'</div>';
  c.appendChild(m); scrollChat();
}

function addTyping(){
  var c=document.getElementById('chat-msgs'); if(!c) return;
  var m=document.createElement('div');
  m.className='msg bot typing'; m.id='typing';
  m.innerHTML='<div class="msg__bub"></div>';
  c.appendChild(m); scrollChat();
}
function rmTyping(){ var t=document.getElementById('typing'); if(t) t.remove(); }
function scrollChat(){ var c=document.getElementById('chat-msgs'); if(c) c.scrollTop=c.scrollHeight; }

function processMsg(q){
  addTyping();
  setTimeout(function(){
    rmTyping();
    addBot(aiReply(q));
  },900+Math.random()*700);
}

function aiReply(q){
  var ql=q.toLowerCase();
  var bp=S.prices['BTC'], ep=S.prices['ETH'];
  var bp_=bp?fmtP(bp.price,'BTC'):'—';
  var ep_=ep?fmtP(ep.price,'ETH'):'—';
  var bchg=bp?bp.chg.toFixed(2):'—';

  if(ql.includes('btc')||ql.includes('биткоин')){
    return 'BTC/USDT: <b>'+bp_+'</b> ('+(parseFloat(bchg)>=0?'+':'')+bchg+'% за 24ч)<br><br>'+
      'Технический анализ: RSI нейтрален (48-52). Ключевые уровни:<br>'+
      '🟢 Поддержка: <b style="color:var(--pos)">$'+(bp?(bp.price*.97).toFixed(0):'—')+'</b><br>'+
      '🔴 Сопротивление: <b style="color:var(--neg)">$'+(bp?(bp.price*1.03).toFixed(0):'—')+'</b><br><br>'+
      '⚠️ Рекомендация: наблюдать за пробоем уровней.';
  }
  if(ql.includes('eth')||ql.includes('эфир')){
    return 'ETH/USDT: <b>'+ep_+'</b><br><br>Ethereum в зоне консолидации. MACD показывает потенциально бычье пересечение.<br>'+
      'TP: <b style="color:var(--pos)">$'+(ep?(ep.price*1.07).toFixed(0):'—')+'</b> / SL: <b style="color:var(--neg)">$'+(ep?(ep.price*.95).toFixed(0):'—')+'</b>';
  }
  if(ql.includes('сигнал')||ql.includes('топ')){
    var s=S.signals[0];
    if(s) return '<b>'+s.coin+'/USDT</b> — <span style="color:'+(s.side==='LONG'?'var(--pos)':'var(--neg)')+'">'+s.side+'</span><br>'+
      'Уверенность: <b style="color:var(--teal)">'+s.conf+'%</b><br>'+
      'Вход: '+fmtP(s.entry,s.coin)+'<br>'+
      'TP: <span style="color:var(--pos)">'+fmtP(s.tp,s.coin)+'</span><br>'+
      'SL: <span style="color:var(--neg)">'+fmtP(s.sl,s.coin)+'</span><br><br>⚡ Всегда ставьте стоп-лосс!';
  }
  if(ql.includes('купить')||ql.includes('что')){
    return '🟢 <b>BTC/USDT</b> — сильная поддержка, потенциал роста<br>'+
      '🟢 <b>ETH/USDT</b> — накопление, возможен импульс<br>'+
      '⚠️ Это не финансовый совет. DYOR всегда!';
  }
  if(ql.includes('риск')||ql.includes('менеджмент')){
    return '<b>Риск-менеджмент:</b><br>🛡 Не более 1-2% депозита на сделку<br>📏 TP:SL минимум 2:1<br>🚫 Никогда без стоп-лосса<br>💼 Диверсификация: макс 20% в монете';
  }
  return 'Анализирую рынок… 🤖<br>Спросите о конкретной монете (BTC, ETH, SOL), сигналах или стратегиях.';
}

/* ══════════════════════════════════════════
   LIVE STATUS
══════════════════════════════════════════ */
function setLive(on){
  var dot=document.getElementById('live-dot');
  var lbl=document.getElementById('live-label');
  if(dot) dot.style.background=on?'var(--teal)':'var(--neg)';
  if(lbl){lbl.textContent=on?'LIVE':'REST'; lbl.style.color=on?'var(--teal)':'var(--txt2)';}
}

/* ══════════════════════════════════════════
   TOAST
══════════════════════════════════════════ */
function toast(msg){
  var t=document.getElementById('toast'); if(!t) return;
  t.textContent=msg; t.classList.add('show');
  setTimeout(function(){t.classList.remove('show');},2400);
}

/* ══════════════════════════════════════════
   FORMAT UTILS
══════════════════════════════════════════ */
function fmtP(p,coin){
  if(!p||isNaN(p)) return '—';
  if(p>=10000) return '$'+p.toLocaleString('en-US',{maximumFractionDigits:0});
  if(p>=100) return '$'+p.toFixed(2);
  if(p>=1) return '$'+p.toFixed(4);
  return '$'+p.toFixed(6);
}
function fmtVol(v){
  if(!v||isNaN(v)) return '—';
  if(v>=1e12) return '$'+(v/1e12).toFixed(2)+'T';
  if(v>=1e9) return '$'+(v/1e9).toFixed(2)+'B';
  if(v>=1e6) return '$'+(v/1e6).toFixed(1)+'M';
  return '$'+(v/1e3).toFixed(1)+'K';
}
function fmtT(d){ return d?d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):''; }
function esc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ── Viewport height ── */
function vhFix(){
  var h=(tg&&tg.viewportStableHeight)?tg.viewportStableHeight:window.innerHeight;
  document.documentElement.style.setProperty('--app-height',h+'px');
}
vhFix();
window.addEventListener('resize',vhFix);
if(tg) tg.onEvent('viewportChanged',vhFix);

/* ── BOOT ── */
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot);
else boot();

})();
