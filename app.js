/* =====================================================
   QUANTSIGNAL AI v18 — Professional App Engine
   No localStorage/sessionStorage/cookies. Pure memory.
   Live data: Bybit V5 REST + WebSocket
   ===================================================== */
(function () {
  'use strict';

  /* ---- Telegram WebApp init ---- */
  var tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
  if (tg) {
    tg.ready();
    tg.expand();
    if (tg.setHeaderColor) tg.setHeaderColor('#050A12');
    if (tg.setBackgroundColor) tg.setBackgroundColor('#050A12');
  }

  /* =========================================================
     STATE
  ========================================================= */
  var state = {
    activeCoin: 'BTC',
    activeTf: '5m',
    activeTab: 'overview',
    sigFilter: 'all',
    marketCategory: 'all',
    prices: {},
    signals: [],
    marketData: [],
    connected: false,
    ws: null
  };

  /* =========================================================
     CANVAS — Circuit Board Background
  ========================================================= */
  function initCircuitBg() {
    var canvas = document.getElementById('bg-circuit');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var W, H;

    function resize() {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    // Grid dots + lines
    function draw() {
      ctx.clearRect(0, 0, W, H);
      var spacing = 32;
      var cols = Math.ceil(W / spacing) + 1;
      var rows = Math.ceil(H / spacing) + 1;

      // Faint grid lines
      ctx.strokeStyle = 'rgba(30, 200, 220, 0.06)';
      ctx.lineWidth = 0.5;
      for (var c = 0; c < cols; c++) {
        ctx.beginPath();
        ctx.moveTo(c * spacing, 0);
        ctx.lineTo(c * spacing, H);
        ctx.stroke();
      }
      for (var r = 0; r < rows; r++) {
        ctx.beginPath();
        ctx.moveTo(0, r * spacing);
        ctx.lineTo(W, r * spacing);
        ctx.stroke();
      }

      // Circuit dots at intersections
      ctx.fillStyle = 'rgba(30, 200, 220, 0.15)';
      for (var ci = 0; ci < cols; ci++) {
        for (var ri = 0; ri < rows; ri++) {
          // Only some intersections get dots
          if ((ci + ri) % 4 === 0) {
            ctx.beginPath();
            ctx.arc(ci * spacing, ri * spacing, 1.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // Highlight some circuit traces (random-ish paths)
      ctx.strokeStyle = 'rgba(30, 200, 220, 0.12)';
      ctx.lineWidth = 1;
      var traces = [
        {x: 0, y: 3, len: 5, dir: 'h'},
        {x: 5, y: 3, len: 4, dir: 'v'},
        {x: 10, y: 0, len: 8, dir: 'h'},
        {x: 2, y: 6, len: 6, dir: 'h'},
        {x: 8, y: 2, len: 3, dir: 'v'},
        {x: 1, y: 9, len: 10, dir: 'h'},
        {x: 11, y: 5, len: 4, dir: 'v'},
      ];
      traces.forEach(function(t) {
        ctx.beginPath();
        ctx.moveTo(t.x * spacing, t.y * spacing);
        if (t.dir === 'h') {
          ctx.lineTo((t.x + t.len) * spacing, t.y * spacing);
        } else {
          ctx.lineTo(t.x * spacing, (t.y + t.len) * spacing);
        }
        ctx.stroke();
      });

      // Orange accent traces
      ctx.strokeStyle = 'rgba(255, 128, 0, 0.08)';
      var orangeTraces = [
        {x: 7, y: 1, len: 4, dir: 'v'},
        {x: 3, y: 5, len: 5, dir: 'h'},
      ];
      orangeTraces.forEach(function(t) {
        ctx.beginPath();
        ctx.moveTo(t.x * spacing, t.y * spacing);
        if (t.dir === 'h') {
          ctx.lineTo((t.x + t.len) * spacing, t.y * spacing);
        } else {
          ctx.lineTo(t.x * spacing, (t.y + t.len) * spacing);
        }
        ctx.stroke();
      });
    }

    draw();
  }

  /* =========================================================
     SPLASH CANVAS — Particle Animation
  ========================================================= */
  function initSplashCanvas() {
    var canvas = document.getElementById('splash-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    var particles = [];
    for (var i = 0; i < 60; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.5 + 0.5,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        a: Math.random() * 0.5 + 0.2,
        col: Math.random() > 0.3 ? '#1EC8DC' : '#FF8000'
      });
    }

    var animId;
    function animateSplash() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(function(p) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.col;
        ctx.globalAlpha = p.a;
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      animId = requestAnimationFrame(animateSplash);
    }
    animateSplash();

    // Store cancel fn
    window._stopSplashAnim = function() { cancelAnimationFrame(animId); };
  }

  /* =========================================================
     BOOT SEQUENCE
  ========================================================= */
  function boot() {
    initSplashCanvas();
    initCircuitBg();

    var bar = document.getElementById('splash-bar');
    var status = document.getElementById('splash-status');
    var splash = document.getElementById('splash');

    var steps = [
      {p: 20, s: 'Connecting to Bybit…'},
      {p: 45, s: 'Loading market data…'},
      {p: 65, s: 'Fetching AI signals…'},
      {p: 85, s: 'Initializing neural engine…'},
      {p: 100, s: 'Ready!'}
    ];
    var i = 0;

    function nextStep() {
      if (i >= steps.length) {
        // Hide splash
        setTimeout(function() {
          splash.classList.add('is-hidden');
          if (window._stopSplashAnim) window._stopSplashAnim();
          // Launch app
          initApp();
        }, 300);
        return;
      }
      var step = steps[i++];
      if (bar) bar.style.width = step.p + '%';
      if (status) status.textContent = step.s;
      setTimeout(nextStep, 350 + Math.random() * 200);
    }

    setTimeout(nextStep, 300);
  }

  /* =========================================================
     APP INITIALIZATION
  ========================================================= */
  function initApp() {
    setupTabBar();
    setupCoinSelector();
    setupTfSelector();
    setupSignalFilters();
    setupMarketTabs();
    setupMarketSearch();
    setupChatInput();
    setupChatSuggestions();

    fetchAllMarketData();
    generateSignals();

    // Connect WebSocket for live price
    connectWS();

    // Refresh button
    var btnRefresh = document.getElementById('btn-refresh');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', function() {
        btnRefresh.classList.add('spinning');
        fetchAllMarketData();
        setTimeout(function() { btnRefresh.classList.remove('spinning'); }, 1000);
        showToast('Market data refreshed');
      });
    }
  }

  /* =========================================================
     WEBSOCKET — Live Prices
  ========================================================= */
  function connectWS() {
    try {
      var ws = new WebSocket('wss://stream.bybit.com/v5/public/linear');
      state.ws = ws;

      ws.onopen = function() {
        state.connected = true;
        setConnStatus(true);
        // Subscribe to BTC ETH SOL BNB XRP
        ws.send(JSON.stringify({
          op: 'subscribe',
          args: [
            'tickers.BTCUSDT',
            'tickers.ETHUSDT',
            'tickers.SOLUSDT',
            'tickers.BNBUSDT',
            'tickers.XRPUSDT'
          ]
        }));
      };

      ws.onmessage = function(e) {
        try {
          var d = JSON.parse(e.data);
          if (d.topic && d.data) {
            handleWSTicker(d.topic, d.data);
          }
        } catch(err) {}
      };

      ws.onerror = function() { setConnStatus(false); };
      ws.onclose = function() {
        state.connected = false;
        setConnStatus(false);
        // Reconnect after 5s
        setTimeout(connectWS, 5000);
      };
    } catch(e) { setConnStatus(false); }
  }

  function handleWSTicker(topic, data) {
    var coin = topic.replace('tickers.', '').replace('USDT', '');
    var price = parseFloat(data.lastPrice || data.markPrice || 0);
    var change24h = parseFloat(data.price24hPcnt || 0) * 100;
    var high = parseFloat(data.highPrice24h || 0);
    var low = parseFloat(data.lowPrice24h || 0);
    var vol = parseFloat(data.volume24h || 0) * price;

    if (!price) return;

    var prev = state.prices[coin];
    state.prices[coin] = { price: price, change24h: change24h, high: high, low: low, vol: vol };

    // Update ticker tape
    var tickEl = document.getElementById('tick-' + coin.toLowerCase());
    if (tickEl) {
      tickEl.textContent = formatPrice(price, coin);
      tickEl.className = change24h >= 0 ? 'pos' : 'neg';
    }

    // If this is active coin, update hero
    if (coin === state.activeCoin) {
      updateHeroCard(coin, price, change24h, high, low, vol, prev ? prev.price : null);
      updateSignalPanel(coin, price);
    }
  }

  /* =========================================================
     FETCH ALL MARKET DATA (REST fallback)
  ========================================================= */
  function fetchAllMarketData() {
    // Bybit V5 tickers
    fetch('https://api.bybit.com/v5/market/tickers?category=linear&limit=200')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d.result || !d.result.list) return;
        var list = d.result.list;
        var coins = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'LINK', 'DOT', 'MATIC', 'UNI', 'LTC', 'ATOM'];

        // Update state prices
        list.forEach(function(item) {
          var sym = item.symbol;
          if (!sym.endsWith('USDT')) return;
          var coin = sym.replace('USDT', '');
          var price = parseFloat(item.lastPrice || 0);
          var change = parseFloat(item.price24hPcnt || 0) * 100;
          var high = parseFloat(item.highPrice24h || 0);
          var low = parseFloat(item.lowPrice24h || 0);
          var vol = parseFloat(item.volume24h || 0) * price;
          state.prices[coin] = { price: price, change24h: change, high: high, low: low, vol: vol };
        });

        // Update hero for active coin
        var c = state.activeCoin;
        var p = state.prices[c];
        if (p) {
          updateHeroCard(c, p.price, p.change24h, p.high, p.low, p.vol, null);
          updateSignalPanel(c, p.price);
        }

        // Update ticker tape with initial data
        ['BTC','ETH','SOL','BNB','XRP'].forEach(function(coin) {
          var d2 = state.prices[coin];
          if (!d2) return;
          var el = document.getElementById('tick-' + coin.toLowerCase());
          if (el) {
            el.textContent = formatPrice(d2.price, coin);
            el.className = d2.change24h >= 0 ? 'pos' : 'neg';
          }
        });

        // Build market table data
        state.marketData = [];
        list.forEach(function(item) {
          var sym = item.symbol;
          if (!sym.endsWith('USDT')) return;
          var coin = sym.replace('USDT', '');
          state.marketData.push({
            coin: coin,
            price: parseFloat(item.lastPrice || 0),
            change24h: parseFloat(item.price24hPcnt || 0) * 100,
            vol: parseFloat(item.volume24h || 0) * parseFloat(item.lastPrice || 0)
          });
        });
        state.marketData.sort(function(a, b) { return b.vol - a.vol; });
        renderMarketTable();

        // Top movers
        renderTopMovers();

      })
      .catch(function() { setConnStatus(false); });

    // Fetch kline for chart
    fetchKline(state.activeCoin, state.activeTf);

    // Fetch market matrix data
    fetchMarketMatrix();
  }

  /* =========================================================
     KLINE / CHART
  ========================================================= */
  function fetchKline(coin, tf) {
    var intervalMap = {'1m':'1','5m':'5','15m':'15','1h':'60','4h':'240','1d':'D'};
    var interval = intervalMap[tf] || '5';
    var url = 'https://api.bybit.com/v5/market/kline?category=linear&symbol=' + coin + 'USDT&interval=' + interval + '&limit=50';

    fetch(url)
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d.result || !d.result.list) return;
        var raw = d.result.list.reverse(); // oldest first
        var prices = raw.map(function(k) { return parseFloat(k[4]); }); // close prices
        renderMiniChart(prices);
      })
      .catch(function() {});
  }

  function renderMiniChart(closes) {
    if (!closes || closes.length < 2) return;
    var svg = document.getElementById('hero-chart');
    var lineEl = document.getElementById('chart-line');
    var areaEl = document.getElementById('chart-area');
    if (!svg || !lineEl) return;

    var W = 300, H = 80;
    var min = Math.min.apply(Math, closes);
    var max = Math.max.apply(Math, closes);
    var range = max - min || 1;
    var n = closes.length;
    var pad = 4;

    var pts = closes.map(function(v, i) {
      var x = (i / (n - 1)) * W;
      var y = H - pad - ((v - min) / range) * (H - pad * 2);
      return [x, y];
    });

    var linePath = 'M ' + pts.map(function(p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L ');
    var areaPath = linePath + ' L ' + W + ' ' + H + ' L 0 ' + H + ' Z';

    lineEl.setAttribute('d', linePath);
    areaEl.setAttribute('d', areaPath);

    // Color based on trend
    var isUp = closes[closes.length - 1] >= closes[0];
    lineEl.setAttribute('stroke', isUp ? '#1EC8DC' : '#FF3060');
    var grad = document.getElementById('chartGrad');
    if (grad) {
      grad.children[0].setAttribute('stop-color', isUp ? 'rgba(30,200,220,0.35)' : 'rgba(255,48,96,0.25)');
      grad.children[1].setAttribute('stop-color', 'rgba(0,0,0,0)');
    }
  }

  /* =========================================================
     MARKET MATRIX
  ========================================================= */
  function fetchMarketMatrix() {
    // Fear & Greed
    fetch('https://api.alternative.me/fng/?limit=1')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d.data || !d.data[0]) return;
        var val = parseInt(d.data[0].value);
        var label = d.data[0].value_classification;
        var el = document.getElementById('mx-fng');
        var lel = document.getElementById('mx-fng-label');
        var bar = document.getElementById('mx-fng-bar');
        if (el) el.textContent = val;
        if (lel) lel.textContent = label;
        if (bar) bar.style.width = val + '%';
        // Color
        if (el) el.style.color = val < 25 ? 'var(--neg)' : val > 75 ? 'var(--pos)' : 'var(--text-0)';
      })
      .catch(function() {});

    // Global market cap from CoinGecko
    fetch('https://api.coingecko.com/api/v3/global')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d.data) return;
        var cap = d.data.total_market_cap && d.data.total_market_cap.usd;
        var dom = d.data.market_cap_percentage && d.data.market_cap_percentage.btc;
        var capChg = d.data.market_cap_change_percentage_24h_usd;

        var capEl = document.getElementById('mx-cap');
        var capChgEl = document.getElementById('mx-cap-chg');
        var domEl = document.getElementById('mx-dom');
        var domBar = document.getElementById('mx-dom-bar');

        if (capEl && cap) capEl.textContent = formatVolume(cap);
        if (capChgEl && capChg) {
          var chgStr = (capChg > 0 ? '+' : '') + capChg.toFixed(1) + '%';
          capChgEl.textContent = chgStr;
          capChgEl.style.color = capChg >= 0 ? 'var(--pos)' : 'var(--neg)';
        }
        if (domEl && dom) domEl.textContent = dom.toFixed(1) + '%';
        if (domBar && dom) domBar.style.width = Math.min(dom, 100) + '%';
      })
      .catch(function() {});

    // Funding rate from Bybit
    fetch('https://api.bybit.com/v5/market/funding/history?category=linear&symbol=BTCUSDT&limit=1')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (!d.result || !d.result.list || !d.result.list[0]) return;
        var rate = parseFloat(d.result.list[0].fundingRate) * 100;
        var el = document.getElementById('mx-fund');
        if (el) {
          el.textContent = (rate > 0 ? '+' : '') + rate.toFixed(4) + '%';
          el.style.color = rate > 0 ? 'var(--pos)' : rate < 0 ? 'var(--neg)' : 'var(--text-0)';
        }
      })
      .catch(function() {});
  }

  /* =========================================================
     HERO CARD UPDATE
  ========================================================= */
  function updateHeroCard(coin, price, change24h, high, low, vol, prevPrice) {
    var priceEl = document.getElementById('hero-price');
    var deltaEl = document.getElementById('hero-delta');
    var pairEl  = document.getElementById('hero-pair');
    var volEl   = document.getElementById('stat-vol');
    var highEl  = document.getElementById('stat-high');
    var lowEl   = document.getElementById('stat-low');
    var oiEl    = document.getElementById('stat-oi');

    if (pairEl) pairEl.textContent = coin + ' / USDT';
    if (priceEl) {
      priceEl.textContent = formatPrice(price, coin);
      if (prevPrice !== null) {
        var cls = price > prevPrice ? 'flash-up' : price < prevPrice ? 'flash-dn' : '';
        if (cls) {
          priceEl.classList.add(cls);
          setTimeout(function() { priceEl.classList.remove(cls); }, 500);
        }
      }
    }
    if (deltaEl) {
      var sign = change24h >= 0 ? '+' : '';
      deltaEl.textContent = sign + change24h.toFixed(2) + '%';
      deltaEl.className = 'price-block__delta ' + (change24h >= 0 ? 'pos' : 'neg');
    }
    if (volEl) volEl.textContent = formatVolume(vol);
    if (highEl) highEl.textContent = formatPrice(high, coin);
    if (lowEl) lowEl.textContent = formatPrice(low, coin);
    if (oiEl) {
      // Estimated OI from Bybit
      fetch('https://api.bybit.com/v5/market/open-interest?category=linear&symbol=' + coin + 'USDT&intervalTime=5min&limit=1')
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.result && d.result.list && d.result.list[0]) {
            var oi = parseFloat(d.result.list[0].openInterest) * price;
            oiEl.textContent = formatVolume(oi);
          }
        })
        .catch(function() { oiEl.textContent = '—'; });
    }
  }

  /* =========================================================
     SIGNAL PANEL (AI Signal on Overview)
  ========================================================= */
  function updateSignalPanel(coin, price) {
    var sig = state.signals.find(function(s) { return s.coin === coin; });
    if (!sig) sig = generateSignalForCoin(coin, price);

    var pairEl = document.getElementById('sig-pair');
    var sideEl = document.getElementById('sig-side');
    var confEl = document.getElementById('sig-conf');
    var entryEl = document.getElementById('sig-entry');
    var tpEl = document.getElementById('sig-tp');
    var slEl = document.getElementById('sig-sl');
    var arcEl = document.getElementById('ring-arc');

    if (pairEl) pairEl.textContent = coin + '/USDT';
    if (sideEl) {
      sideEl.innerHTML = '<span class="side-badge side-badge--' + (sig.side === 'LONG' ? 'long' : 'short') + '">' + sig.side + '</span>';
    }
    if (confEl) confEl.textContent = sig.confidence + '%';
    if (entryEl) entryEl.textContent = formatPrice(price, coin);
    if (tpEl) tpEl.textContent = formatPrice(sig.tp, coin);
    if (slEl) slEl.textContent = formatPrice(sig.sl, coin);

    // Update ring arc
    if (arcEl) {
      var perim = 163.4;
      var offset = perim - (sig.confidence / 100) * perim;
      arcEl.setAttribute('stroke-dashoffset', offset.toFixed(1));
      arcEl.setAttribute('stroke', sig.side === 'LONG' ? '#00D890' : '#FF3060');
    }
  }

  /* =========================================================
     SIGNALS GENERATION (AI-style)
  ========================================================= */
  var COIN_SYMBOLS = {
    BTC: '₿', ETH: 'Ξ', SOL: '◎', BNB: '⬡', XRP: '✕',
    ADA: '₳', DOGE: 'Ð', AVAX: 'Δ', LINK: '⬡', DOT: '●'
  };
  var SIGNAL_COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'LINK'];

  function generateSignalForCoin(coin, price) {
    if (!price) price = state.prices[coin] ? state.prices[coin].price : 0;
    var side = Math.random() > 0.45 ? 'LONG' : 'SHORT';
    var confidence = 65 + Math.floor(Math.random() * 30);
    var slPct = 0.008 + Math.random() * 0.012;
    var tpPct = slPct * (2 + Math.random() * 2);
    var tp = side === 'LONG' ? price * (1 + tpPct) : price * (1 - tpPct);
    var sl = side === 'LONG' ? price * (1 - slPct) : price * (1 + slPct);
    var tf = ['15м', '1ч', '4ч'][Math.floor(Math.random() * 3)];
    var sig = { coin: coin, side: side, confidence: confidence, entry: price, tp: tp, sl: sl, tf: tf, time: new Date() };
    // Update in state
    var idx = state.signals.findIndex(function(s) { return s.coin === coin; });
    if (idx >= 0) state.signals[idx] = sig;
    else state.signals.push(sig);
    return sig;
  }

  function generateSignals() {
    // Generate signals for all coins once prices load
    // Will update when prices arrive
    SIGNAL_COINS.forEach(function(coin) {
      var p = state.prices[coin];
      generateSignalForCoin(coin, p ? p.price : 0);
    });
    renderSignalsList();

    // Refresh signals every 30s
    setInterval(function() {
      SIGNAL_COINS.forEach(function(coin) {
        var p = state.prices[coin];
        if (p) generateSignalForCoin(coin, p.price);
      });
      renderSignalsList();
    }, 30000);
  }

  function renderSignalsList() {
    var list = document.getElementById('signals-list');
    if (!list) return;

    var filtered = state.signals.filter(function(s) {
      if (state.sigFilter === 'all') return true;
      return s.side.toLowerCase() === state.sigFilter;
    });

    if (!filtered.length) {
      list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-2);font-size:13px;">No signals available</div>';
      return;
    }

    list.innerHTML = filtered.map(function(sig) {
      var price = state.prices[sig.coin] ? state.prices[sig.coin].price : sig.entry;
      var timeStr = formatTime(sig.time);
      return '<div class="signal-row ' + sig.side.toLowerCase() + '" data-coin="' + sig.coin + '">' +
        '<div class="signal-row__time">' + timeStr + '</div>' +
        '<div class="signal-row__top">' +
          '<span style="font-size:18px">' + (COIN_SYMBOLS[sig.coin] || '●') + '</span>' +
          '<span class="signal-row__pair">' + sig.coin + '/USDT</span>' +
          '<span class="side-badge side-badge--' + (sig.side === 'LONG' ? 'long' : 'short') + '">' + sig.side + '</span>' +
          '<span class="signal-row__conf">AI: <span>' + sig.confidence + '%</span></span>' +
        '</div>' +
        '<div class="signal-row__levels">' +
          '<div class="level-item level-item--entry"><div class="level-item__label">Entry</div><div class="level-item__val">' + formatPrice(price, sig.coin) + '</div></div>' +
          '<div class="level-item level-item--tp"><div class="level-item__label">TP</div><div class="level-item__val">' + formatPrice(sig.tp, sig.coin) + '</div></div>' +
          '<div class="level-item level-item--sl"><div class="level-item__label">SL</div><div class="level-item__val">' + formatPrice(sig.sl, sig.coin) + '</div></div>' +
          '<div class="level-item"><div class="level-item__label">TF</div><div class="level-item__val" style="color:var(--teal)">' + sig.tf + '</div></div>' +
        '</div>' +
      '</div>';
    }).join('');

    // Animate in
    var rows = list.querySelectorAll('.signal-row');
    rows.forEach(function(row, i) {
      row.style.opacity = '0';
      row.style.transform = 'translateY(10px)';
      setTimeout(function() {
        row.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        row.style.opacity = '1';
        row.style.transform = 'none';
      }, i * 60);
    });
  }

  /* =========================================================
     TOP MOVERS
  ========================================================= */
  var MOVER_SYMBOLS = {BTC:'₿',ETH:'Ξ',SOL:'◎',BNB:'⬡',XRP:'✕',DOGE:'Ð',AVAX:'Δ',LINK:'⬡',ADA:'₳',DOT:'●',MATIC:'⬡',UNI:'🦄'};

  function renderTopMovers() {
    var list = document.getElementById('movers-list');
    if (!list) return;

    var sorted = state.marketData.slice(0, 50).sort(function(a, b) {
      return Math.abs(b.change24h) - Math.abs(a.change24h);
    });
    var top5 = sorted.slice(0, 5);

    if (!top5.length) return;

    list.innerHTML = top5.map(function(item, i) {
      return '<div class="mover-item">' +
        '<span class="mover-item__rank">' + (i + 1) + '</span>' +
        '<span class="mover-item__sym">' + (MOVER_SYMBOLS[item.coin] || '●') + '</span>' +
        '<span class="mover-item__coin">' + item.coin + '</span>' +
        '<span class="mover-item__price">' + formatPrice(item.price, item.coin) + '</span>' +
        '<span class="mover-item__delta ' + (item.change24h >= 0 ? 'pos' : 'neg') + '">' +
          (item.change24h >= 0 ? '+' : '') + item.change24h.toFixed(2) + '%' +
        '</span>' +
      '</div>';
    }).join('');
  }

  /* =========================================================
     MARKET TABLE
  ========================================================= */
  var marketSearchQuery = '';

  function renderMarketTable() {
    var table = document.getElementById('market-table');
    if (!table) return;

    var data = state.marketData.slice();

    // Filter by category
    if (state.marketCategory === 'gainers') {
      data = data.filter(function(d) { return d.change24h > 0; })
                 .sort(function(a,b) { return b.change24h - a.change24h; });
    } else if (state.marketCategory === 'losers') {
      data = data.filter(function(d) { return d.change24h < 0; })
                 .sort(function(a,b) { return a.change24h - b.change24h; });
    }

    // Search
    if (marketSearchQuery) {
      data = data.filter(function(d) {
        return d.coin.toLowerCase().includes(marketSearchQuery);
      });
    }

    var top = data.slice(0, 40);

    table.innerHTML = top.map(function(item) {
      return '<div class="market-row">' +
        '<div class="market-row__coin">' +
          '<div class="market-row__sym">' + (MOVER_SYMBOLS[item.coin] || item.coin[0]) + '</div>' +
          '<div><div class="market-row__name">' + item.coin + '</div><div class="market-row__full">Perp</div></div>' +
        '</div>' +
        '<div class="market-row__price">' + formatPrice(item.price, item.coin) + '</div>' +
        '<div class="market-row__pct ' + (item.change24h >= 0 ? 'pos' : 'neg') + '">' +
          (item.change24h >= 0 ? '+' : '') + item.change24h.toFixed(2) + '%' +
        '</div>' +
        '<div class="market-row__vol">' + formatVolume(item.vol) + '</div>' +
      '</div>';
    }).join('');
  }

  /* =========================================================
     AI CHAT
  ========================================================= */
  var GROQ_API_KEY = ''; // Leave blank — calls proxy endpoint or demo mode

  function setupChatInput() {
    var input = document.getElementById('chat-input');
    var send = document.getElementById('chat-send');
    if (!input || !send) return;

    send.addEventListener('click', function() { sendMessage(); });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    // Auto-resize
    input.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
  }

  function setupChatSuggestions() {
    var container = document.getElementById('chat-suggestions');
    if (!container) return;
    container.addEventListener('click', function(e) {
      var btn = e.target.closest('.suggestion');
      if (!btn) return;
      var query = btn.dataset.query;
      container.style.display = 'none';
      addUserMessage(query);
      processChatMessage(query);
    });
  }

  function sendMessage() {
    var input = document.getElementById('chat-input');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    addUserMessage(text);
    processChatMessage(text);
  }

  function addUserMessage(text) {
    var container = document.getElementById('chat-messages');
    if (!container) return;
    var msg = document.createElement('div');
    msg.className = 'msg msg--user';
    msg.innerHTML = '<div class="msg__bubble">' + escapeHtml(text) + '</div>' +
                    '<div class="msg__time">' + formatTime(new Date()) + '</div>';
    container.appendChild(msg);
    scrollChat();
  }

  function addBotMessage(text) {
    var container = document.getElementById('chat-messages');
    if (!container) return;
    var msg = document.createElement('div');
    msg.className = 'msg msg--bot';
    msg.innerHTML = '<div class="msg__bubble">' + text + '</div>' +
                    '<div class="msg__time">' + formatTime(new Date()) + '</div>';
    container.appendChild(msg);
    scrollChat();
  }

  function addTypingIndicator() {
    var container = document.getElementById('chat-messages');
    if (!container) return;
    var msg = document.createElement('div');
    msg.className = 'msg msg--bot msg--typing';
    msg.id = 'typing-indicator';
    msg.innerHTML = '<div class="msg__bubble"></div>';
    container.appendChild(msg);
    scrollChat();
  }

  function removeTypingIndicator() {
    var el = document.getElementById('typing-indicator');
    if (el) el.parentNode.removeChild(el);
  }

  function scrollChat() {
    var c = document.getElementById('chat-messages');
    if (c) c.scrollTop = c.scrollHeight;
  }

  function processChatMessage(query) {
    addTypingIndicator();
    // Generate AI-like response based on query keywords
    setTimeout(function() {
      removeTypingIndicator();
      var response = generateAIResponse(query);
      addBotMessage(response);
    }, 1000 + Math.random() * 800);
  }

  function generateAIResponse(query) {
    var q = query.toLowerCase();
    var btcPrice = state.prices['BTC'] ? formatPrice(state.prices['BTC'].price, 'BTC') : '—';
    var ethPrice = state.prices['ETH'] ? formatPrice(state.prices['ETH'].price, 'ETH') : '—';
    var btcChange = state.prices['BTC'] ? state.prices['BTC'].change24h.toFixed(2) : '—';

    if (q.includes('btc') || q.includes('биткоин') || q.includes('bitcoin')) {
      return 'BTC/USDT торгуется на уровне <b>' + btcPrice + '</b> (' + (parseFloat(btcChange) >= 0 ? '+' : '') + btcChange + '% за 24ч).<br><br>Технически: RSI на 4ч таймфрейме показывает нейтральную зону (45-55). Поддержка на $' + (state.prices['BTC'] ? (state.prices['BTC'].price * 0.97).toFixed(0) : '—') + ', сопротивление $' + (state.prices['BTC'] ? (state.prices['BTC'].price * 1.03).toFixed(0) : '—') + '.<br><br>AI-рекомендация: ⚠️ Удерживать позиции, ждать подтверждения пробоя.';
    }
    if (q.includes('eth') || q.includes('ethereum') || q.includes('эфир')) {
      return 'ETH/USDT: <b>' + ethPrice + '</b><br><br>Ethereum показывает признаки консолидации после недавнего движения. MACD пересекает сигнальную линию снизу — потенциально бычий сигнал. Уровни: поддержка <b style="color:var(--neg)">' + (state.prices['ETH'] ? (state.prices['ETH'].price * 0.95).toFixed(0) : '—') + '</b>, цель <b style="color:var(--pos)">' + (state.prices['ETH'] ? (state.prices['ETH'].price * 1.08).toFixed(0) : '—') + '</b>.';
    }
    if (q.includes('сигнал') || q.includes('signal') || q.includes('топ')) {
      var topSig = state.signals[0];
      if (topSig) {
        return 'Топ AI-сигнал прямо сейчас:<br><br>' +
          '<b>' + topSig.coin + '/USDT</b> — <span style="color:' + (topSig.side === 'LONG' ? 'var(--pos)' : 'var(--neg)') + '">' + topSig.side + '</span><br>' +
          'Уверенность: <b style="color:var(--teal)">' + topSig.confidence + '%</b><br>' +
          'Вход: ' + formatPrice(topSig.entry, topSig.coin) + '<br>' +
          'Цель: <span style="color:var(--pos)">' + formatPrice(topSig.tp, topSig.coin) + '</span><br>' +
          'Стоп: <span style="color:var(--neg)">' + formatPrice(topSig.sl, topSig.coin) + '</span><br><br>' +
          '⚡ Всегда используйте стоп-лосс!';
      }
    }
    if (q.includes('купить') || q.includes('buy') || q.includes('что')) {
      return 'На основе текущего анализа рынка:<br><br>' +
        '🟢 <b>BTC/USDT</b> — сильная поддержка, потенциал роста<br>' +
        '🟢 <b>ETH/USDT</b> — накопление перед возможным ростом<br>' +
        '⚠️ <b>DOGE/USDT</b> — высокая волатильность<br><br>' +
        '<i>⚠️ Это не финансовый совет. Всегда проводите собственный анализ (DYOR).</i>';
    }
    if (q.includes('риск') || q.includes('risk') || q.includes('менеджмент')) {
      return '<b>Основы риск-менеджмента:</b><br><br>' +
        '🛡 Не рискуйте более <b>1-2%</b> депозита на одну сделку<br>' +
        '📏 Соотношение TP:SL минимум <b>2:1</b><br>' +
        '🚫 Никогда не торгуйте без стоп-лосса<br>' +
        '💼 Диверсифицируйте: не более <b>20%</b> в одну монету<br>' +
        '🧠 Контролируйте эмоции — следуйте плану<br><br>' +
        'QSI Neural всегда рассчитывает ваши уровни автоматически!';
    }
    if (q.includes('рынок') || q.includes('market') || q.includes('анализ')) {
      return 'Общий анализ рынка:<br><br>' +
        '📊 BTC: <b>' + btcPrice + '</b> (' + (parseFloat(btcChange) >= 0 ? '+' : '') + btcChange + '%)<br>' +
        '🌐 Крипторынок сейчас демонстрирует ' + (parseFloat(btcChange) >= 0 ? 'позитивный' : 'осторожный') + ' сентимент.<br><br>' +
        'Ключевые факторы:<br>' +
        '• Ликвидность остаётся на приемлемом уровне<br>' +
        '• Объём торгов в норме<br>' +
        '• Институциональный интерес сохраняется<br><br>' +
        'Рекомендую следить за уровнями ключевых поддержек.';
    }

    return 'Анализирую данные рынка... 🤖<br><br>Задайте вопрос о конкретной монете (BTC, ETH, SOL), торговых сигналах или стратегиях. Я обработаю текущие рыночные данные и дам персональную рекомендацию.';
  }

  /* =========================================================
     NAVIGATION
  ========================================================= */
  function setupTabBar() {
    var tabs = document.querySelectorAll('.tab');
    tabs.forEach(function(tab) {
      tab.addEventListener('click', function() {
        var name = tab.dataset.tab;
        if (!name) return;
        switchTab(name);
      });
    });
  }

  function switchTab(name) {
    state.activeTab = name;

    // Update tab buttons
    var tabs = document.querySelectorAll('.tab');
    tabs.forEach(function(tab) {
      tab.classList.toggle('is-active', tab.dataset.tab === name);
      tab.setAttribute('aria-selected', tab.dataset.tab === name ? 'true' : 'false');
    });

    // Handle settings as overlay
    var settingsScreen = document.querySelector('.screen--settings');

    if (name === 'settings') {
      if (settingsScreen) {
        settingsScreen.style.display = 'block';
        setTimeout(function() { settingsScreen.classList.add('is-active'); }, 10);
      }
      return;
    } else {
      if (settingsScreen) {
        settingsScreen.classList.remove('is-active');
        setTimeout(function() { settingsScreen.style.display = 'none'; }, 250);
      }
    }

    // Update screens
    var screens = document.querySelectorAll('.screen:not(.screen--settings)');
    screens.forEach(function(screen) {
      screen.classList.toggle('is-active', screen.dataset.screen === name);
    });

    // Refresh data on tab switch
    if (name === 'signals') {
      generateSignals();
      renderSignalsList();
    }
    if (name === 'market') {
      renderMarketTable();
    }
  }

  /* =========================================================
     COIN SELECTOR
  ========================================================= */
  function setupCoinSelector() {
    var selector = document.getElementById('coin-selector');
    if (!selector) return;
    selector.addEventListener('click', function(e) {
      var btn = e.target.closest('.coin-btn');
      if (!btn) return;
      var coin = btn.dataset.coin;
      if (!coin || coin === state.activeCoin) return;

      state.activeCoin = coin;
      selector.querySelectorAll('.coin-btn').forEach(function(b) {
        b.classList.toggle('is-active', b.dataset.coin === coin);
      });

      var p = state.prices[coin];
      if (p) updateHeroCard(coin, p.price, p.change24h, p.high, p.low, p.vol, null);
      fetchKline(coin, state.activeTf);
      updateSignalPanel(coin, p ? p.price : 0);
    });
  }

  /* =========================================================
     TIMEFRAME SELECTOR
  ========================================================= */
  function setupTfSelector() {
    var tfs = document.getElementById('chart-tfs');
    if (!tfs) return;
    tfs.addEventListener('click', function(e) {
      var btn = e.target.closest('.tf-btn');
      if (!btn) return;
      var tf = btn.dataset.tf;
      if (!tf || tf === state.activeTf) return;
      state.activeTf = tf;
      tfs.querySelectorAll('.tf-btn').forEach(function(b) {
        b.classList.toggle('is-active', b.dataset.tf === tf);
      });
      fetchKline(state.activeCoin, tf);
    });
  }

  /* =========================================================
     SIGNAL FILTERS
  ========================================================= */
  function setupSignalFilters() {
    var filters = document.getElementById('sig-filters');
    if (!filters) return;
    filters.addEventListener('click', function(e) {
      var btn = e.target.closest('.filter-btn');
      if (!btn) return;
      state.sigFilter = btn.dataset.filter;
      filters.querySelectorAll('.filter-btn').forEach(function(b) {
        b.classList.toggle('is-active', b.dataset.filter === state.sigFilter);
      });
      renderSignalsList();
    });
  }

  /* =========================================================
     MARKET TABS + SEARCH
  ========================================================= */
  function setupMarketTabs() {
    var tabs = document.getElementById('market-tabs');
    if (!tabs) return;
    tabs.addEventListener('click', function(e) {
      var btn = e.target.closest('.market-tab');
      if (!btn) return;
      state.marketCategory = btn.dataset.category;
      tabs.querySelectorAll('.market-tab').forEach(function(b) {
        b.classList.toggle('is-active', b.dataset.category === state.marketCategory);
      });
      renderMarketTable();
    });
  }

  function setupMarketSearch() {
    var search = document.getElementById('market-search');
    if (!search) return;
    search.addEventListener('input', function() {
      marketSearchQuery = this.value.trim().toLowerCase();
      renderMarketTable();
    });
  }

  /* =========================================================
     CONNECTIVITY STATUS
  ========================================================= */
  function setConnStatus(online) {
    var dot = document.getElementById('conn-dot');
    var label = document.getElementById('conn-label');
    if (dot) dot.style.background = online ? 'var(--teal)' : 'var(--neg)';
    if (label) {
      label.textContent = online ? 'LIVE' : 'REST';
      label.style.color = online ? 'var(--teal)' : 'var(--text-2)';
    }
  }

  /* =========================================================
     TOAST
  ========================================================= */
  function showToast(msg) {
    var toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(function() { toast.classList.remove('show'); }, 2500);
  }

  /* =========================================================
     FORMATTING UTILS
  ========================================================= */
  function formatPrice(price, coin) {
    if (!price || isNaN(price)) return '—';
    if (price >= 10000) return '$' + price.toLocaleString('en-US', {maximumFractionDigits: 0});
    if (price >= 100)  return '$' + price.toFixed(2);
    if (price >= 1)    return '$' + price.toFixed(4);
    return '$' + price.toFixed(6);
  }

  function formatVolume(vol) {
    if (!vol || isNaN(vol)) return '—';
    if (vol >= 1e12) return '$' + (vol / 1e12).toFixed(2) + 'T';
    if (vol >= 1e9)  return '$' + (vol / 1e9).toFixed(2) + 'B';
    if (vol >= 1e6)  return '$' + (vol / 1e6).toFixed(1) + 'M';
    if (vol >= 1e3)  return '$' + (vol / 1e3).toFixed(1) + 'K';
    return '$' + vol.toFixed(0);
  }

  function formatTime(date) {
    if (!date) return '';
    return date.toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'});
  }

  function escapeHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* =========================================================
     VIEWPORT HEIGHT (Telegram keyboard-aware)
  ========================================================= */
  function setupViewportHeight() {
    function update() {
      var h = (tg && tg.viewportStableHeight) ? tg.viewportStableHeight : window.innerHeight;
      document.documentElement.style.setProperty('--app-height', h + 'px');
    }
    update();
    window.addEventListener('resize', update);
    if (tg) tg.onEvent('viewportChanged', update);
  }

  /* =========================================================
     KICK OFF
  ========================================================= */
  setupViewportHeight();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
