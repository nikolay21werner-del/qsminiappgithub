/* =========================================================
   QUANTSIGNAL AI — Telegram Mini App (realtime edition)
   No localStorage / sessionStorage / cookies. In-memory state only.
   Data: public Bybit V5 WebSocket + REST fallback (no secrets).
   ========================================================= */
(function () {
  "use strict";

  var tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
  var I18N = window.QSI18N;
  var API = window.QSI_API;

  // ---------- Telegram WebApp SDK ----------
  function initTelegram() {
    if (!tg) return;
    try {
      tg.ready && tg.ready();
      tg.expand && tg.expand();
      if (typeof tg.setHeaderColor === "function") {
        try { tg.setHeaderColor("#04070d"); } catch (e) {}
      }
      if (typeof tg.setBackgroundColor === "function") {
        try { tg.setBackgroundColor("#04070d"); } catch (e) {}
      }
      if (typeof tg.disableVerticalSwipes === "function") {
        try { tg.disableVerticalSwipes(); } catch (e) {}
      }
      if (tg.themeParams && Object.keys(tg.themeParams).length) {
        document.body.classList.add("tg-themed");
        applyTelegramTheme(tg.themeParams);
      }
      tg.onEvent && tg.onEvent("themeChanged", function () {
        applyTelegramTheme(tg.themeParams || {});
      });
      if (API && typeof tg.initData === "string") API.setInitData(tg.initData);
    } catch (e) {
      console.warn("[QUANTSIGNAL] Telegram init warning:", e);
    }
  }

  function applyTelegramTheme(params) {
    var root = document.documentElement.style;
    if (params.bg_color)          root.setProperty("--tg-theme-bg-color", params.bg_color);
    if (params.text_color)        root.setProperty("--tg-theme-text-color", params.text_color);
    if (params.hint_color)        root.setProperty("--tg-theme-hint-color", params.hint_color);
    if (params.button_color)      root.setProperty("--tg-theme-button-color", params.button_color);
    if (params.button_text_color) root.setProperty("--tg-theme-button-text-color", params.button_text_color);
  }

  function haptic(type) {
    try {
      if (tg && tg.HapticFeedback) {
        if (type === "selection") tg.HapticFeedback.selectionChanged();
        else if (type === "success" || type === "warning" || type === "error") {
          tg.HapticFeedback.notificationOccurred(type);
        } else {
          tg.HapticFeedback.impactOccurred(type || "light");
        }
      }
    } catch (e) {}
  }

  // ---------- Helpers ----------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtPrice(n) {
    if (n == null || isNaN(n)) return "—";
    var abs = Math.abs(n);
    var digits = abs >= 1000 ? 2 : abs >= 10 ? 3 : abs >= 1 ? 4 : 6;
    return Number(n).toLocaleString("en-US", { maximumFractionDigits: digits });
  }
  function fmtPct(n) {
    if (n == null || isNaN(n)) return "—";
    return (n >= 0 ? "+" : "") + Number(n).toFixed(2) + "%";
  }
  function fmtCompact(n) {
    if (n == null || isNaN(n)) return "—";
    if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(Math.round(n));
  }
  function shortSym(sym) { return String(sym || "").replace(/USDT$/i, ""); }
  function relTime(ts) {
    if (!ts) return "—";
    var diff = Math.max(0, Date.now() - ts);
    if (diff < 4000) return I18N.t("justNow");
    var s = Math.floor(diff / 1000);
    if (s < 60) return I18N.t("secondsAgo", { n: s });
    var m = Math.floor(s / 60);
    if (m < 60) return I18N.t("minutesAgo", { n: m });
    var h = Math.floor(m / 60);
    return I18N.t("hoursAgo", { n: h });
  }

  // Map UI timeframe -> Bybit kline interval string.
  var TF_TO_BYBIT = { "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D" };

  // ---------- State ----------
  var state = {
    screen: "overview",
    tf: "5m",
    marketTf: "5m",
    selectedSymbol: "BTCUSDT",
    tickers: [],            // array of normalized tickers (from store)
    tickerMap: {},          // symbol -> ticker
    klines: {},             // "SYMBOL|tf" -> [{ts,open,high,low,close,volume}]
    klineLoading: {},
    aiHistory: [],
    aiBusy: false,
    status: {
      transport: "rest",
      wsReady: false,
      lastUpdateTs: 0,
      provider: "Bybit V5 (linear)"
    }
  };

  var realtime = null;

  // ---------- Screen routing ----------
  function setScreen(name) {
    if (!name) return;
    state.screen = name;
    $$(".screen").forEach(function (s) {
      s.classList.toggle("is-active", s.getAttribute("data-screen") === name);
    });
    $$(".tab").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-nav") === name);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (name === "signals") renderSignalsScreen();
    if (name === "market") renderMarketScreen();
    if (name === "ai") renderAIInitial();
    if (name === "profile") renderProfileScreen();
  }

  // ---------- Tickers ----------
  function renderTicker() {
    var track = $("#ticker-track");
    if (!track) return;
    var rows = state.tickers && state.tickers.length ? state.tickers : null;
    if (!rows) {
      track.innerHTML = '<span class="ticker-item"><span class="sym">…</span></span>';
      return;
    }
    var seq = rows.concat(rows);
    var html = "";
    for (var i = 0; i < seq.length; i++) {
      var t = seq[i];
      var dir = t.change_pct_24h >= 0 ? "up" : "dn";
      html += '<span class="ticker-item">' +
                '<span class="sym">' + escapeHtml(shortSym(t.symbol)) + '</span>' +
                '<span>$' + fmtPrice(t.last_price) + '</span>' +
                '<span class="' + dir + '">' + fmtPct(t.change_pct_24h) + '</span>' +
              '</span>';
    }
    track.innerHTML = html;
  }

  function applyHeroSnapshot() {
    if (!state.tickers || !state.tickers.length) return;
    var sym = state.selectedSymbol || "BTCUSDT";
    var t = state.tickerMap[sym] || state.tickers[0];
    if (!t) return;
    var pairEl = $("#hero-pair");
    var priceEl = $("#hero-price");
    var deltaEl = $("#hero-delta");
    var tagEl = $("#hero-chart-tag");
    var volEl = $("#hero-vol");
    if (pairEl) pairEl.textContent = t.symbol;
    if (priceEl) priceEl.textContent = fmtPrice(t.last_price);
    if (tagEl) tagEl.textContent = fmtPrice(t.last_price);
    if (volEl) volEl.textContent = fmtCompact(t.volume_24h);
    if (deltaEl) {
      deltaEl.textContent = fmtPct(t.change_pct_24h);
      deltaEl.classList.toggle("dn", t.change_pct_24h < 0);
    }
    ensureKlines(t.symbol, state.tf);
    renderHeroChart(t);
  }

  function klineKey(symbol, tf) { return symbol + "|" + tf; }

  function ensureKlines(symbol, tf) {
    var key = klineKey(symbol, tf);
    if (state.klines[key] || state.klineLoading[key]) return;
    var interval = TF_TO_BYBIT[tf] || "5";
    state.klineLoading[key] = true;
    API.bybitGetKlines(symbol, interval, 60).then(function (rows) {
      state.klines[key] = rows;
      state.klineLoading[key] = false;
      if (state.screen === "overview" && state.selectedSymbol === symbol && state.tf === tf) {
        var t = state.tickerMap[symbol];
        if (t) renderHeroChart(t);
      }
    }).catch(function () {
      state.klineLoading[key] = false;
    });
  }

  function renderHeroChart(t) {
    var g = $("#hero-chart-candles");
    if (!g) return;
    var key = klineKey(t.symbol, state.tf);
    var rows = state.klines[key];
    if (!rows || !rows.length) {
      // Show placeholder bars derived from live price while we load klines.
      drawPlaceholderBars(g, t);
      return;
    }
    var visible = rows.slice(-26);
    // Replace the last candle's close with the live tick so the chart "breathes".
    if (visible.length) {
      var last = visible[visible.length - 1];
      visible[visible.length - 1] = {
        ts: last.ts,
        open: last.open,
        high: Math.max(last.high, t.last_price),
        low: Math.min(last.low, t.last_price),
        close: t.last_price,
        volume: last.volume
      };
    }
    var min = Infinity, max = -Infinity;
    visible.forEach(function (r) {
      if (r.low < min) min = r.low;
      if (r.high > max) max = r.high;
    });
    if (!isFinite(min) || !isFinite(max) || min === max) {
      drawPlaceholderBars(g, t);
      return;
    }
    var range = max - min;
    var padTop = 8, padBot = 12;
    var W = 320, H = 140;
    var usable = H - padTop - padBot;
    var step = W / visible.length;
    var bodyW = Math.max(2, step * 0.6);
    var html = "";
    visible.forEach(function (r, i) {
      var x = i * step + (step - bodyW) / 2;
      var yHigh = padTop + (1 - (r.high - min) / range) * usable;
      var yLow = padTop + (1 - (r.low - min) / range) * usable;
      var yOpen = padTop + (1 - (r.open - min) / range) * usable;
      var yClose = padTop + (1 - (r.close - min) / range) * usable;
      var up = r.close >= r.open;
      var color = up ? "#26e6f2" : "#ff5577";
      var top = Math.min(yOpen, yClose);
      var bottom = Math.max(yOpen, yClose);
      var bodyH = Math.max(1.5, bottom - top);
      var wickX = x + bodyW / 2;
      html += '<line x1="' + wickX.toFixed(1) + '" y1="' + yHigh.toFixed(1) +
              '" x2="' + wickX.toFixed(1) + '" y2="' + yLow.toFixed(1) +
              '" stroke="' + color + '" stroke-width="1" opacity="0.7"/>';
      html += '<rect x="' + x.toFixed(1) + '" y="' + top.toFixed(1) +
              '" width="' + bodyW.toFixed(1) + '" height="' + bodyH.toFixed(1) +
              '" fill="' + color + '" />';
    });
    g.innerHTML = html;
  }

  function drawPlaceholderBars(g, t) {
    var pos = (t.change_pct_24h || 0) >= 0;
    var seed = 0;
    var sym = t.symbol || "BTC";
    for (var i = 0; i < sym.length; i++) seed = (seed * 31 + sym.charCodeAt(i)) >>> 0;
    seed = (seed + Math.floor(Date.now() / 60000)) >>> 0;
    function rand() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    var html = "";
    var x = 6, w = 6, step = 12;
    var baseY = pos ? 80 : 30;
    var trendDir = pos ? -1 : 1;
    for (var i = 0; i < 26; i++) {
      var noise = (rand() - 0.5) * 16;
      var trend = trendDir * i * 1.6;
      var y = Math.max(6, Math.min(108, baseY + trend + noise));
      var h = Math.max(8, 14 + (rand() * 18));
      var color = rand() > 0.45 ? "#26e6f2" : "#ff5577";
      html += '<rect x="' + (x + i * step) + '" y="' + y.toFixed(1) + '" width="' + w + '" height="' + h.toFixed(1) + '" fill="' + color + '"/>';
    }
    g.innerHTML = html;
  }

  // ---------- KPI animation ----------
  function animateCounter(el, target) {
    if (!el) return;
    var dur = 700;
    var start = performance.now();
    var unit = el.querySelector(".kpi-unit");
    var from = parseInt(el.textContent, 10);
    if (!isFinite(from)) from = 0;
    function frame(t) {
      var p = Math.min(1, (t - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      var v = Math.round(from + (target - from) * eased);
      el.textContent = String(v);
      if (unit) el.appendChild(unit);
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  function renderKPIs() {
    // KPIs derive from realtime store when available; otherwise show plausible values.
    var tickers = state.tickers || [];
    var signals = computeSignals();
    var watched = tickers.length || (API.DEFAULT_SYMBOLS || []).length;
    // "Model accuracy" — illustrative composite of average absolute momentum + win heuristic.
    var avgAbs = 0;
    tickers.forEach(function (t) { avgAbs += Math.abs(t.change_pct_24h || 0); });
    if (tickers.length) avgAbs /= tickers.length;
    var accuracy = Math.round(Math.max(55, Math.min(92, 62 + avgAbs * 3)));
    animateCounter($('[data-counter="signals"]'), signals.length);
    animateCounter($('[data-counter="coins"]'), watched);
    animateCounter($('[data-counter="accuracy"]'), accuracy);
  }

  // ---------- Overview rows ----------
  function renderOverviewRows() {
    var el = $("#overview-rows");
    if (!el) return;
    var rows = (state.tickers || []).slice(0, 5);
    if (!rows.length) {
      el.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
      return;
    }
    var html = "";
    rows.forEach(function (t) {
      var pos = t.change_pct_24h >= 0;
      html += '<div class="row" data-symbol="' + escapeHtml(t.symbol) + '">' +
        '<span class="row-coin">' + escapeHtml(shortSym(t.symbol).slice(0, 3)) + '</span>' +
        '<span><b>' + escapeHtml(shortSym(t.symbol)) + '</b><br><span style="color:var(--ink-2);font-size:11px;">$' + fmtPrice(t.last_price) + '</span></span>' +
        '<span class="' + (pos ? "up" : "dn") + '">' + fmtPct(t.change_pct_24h) + '</span>' +
        '<span style="color:var(--ink-3);font-family:JetBrains Mono,monospace;font-size:10px;">vol ' + fmtCompact(t.volume_24h) + '</span>' +
      '</div>';
    });
    el.innerHTML = html;
  }

  // ---------- Signals (realtime engine) ----------
  function computeSignals() {
    // Lightweight transparent engine based on 24h momentum, volatility and range position.
    // Not financial advice. Used for UI demonstration over live market data.
    var rows = state.tickers || [];
    var out = [];
    rows.forEach(function (t) {
      if (!t || !isFinite(t.last_price)) return;
      var change = t.change_pct_24h || 0;
      var absChg = Math.abs(change);
      // Skip flat coins from the signals stream.
      if (absChg < 0.25) return;
      var dir = change >= 0 ? "LONG" : "SHORT";
      var hi = t.high_24h || t.last_price;
      var lo = t.low_24h || t.last_price;
      var rangePct = hi > lo ? (hi - lo) / lo : 0.01;
      var rangeFactor = Math.max(0.005, Math.min(0.08, rangePct * 0.5 + absChg / 200));
      var entry = t.last_price;
      var sl  = dir === "LONG" ? entry * (1 - rangeFactor * 1.2) : entry * (1 + rangeFactor * 1.2);
      var tp1 = dir === "LONG" ? entry * (1 + rangeFactor)       : entry * (1 - rangeFactor);
      var tp2 = dir === "LONG" ? entry * (1 + rangeFactor * 2)   : entry * (1 - rangeFactor * 2);
      var rr = Math.abs(tp1 - entry) / Math.max(Math.abs(entry - sl), 1e-9);
      // Confidence: blend of |Δ24h|, volatility (range%) and proximity to range extreme.
      var rangePos = hi > lo ? (entry - lo) / (hi - lo) : 0.5;
      var extremeBonus = dir === "LONG" ? (1 - rangePos) : rangePos;
      var conf = Math.max(0.35, Math.min(0.92,
        0.45 + absChg / 12 + Math.min(0.2, rangePct) + (extremeBonus - 0.5) * 0.2
      ));
      var rationaleKey = dir === "LONG" ? "momentumLong" : "momentumShort";
      out.push({
        id: t.symbol + "-rt",
        symbol: t.symbol,
        direction: dir,
        entry: entry,
        stop_loss: sl,
        take_profit_1: tp1,
        take_profit_2: tp2,
        confidence: conf,
        risk_reward: +rr.toFixed(2),
        rationale: I18N.t(rationaleKey) + " · 24h " + fmtPct(change) +
                   " · " + I18N.t("aiVolatility") + " " + (rangePct * 100).toFixed(2) + "%",
        ts: Date.now()
      });
    });
    // Sort by confidence descending so the strongest signal appears first.
    out.sort(function (a, b) { return b.confidence - a.confidence; });
    return out;
  }

  function renderSignalsScreen() {
    var el = $("#signals-list");
    if (!el) return;
    var signals = computeSignals();
    if (!signals.length) {
      el.innerHTML = '<div class="card"><div class="muted">' + escapeHtml(I18N.t("noSignals")) + '</div></div>' +
                     '<p class="muted" style="font-size:11px;margin-top:6px;">' + escapeHtml(I18N.t("signalEngineNote")) + '</p>';
      state.signals = [];
      return;
    }
    state.signals = signals;
    var html = "";
    signals.forEach(function (s, idx) {
      var dirClass = s.direction === "LONG" ? "up" : "dn";
      var cardClass = s.direction === "LONG" ? "signal-card--long" : "signal-card--short";
      var conf = Math.round((s.confidence || 0) * 100);
      var status = idx === 0 ? "new" : (idx % 3 === 0 ? "watch" : "active");
      var statusLabel = (status === "new") ? I18N.t("statusNew") :
                        (status === "watch") ? I18N.t("statusWatch") : I18N.t("statusActive");
      html += '<article class="signal-card ' + cardClass + '" data-signal-id="' + escapeHtml(s.id) + '" data-signal-idx="' + idx + '">' +
        '<div class="signal-card__head">' +
          '<div class="signal-card__sym"><span class="row-coin">' + escapeHtml(shortSym(s.symbol).slice(0, 3)) + '</span>' + escapeHtml(s.symbol) + '</div>' +
          '<span class="signal-card__dir ' + dirClass + '">' + (s.direction === "LONG" ? "↑ " : "↓ ") + escapeHtml(s.direction) + '</span>' +
        '</div>' +
        '<div class="signal-card__grid">' +
          '<div class="signal-card__cell"><div class="signal-card__cell-label">' + I18N.t("entry") + '</div><div class="signal-card__cell-value">' + fmtPrice(s.entry) + '</div></div>' +
          '<div class="signal-card__cell"><div class="signal-card__cell-label">' + I18N.t("tp1") + '</div><div class="signal-card__cell-value">' + fmtPrice(s.take_profit_1) + '</div></div>' +
          '<div class="signal-card__cell signal-card__cell--danger"><div class="signal-card__cell-label">' + I18N.t("stop") + '</div><div class="signal-card__cell-value">' + fmtPrice(s.stop_loss) + '</div></div>' +
        '</div>' +
        '<div class="signal-card__foot">' +
          '<span class="signal-card__conf">' + I18N.t("aiConfidence") + ' <b>' + conf + '%</b><span class="signal-card__conf-bar"><i style="width:' + conf + '%"></i></span></span>' +
          '<span>R:R <b>' + (s.risk_reward || 0).toFixed(2) + '</b></span>' +
          '<button type="button" class="signal-card__cta" data-action="open-signal" data-signal-idx="' + idx + '">' + escapeHtml(statusLabel) + ' ›</button>' +
        '</div>' +
      '</article>';
    });
    html += '<p class="muted" style="font-size:11px;margin-top:6px;">' + escapeHtml(I18N.t("signalEngineNote")) + '</p>';
    el.innerHTML = html;
  }

  function renderSignalDetail(idx) {
    var s = state.signals && state.signals[idx];
    if (!s) return;
    var body = $("#signal-sheet-body");
    if (!body) return;
    var dirClass = s.direction === "LONG" ? "up" : "dn";
    var conf = Math.round((s.confidence || 0) * 100);
    var potential = ((s.take_profit_1 - s.entry) / s.entry) * 100;
    if (s.direction === "SHORT") potential = -potential;
    body.innerHTML =
      '<div class="sheet-signal__head">' +
        '<div class="sheet-signal__sym">' + escapeHtml(s.symbol) + ' · <span class="signal-card__dir ' + dirClass + '">' + (s.direction === "LONG" ? "↑ " : "↓ ") + escapeHtml(s.direction) + '</span></div>' +
      '</div>' +
      '<div class="sheet-signal__grid">' +
        '<div class="sheet-signal__cell"><div class="sheet-signal__cell-label">' + I18N.t("entry") + '</div><div class="sheet-signal__cell-value">' + fmtPrice(s.entry) + '</div></div>' +
        '<div class="sheet-signal__cell sheet-signal__cell--pos"><div class="sheet-signal__cell-label">' + I18N.t("tp1") + '</div><div class="sheet-signal__cell-value">' + fmtPrice(s.take_profit_1) + '</div></div>' +
        '<div class="sheet-signal__cell sheet-signal__cell--pos"><div class="sheet-signal__cell-label">' + I18N.t("tp2") + '</div><div class="sheet-signal__cell-value">' + fmtPrice(s.take_profit_2) + '</div></div>' +
        '<div class="sheet-signal__cell sheet-signal__cell--danger"><div class="sheet-signal__cell-label">' + I18N.t("stop") + '</div><div class="sheet-signal__cell-value">' + fmtPrice(s.stop_loss) + '</div></div>' +
        '<div class="sheet-signal__cell"><div class="sheet-signal__cell-label">' + I18N.t("aiConfidence") + '</div><div class="sheet-signal__cell-value">' + conf + '%</div></div>' +
        '<div class="sheet-signal__cell"><div class="sheet-signal__cell-label">R:R</div><div class="sheet-signal__cell-value">' + (s.risk_reward || 0).toFixed(2) + '</div></div>' +
      '</div>' +
      '<p class="sheet-signal__rationale">' + escapeHtml(s.rationale || I18N.t("signalRationaleDefault")) + '</p>' +
      '<div class="chips" style="margin-top:4px;">' +
        '<span><b>' + I18N.t("potential") + '</b>: <em>' + fmtPct(potential) + '</em></span>' +
        '<span><b>' + I18N.t("aiTrend") + '</b>: <em>' + (s.direction === "LONG" ? I18N.t("bullish") : I18N.t("bearish")) + '</em></span>' +
        '<span><b>' + I18N.t("signalEngineLabel") + '</b>: <em>realtime</em></span>' +
      '</div>';
    openSheet("#signal-sheet");
  }

  // ---------- Market screen ----------
  function renderMarketScreen() {
    var el = $("#matrix");
    if (!el) return;
    var rows = state.tickers || [];
    if (!rows.length) {
      el.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
      return;
    }
    var html = "";
    rows.forEach(function (t) {
      var pos = t.change_pct_24h >= 0;
      var absChg = Math.abs(t.change_pct_24h || 0);
      var strength = absChg >= 2 ? "high" : absChg >= 1 ? "mid" : "low";
      var strengthLabel = strength === "high" ? I18N.t("strHigh") : strength === "mid" ? I18N.t("strMid") : I18N.t("strLow");
      html += '<div class="matrix-cell ' + (pos ? "up" : "down") + '" data-symbol="' + escapeHtml(t.symbol) + '">' +
        '<div class="matrix-sym">' + escapeHtml(shortSym(t.symbol)) + '<span class="matrix-strength ' + strength + '">' + escapeHtml(strengthLabel) + '</span></div>' +
        '<div class="matrix-price">$' + fmtPrice(t.last_price) + '</div>' +
        '<div class="matrix-delta">' + fmtPct(t.change_pct_24h) + '</div>' +
        '<div class="matrix-vol">vol ' + fmtCompact(t.volume_24h) + '</div>' +
      '</div>';
    });
    el.innerHTML = html;
  }

  // ---------- AI assistant ----------
  function renderAIInitial() {
    renderAISuggestions();
    renderAIHistory();
  }

  function renderAISuggestions() {
    var el = $("#ai-suggest");
    if (!el) return;
    var suggestions = [
      I18N.t("askSuggest1"),
      I18N.t("askSuggest2"),
      I18N.t("askSuggest3"),
      I18N.t("askSuggest4")
    ];
    el.innerHTML = suggestions.map(function (s) {
      return '<button type="button" data-suggest="1">' + escapeHtml(s) + '</button>';
    }).join("");
  }

  function renderAIHistory() {
    var chat = $("#ai-chat");
    if (!chat) return;
    if (!state.aiHistory.length) {
      chat.innerHTML = '<div class="ai-empty">' + escapeHtml(buildSnapshotHint(state.selectedSymbol)) + '</div>';
      return;
    }
    var html = "";
    state.aiHistory.forEach(function (m) {
      var cls = "ai-msg " + m.role;
      if (m.thinking) cls += " ai-msg__thinking";
      if (m.error) cls += " ai-msg__error";
      html += '<div class="' + cls + '">' + escapeHtml(m.content) + '</div>';
    });
    chat.innerHTML = html;
    chat.scrollTop = chat.scrollHeight;
  }

  // Build a short market snapshot string for the empty-state placeholder.
  // This is never sent as an "AI reply" — it's just a non-AI hint that lives
  // in the empty chat panel before the user has asked anything.
  function buildSnapshotHint(symbol) {
    var sym = symbol || state.selectedSymbol || "BTCUSDT";
    var t = state.tickerMap[sym] || state.tickers[0];
    if (!t) return I18N.t("aiIntro");
    var head = I18N.t("aiSnapshotIntro", { sym: t.symbol });
    var change = t.change_pct_24h || 0;
    var dirWord = change >= 0 ? I18N.t("bullish") : I18N.t("bearish");
    var hi = t.high_24h || t.last_price;
    var lo = t.low_24h || t.last_price;
    var rangePct = hi > lo ? ((hi - lo) / lo) * 100 : 0;
    return [
      head,
      "• Price: $" + fmtPrice(t.last_price) + " (24h " + fmtPct(change) + ", " + dirWord + ")",
      "• Range 24h: $" + fmtPrice(lo) + " — $" + fmtPrice(hi) + " (" + rangePct.toFixed(2) + "%)",
      "• Volume: " + fmtCompact(t.volume_24h),
      "— " + I18N.t("signalEngineNote")
    ].join("\n");
  }

  function buildMarketContext(targetSymbol) {
    var t = state.tickerMap[targetSymbol] || state.tickerMap[state.selectedSymbol] || state.tickers[0];
    if (!t) return null;
    var st = state.status || {};
    var ageMs = st.lastUpdateTs ? (Date.now() - st.lastUpdateTs) : null;
    var peers = (state.tickers || []).slice(0, 8).map(function (p) {
      return {
        symbol: p.symbol,
        last_price: p.last_price,
        change_pct_24h: p.change_pct_24h
      };
    });
    return {
      symbol: t.symbol,
      last_price: t.last_price,
      change_pct_24h: t.change_pct_24h,
      volume_24h: t.volume_24h,
      high_24h: t.high_24h,
      low_24h: t.low_24h,
      transport: st.transport || "rest",
      provider: st.provider || "Bybit V5 (linear)",
      last_update_age_ms: ageMs,
      top_tickers: peers
    };
  }

  function aiErrorMessage(code) {
    if (code === "ai_not_configured") return I18N.t("aiNotConfigured");
    if (code === "ai_upstream_timeout") return I18N.t("aiTimeout");
    if (code === "ai_upstream_unreachable") return I18N.t("aiUnreachable");
    if (code === "ai_upstream_error" || code === "ai_upstream_bad_json" || code === "ai_empty_response") {
      return I18N.t("aiUpstream");
    }
    if (code === "messages_empty" || code === "last_message_not_user") return I18N.t("aiBadRequest");
    return I18N.t("aiError");
  }

  function sendAIMessage(text) {
    if (!text || state.aiBusy) return;
    text = String(text).trim();
    if (!text) return;
    if (text.length > 2000) text = text.slice(0, 2000);

    state.aiBusy = true;
    state.aiHistory.push({ role: "user", content: text });
    state.aiHistory.push({ role: "assistant", content: I18N.t("thinking"), thinking: true });
    renderAIHistory();
    haptic("light");

    var upper = text.toUpperCase();
    var symMatch = null;
    state.tickers.forEach(function (t) {
      var s = t.symbol;
      if (upper.indexOf(s) >= 0 || upper.indexOf(shortSym(s)) >= 0) symMatch = s;
    });
    var targetSymbol = symMatch || state.selectedSymbol;

    var msgs = state.aiHistory
      .filter(function (m) { return !m.thinking; })
      .map(function (m) { return { role: m.role, content: m.content }; });

    var ctx = buildMarketContext(targetSymbol);

    API.aiChat(msgs, I18N.get(), ctx).then(function (reply) {
      state.aiHistory.pop();
      var body = (reply && reply.content) || "";
      if (!body) {
        state.aiHistory.push({ role: "assistant", content: aiErrorMessage("ai_empty_response"), error: true });
      } else {
        state.aiHistory.push({ role: "assistant", content: body });
      }
      state.aiBusy = false;
      renderAIHistory();
      haptic("success");
    }).catch(function (err) {
      state.aiHistory.pop();
      var code = (err && err.code) || "ai_unreachable";
      state.aiHistory.push({ role: "assistant", content: aiErrorMessage(code), error: true });
      state.aiBusy = false;
      renderAIHistory();
      haptic("error");
    });
  }

  // ---------- Profile ----------
  function renderProfileScreen() {
    var user = null;
    try { user = tg && tg.initDataUnsafe && tg.initDataUnsafe.user; } catch (e) {}
    var name = user ? [user.first_name, user.last_name].filter(Boolean).join(" ") : "Guest";
    var uname = user && user.username ? "@" + user.username : "—";
    var lc = (user && user.language_code) || I18N.get();
    var platform = (tg && tg.platform && tg.platform !== "unknown") ? tg.platform : "web";
    setText("#prof-name", name);
    setText("#prof-platform", "Telegram · " + platform);
    setText("#prof-username", uname);
    setText("#prof-lang", lc);
    setText("#prof-status", state.status.transport === "offline"
      ? I18N.t("transportOffline")
      : I18N.t("connected"));
    setText("#prof-transport", transportLabel(state.status.transport));
    setText("#prof-provider", state.status.provider || "—");
    setText("#prof-last-update", state.status.lastUpdateTs ? relTime(state.status.lastUpdateTs) : "—");
    renderLangGrid();
  }

  function transportLabel(t) {
    if (t === "ws") return I18N.t("transportWs");
    if (t === "rest") return I18N.t("transportRest");
    return I18N.t("transportOffline");
  }

  function renderLangGrid() {
    var el = $("#lang-grid");
    if (!el) return;
    var meta = {
      ru: { flag: "🇷🇺", name: "Русский" },
      en: { flag: "🇺🇸", name: "English" },
      zh: { flag: "🇨🇳", name: "中文" }
    };
    var cur = I18N.get();
    var html = I18N.supported().map(function (code) {
      var m = meta[code] || { flag: "🌐", name: code.toUpperCase() };
      return '<button type="button" class="lang-chip ' + (code === cur ? "is-active" : "") +
             '" data-lang="' + code + '"><span class="flag">' + m.flag + '</span><b>' + escapeHtml(m.name) + '</b></button>';
    }).join("");
    el.innerHTML = html;
  }

  // ---------- Connection pill ----------
  function applyConnectionStatus() {
    var pill = $("#conn-pill");
    var dot = $("#dot-live");
    var t = state.status.transport;
    if (pill) {
      pill.classList.remove("is-ws", "is-rest", "is-offline");
      if (t === "ws") { pill.classList.add("is-ws"); pill.textContent = "LIVE"; }
      else if (t === "rest") { pill.classList.add("is-rest"); pill.textContent = "REST"; }
      else { pill.classList.add("is-offline"); pill.textContent = "OFF"; }
    }
    if (dot) {
      dot.classList.remove("is-rest", "is-offline");
      if (t === "rest") dot.classList.add("is-rest");
      else if (t === "offline") dot.classList.add("is-offline");
    }
    if (state.screen === "profile") {
      setText("#prof-transport", transportLabel(t));
      setText("#prof-last-update", state.status.lastUpdateTs ? relTime(state.status.lastUpdateTs) : "—");
      setText("#prof-status", t === "offline" ? I18N.t("transportOffline") : I18N.t("connected"));
    }
  }

  // ---------- Sheets ----------
  function openSheet(sel) {
    var s = $(sel);
    if (!s) return;
    s.classList.add("is-open");
    s.setAttribute("aria-hidden", "false");
  }
  function closeSheet(sel) {
    var s = $(sel);
    if (!s) return;
    s.classList.remove("is-open");
    s.setAttribute("aria-hidden", "true");
  }

  // ---------- Events ----------
  function setText(sel, text) {
    var el = $(sel);
    if (el) el.textContent = text;
  }

  function wireEvents() {
    document.addEventListener("click", function (e) {
      var navBtn = e.target.closest("[data-nav]");
      if (navBtn) {
        haptic("light");
        setScreen(navBtn.getAttribute("data-nav"));
        return;
      }
      var actionEl = e.target.closest("[data-action]");
      if (actionEl) {
        var act = actionEl.getAttribute("data-action");
        handleAction(act, actionEl);
        return;
      }
      var langBtn = e.target.closest("[data-lang]");
      if (langBtn) {
        var code = langBtn.getAttribute("data-lang");
        I18N.set(code);
        haptic("selection");
        return;
      }
      var tfBtn = e.target.closest("[data-tf]");
      if (tfBtn) {
        state.tf = tfBtn.getAttribute("data-tf");
        $$("#tf-tabs button").forEach(function (b) {
          b.classList.toggle("is-active", b === tfBtn);
        });
        setText("#set-tf", state.tf);
        ensureKlines(state.selectedSymbol, state.tf);
        applyHeroSnapshot();
        haptic("selection");
        return;
      }
      var mtfBtn = e.target.closest("[data-mtf]");
      if (mtfBtn) {
        state.marketTf = mtfBtn.getAttribute("data-mtf");
        $$("#market-tabs button").forEach(function (b) {
          b.classList.toggle("is-active", b === mtfBtn);
        });
        renderMarketScreen();
        haptic("selection");
        return;
      }
      var matrixCell = e.target.closest(".matrix-cell[data-symbol]");
      if (matrixCell) {
        var sym = matrixCell.getAttribute("data-symbol");
        if (sym) {
          state.selectedSymbol = sym;
          setScreen("overview");
          ensureKlines(sym, state.tf);
          applyHeroSnapshot();
        }
        return;
      }
      var overviewRow = e.target.closest("#overview-rows .row[data-symbol]");
      if (overviewRow) {
        var sym2 = overviewRow.getAttribute("data-symbol");
        if (sym2) {
          state.selectedSymbol = sym2;
          ensureKlines(sym2, state.tf);
          applyHeroSnapshot();
          haptic("selection");
        }
        return;
      }
      var togg = e.target.closest("[data-toggle]");
      if (togg) {
        togg.classList.toggle("is-on");
        var on = togg.classList.contains("is-on");
        togg.setAttribute("aria-pressed", on ? "true" : "false");
        haptic("selection");
        return;
      }
      var sug = e.target.closest("[data-suggest]");
      if (sug) {
        var input = $("#ai-text");
        if (input) {
          input.value = sug.textContent || "";
          input.focus();
        }
        return;
      }
    });

    // AI form
    var aiForm = $("#ai-form");
    if (aiForm) {
      aiForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var input = $("#ai-text");
        if (!input) return;
        var v = (input.value || "").trim();
        if (!v) return;
        input.value = "";
        sendAIMessage(v);
      });
    }
    var mic = $("#ai-mic");
    if (mic) {
      mic.addEventListener("click", function () {
        mic.classList.toggle("is-recording");
        haptic("light");
        if (mic.classList.contains("is-recording")) {
          setTimeout(function () {
            mic.classList.remove("is-recording");
            var input = $("#ai-text");
            if (input && !input.value) {
              input.value = I18N.t("micPlaceholder");
            }
          }, 1200);
        }
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeSheet("#signal-sheet");
        closeSheet("#roadmap-sheet");
      }
    });
  }

  function handleAction(act, el) {
    switch (act) {
      case "go-overview":
        haptic("selection"); setScreen("overview"); break;
      case "open-signals":
        haptic("light"); setScreen("signals"); break;
      case "open-market":
        haptic("light"); setScreen("market"); break;
      case "open-ai":
        haptic("light"); setScreen("ai"); break;
      case "open-profile":
        haptic("light"); setScreen("profile"); break;
      case "refresh":
        haptic("light");
        if (realtime && realtime.getStatus) {
          // Force an immediate REST poll by re-starting the store; cheap and idempotent.
          try { realtime.stop(); } catch (e) {}
          realtime.start();
        }
        if (state.screen === "signals") renderSignalsScreen();
        if (state.screen === "market") renderMarketScreen();
        break;
      case "open-signal":
        var idx = parseInt(el.getAttribute("data-signal-idx"), 10);
        renderSignalDetail(idx);
        haptic("selection");
        break;
      case "close-sheet":
        closeSheet("#signal-sheet");
        haptic("selection");
        break;
      case "open-roadmap":
        openSheet("#roadmap-sheet");
        haptic("selection");
        break;
      case "close-roadmap":
        closeSheet("#roadmap-sheet");
        haptic("selection");
        break;
      default: break;
    }
  }

  // ---------- i18n ----------
  function applyI18N() {
    document.documentElement.setAttribute("lang", I18N.get());
    $$("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      var v = I18N.t(key);
      if (v != null) el.textContent = v;
    });
    $$("[data-i18n-placeholder]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-placeholder");
      var v = I18N.t(key);
      if (v != null) el.setAttribute("placeholder", v);
    });
    applyConnectionStatus();
    if (state.screen === "signals") renderSignalsScreen();
    if (state.screen === "ai") renderAIInitial();
    if (state.screen === "profile") renderProfileScreen();
  }

  // ---------- Realtime wiring ----------
  function onRealtimeTickers(list) {
    state.tickers = list.slice();
    state.tickerMap = {};
    list.forEach(function (t) { state.tickerMap[t.symbol] = t; });
    state.status.lastUpdateTs = Date.now();
    renderTicker();
    renderOverviewRows();
    applyHeroSnapshot();
    if (state.screen === "market") renderMarketScreen();
    if (state.screen === "signals") renderSignalsScreen();
    renderKPIs();
    applyConnectionStatus();
  }

  function onRealtimeStatus(st) {
    state.status.transport = st.transport;
    state.status.wsReady = st.wsReady;
    state.status.provider = st.provider;
    if (st.lastUpdateTs) state.status.lastUpdateTs = st.lastUpdateTs;
    applyConnectionStatus();
  }

  // ---------- Boot ----------
  function boot() {
    initTelegram();
    I18N.init();
    applyI18N();
    I18N.on(function () { applyI18N(); });
    wireEvents();
    renderTicker();
    renderOverviewRows();
    renderAIInitial();
    renderKPIs();

    // Spin up the realtime market store. Bybit V5 public, no secrets.
    realtime = API.createRealtimeStore({ symbols: API.DEFAULT_SYMBOLS });
    realtime.onTickers(onRealtimeTickers);
    realtime.onStatus(onRealtimeStatus);
    realtime.start();

    // Tick the "last update" relative time every 5s without forcing data work.
    setInterval(function () {
      if (state.screen === "profile") {
        setText("#prof-last-update", state.status.lastUpdateTs ? relTime(state.status.lastUpdateTs) : "—");
      }
    }, 5000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
