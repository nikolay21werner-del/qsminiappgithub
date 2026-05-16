/* =========================================================
   QUANTSIGNAL AI — Telegram Mini App (full-stack edition)
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
      tg.ready();
      tg.expand();
      if (typeof tg.setHeaderColor === "function") tg.setHeaderColor("#0b0f14");
      if (typeof tg.setBackgroundColor === "function") tg.setBackgroundColor("#0b0f14");
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
      // Capture raw initData for server-side validation; never trust initDataUnsafe.
      if (API && typeof tg.initData === "string") API.setInitData(tg.initData);
    } catch (e) {
      console.warn("[QUANTSIGNAL] Telegram init warning:", e);
    }
  }

  function applyTelegramTheme(params) {
    var root = document.documentElement.style;
    if (params.bg_color)         root.setProperty("--tg-theme-bg-color", params.bg_color);
    if (params.text_color)       root.setProperty("--tg-theme-text-color", params.text_color);
    if (params.hint_color)       root.setProperty("--tg-theme-hint-color", params.hint_color);
    if (params.button_color)     root.setProperty("--tg-theme-button-color", params.button_color);
    if (params.button_text_color)root.setProperty("--tg-theme-button-text-color", params.button_text_color);
  }

  function haptic(type) {
    try {
      if (tg && tg.HapticFeedback) {
        if (type === "selection") tg.HapticFeedback.selectionChanged();
        else tg.HapticFeedback.impactOccurred(type || "light");
      }
    } catch (e) {}
  }

  // ---------- Helpers ----------
  function fmtPrice(n) {
    if (n == null || isNaN(n)) return "—";
    var abs = Math.abs(n);
    var digits = abs >= 1000 ? 2 : abs >= 10 ? 3 : abs >= 1 ? 4 : 6;
    return Number(n).toLocaleString("en-US", { maximumFractionDigits: digits });
  }
  function fmtPct(n) {
    if (n == null || isNaN(n)) return "—";
    var s = (n >= 0 ? "+" : "") + Number(n).toFixed(2) + "%";
    return s;
  }
  function fmtCompact(n) {
    if (n == null || isNaN(n)) return "—";
    if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(Math.round(n));
  }
  function shortSym(sym) { return String(sym || "").replace(/USDT$/i, ""); }

  // ---------- Live tickers ----------
  var liveTickers = null;

  function renderTicker() {
    var track = document.getElementById("ticker-track");
    if (!track) return;
    var rows = liveTickers && liveTickers.length ? liveTickers : null;
    var html = "";
    if (rows) {
      var seq = rows.concat(rows);
      for (var i = 0; i < seq.length; i++) {
        var t = seq[i];
        var dir = t.change_pct_24h >= 0 ? "up" : "dn";
        html += '<span class="ticker-item">' +
                  '<span class="sym">' + shortSym(t.symbol) + '</span>' +
                  '<span>$' + fmtPrice(t.last_price) + '</span>' +
                  '<span class="' + dir + '">' + fmtPct(t.change_pct_24h) + '</span>' +
                '</span>';
      }
    } else {
      // initial loader bar
      html = '<span class="ticker-item"><span class="sym">…</span></span>';
    }
    track.innerHTML = html;
  }

  function applyHeroSnapshot() {
    if (!liveTickers || !liveTickers.length) return;
    var btc = null;
    for (var i = 0; i < liveTickers.length; i++) {
      if (liveTickers[i].symbol === "BTCUSDT") { btc = liveTickers[i]; break; }
    }
    if (!btc) return;
    var priceEl = document.querySelector(".market-card .price-line");
    var deltaEl = document.querySelector(".market-card .price-delta");
    var markerEl = document.querySelector(".market-card .price-marker");
    if (priceEl) priceEl.textContent = fmtPrice(btc.last_price);
    if (markerEl) markerEl.textContent = fmtPrice(btc.last_price);
    if (deltaEl) {
      var changeAbs = btc.last_price * (btc.change_pct_24h / 100);
      deltaEl.textContent = (changeAbs >= 0 ? "+" : "") + fmtPrice(changeAbs) +
                            " (" + fmtPct(btc.change_pct_24h) + ")";
      deltaEl.classList.toggle("dn", btc.change_pct_24h < 0);
    }
  }

  async function refreshTickers() {
    if (!API) return;
    try {
      var data = await API.getTickers();
      liveTickers = (data && data.tickers) ? data.tickers : null;
      renderTicker();
      applyHeroSnapshot();
    } catch (e) {
      console.warn("ticker refresh failed", e);
    }
  }

  // ---------- KPI counters ----------
  function animateCounter(el, target) {
    var dur = 900;
    var start = performance.now();
    var unit = el.querySelector(".kpi-unit");
    function frame(t) {
      var p = Math.min(1, (t - start) / dur);
      var eased = 1 - Math.pow(1 - p, 3);
      var v = Math.round(eased * target);
      el.firstChild ? (el.firstChild.nodeValue = String(v)) : (el.textContent = String(v));
      if (unit) el.appendChild(unit);
      if (p < 1) requestAnimationFrame(frame);
    }
    el.textContent = "0";
    if (unit) el.appendChild(unit);
    requestAnimationFrame(frame);
  }

  function renderKPIs() {
    var sig = document.querySelector('[data-counter="signals"]');
    var coi = document.querySelector('[data-counter="coins"]');
    var acc = document.querySelector('[data-counter="accuracy"]');
    if (sig) animateCounter(sig, 24);
    if (coi) animateCounter(coi, 187);
    if (acc) animateCounter(acc, 72);
  }

  // ---------- Panel renderer (dynamic screens) ----------
  var panelState = { screen: "default" };

  function setPanelTitle(text) {
    var el = document.getElementById("panel-title");
    if (el) el.textContent = text;
  }

  function panelLoading() {
    var bodyEl = document.getElementById("panel-body");
    if (!bodyEl) return;
    bodyEl.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  }

  function panelEmpty(msg) {
    var bodyEl = document.getElementById("panel-body");
    if (!bodyEl) return;
    bodyEl.innerHTML = '<div class="row"><span class="row-text" style="opacity:.7">' + msg + '</span></div>';
  }

  function scrollToPanel() {
    var panel = document.getElementById("content-panel");
    if (!panel) return;
    var top = panel.getBoundingClientRect().top + window.scrollY - 12;
    window.scrollTo({ top: top, behavior: "smooth" });
  }

  // --- Signals screen ---
  async function renderSignalsScreen() {
    panelState.screen = "signals";
    setPanelTitle(I18N.t("sectionSignals"));
    panelLoading();
    scrollToPanel();
    var data = await API.getSignals();
    var bodyEl = document.getElementById("panel-body");
    if (!bodyEl) return;
    if (!data.signals || !data.signals.length) {
      panelEmpty("—");
      return;
    }
    var html = "";
    data.signals.forEach(function (s) {
      var dirClass = s.direction === "LONG" ? "up" : "down";
      var dirSign = s.direction === "LONG" ? "↑" : "↓";
      var conf = Math.round((s.confidence || 0) * 100);
      html +=
        '<div class="row">' +
          '<span class="row-sym">' + shortSym(s.symbol) + '</span>' +
          '<span class="row-text">' +
            '<b>' + s.direction + '</b> @ <b>' + fmtPrice(s.entry) + '</b> · ' +
            I18N.t("tp1") + ' <b>' + fmtPrice(s.take_profit_1) + '</b> · ' +
            I18N.t("stop") + ' <b class="danger">' + fmtPrice(s.stop_loss) + '</b> · ' +
            'R:R <b>' + (s.risk_reward || 0).toFixed(2) + '</b> · ' +
            I18N.t("aiConfidence") + ' <b>' + conf + '%</b>' +
          '</span>' +
          '<span class="row-value ' + dirClass + '">' + dirSign + ' ' + s.direction + '</span>' +
        '</div>';
    });
    bodyEl.innerHTML = html;
  }

  // --- Market matrix screen ---
  async function renderMatrixScreen() {
    panelState.screen = "matrix";
    setPanelTitle(I18N.t("sectionMatrix"));
    panelLoading();
    scrollToPanel();
    var data = await API.getTickers();
    liveTickers = data.tickers || [];
    renderTicker();
    applyHeroSnapshot();
    var bodyEl = document.getElementById("panel-body");
    if (!bodyEl) return;
    if (!liveTickers.length) { panelEmpty("—"); return; }
    var html = '<div class="matrix">';
    liveTickers.forEach(function (t) {
      var pos = t.change_pct_24h >= 0;
      html +=
        '<div class="matrix-cell ' + (pos ? "up" : "down") + '">' +
          '<div class="matrix-sym">' + shortSym(t.symbol) + '</div>' +
          '<div class="matrix-price">$' + fmtPrice(t.last_price) + '</div>' +
          '<div class="matrix-delta">' + fmtPct(t.change_pct_24h) + '</div>' +
          '<div class="matrix-vol">vol ' + fmtCompact(t.volume_24h) + '</div>' +
        '</div>';
    });
    html += '</div>';
    bodyEl.innerHTML = html;
  }

  // --- AI Assistant screen ---
  var aiHistory = []; // in-memory only
  async function renderAIScreen() {
    panelState.screen = "ai";
    setPanelTitle(I18N.t("sectionAI"));
    scrollToPanel();
    var bodyEl = document.getElementById("panel-body");
    if (!bodyEl) return;
    bodyEl.innerHTML =
      '<div class="ai-chat" id="ai-chat"></div>' +
      '<form class="ai-input" id="ai-form">' +
        '<input type="text" id="ai-text" autocomplete="off" placeholder="' + I18N.t("askAI") + '" />' +
        '<button type="submit" class="cta primary" id="ai-send">' + I18N.t("send") + '</button>' +
      '</form>';

    renderAIHistory();

    var form = document.getElementById("ai-form");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var input = document.getElementById("ai-text");
        if (!input) return;
        var text = (input.value || "").trim();
        if (!text) return;
        input.value = "";
        sendAIMessage(text);
      });
    }
  }

  function renderAIHistory() {
    var chat = document.getElementById("ai-chat");
    if (!chat) return;
    if (!aiHistory.length) {
      chat.innerHTML = '<div class="ai-empty">' + I18N.t("aiMockNotice") + '</div>';
      return;
    }
    var html = "";
    aiHistory.forEach(function (m) {
      html += '<div class="ai-msg ' + m.role + '">' +
                '<div class="ai-bubble">' + escapeHtml(m.content) + '</div>' +
              '</div>';
    });
    chat.innerHTML = html;
    chat.scrollTop = chat.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  async function sendAIMessage(text) {
    aiHistory.push({ role: "user", content: text });
    aiHistory.push({ role: "assistant", content: "… " + I18N.t("thinking") });
    renderAIHistory();
    haptic("light");
    var reply = await API.aiChat(
      aiHistory.filter(function (m) { return m.role !== "assistant" || m.content.indexOf("…") !== 0; }),
      I18N.get()
    );
    aiHistory.pop(); // remove thinking placeholder
    aiHistory.push({ role: "assistant", content: reply.content + (reply.mock ? "\n\n— " + I18N.t("aiMockNotice") : "") });
    renderAIHistory();
  }

  // --- Profile screen ---
  function renderProfileScreen() {
    panelState.screen = "profile";
    setPanelTitle(I18N.t("sectionProfile"));
    scrollToPanel();
    var bodyEl = document.getElementById("panel-body");
    if (!bodyEl) return;
    var user = null;
    try { user = tg && tg.initDataUnsafe && tg.initDataUnsafe.user; } catch (e) {}
    var name = user ? [user.first_name, user.last_name].filter(Boolean).join(" ") : "Guest";
    var uname = user && user.username ? "@" + user.username : "—";
    var lc = (user && user.language_code) || "—";
    var platform = (tg && tg.platform && tg.platform !== "unknown") ? tg.platform : "web";
    var supported = I18N.supported();
    var cur = I18N.get();
    var langButtons = supported.map(function (code) {
      return '<button type="button" class="chip lang-chip ' + (code === cur ? "active" : "") +
             '" data-lang="' + code + '">' + code.toUpperCase() + '</button>';
    }).join("");
    bodyEl.innerHTML =
      '<div class="profile">' +
        '<div class="profile-row"><span>Telegram</span><b>' + escapeHtml(name) + '</b></div>' +
        '<div class="profile-row"><span>Username</span><b>' + escapeHtml(uname) + '</b></div>' +
        '<div class="profile-row"><span>Lang code</span><b>' + escapeHtml(lc) + '</b></div>' +
        '<div class="profile-row"><span>Platform</span><b>' + escapeHtml(platform) + '</b></div>' +
        '<div class="profile-row lang-switch"><span>' + I18N.t("languageLabel") + '</span>' +
          '<span class="lang-chips">' + langButtons + '</span>' +
        '</div>' +
        '<p class="about-text" style="margin-top:14px">' + I18N.t("aboutLead") + '</p>' +
      '</div>';
  }

  // --- Default overview (the panel that ships at the bottom) ---
  function renderDefaultScreen() {
    panelState.screen = "default";
    setPanelTitle(I18N.t("sectionMain"));
    panelLoading();
    setTimeout(function () {
      var bodyEl = document.getElementById("panel-body");
      if (!bodyEl) return;
      var rows = (liveTickers && liveTickers.length ? liveTickers : []).slice(0, 4);
      if (!rows.length) {
        panelEmpty("…");
        return;
      }
      var html = "";
      rows.forEach(function (t) {
        var dirClass = t.change_pct_24h >= 0 ? "up" : "down";
        html +=
          '<div class="row">' +
            '<span class="row-sym">' + shortSym(t.symbol) + '</span>' +
            '<span class="row-text">$' + fmtPrice(t.last_price) +
              ' · vol ' + fmtCompact(t.volume_24h) + '</span>' +
            '<span class="row-value ' + dirClass + '">' + fmtPct(t.change_pct_24h) + '</span>' +
          '</div>';
      });
      bodyEl.innerHTML = html;
    }, 220);
  }

  // ---------- Actions ----------
  function handleAction(action, el) {
    switch (action) {
      case "open-signals":
      case "open-derivs": // legacy alias
        haptic("light"); renderSignalsScreen(); break;
      case "open-coins":
      case "open-matrix":
        haptic("light"); renderMatrixScreen(); break;
      case "open-ai":
        haptic("light"); renderAIScreen(); break;
      case "open-about":
      case "open-profile":
        haptic("selection"); renderProfileScreen(); break;
      case "refresh":
        haptic("light");
        refreshTickers();
        if (panelState.screen === "signals") renderSignalsScreen();
        else if (panelState.screen === "matrix") renderMatrixScreen();
        else if (panelState.screen === "ai") { /* no-op */ }
        else if (panelState.screen === "profile") renderProfileScreen();
        else renderDefaultScreen();
        break;
      case "reset":
        haptic("selection");
        window.scrollTo({ top: 0, behavior: "smooth" });
        renderDefaultScreen();
        break;
      case "set-lang":
        var lang = el && el.getAttribute("data-lang");
        if (lang) { I18N.set(lang); haptic("selection"); }
        break;
      default: break;
    }
  }

  function wireEvents() {
    document.addEventListener("click", function (e) {
      var langBtn = e.target.closest("[data-lang]");
      if (langBtn) {
        e.preventDefault();
        handleAction("set-lang", langBtn);
        if (panelState.screen === "profile") renderProfileScreen();
        return;
      }
      var el = e.target.closest("[data-action]");
      if (!el) return;
      e.preventDefault();
      handleAction(el.getAttribute("data-action"), el);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var el = document.activeElement;
      if (el && el.matches("[data-action]")) {
        e.preventDefault();
        handleAction(el.getAttribute("data-action"), el);
      }
    });
  }

  // ---------- i18n binding ----------
  function syncLangChips() {
    var cur = I18N.get();
    var chips = document.querySelectorAll('.lang-chip[data-lang]');
    chips.forEach(function (c) {
      c.classList.toggle('is-active', c.getAttribute('data-lang') === cur);
      c.classList.toggle('active', c.getAttribute('data-lang') === cur);
    });
  }

  function applyI18N() {
    var t = I18N.t;
    document.documentElement.setAttribute("lang", I18N.get());
    syncLangChips();
    // Hero tagline
    var tagline = document.querySelector(".brand-copy p");
    if (tagline) tagline.innerHTML = t("brandTagline").replace("AI", "<strong>AI</strong>");
    var badge = document.querySelector(".brand-copy .eyebrow");
    if (badge) {
      // keep the live-dot, replace text node
      var dot = badge.querySelector(".live-dot");
      badge.innerHTML = "";
      if (dot) badge.appendChild(dot);
      badge.appendChild(document.createTextNode(" " + t("heroBadge")));
    }
    // CTAs
    setText('[data-action="open-signals"].primary', t("ctaOpenSignals"));
    setText('[data-action="open-about"].secondary', t("ctaAbout"));
    // KPI labels
    var k = document.querySelectorAll(".kpi .kpi-label");
    if (k.length >= 3) {
      k[0].textContent = t("kpiSignals");
      k[1].textContent = t("kpiCoins");
      k[2].textContent = t("kpiAccuracy");
    }
    var trends = document.querySelectorAll(".kpi .kpi-trend");
    if (trends.length >= 3) {
      trends[0].textContent = "↑ " + t("kpiSignalsDelta");
      trends[1].textContent = "↑ " + t("kpiCoinsDelta");
      trends[2].textContent = t("kpiAccuracyDelta");
    }
    // AI summary card
    var aiH = document.querySelector(".ai-card h2");
    if (aiH) aiH.textContent = t("aiTitle");
    var chips = document.querySelectorAll(".ai-card .chips span");
    if (chips.length >= 3) {
      chips[0].innerHTML = t("aiTrend") + ": <b>" + t("bullish") + "</b>";
      chips[1].innerHTML = t("aiConfidence") + ": <b>78%</b>";
      chips[2].innerHTML = t("aiVolatility") + ": " + t("medium");
    }
    // Signal card labels
    var grid = document.querySelector(".signal-grid");
    if (grid) {
      var spans = grid.querySelectorAll("span");
      var labels = [t("entry"), t("tp1"), t("tp2"), t("stop")];
      spans.forEach(function (s, i) { if (labels[i]) s.textContent = labels[i]; });
    }
    setText(".signal-status", t("activeSignal"));
    setText(".signal-potential span", t("potential"));
    setText(".signal-card .details-button", t("details"));
    // Section heading + refresh chip
    setText('.section-head .chip[data-action="refresh"]', t("refresh"));
    // About section
    setText("#about-section h2", t("aboutTitle"));
    setText("#about-section .about-text", t("aboutLead"));
    // Bottom nav
    var navBtns = document.querySelectorAll(".bottom-nav button");
    var navLabels = [t("navOverview"), t("navSignals"), t("navMatrix"), t("navAI"), t("navProfile")];
    navBtns.forEach(function (b, i) {
      if (navLabels[i] == null) return;
      var icon = b.querySelector("span");
      b.textContent = "";
      if (icon) b.appendChild(icon);
      b.appendChild(document.createTextNode(navLabels[i]));
    });
    // Panel title respecting active screen
    if (panelState.screen === "signals") setPanelTitle(t("sectionSignals"));
    else if (panelState.screen === "matrix") setPanelTitle(t("sectionMatrix"));
    else if (panelState.screen === "ai") setPanelTitle(t("sectionAI"));
    else if (panelState.screen === "profile") setPanelTitle(t("sectionProfile"));
    else setPanelTitle(t("sectionMain"));
  }
  function setText(sel, text) {
    var el = document.querySelector(sel);
    if (el) el.textContent = text;
  }

  // ---------- Boot ----------
  async function boot() {
    initTelegram();
    I18N.init();
    applyI18N();
    I18N.on(function () {
      applyI18N();
      // Re-render whatever screen is active so labels update too.
      if (panelState.screen === "signals") renderSignalsScreen();
      else if (panelState.screen === "matrix") renderMatrixScreen();
      else if (panelState.screen === "ai") renderAIScreen();
      else if (panelState.screen === "profile") renderProfileScreen();
      else renderDefaultScreen();
    });
    renderKPIs();
    wireEvents();
    renderTicker(); // placeholder
    await refreshTickers();
    renderDefaultScreen();
    // Optional: hook live socket if backend reachable
    if (API && typeof API.openMarketSocket === "function") {
      API.openMarketSocket(function (msg) {
        if (msg && msg.type === "snapshot" && msg.tickers) {
          liveTickers = msg.tickers;
          renderTicker();
          applyHeroSnapshot();
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
