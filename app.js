/* =========================================================
   QUANTSIGNAL AI — Telegram Mini App
   Static demo logic. No backend, no persistence APIs.
   ========================================================= */
(function () {
  "use strict";

  // ---------- Telegram WebApp SDK ----------
  var tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;

  function initTelegram() {
    if (!tg) return;
    try {
      tg.ready();
      tg.expand();
      // Sync header/background with our dark theme
      if (typeof tg.setHeaderColor === "function") tg.setHeaderColor("#0b0f14");
      if (typeof tg.setBackgroundColor === "function") tg.setBackgroundColor("#0b0f14");
      if (typeof tg.disableVerticalSwipes === "function") {
        try { tg.disableVerticalSwipes(); } catch (e) {}
      }
      // Reflect Telegram theme variables if present
      if (tg.themeParams && Object.keys(tg.themeParams).length) {
        document.body.classList.add("tg-themed");
        applyTelegramTheme(tg.themeParams);
      }
      tg.onEvent && tg.onEvent("themeChanged", function () {
        applyTelegramTheme(tg.themeParams || {});
      });
      // Platform info in footer
      var platformEl = document.getElementById("platform-info");
      if (platformEl && tg.platform && tg.platform !== "unknown") {
        platformEl.textContent = "Telegram • " + String(tg.platform).toUpperCase();
      }
    } catch (e) {
      // Telegram SDK runtime issues should never crash the page
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

  // ---------- Demo data ----------
  var TICKER = [
    { sym: "BTC",   price: "67,420", delta: "+1.84%", dir: "up" },
    { sym: "ETH",   price: "3,512",  delta: "+2.31%", dir: "up" },
    { sym: "SOL",   price: "184.20", delta: "-0.42%", dir: "dn" },
    { sym: "BNB",   price: "612.05", delta: "+0.65%", dir: "up" },
    { sym: "TON",   price: "7.18",   delta: "+4.12%", dir: "up" },
    { sym: "XRP",   price: "0.612",  delta: "-1.08%", dir: "dn" },
    { sym: "DOGE",  price: "0.158",  delta: "+3.04%", dir: "up" },
    { sym: "AVAX",  price: "36.41",  delta: "-0.91%", dir: "dn" },
    { sym: "ARB",   price: "1.082",  delta: "+2.55%", dir: "up" },
    { sym: "LINK",  price: "17.84",  delta: "+1.19%", dir: "up" }
  ];

  var SECTIONS = {
    "open-signals": {
      title: "Активные сигналы",
      rows: [
        { sym: "BTC",  text: "Лонг от <b>66.8K</b>, цель <b>69.4K</b>, риск 1.2%", value: "+1.84%", dir: "up" },
        { sym: "ETH",  text: "Лонг от <b>3.46K</b>, цель <b>3.62K</b>, риск 1.0%", value: "+2.31%", dir: "up" },
        { sym: "TON",  text: "Импульсный лонг, breakout уровня <b>7.05</b>",       value: "+4.12%", dir: "up" },
        { sym: "SOL",  text: "Шорт от <b>186</b>, цель <b>178</b>, риск 0.9%",     value: "-0.42%", dir: "down" }
      ]
    },
    "open-coins": {
      title: "Монеты и категории",
      rows: [
        { sym: "AI",     text: "AI&#8209;токены: лидер <b>FET</b>, средняя динамика +3.4%", value: "+3.4%", dir: "up" },
        { sym: "L2",     text: "Layer&#8209;2: усиление <b>ARB</b>, <b>OP</b>",             value: "+2.1%", dir: "up" },
        { sym: "DEFI",   text: "DeFi: ротация в <b>AAVE</b>, <b>UNI</b>",                   value: "+1.2%", dir: "up" },
        { sym: "MEME",   text: "Мемы: охлаждение, объёмы снижаются",                        value: "-1.6%", dir: "down" }
      ]
    },
    "open-derivs": {
      title: "Деривативы",
      rows: [
        { sym: "BTC",  text: "Открытый интерес <b>+4.2%</b>, фандинг положительный",         value: "OI ↑",  dir: "up" },
        { sym: "ETH",  text: "OI <b>+2.7%</b>, ликвидации шортов <b>$38M</b>",                value: "OI ↑",  dir: "up" },
        { sym: "SOL",  text: "Фандинг <b>-0.012%</b>, давление шортов растёт",                value: "F ↓",   dir: "down" },
        { sym: "TON",  text: "OI <b>+11%</b> за сутки, импульсное расширение",                value: "OI ↑↑", dir: "up" }
      ]
    },
    "open-movers": {
      title: "Рыночные движения",
      rows: [
        { sym: "PEPE", text: "Лидер 1ч: объём <b>×3.4</b> к среднему",                value: "+8.2%",  dir: "up" },
        { sym: "TON",  text: "Импульс на новостях, разгон с <b>6.90</b>",             value: "+4.12%", dir: "up" },
        { sym: "WIF",  text: "Аномалия объёма, тест уровня <b>2.40</b>",              value: "+5.6%",  dir: "up" },
        { sym: "AVAX", text: "Падение на ослаблении сектора L1",                       value: "-3.1%",  dir: "down" }
      ]
    },
    "default": {
      title: "Главное сейчас",
      rows: [
        { sym: "BTC",  text: "Тренд 4ч: <b>восходящий</b>, локальная цель 69.4K", value: "+1.84%", dir: "up" },
        { sym: "ETH",  text: "Сила сектора <b>выше средней</b>, ротация активна", value: "+2.31%", dir: "up" },
        { sym: "TON",  text: "Импульс <b>сильный</b>, фокус на пробое 7.40",      value: "+4.12%", dir: "up" }
      ]
    }
  };

  // ---------- Ticker ----------
  function renderTicker() {
    var track = document.getElementById("ticker-track");
    if (!track) return;
    var html = "";
    var seq = TICKER.concat(TICKER); // duplicated for seamless loop
    for (var i = 0; i < seq.length; i++) {
      var t = seq[i];
      html += '<span class="ticker-item">' +
              '<span class="sym">' + t.sym + '</span>' +
              '<span>$' + t.price + '</span>' +
              '<span class="' + (t.dir === "up" ? "up" : "dn") + '">' + t.delta + '</span>' +
              '</span>';
    }
    track.innerHTML = html;
  }

  // ---------- KPI counters ----------
  function animateCounter(el, target, opts) {
    opts = opts || {};
    var dur = opts.duration || 900;
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

  // ---------- Panel renderer ----------
  function renderPanel(key, useSkeleton) {
    var data = SECTIONS[key] || SECTIONS["default"];
    var titleEl = document.getElementById("panel-title");
    var bodyEl  = document.getElementById("panel-body");
    if (!bodyEl || !titleEl) return;
    titleEl.textContent = data.title;

    if (useSkeleton) {
      bodyEl.innerHTML =
        '<div class="skeleton"></div>' +
        '<div class="skeleton"></div>' +
        '<div class="skeleton"></div>';
      setTimeout(function () { renderPanel(key, false); }, 380);
      return;
    }

    var html = "";
    data.rows.forEach(function (r) {
      var cls = r.dir === "down" ? "down" : "up";
      html +=
        '<div class="row">' +
          '<span class="row-sym">' + r.sym + '</span>' +
          '<span class="row-text">' + r.text + '</span>' +
          '<span class="row-value ' + cls + '">' + r.value + '</span>' +
        '</div>';
    });
    bodyEl.innerHTML = html;

    // Scroll panel into view on action selection (small offset)
    var panel = document.getElementById("content-panel");
    if (panel) {
      var top = panel.getBoundingClientRect().top + window.scrollY - 12;
      window.scrollTo({ top: top, behavior: "smooth" });
    }
  }

  // ---------- Actions ----------
  function handleAction(action) {
    switch (action) {
      case "open-signals":
      case "open-coins":
      case "open-derivs":
      case "open-movers":
        haptic("light");
        renderPanel(action, true);
        break;
      case "open-about":
        haptic("selection");
        var about = document.getElementById("about-section");
        if (about) about.scrollIntoView({ behavior: "smooth", block: "start" });
        break;
      case "refresh":
        haptic("light");
        var titleEl = document.getElementById("panel-title");
        var key = "default";
        // Detect current key from title (best effort)
        Object.keys(SECTIONS).forEach(function (k) {
          if (SECTIONS[k].title === (titleEl && titleEl.textContent)) key = k;
        });
        renderPanel(key, true);
        break;
      case "reset":
        haptic("selection");
        window.scrollTo({ top: 0, behavior: "smooth" });
        renderPanel("default", true);
        break;
      default: break;
    }
  }

  function wireEvents() {
    document.addEventListener("click", function (e) {
      var el = e.target.closest("[data-action]");
      if (!el) return;
      e.preventDefault();
      handleAction(el.getAttribute("data-action"));
    });

    // Keyboard a11y for cards (button elements already focusable)
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var el = document.activeElement;
      if (el && el.matches("[data-action]")) {
        e.preventDefault();
        handleAction(el.getAttribute("data-action"));
      }
    });
  }

  // ---------- Boot ----------
  function boot() {
    initTelegram();
    renderTicker();
    renderKPIs();
    renderPanel("default", false);
    wireEvents();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
