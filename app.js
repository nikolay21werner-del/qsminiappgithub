/* =========================================================
   QUANTSIGNAL AI — Telegram Mini App (app-first edition)
   No localStorage / sessionStorage / cookies. In-memory state only.
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
  function coinSeed(sym) {
    var s = String(sym || "");
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  // ---------- State ----------
  var state = {
    screen: "overview",
    tf: "5m",
    marketTf: "5m",
    tickers: null,
    signals: null,
    aiHistory: [],
    aiBusy: false,
    backendOk: false
  };

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
    // Lazy renders
    if (name === "signals" && !state.signals) renderSignalsScreen();
    if (name === "market" && (!state.tickers || !state.tickers.length)) renderMarketScreen();
    if (name === "ai" && !state.aiHistory.length) renderAIInitial();
    if (name === "profile") renderProfileScreen();
    if (name === "signals") renderSignalsScreen();
    if (name === "market") renderMarketScreen();
  }

  // ---------- Live tickers ----------
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
    var btc = state.tickers.find(function (t) { return t.symbol === "BTCUSDT"; }) || state.tickers[0];
    if (!btc) return;
    var pairEl = $("#hero-pair");
    var priceEl = $("#hero-price");
    var deltaEl = $("#hero-delta");
    var tagEl = $("#hero-chart-tag");
    var volEl = $("#hero-vol");
    if (pairEl) pairEl.textContent = btc.symbol;
    if (priceEl) priceEl.textContent = fmtPrice(btc.last_price);
    if (tagEl) tagEl.textContent = fmtPrice(btc.last_price);
    if (volEl) volEl.textContent = fmtCompact(btc.volume_24h);
    if (deltaEl) {
      deltaEl.textContent = fmtPct(btc.change_pct_24h);
      deltaEl.classList.toggle("dn", btc.change_pct_24h < 0);
    }
    renderHeroChart(btc);
  }

  function renderHeroChart(t) {
    var g = $("#hero-chart-candles");
    if (!g) return;
    var seed = coinSeed(t.symbol || "BTC") + Math.floor(Date.now() / 60000);
    function rand() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    var pos = (t.change_pct_24h || 0) >= 0;
    var html = "";
    var x = 6;
    var w = 6;
    var step = 12;
    var baseY = pos ? 80 : 30;
    var trendDir = pos ? -1 : 1;
    for (var i = 0; i < 26; i++) {
      var noise = (rand() - 0.5) * 16;
      var trend = trendDir * i * 1.6;
      var y = Math.max(6, Math.min(108, baseY + trend + noise));
      var hgt = Math.max(8, 14 + (rand() * 18));
      var color = (rand() > 0.45 ? "#26e6f2" : "#ff5577");
      html += '<rect x="' + (x + i * step) + '" y="' + y.toFixed(1) + '" width="' + w + '" height="' + hgt.toFixed(1) + '" fill="' + color + '"/>';
    }
    g.innerHTML = html;
  }

  async function refreshTickers() {
    if (!API) return;
    try {
      var data = await API.getTickers();
      state.tickers = (data && data.tickers) ? data.tickers : [];
      state.backendOk = !!(data && data.source && data.source !== "demo");
      renderTicker();
      applyHeroSnapshot();
      renderOverviewRows();
      if (state.screen === "market") renderMarketScreen();
    } catch (e) {
      console.warn("ticker refresh failed", e);
    }
  }

  // ---------- KPI animation ----------
  function animateCounter(el, target) {
    if (!el) return;
    var dur = 900;
    var start = performance.now();
    var unit = el.querySelector(".kpi-unit");
    function frame(t) {
      var p = Math.min(1, (t - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      var v = Math.round(eased * target);
      el.textContent = String(v);
      if (unit) el.appendChild(unit);
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  function renderKPIs() {
    animateCounter($('[data-counter="signals"]'), 24);
    animateCounter($('[data-counter="coins"]'), 187);
    animateCounter($('[data-counter="accuracy"]'), 72);
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
      html += '<div class="row">' +
        '<span class="row-coin">' + escapeHtml(shortSym(t.symbol).slice(0, 3)) + '</span>' +
        '<span><b>' + escapeHtml(shortSym(t.symbol)) + '</b><br><span style="color:var(--ink-2);font-size:11px;">$' + fmtPrice(t.last_price) + '</span></span>' +
        '<span class="' + (pos ? "up" : "dn") + '">' + fmtPct(t.change_pct_24h) + '</span>' +
        '<span style="color:var(--ink-3);font-family:JetBrains Mono,monospace;font-size:10px;">vol ' + fmtCompact(t.volume_24h) + '</span>' +
      '</div>';
    });
    el.innerHTML = html;
  }

  // ---------- Signals screen ----------
  async function renderSignalsScreen() {
    var el = $("#signals-list");
    if (!el) return;
    if (!state.signals) el.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    try {
      var data = await API.getSignals();
      state.signals = (data && data.signals) ? data.signals : [];
    } catch (e) {
      state.signals = [];
    }
    if (!state.signals.length) {
      el.innerHTML = '<div class="card"><div class="muted">' + escapeHtml(I18N.t("noSignals")) + '</div></div>';
      return;
    }
    var html = "";
    state.signals.forEach(function (s, idx) {
      var dirClass = s.direction === "LONG" ? "up" : "dn";
      var cardClass = s.direction === "LONG" ? "signal-card--long" : "signal-card--short";
      var conf = Math.round((s.confidence || 0) * 100);
      var status = idx === 0 ? "new" : (idx % 3 === 0 ? "watch" : "active");
      var statusLabel = (status === "new") ? I18N.t("statusNew") :
                        (status === "watch") ? I18N.t("statusWatch") : I18N.t("statusActive");
      html += '<article class="signal-card ' + cardClass + '" data-signal-id="' + escapeHtml(s.id || s.symbol) + '" data-signal-idx="' + idx + '">' +
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
      '</div>';
    openSheet("#signal-sheet");
  }

  // ---------- Market screen ----------
  async function renderMarketScreen() {
    var el = $("#matrix");
    if (!el) return;
    if (!state.tickers) el.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
    try {
      var data = await API.getTickers();
      state.tickers = (data && data.tickers) ? data.tickers : [];
    } catch (e) {}
    if (!state.tickers.length) {
      el.innerHTML = '<div class="card"><div class="muted">—</div></div>';
      return;
    }
    var html = "";
    state.tickers.forEach(function (t) {
      var pos = t.change_pct_24h >= 0;
      var absChg = Math.abs(t.change_pct_24h || 0);
      var strength = absChg >= 2 ? "high" : absChg >= 1 ? "mid" : "low";
      var strengthLabel = strength === "high" ? I18N.t("strHigh") : strength === "mid" ? I18N.t("strMid") : I18N.t("strLow");
      html += '<div class="matrix-cell ' + (pos ? "up" : "down") + '">' +
        '<div class="matrix-sym">' + escapeHtml(shortSym(t.symbol)) + '<span class="matrix-strength ' + strength + '">' + escapeHtml(strengthLabel) + '</span></div>' +
        '<div class="matrix-price">$' + fmtPrice(t.last_price) + '</div>' +
        '<div class="matrix-delta">' + fmtPct(t.change_pct_24h) + '</div>' +
        '<div class="matrix-vol">vol ' + fmtCompact(t.volume_24h) + '</div>' +
      '</div>';
    });
    el.innerHTML = html;
  }

  // ---------- AI screen ----------
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
      chat.innerHTML = '<div class="ai-empty">' + escapeHtml(I18N.t("aiMockNotice")) + '</div>';
      return;
    }
    var html = "";
    state.aiHistory.forEach(function (m) {
      var thinkingClass = m.thinking ? " ai-msg__thinking" : "";
      html += '<div class="ai-msg ' + m.role + thinkingClass + '">' + escapeHtml(m.content) + '</div>';
    });
    chat.innerHTML = html;
    chat.scrollTop = chat.scrollHeight;
  }

  async function sendAIMessage(text) {
    if (!text || state.aiBusy) return;
    state.aiBusy = true;
    state.aiHistory.push({ role: "user", content: text });
    state.aiHistory.push({ role: "assistant", content: I18N.t("thinking"), thinking: true });
    renderAIHistory();
    haptic("light");
    try {
      var msgs = state.aiHistory
        .filter(function (m) { return !m.thinking; })
        .map(function (m) { return { role: m.role, content: m.content }; });
      var reply = await API.aiChat(msgs, I18N.get());
      state.aiHistory.pop();
      var body = reply.content || "—";
      if (reply.mock) body += "\n\n— " + I18N.t("aiMockNotice");
      state.aiHistory.push({ role: "assistant", content: body });
    } catch (e) {
      state.aiHistory.pop();
      state.aiHistory.push({ role: "assistant", content: I18N.t("aiError") });
    }
    state.aiBusy = false;
    renderAIHistory();
    haptic("success");
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
    setText("#prof-status", state.backendOk ? I18N.t("connected") : I18N.t("demoMode"));
    renderLangGrid();
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
    // Mic placeholder
    var mic = $("#ai-mic");
    if (mic) {
      mic.addEventListener("click", function () {
        mic.classList.toggle("is-recording");
        haptic("light");
        // Voice not implemented — just toggle visual state.
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

    // Keyboard
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
        refreshTickers();
        if (state.screen === "signals") { state.signals = null; renderSignalsScreen(); }
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
    // Re-render dynamic screens whose content depends on i18n
    if (state.signals) renderSignalsScreen();
    if (state.screen === "ai") renderAIInitial();
    if (state.screen === "profile") renderProfileScreen();
  }

  // ---------- Boot ----------
  async function boot() {
    initTelegram();
    I18N.init();
    applyI18N();
    I18N.on(function () { applyI18N(); });
    wireEvents();
    renderKPIs();
    renderTicker(); // placeholder
    renderOverviewRows();
    renderAIInitial();
    await refreshTickers();
    // Optional live socket
    if (API && typeof API.openMarketSocket === "function") {
      API.openMarketSocket(function (msg) {
        if (msg && msg.type === "snapshot" && msg.tickers) {
          state.tickers = msg.tickers;
          renderTicker();
          applyHeroSnapshot();
          renderOverviewRows();
          if (state.screen === "market") renderMarketScreen();
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
