/* =========================================================
   QUANTSIGNAL AI — i18n (no storage, in-memory only)
   ========================================================= */
(function (global) {
  "use strict";

  var DICT = {
    en: {
      brandTagline: "Signals, market, AI analysis",
      ctaOpenSignals: "Open signals",
      ctaAbout: "About",
      sectionMain: "Top now",
      sectionSignals: "Active signals",
      sectionMatrix: "Market matrix",
      sectionAI: "AI Assistant",
      sectionProfile: "Profile",
      navOverview: "Overview",
      navSignals: "Signals",
      navMatrix: "Market",
      navAI: "AI",
      navProfile: "Profile",
      kpiSignals: "Active signals",
      kpiCoins: "Coins watched",
      kpiAccuracy: "Model accuracy",
      kpiSignalsDelta: "+12% / 24h",
      kpiCoinsDelta: "+4 new",
      kpiAccuracyDelta: "7d average",
      aiTitle: "AI analysis",
      aiTrend: "Trend",
      aiConfidence: "Confidence",
      aiVolatility: "Volatility",
      bullish: "Bullish",
      bearish: "Bearish",
      medium: "medium",
      activeSignal: "Active signal",
      entry: "Entry",
      tp1: "Take-profit 1",
      tp2: "Take-profit 2",
      stop: "Stop-loss",
      potential: "Potential",
      details: "Details",
      refresh: "Refresh",
      aboutTitle: "About",
      aboutLead: "QUANTSIGNAL AI — a Telegram Mini App with a premium crypto terminal feel: signals, market overview, AI analysis and quick access to key sections.",
      languageLabel: "Language",
      askAI: "Ask the AI",
      send: "Send",
      thinking: "Thinking…",
      aiMockNotice: "Demo mode — connect a backend to enable live AI replies.",
      backendOffline: "Backend offline — showing demo data.",
      heroBadge: "live crypto intelligence"
    },
    ru: {
      brandTagline: "Сигналы, рынок, AI-анализ",
      ctaOpenSignals: "Открыть сигналы",
      ctaAbout: "О приложении",
      sectionMain: "Главное сейчас",
      sectionSignals: "Активные сигналы",
      sectionMatrix: "Матрица рынка",
      sectionAI: "AI-ассистент",
      sectionProfile: "Профиль",
      navOverview: "Обзор",
      navSignals: "Сигналы",
      navMatrix: "Рынок",
      navAI: "AI",
      navProfile: "Профиль",
      kpiSignals: "Активных сигналов",
      kpiCoins: "Монет в наблюдении",
      kpiAccuracy: "Точность модели",
      kpiSignalsDelta: "↑ 12% / 24ч",
      kpiCoinsDelta: "↑ 4 новые",
      kpiAccuracyDelta: "7д среднее",
      aiTitle: "AI-анализ",
      aiTrend: "Тренд",
      aiConfidence: "Уверенность",
      aiVolatility: "Волатильность",
      bullish: "Бычий",
      bearish: "Медвежий",
      medium: "средняя",
      activeSignal: "Активный сигнал",
      entry: "Точка входа",
      tp1: "Тейк-профит 1",
      tp2: "Тейк-профит 2",
      stop: "Стоп-лосс",
      potential: "Потенциал",
      details: "Подробнее",
      refresh: "Обновить",
      aboutTitle: "О приложении",
      aboutLead: "QUANTSIGNAL AI — Telegram Mini App в стиле premium crypto terminal: сигналы, рыночный обзор, AI-анализ и быстрый доступ к ключевым разделам.",
      languageLabel: "Язык",
      askAI: "Спросите AI",
      send: "Отправить",
      thinking: "Думаю…",
      aiMockNotice: "Демо-режим — подключите backend, чтобы получать живые ответы AI.",
      backendOffline: "Backend недоступен — показаны демо-данные.",
      heroBadge: "live crypto intelligence"
    },
    zh: {
      brandTagline: "信号、行情、AI 分析",
      ctaOpenSignals: "打开信号",
      ctaAbout: "关于",
      sectionMain: "当前要点",
      sectionSignals: "活跃信号",
      sectionMatrix: "市场矩阵",
      sectionAI: "AI 助手",
      sectionProfile: "个人资料",
      navOverview: "概览",
      navSignals: "信号",
      navMatrix: "行情",
      navAI: "AI",
      navProfile: "我",
      kpiSignals: "活跃信号",
      kpiCoins: "关注币种",
      kpiAccuracy: "模型准确率",
      kpiSignalsDelta: "↑ 12% / 24h",
      kpiCoinsDelta: "↑ 新增 4",
      kpiAccuracyDelta: "7天均值",
      aiTitle: "AI 分析",
      aiTrend: "趋势",
      aiConfidence: "置信度",
      aiVolatility: "波动性",
      bullish: "看多",
      bearish: "看空",
      medium: "中等",
      activeSignal: "活跃信号",
      entry: "入场",
      tp1: "止盈 1",
      tp2: "止盈 2",
      stop: "止损",
      potential: "潜力",
      details: "详情",
      refresh: "刷新",
      aboutTitle: "关于",
      aboutLead: "QUANTSIGNAL AI — 一个具备高端加密终端质感的 Telegram Mini App：信号、行情、AI 分析与快捷入口。",
      languageLabel: "语言",
      askAI: "向 AI 提问",
      send: "发送",
      thinking: "思考中…",
      aiMockNotice: "演示模式 — 连接后端以启用真实 AI 回复。",
      backendOffline: "后端不可用 — 显示演示数据。",
      heroBadge: "live crypto intelligence"
    }
  };

  var SUPPORTED = ["en", "ru", "zh"];
  var current = "ru"; // default before detection
  var listeners = [];

  function normalize(code) {
    if (!code) return null;
    var lc = String(code).toLowerCase();
    if (lc.indexOf("ru") === 0) return "ru";
    if (lc.indexOf("zh") === 0) return "zh";
    if (lc.indexOf("en") === 0) return "en";
    return null;
  }

  function detectFromTelegram() {
    try {
      var tg = global.Telegram && global.Telegram.WebApp;
      // language_code is exposed via initDataUnsafe but is OK for UI hints only.
      var lc = tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.language_code;
      return normalize(lc);
    } catch (e) {
      return null;
    }
  }

  function detectFromBrowser() {
    try {
      var nav = global.navigator;
      var langs = (nav && (nav.languages || [nav.language])) || [];
      for (var i = 0; i < langs.length; i++) {
        var n = normalize(langs[i]);
        if (n) return n;
      }
    } catch (e) {}
    return null;
  }

  function get() { return current; }

  function getSupported() { return SUPPORTED.slice(); }

  function t(key) {
    var d = DICT[current] || DICT.en;
    return d[key] != null ? d[key] : (DICT.en[key] != null ? DICT.en[key] : key);
  }

  function set(code) {
    var n = normalize(code) || "en";
    if (SUPPORTED.indexOf(n) < 0) n = "en";
    current = n;
    notify();
  }

  function on(fn) {
    listeners.push(fn);
    return function off() {
      listeners = listeners.filter(function (x) { return x !== fn; });
    };
  }

  function notify() {
    listeners.forEach(function (fn) {
      try { fn(current); } catch (e) {}
    });
  }

  function init() {
    var fromTg = detectFromTelegram();
    if (fromTg) { current = fromTg; return; }
    var fromBrowser = detectFromBrowser();
    if (fromBrowser) { current = fromBrowser; return; }
    current = "ru"; // preserve current default
  }

  global.QSI18N = {
    init: init,
    get: get,
    set: set,
    t: t,
    on: on,
    supported: getSupported
  };
})(window);
