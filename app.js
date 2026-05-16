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

  // ---------- Per-coin brand identity ----------
  // Glyph is intentionally ASCII / Unicode (no external assets) so the Telegram
  // WebView renders consistently. Palettes are driven by CSS [data-coin="..."].
  var COIN_BRANDS = {
    BTC:    { glyph: "₿", mark: "₿", label: "BTC" },
    ETH:    { glyph: "Ξ", mark: "Ξ", label: "ETH" },
    SOL:    { glyph: "◈", mark: "S", label: "SOL" },
    TON:    { glyph: "◇", mark: "T", label: "TON" },
    BNB:    { glyph: "♦", mark: "B", label: "BNB" },
    XRP:    { glyph: "✕", mark: "X", label: "XRP" },
    DOGE:   { glyph: "Ð", mark: "D", label: "DOGE" },
    ADA:    { glyph: "₳", mark: "A", label: "ADA" },
    AVAX:   { glyph: "▲", mark: "A", label: "AVAX" },
    LINK:   { glyph: "⬡", mark: "L", label: "LINK" },
    DOT:    { glyph: "●", mark: "D", label: "DOT" },
    POL:    { glyph: "⬢", mark: "P", label: "POL" },
    MATIC:  { glyph: "⬢", mark: "M", label: "MATIC" },
    LTC:    { glyph: "Ł", mark: "Ł", label: "LTC" },
    TRX:    { glyph: "▶", mark: "T", label: "TRX" },
    NEAR:   { glyph: "N", mark: "N", label: "NEAR" },
    ARB:    { glyph: "◉", mark: "A", label: "ARB" },
    OP:     { glyph: "○", mark: "O", label: "OP" },
    SUI:    { glyph: "💧", mark: "S", label: "SUI" },
    APT:    { glyph: "▤", mark: "A", label: "APT" },
    PEPE:   { glyph: "🐸", mark: "P", label: "PEPE" },
    "1000PEPE": { glyph: "🐸", mark: "P", label: "1000PEPE" },
    SHIB:   { glyph: "🐕", mark: "S", label: "SHIB" },
    "1000SHIB": { glyph: "🐕", mark: "S", label: "1000SHIB" },
    BCH:    { glyph: "Ƀ", mark: "B", label: "BCH" },
    UNI:    { glyph: "🦄", mark: "U", label: "UNI" },
    ATOM:   { glyph: "⚛", mark: "A", label: "ATOM" },
    ETC:    { glyph: "ξ", mark: "E", label: "ETC" },
    FIL:    { glyph: "⬚", mark: "F", label: "FIL" },
    INJ:    { glyph: "◆", mark: "I", label: "INJ" },
    TIA:    { glyph: "✧", mark: "T", label: "TIA" },
    WLD:    { glyph: "◯", mark: "W", label: "WLD" },
    AAVE:   { glyph: "◬", mark: "A", label: "AAVE" },
    RNDR:   { glyph: "▣", mark: "R", label: "RNDR" },
    FTM:    { glyph: "ƒ", mark: "F", label: "FTM" },
    HBAR:   { glyph: "ℏ", mark: "H", label: "HBAR" },
    ICP:    { glyph: "∞", mark: "I", label: "ICP" },
    ALGO:   { glyph: "△", mark: "A", label: "ALGO" },
    GALA:   { glyph: "★", mark: "G", label: "GALA" },
    SAND:   { glyph: "■", mark: "S", label: "SAND" },
    MANA:   { glyph: "◧", mark: "M", label: "MANA" },
    AXS:    { glyph: "♠", mark: "A", label: "AXS" },
    STX:    { glyph: "▰", mark: "S", label: "STX" },
    SEI:    { glyph: "▼", mark: "S", label: "SEI" },
    BLUR:   { glyph: "◐", mark: "B", label: "BLUR" },
    PYTH:   { glyph: "π", mark: "P", label: "PYTH" },
    JTO:    { glyph: "J", mark: "J", label: "JTO" },
    JUP:    { glyph: "♃", mark: "J", label: "JUP" },
    WIF:    { glyph: "🐶", mark: "W", label: "WIF" },
    ORDI:   { glyph: "◆", mark: "O", label: "ORDI" },
    BONK:   { glyph: "🔨", mark: "B", label: "BONK" },
    FLOKI:  { glyph: "🐺", mark: "F", label: "FLOKI" },
    RUNE:   { glyph: "ᛉ", mark: "R", label: "RUNE" },
    GMX:    { glyph: "✦", mark: "G", label: "GMX" },
    DYDX:   { glyph: "Δ", mark: "D", label: "DYDX" },
    ENS:    { glyph: ".",  mark: "E", label: "ENS" },
    CRV:    { glyph: "∿", mark: "C", label: "CRV" },
    COMP:   { glyph: "◷", mark: "C", label: "COMP" },
    MKR:    { glyph: "Μ", mark: "M", label: "MKR" },
    SNX:    { glyph: "✕", mark: "S", label: "SNX" },
    LDO:    { glyph: "Λ", mark: "L", label: "LDO" }
  };
  var COIN_BRAND_DEFAULT = { glyph: "◎", mark: "¤", label: "USD" };

  // ---------- Per-coin logo (inline SVG, no external assets) ----------
  // Each entry returns the *inner* SVG body. The outer <svg viewBox="0 0 36 36">
  // wrapper is added by `coinLogoSVG()`. Paths use `currentColor` so they paint
  // with the parent's `--coin-mark-fg`. Major coins get bespoke marks; every
  // other curated currency falls back to a deterministic monogram badge so the
  // UI never shows a broken icon.
  var COIN_LOGO_PATHS = {
    BTC: '<path d="M12.4 8h6.7c2.7 0 4.4 1.4 4.4 3.6 0 1.5-.8 2.6-2.1 3.2 1.7.5 2.7 1.8 2.7 3.6 0 2.4-1.9 4-4.8 4h-6.9V8Zm2.7 6.7h3.3c1.3 0 2.1-.6 2.1-1.7 0-1-.8-1.6-2.1-1.6h-3.3v3.3Zm0 5.7h3.6c1.4 0 2.3-.6 2.3-1.8 0-1.1-.9-1.8-2.3-1.8h-3.6v3.6Z" fill="currentColor"/><path d="M15.7 5.5h1.8V8h-1.8V5.5Zm0 19h1.8V27h-1.8v-2.5ZM19.4 5.5h1.8V8h-1.8V5.5Zm0 19h1.8V27h-1.8v-2.5Z" fill="currentColor"/>',
    ETH: '<path d="M18 4 9.5 18l8.5 5 8.5-5L18 4Z" fill="currentColor" opacity=".75"/><path d="M18 4v19l8.5-5L18 4Z" fill="currentColor"/><path d="M9.5 19.5 18 32l8.5-12.5L18 24.5 9.5 19.5Z" fill="currentColor" opacity=".55"/>',
    SOL: '<path d="M9 12.5h17l-2.5 2.8H6.5L9 12.5Zm0 5.2h17l-2.5 2.8H6.5L9 17.7Zm-2.5 5.2h17L21 25.7H4l2.5-2.8Z" fill="currentColor"/>',
    TON: '<path d="M9 11h18L18 28 9 11Zm9 14.8L23.9 13H12.1L18 25.8Z" fill="currentColor"/><path d="M16.6 13h-4.5L18 24.2 16.6 13Zm2.8 0L18 24.2 23.9 13h-4.5Z" fill="currentColor" opacity=".7"/>',
    BNB: '<path d="M18 6.5 11.5 13l2.6 2.6L18 11.7l3.9 3.9 2.6-2.6L18 6.5Zm-9 9 2.6 2.6L9 20.6l2.6 2.6L9 25.8 6.4 23.2 9 20.6 6.4 18l2.6-2.6Zm18 0L24.4 18l2.6 2.6-2.6 2.6L27 25.8l2.6-2.6L27 20.6l2.6-2.6L27 15.4ZM18 13.6 14.7 17 18 20.3 21.3 17 18 13.6Zm0 9.7-3.9-3.9-2.6 2.6L18 28.5l6.5-6.5-2.6-2.6L18 23.3Z" fill="currentColor"/>',
    XRP: '<path d="M7.5 8 12 12.5 16.5 8h3L13.7 14 19 19.3 23 15.3 27.5 19.8h-3L20 15.3 16 19.3 10.3 13.6 16.5 7.4l-3-.1L9 11.5 4.5 7l3 1ZM7.5 28 12 23.5l4.5 4.5h3L13.7 22l5.3-5.3 4 4 4.5-4.5h-3L20 20.7l-4-4-5.7 5.7L16.5 28h-3L9 24.5 4.5 29l3-1Z" fill="currentColor"/>',
    DOGE: '<path d="M9 8h6.5c5 0 8 3.4 8 10s-3.4 10-8.6 10H9V18.5H7v-2.7h2V8Zm2.8 2.7v5h3.4v2.6h-3.4V25.3h2.9c3.4 0 5.4-2.3 5.4-7.3 0-5.1-2-7.3-5.2-7.3h-3.1Z" fill="currentColor"/>',
    ADA: '<circle cx="18" cy="18" r="2.4" fill="currentColor"/><circle cx="18" cy="8" r="1.5" fill="currentColor"/><circle cx="18" cy="28" r="1.5" fill="currentColor"/><circle cx="9.3" cy="13" r="1.5" fill="currentColor"/><circle cx="26.7" cy="13" r="1.5" fill="currentColor"/><circle cx="9.3" cy="23" r="1.5" fill="currentColor"/><circle cx="26.7" cy="23" r="1.5" fill="currentColor"/><circle cx="6" cy="18" r="1.3" fill="currentColor" opacity=".7"/><circle cx="30" cy="18" r="1.3" fill="currentColor" opacity=".7"/><circle cx="12" cy="6" r="1.1" fill="currentColor" opacity=".5"/><circle cx="24" cy="6" r="1.1" fill="currentColor" opacity=".5"/><circle cx="12" cy="30" r="1.1" fill="currentColor" opacity=".5"/><circle cx="24" cy="30" r="1.1" fill="currentColor" opacity=".5"/>',
    AVAX: '<path d="M18 7 6 27h6l2.5-4.4h7L24 27h6L18 7Zm-2.1 14.5L18 17l2.1 4.5h-4.2Z" fill="currentColor"/>',
    LINK: '<path d="M18 5 6.5 11.5v13L18 31l11.5-6.5v-13L18 5Zm0 3.5 8.5 4.8v9.4L18 27.5l-8.5-4.8v-9.4L18 8.5Z" fill="currentColor"/><circle cx="18" cy="18" r="3.4" fill="currentColor"/>',
    DOT: '<ellipse cx="18" cy="9" rx="4.5" ry="2.3" fill="currentColor"/><ellipse cx="18" cy="27" rx="4.5" ry="2.3" fill="currentColor"/><ellipse cx="10.3" cy="13.5" rx="4.5" ry="2.3" transform="rotate(-60 10.3 13.5)" fill="currentColor"/><ellipse cx="25.7" cy="13.5" rx="4.5" ry="2.3" transform="rotate(60 25.7 13.5)" fill="currentColor"/><ellipse cx="10.3" cy="22.5" rx="4.5" ry="2.3" transform="rotate(60 10.3 22.5)" fill="currentColor"/><ellipse cx="25.7" cy="22.5" rx="4.5" ry="2.3" transform="rotate(-60 25.7 22.5)" fill="currentColor"/>',
    POL: '<path d="M22 11.5 18 9.2 14 11.5v3.4l4-2.3 4 2.3v3.4l-4 2.3-4-2.3v-3.4l-4 2.3v3.4l4 2.3 4-2.3v-3.4l4-2.3v-3.4Z" fill="currentColor"/><path d="M22 17.3v3.4l4 2.3 4-2.3v-3.4l-4 2.3-4-2.3Z" fill="currentColor" opacity=".7"/>',
    MATIC: '<path d="M22 11.5 18 9.2 14 11.5v3.4l4-2.3 4 2.3v3.4l-4 2.3-4-2.3v-3.4l-4 2.3v3.4l4 2.3 4-2.3v-3.4l4-2.3v-3.4Z" fill="currentColor"/>',
    LTC: '<path d="M16.6 6h3.6L17.7 16l3.5-1-.7 2.8-3.5 1L15.3 25h9.4l-.7 3H11l2.9-10.7-2.9.8.7-2.8 2.9-.8L16.6 6Z" fill="currentColor"/>',
    TRX: '<path d="M6 8 30 12 15 30 6 8Zm3.1 1.7 4.9 7.4 11.4-4-16.3-3.4Zm6.5 8.6L14.4 27l9.2-11.2-8 2.5Z" fill="currentColor"/>',
    NEAR: '<path d="M8 8v20h3V14l13.5 14h3.5V8h-3v13.8L11.7 8H8Z" fill="currentColor"/>',
    ARB: '<path d="M18 5 6 12v12l12 7 12-7V12L18 5Zm0 3 9.5 5.5v9L18 28l-9.5-5.5v-9L18 8Z" fill="currentColor"/><path d="m14 22 4-10 4 10h-2.2l-1.8-4.5-1.8 4.5H14Z" fill="currentColor"/>',
    OP: '<circle cx="18" cy="18" r="11" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11.5 20.5c0-2.5 1.5-4 3.7-4 2.2 0 3.7 1.5 3.7 4s-1.5 4-3.7 4c-2.2 0-3.7-1.5-3.7-4Zm2 0c0 1.5.6 2.3 1.7 2.3 1.1 0 1.7-.8 1.7-2.3s-.6-2.3-1.7-2.3c-1.1 0-1.7.8-1.7 2.3Zm7.5-4h3.4c1.7 0 2.7 1 2.7 2.5s-1 2.5-2.7 2.5h-1.7v2.8h-1.7v-7.8Zm1.7 1.6v1.8h1.4c.7 0 1.1-.3 1.1-.9s-.4-.9-1.1-.9h-1.4Z" fill="currentColor"/>',
    SUI: '<path d="M18 4c-3.3 4-9 9.5-9 15.5C9 25 13 29 18 29s9-4 9-9.5C27 13.5 21.3 8 18 4Zm0 4.2c2.4 3.2 6 7.5 6 11.3 0 3.4-2.7 6-6 6s-6-2.6-6-6c0-3.8 3.6-8.1 6-11.3Z" fill="currentColor"/>',
    APT: '<circle cx="18" cy="18" r="11" fill="none" stroke="currentColor" stroke-width="2"/><path d="M11 14h6.5l1.2-1.6h2l1.2 1.6H25v1.7h-3.5l-.8-1.1-.8 1.1H11v-1.7Zm0 4h14v1.7H11V18Zm0 4h4.5l1.2 1.6h2l1.2-1.6H25v1.7h-3.5l-.8 1.1-.8-1.1H11v-1.7Z" fill="currentColor"/>',
    BCH: '<path d="M12.4 8h6.7c2.7 0 4.4 1.4 4.4 3.6 0 1.5-.8 2.6-2.1 3.2 1.7.5 2.7 1.8 2.7 3.6 0 2.4-1.9 4-4.8 4h-6.9V8Zm2.7 6.7h3.3c1.3 0 2.1-.6 2.1-1.7 0-1-.8-1.6-2.1-1.6h-3.3v3.3Zm0 5.7h3.6c1.4 0 2.3-.6 2.3-1.8 0-1.1-.9-1.8-2.3-1.8h-3.6v3.6Z" fill="currentColor"/>',
    UNI: '<path d="M11 6c4 4 8 8 9 13 1-2 2-3 4-3-1 4-5 7-9 7s-7-3-7-6c0-4 2-7 3-11Z" fill="currentColor"/><circle cx="20" cy="22" r="2" fill="currentColor"/><circle cx="25" cy="14" r="1.5" fill="currentColor" opacity=".7"/>',
    ATOM: '<ellipse cx="18" cy="18" rx="10" ry="4" fill="none" stroke="currentColor" stroke-width="1.8"/><ellipse cx="18" cy="18" rx="10" ry="4" transform="rotate(60 18 18)" fill="none" stroke="currentColor" stroke-width="1.8"/><ellipse cx="18" cy="18" rx="10" ry="4" transform="rotate(-60 18 18)" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="18" r="2.2" fill="currentColor"/>',
    ETC: '<path d="M18 4 9.5 18l8.5 5 8.5-5L18 4Z" fill="currentColor" opacity=".75"/><path d="M18 4v19l8.5-5L18 4Z" fill="currentColor"/><path d="M9.5 19.5 18 32l8.5-12.5L18 24.5 9.5 19.5Z" fill="currentColor" opacity=".55"/>',
    FIL: '<circle cx="18" cy="18" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 14h12l-1 2h-4l-.5 2.5h3l-.5 2h-3L17 26h-2l1.2-5.5h-2l-.5-2h2l.5-2.5h-3l-1-2Z" fill="currentColor"/>',
    INJ: '<path d="M18 5c-4 4-8 7-8 12s4 9 8 9 8-4 8-9-4-8-8-12Zm0 4.2c2.5 3 5 5.5 5 8.4 0 2.8-2.2 5-5 5s-5-2.2-5-5c0-2.9 2.5-5.4 5-8.4Z" fill="currentColor"/>',
    TIA: '<path d="M18 5 8 20h7l-2 7 13-15h-7l2-7H18Z" fill="currentColor"/>',
    WLD: '<circle cx="18" cy="18" r="11" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="18" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 18h22M18 7v22" stroke="currentColor" stroke-width="1.5"/>',
    AAVE: '<path d="M18 5 6 28h3.5l2.4-5.5H24l2.5 5.5H30L18 5Zm0 6 3.5 8.2h-7L18 11Z" fill="currentColor"/><path d="M18 17h2v2h-2zM16 19h4v2h-4z" fill="currentColor"/>',
    RNDR: '<path d="M9 8h8.5c3 0 5 1.8 5 4.5 0 2-1.2 3.5-3 4.2L24 28h-3.4l-4.2-10.5h-3.7V28H9V8Zm3.7 2.7v4.5h4.5c1.5 0 2.5-.9 2.5-2.2 0-1.4-1-2.3-2.5-2.3h-4.5Z" fill="currentColor"/>',
    FTM: '<path d="M18 5 8 11v13l10 6 10-6V11L18 5Zm0 2.7 7 4.2v9l-7 4.2-7-4.2v-9l7-4.2Z" fill="currentColor"/><path d="m11 14 7 4.2 7-4.2-7-4.2-7 4.2Zm0 9 7 4.2 7-4.2v-6l-7 4.2-7-4.2v6Z" fill="currentColor"/>',
    HBAR: '<circle cx="18" cy="18" r="11" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 9h2.2v6.7h7.6V9H24v18h-2.2v-7.3h-7.6V27H12V9Z" fill="currentColor"/>',
    ICP: '<path d="M6 18c0-3 2.2-5.5 5.5-5.5 1.8 0 3.2 1 4.2 2.3.7-.9 1.6-1.6 2.5-2.2 1-1 2.4-1.6 3.8-1.6 3.5 0 5.5 2.5 5.5 5.5s-2 5.5-5.5 5.5c-1.4 0-2.8-.6-3.8-1.6-.9-.6-1.8-1.3-2.5-2.2C14.7 19.5 13.3 20.5 11.5 20.5 8.2 20.5 6 21 6 18Zm5.5-3c1.8 0 2.7 1.3 4.2 3-1.5 1.7-2.4 3-4.2 3-1.8 0-3-1.3-3-3s1.2-3 3-3Zm13 0c-1.4 0-2.5 1-3 2 .5 1 1.6 2 3 2 1.8 0 3-1.3 3-3s-1.2-3-3-3Z" fill="currentColor"/>',
    ALGO: '<path d="M9 26 17 12l1.3 2.4-7.6 11.6H9Zm6.5 0 4-7 1.3 2.3-2.7 4.7h-2.6Zm5 0L23 21l1.5 5h-3.5l-.5-.7Zm-3.3-15h3l.8 3-3.8.5V11Z" fill="currentColor"/>',
    GALA: '<path d="M18 5 5 12.5v11L18 31l13-7.5v-11L18 5Zm0 3 10 5.8v8.4L18 28 8 22.2v-8.4L18 8Z" fill="currentColor"/><path d="m13 15 5 3 5-3v6l-5 3-5-3v-6Z" fill="currentColor"/>',
    SAND: '<rect x="8" y="8" width="6" height="6" fill="currentColor"/><rect x="22" y="8" width="6" height="6" fill="currentColor"/><rect x="15" y="15" width="6" height="6" fill="currentColor"/><rect x="8" y="22" width="6" height="6" fill="currentColor"/><rect x="22" y="22" width="6" height="6" fill="currentColor"/>',
    MANA: '<path d="M6 27 18 9v18H6Z" fill="currentColor" opacity=".85"/><path d="M30 27 18 9v18h12Z" fill="currentColor" opacity=".6"/><circle cx="13" cy="20" r="2" fill="#fff"/><circle cx="23" cy="20" r="2" fill="#fff"/>',
    AXS: '<path d="M6 28 18 6l12 22H6Zm5 0h14L18 14 11 28Z" fill="currentColor"/><path d="M14 28 18 18l4 10h-8Z" fill="currentColor"/>',
    STX: '<path d="M9 8h18v3H9V8Zm0 6h18v3H9v-3Zm0 6h18v3H9v-3Zm0 6h18v3H9v-3Z" fill="currentColor"/><path d="M11.5 11h2L11 14h-2l2.5-3Zm11 0h2L27 14h-2l-2.5-3Z" fill="currentColor"/>',
    SEI: '<path d="M6 12c4 0 4 3 8 3s4-3 8-3 4 3 8 3" stroke="currentColor" stroke-width="2.4" fill="none"/><path d="M6 18c4 0 4 3 8 3s4-3 8-3 4 3 8 3" stroke="currentColor" stroke-width="2.4" fill="none"/><path d="M6 24c4 0 4 3 8 3s4-3 8-3 4 3 8 3" stroke="currentColor" stroke-width="2.4" fill="none"/>',
    BLUR: '<circle cx="18" cy="18" r="11" fill="currentColor" opacity=".25"/><circle cx="14" cy="18" r="7" fill="currentColor" opacity=".55"/><circle cx="22" cy="18" r="7" fill="currentColor"/>',
    PYTH: '<path d="M18 5v14M18 19c-4 0-7-2-7-5s3-5 7-5 7 2 7 5-3 5-7 5Zm0 0v8M11 22h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/>',
    JTO: '<path d="M14 8h8v14c0 4-2 6-6 6s-6-2-6-6v-2h3.4v2c0 2 .9 3 2.6 3s2.6-1 2.6-3V11H14V8Z" fill="currentColor"/>',
    JUP: '<circle cx="13" cy="14" r="6" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="23" cy="22" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="m17 14 6 8" stroke="currentColor" stroke-width="2"/>',
    WIF: '<path d="M9 11c2-3 6-4 9-4s7 1 9 4l-2 2c-1 6-3 11-7 11s-6-5-7-11l-2-2Z" fill="currentColor"/><circle cx="14" cy="14" r="1.5" fill="#fff"/><circle cx="22" cy="14" r="1.5" fill="#fff"/><path d="M6 12 9 9m18 3 3-3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    ORDI: '<path d="M9 11h18v3H9v-3Zm0 5h18v3H9v-3Zm0 5h18v3H9v-3Zm0 5h12v2H9v-2Z" fill="currentColor"/>',
    BONK: '<path d="M9 22c-1-3 1-9 5-12s10-2 12 1c2 3 1 8-2 11s-9 4-13 3l-2-3Z" fill="currentColor"/><circle cx="14" cy="16" r="1.6" fill="#fff"/><circle cx="22" cy="14" r="1.6" fill="#fff"/><path d="M14 22c1 1.5 3 2 5 1" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
    FLOKI: '<path d="M7 13c2-4 7-6 11-6s7 2 10 5l1 4-3 1c-1 5-3 11-8 11s-7-4-8-9l-3-1V13Z" fill="currentColor"/><path d="m7 13 4-3 2 3-2 2-4-2Zm22 0-4-3-2 3 2 2 4-2Z" fill="currentColor"/><circle cx="14" cy="16" r="1.5" fill="#fff"/><circle cx="22" cy="16" r="1.5" fill="#fff"/>',
    RUNE: '<path d="M18 5 7 12v12l11 7 11-7V12L18 5Zm0 3 8 5v10l-8 5-8-5V13l8-5Z" fill="currentColor"/><path d="M12 14h12v3l-6 4-6-4v-3Zm0 6 6 4 6-4v3l-6 4-6-4v-3Z" fill="currentColor"/>',
    GMX: '<path d="M6 26 18 6l12 20H6Zm5 0 7-11 7 11H11Z" fill="currentColor"/><path d="m13 26 5-8 5 8h-10Z" fill="currentColor"/>',
    DYDX: '<path d="M8 8h4l8 18h-4L8 8Zm12 0h4l-7 18h-4l7-18Z" fill="currentColor"/>',
    ENS: '<path d="M18 4c-2 3-9 9-9 14s7 11 9 14c2-3 9-9 9-14s-7-11-9-14Zm0 4c2 2 6 6 6 10s-4 8-6 10c-2-2-6-6-6-10s4-8 6-10Z" fill="currentColor"/>',
    CRV: '<path d="M6 22c2-8 6-12 12-12s10 4 12 12l-2 .8c-1.6-6.8-5-10.4-10-10.4S8 16 6.4 22.8L6 22Zm0 2c2-2 6-2 12 0s10 2 12 0v3c-2 2-6 2-12 0s-10-2-12 0v-3Z" fill="currentColor"/>',
    COMP: '<circle cx="18" cy="18" r="11" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="18" cy="18" r="7" fill="none" stroke="currentColor" stroke-width="2" opacity=".7"/><circle cx="18" cy="18" r="3" fill="currentColor"/>',
    MKR: '<path d="M7 8v20h3V13l4 9h3l4-9v15h3V8h-3l-5.5 12L13 8H7Z" fill="currentColor"/>',
    SNX: '<path d="M9 8 27 28M27 8 9 28" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>',
    LDO: '<path d="M18 5 9 18l9 13 9-13L18 5Zm0 4 6.3 9L18 26.5 11.7 18 18 9Z" fill="currentColor"/><path d="M18 12 14 18l4 5 4-5-4-6Z" fill="currentColor"/>'
  };
  COIN_LOGO_PATHS["1000PEPE"] = '<path d="M9 14c0-4 4-7 9-7s9 3 9 7v3l-3 1c-1 6-3 11-6 11s-5-5-6-11l-3-1v-3Z" fill="currentColor"/><circle cx="14" cy="14" r="1.6" fill="#fff"/><circle cx="22" cy="14" r="1.6" fill="#fff"/><circle cx="14" cy="14" r=".8" fill="currentColor"/><circle cx="22" cy="14" r=".8" fill="currentColor"/><path d="M14 21c1 1.5 3 2 5 1" stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/>';
  COIN_LOGO_PATHS.PEPE = COIN_LOGO_PATHS["1000PEPE"];
  COIN_LOGO_PATHS["1000SHIB"] = '<path d="M7 13c2-4 7-6 11-6s8 2 11 6l-1 3c-1 6-4 11-9 11s-9-4-10-10l-2-4Z" fill="currentColor"/><path d="m7 13 4-3 2 3-3 2-3-2Zm22 0-4-3-2 3 3 2 3-2Z" fill="currentColor"/><circle cx="14" cy="16" r="1.5" fill="#fff"/><circle cx="22" cy="16" r="1.5" fill="#fff"/>';
  COIN_LOGO_PATHS.SHIB = COIN_LOGO_PATHS["1000SHIB"];

  function coinKey(symbol) {
    var s = shortSym(symbol).toUpperCase();
    return COIN_BRANDS[s] ? s : "DEFAULT";
  }
  function coinBrand(symbol) {
    var key = coinKey(symbol);
    return key === "DEFAULT" ? COIN_BRAND_DEFAULT : COIN_BRANDS[key];
  }
  // Deterministic 2-letter monogram for the fallback badge.
  function coinMonogram(symbol) {
    var s = shortSym(symbol).toUpperCase().replace(/^1000/, "");
    if (!s) return "¤";
    if (s.length <= 2) return s;
    // Drop common suffixes like USDT/USDC defensively.
    s = s.replace(/USDT$|USDC$|BUSD$/, "");
    return s.slice(0, Math.min(3, s.length));
  }
  // Render a logo as inline SVG. Always 36×36 viewBox so it scales cleanly
  // inside any container (.coin-mark, .row-coin, .coin-chip__mark, etc.).
  function coinLogoSVG(symbol) {
    var s = shortSym(symbol).toUpperCase();
    var body = COIN_LOGO_PATHS[s];
    if (!body) {
      // Fallback monogram badge: a soft outer ring + the coin's initials,
      // centered. currentColor inherits the per-coin --coin-mark-fg.
      var text = coinMonogram(symbol);
      var size = text.length >= 4 ? 9 : text.length === 3 ? 11 : 13;
      body =
        '<circle cx="18" cy="18" r="14" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".55"/>' +
        '<text x="18" y="18" text-anchor="middle" dominant-baseline="central" ' +
        'font-family="JetBrains Mono, ui-monospace, monospace" font-weight="800" ' +
        'font-size="' + size + '" fill="currentColor" letter-spacing="-0.4">' +
        escapeHtml(text) + '</text>';
    }
    return '<svg class="coin-logo" viewBox="0 0 36 36" width="100%" height="100%" ' +
           'aria-hidden="true" focusable="false">' + body + '</svg>';
  }

  function applyCoinBranding(symbol) {
    var key = coinKey(symbol);
    var brand = coinBrand(symbol);
    var card = $("#hero-card");
    var mark = $("#hero-coin-mark");
    var glyph = $("#hero-banner-glyph");
    var tag = $("#hero-banner-tag");
    if (card) card.setAttribute("data-coin", key);
    if (mark) {
      mark.setAttribute("data-coin", key);
      mark.innerHTML = coinLogoSVG(symbol);
    }
    if (glyph) glyph.textContent = brand.glyph;
    if (tag) tag.textContent = brand.label;
  }
  // Expose for tests/debug.
  window.QSI_COIN = window.QSI_COIN || {};
  window.QSI_COIN.coinLogoSVG = coinLogoSVG;
  window.QSI_COIN.coinKey = coinKey;
  window.QSI_COIN.coinBrand = coinBrand;
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
    klineError: {},         // "SYMBOL|tf" -> error code
    marketQuery: "",        // current market-screen search filter
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
    if (name === "market") { renderCoinChips(); renderMarketScreen(); }
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
    applyCoinBranding(t.symbol);
    if (pairEl) pairEl.textContent = t.symbol;
    if (priceEl) priceEl.textContent = fmtPrice(t.last_price);
    if (tagEl) tagEl.textContent = fmtPrice(t.last_price);
    if (volEl) volEl.textContent = fmtCompact(t.volume_24h);
    if (deltaEl) {
      deltaEl.textContent = fmtPct(t.change_pct_24h);
      deltaEl.classList.toggle("dn", t.change_pct_24h < 0);
    }
    ensureKlines(t.symbol, state.tf);
    // Sync chart status overlay with cached load state for the current key.
    var key = klineKey(t.symbol, state.tf);
    if (state.klines[key]) setChartStatus(null, false);
    else if (state.klineError[key]) setChartStatus(I18N.t("chartUnavailable"), true);
    else if (state.klineLoading[key]) setChartStatus(I18N.t("chartLoading"), false);
    renderHeroChart(t);
    renderLastSignal();
  }

  // ---------- Last-signal card (reference-style summary on overview) ----------
  function renderLastSignal() {
    var card = $("#last-signal-card");
    if (!card) return;
    var signals = computeSignals();
    var top = signals && signals[0];
    if (!top) return;
    var k = coinKey(top.symbol);
    var mark = $("#last-signal-mark");
    if (mark) {
      mark.setAttribute("data-coin", k);
      mark.innerHTML = coinLogoSVG(top.symbol);
    }
    var pairEl = $("#last-signal-pair");
    if (pairEl) {
      var s = String(top.symbol || "");
      var quote = s.indexOf("USDT") >= 0 ? "USDT" : (s.slice(-4));
      pairEl.textContent = shortSym(top.symbol) + "/" + quote;
    }
    var sideEl = $("#last-signal-side");
    if (sideEl) {
      sideEl.classList.toggle("last-signal__side--short", top.direction === "SHORT");
      sideEl.classList.toggle("last-signal__side--long", top.direction !== "SHORT");
      sideEl.textContent = top.direction === "SHORT" ? I18N.t("sideShort") : I18N.t("sideLong");
    }
    var entryEl = $("#last-signal-entry");
    var tp1El = $("#last-signal-tp1");
    var tp2El = $("#last-signal-tp2");
    var stopEl = $("#last-signal-stop");
    if (entryEl) entryEl.textContent = fmtPrice(top.entry);
    if (tp1El) tp1El.textContent = fmtPrice(top.take_profit_1);
    if (tp2El) tp2El.textContent = fmtPrice(top.take_profit_2);
    if (stopEl) stopEl.textContent = fmtPrice(top.stop_loss);
  }

  function klineKey(symbol, tf) { return symbol + "|" + tf; }

  function ensureKlines(symbol, tf) {
    var key = klineKey(symbol, tf);
    if (state.klines[key] || state.klineLoading[key]) return;
    var interval = TF_TO_BYBIT[tf] || "5";
    state.klineLoading[key] = true;
    state.klineError[key] = null;
    if (state.screen === "overview" && state.selectedSymbol === symbol && state.tf === tf) {
      setChartStatus(I18N.t("chartLoading"), false);
    }
    // Hard ceiling so the "Loading chart…" overlay can never live forever
    // even if both the proxy and the fallbacks hang. The API layer already
    // applies its own 8s per-request timeout; this is belt-and-suspenders.
    var settled = false;
    var watchdog = setTimeout(function () {
      if (settled) return;
      settled = true;
      state.klineLoading[key] = false;
      state.klineError[key] = "timeout";
      if (state.screen === "overview" && state.selectedSymbol === symbol && state.tf === tf) {
        setChartStatus(I18N.t("chartUnavailable"), true);
        var t = state.tickerMap[symbol];
        if (t) renderHeroChart(t); // keep placeholder bars visible
      }
    }, 15000);
    API.bybitGetKlines(symbol, interval, 60).then(function (rows) {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      state.klines[key] = rows;
      state.klineLoading[key] = false;
      if (state.screen === "overview" && state.selectedSymbol === symbol && state.tf === tf) {
        setChartStatus(null, false);
        var t = state.tickerMap[symbol];
        if (t) renderHeroChart(t);
      }
    }).catch(function (err) {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      state.klineLoading[key] = false;
      // Proxy returns a structured `provider_unavailable` body when neither
      // Bybit nor any fallback could serve the request; surface that code so
      // the overlay reflects the real situation instead of a generic error.
      var code = "error";
      if (err && err.payload && typeof err.payload === "object" && err.payload.error) {
        code = err.payload.error;
      } else if (err && err.message) {
        code = err.message;
      }
      state.klineError[key] = code;
      if (state.screen === "overview" && state.selectedSymbol === symbol && state.tf === tf) {
        setChartStatus(I18N.t("chartUnavailable"), true);
        var tk = state.tickerMap[symbol];
        if (tk) renderHeroChart(tk); // placeholder bars still drawn
      }
    });
  }

  function setChartStatus(message, isError) {
    var el = $("#hero-chart-status");
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = "";
      el.classList.remove("is-error");
      return;
    }
    el.hidden = false;
    el.textContent = message;
    el.classList.toggle("is-error", !!isError);
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
  function buildOverviewRow(t) {
    var cKey = coinKey(t.symbol);
    var row = document.createElement("div");
    row.className = "row";
    row.setAttribute("data-symbol", t.symbol);
    row.innerHTML =
      '<span class="row-coin" data-coin="' + cKey + '">' + coinLogoSVG(t.symbol) + '</span>' +
      '<span><b>' + escapeHtml(shortSym(t.symbol)) + '</b><br>' +
        '<span class="row-price" style="color:var(--ink-2);font-size:11px;"></span></span>' +
      '<span class="row-delta"></span>' +
      '<span class="row-vol" style="color:var(--ink-3);font-family:JetBrains Mono,monospace;font-size:10px;"></span>';
    return row;
  }

  function updateOverviewRow(row, t) {
    var pos = t.change_pct_24h >= 0;
    var priceEl = row.querySelector(".row-price");
    var priceText = "$" + fmtPrice(t.last_price);
    if (priceEl && priceEl.textContent !== priceText) priceEl.textContent = priceText;
    var deltaEl = row.querySelector(".row-delta");
    var deltaText = fmtPct(t.change_pct_24h);
    var deltaCls = pos ? "row-delta up" : "row-delta dn";
    if (deltaEl) {
      if (deltaEl.className !== deltaCls) deltaEl.className = deltaCls;
      if (deltaEl.textContent !== deltaText) deltaEl.textContent = deltaText;
    }
    var volEl = row.querySelector(".row-vol");
    var volText = "vol " + fmtCompact(t.volume_24h);
    if (volEl && volEl.textContent !== volText) volEl.textContent = volText;
  }

  // Diff-update overview rows so taps on a "top coin" row stay stable
  // across live ticks (rows are reused by symbol).
  function renderOverviewRows() {
    var el = $("#overview-rows");
    if (!el) return;
    var rows = (state.tickers || []).slice(0, 5);
    if (!rows.length) {
      if (el.getAttribute("data-state") !== "loading") {
        el.setAttribute("data-state", "loading");
        el.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
      }
      return;
    }
    if (el.getAttribute("data-state") !== "ready") {
      el.setAttribute("data-state", "ready");
      var stale = [];
      for (var s = 0; s < el.children.length; s++) {
        var sc = el.children[s];
        if (!sc.getAttribute || !sc.getAttribute("data-symbol")) stale.push(sc);
      }
      stale.forEach(function (n) { el.removeChild(n); });
    }

    var existing = {};
    var kids = el.children;
    for (var i = 0; i < kids.length; i++) {
      var node = kids[i];
      var sym = node.getAttribute && node.getAttribute("data-symbol");
      if (sym) existing[sym] = node;
    }

    var prevSibling = null;
    var wanted = {};
    rows.forEach(function (t) {
      wanted[t.symbol] = true;
      var row = existing[t.symbol];
      if (!row) row = buildOverviewRow(t);
      updateOverviewRow(row, t);
      var target = prevSibling ? prevSibling.nextSibling : el.firstChild;
      if (target !== row) el.insertBefore(row, target);
      prevSibling = row;
    });

    var remove = [];
    for (var j = 0; j < kids.length; j++) {
      var c = kids[j];
      var ss = c.getAttribute && c.getAttribute("data-symbol");
      if (!ss || !wanted[ss]) remove.push(c);
    }
    remove.forEach(function (n) { el.removeChild(n); });
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
      var sKey = coinKey(s.symbol);
      html += '<article class="signal-card ' + cardClass + '" data-signal-id="' + escapeHtml(s.id) + '" data-signal-idx="' + idx + '" data-coin="' + sKey + '">' +
        '<div class="signal-card__head">' +
          '<div class="signal-card__sym"><span class="row-coin" data-coin="' + sKey + '">' + coinLogoSVG(s.symbol) + '</span>' + escapeHtml(s.symbol) + '</div>' +
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
  function filterTickers(rows, query) {
    var q = String(query || "").trim().toUpperCase();
    if (!q) return rows;
    return rows.filter(function (t) {
      var sym = String(t.symbol || "").toUpperCase();
      var shortS = shortSym(sym).toUpperCase();
      return sym.indexOf(q) >= 0 || shortS.indexOf(q) >= 0;
    });
  }

  function buildCoinChip(sym) {
    var k = coinKey(sym);
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "coin-chip";
    btn.setAttribute("data-coin", k);
    btn.setAttribute("data-symbol", sym);
    btn.setAttribute("data-testid", "coin-chip-" + sym);
    btn.innerHTML =
      '<span class="coin-chip__mark" data-coin="' + k + '">' + coinLogoSVG(sym) + '</span>' +
      escapeHtml(shortSym(sym));
    return btn;
  }

  // Diff-update the chip rail: reuse existing nodes so taps stay stable
  // while realtime updates churn. Only the .is-active class is toggled.
  function renderCoinChips() {
    var el = $("#coin-chips");
    if (!el) return;
    var symbols = (API.CURATED_SYMBOLS || API.DEFAULT_SYMBOLS || []).slice(0, 40);

    // Index existing chips by symbol.
    var existing = {};
    var children = el.children;
    for (var i = 0; i < children.length; i++) {
      var node = children[i];
      var sym = node.getAttribute && node.getAttribute("data-symbol");
      if (sym) existing[sym] = node;
    }

    // Walk desired order, reusing or creating nodes; reorder only if needed.
    var prevSibling = null;
    var wanted = {};
    symbols.forEach(function (sym) {
      wanted[sym] = true;
      var node = existing[sym];
      if (!node) {
        node = buildCoinChip(sym);
      }
      var isActive = sym === state.selectedSymbol;
      node.classList.toggle("is-active", isActive);
      // Place node after prevSibling (or at start). Skip DOM op if already correct.
      var target = prevSibling ? prevSibling.nextSibling : el.firstChild;
      if (target !== node) {
        el.insertBefore(node, target);
      }
      prevSibling = node;
    });

    // Remove leftover nodes that are no longer in the curated list.
    var remove = [];
    for (var j = 0; j < children.length; j++) {
      var c = children[j];
      var s = c.getAttribute && c.getAttribute("data-symbol");
      if (!s || !wanted[s]) remove.push(c);
    }
    remove.forEach(function (n) { el.removeChild(n); });
  }

  function buildMatrixCell(t) {
    var cell = document.createElement("div");
    cell.className = "matrix-cell";
    cell.setAttribute("data-symbol", t.symbol);
    cell.setAttribute("data-testid", "matrix-cell-" + t.symbol);
    cell.innerHTML =
      '<div class="matrix-sym">' + escapeHtml(shortSym(t.symbol)) +
        '<span class="matrix-strength"></span></div>' +
      '<div class="matrix-price"></div>' +
      '<div class="matrix-delta"></div>' +
      '<div class="matrix-vol"></div>';
    return cell;
  }

  function updateMatrixCell(cell, t) {
    var pos = t.change_pct_24h >= 0;
    var absChg = Math.abs(t.change_pct_24h || 0);
    var strength = absChg >= 2 ? "high" : absChg >= 1 ? "mid" : "low";
    var strengthLabel = strength === "high" ? I18N.t("strHigh") : strength === "mid" ? I18N.t("strMid") : I18N.t("strLow");
    var mKey = coinKey(t.symbol);
    var mBrand = coinBrand(t.symbol);

    if (cell.getAttribute("data-coin") !== mKey) cell.setAttribute("data-coin", mKey);
    if (cell.getAttribute("data-glyph") !== mBrand.glyph) cell.setAttribute("data-glyph", mBrand.glyph);
    cell.classList.toggle("up", pos);
    cell.classList.toggle("down", !pos);

    var strengthEl = cell.querySelector(".matrix-strength");
    if (strengthEl) {
      strengthEl.className = "matrix-strength " + strength;
      if (strengthEl.textContent !== strengthLabel) strengthEl.textContent = strengthLabel;
    }
    var priceEl = cell.querySelector(".matrix-price");
    var priceText = "$" + fmtPrice(t.last_price);
    if (priceEl && priceEl.textContent !== priceText) priceEl.textContent = priceText;

    var deltaEl = cell.querySelector(".matrix-delta");
    var deltaText = fmtPct(t.change_pct_24h);
    if (deltaEl && deltaEl.textContent !== deltaText) deltaEl.textContent = deltaText;

    var volEl = cell.querySelector(".matrix-vol");
    var volText = "vol " + fmtCompact(t.volume_24h);
    if (volEl && volEl.textContent !== volText) volEl.textContent = volText;
  }

  // Diff-update the market matrix so tappable .matrix-cell nodes are never
  // detached mid-tap by live price ticks. Cells are reused by symbol; only
  // text content / classes change on each ticker update.
  function renderMarketScreen() {
    var el = $("#matrix");
    if (!el) return;
    var rows = state.tickers || [];
    var emptyEl = $("#market-empty");
    var countEl = $("#market-count");

    if (!rows.length) {
      // No data yet — show skeleton placeholders, but only once.
      if (!el.getAttribute("data-state") || el.getAttribute("data-state") !== "loading") {
        el.setAttribute("data-state", "loading");
        el.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
      }
      if (countEl) countEl.textContent = "—";
      if (emptyEl) emptyEl.hidden = true;
      return;
    }

    var visible = filterTickers(rows, state.marketQuery);
    if (countEl) countEl.textContent = visible.length + " / " + rows.length;
    if (emptyEl) emptyEl.hidden = visible.length > 0;

    // Transition out of any skeleton state once we have data.
    if (el.getAttribute("data-state") !== "ready") {
      el.setAttribute("data-state", "ready");
      // Strip skeleton placeholders without symbols so we start clean.
      var stale = [];
      for (var s = 0; s < el.children.length; s++) {
        var sc = el.children[s];
        if (!sc.getAttribute || !sc.getAttribute("data-symbol")) stale.push(sc);
      }
      stale.forEach(function (n) { el.removeChild(n); });
    }

    if (!visible.length) {
      // Filter excluded all rows — clear without touching skeleton state.
      while (el.firstChild) el.removeChild(el.firstChild);
      return;
    }

    // Index existing cells by symbol.
    var existing = {};
    var kids = el.children;
    for (var i = 0; i < kids.length; i++) {
      var node = kids[i];
      var sym = node.getAttribute && node.getAttribute("data-symbol");
      if (sym) existing[sym] = node;
    }

    var prevSibling = null;
    var wanted = {};
    visible.forEach(function (t) {
      wanted[t.symbol] = true;
      var cell = existing[t.symbol];
      if (!cell) cell = buildMatrixCell(t);
      updateMatrixCell(cell, t);
      var target = prevSibling ? prevSibling.nextSibling : el.firstChild;
      if (target !== cell) el.insertBefore(cell, target);
      prevSibling = cell;
    });

    var remove = [];
    for (var j = 0; j < kids.length; j++) {
      var c = kids[j];
      var ss = c.getAttribute && c.getAttribute("data-symbol");
      if (!ss || !wanted[ss]) remove.push(c);
    }
    remove.forEach(function (n) { el.removeChild(n); });
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

  // ---------- Symbol selection ----------
  function selectSymbol(sym, opts) {
    if (!sym) return;
    opts = opts || {};
    state.selectedSymbol = sym;
    // Make sure the realtime store is following this symbol over WS so the
    // hero ticker updates in true realtime, not just on the next REST poll.
    if (realtime && typeof realtime.setWsSymbols === "function") {
      var core = (API.CORE_SYMBOLS || []).slice();
      if (core.indexOf(sym) < 0) core.push(sym);
      try { realtime.setWsSymbols(core); } catch (e) {}
    }
    // If the symbol isn't in the polled list, expand it so it shows up.
    if (realtime && typeof realtime.setSymbols === "function") {
      var cur = realtime.symbols();
      if (cur.indexOf(sym) < 0) {
        cur.push(sym);
        try { realtime.setSymbols(cur); } catch (e) {}
      }
    }
    if (opts.switchScreen) setScreen("overview");
    ensureKlines(sym, state.tf);
    applyHeroSnapshot();
    renderCoinChips();
    haptic("selection");
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
        if (sym) selectSymbol(sym, { switchScreen: true });
        return;
      }
      var chip = e.target.closest(".coin-chip[data-symbol]");
      if (chip) {
        var sym3 = chip.getAttribute("data-symbol");
        if (sym3) selectSymbol(sym3, { switchScreen: true });
        return;
      }
      var overviewRow = e.target.closest("#overview-rows .row[data-symbol]");
      if (overviewRow) {
        var sym2 = overviewRow.getAttribute("data-symbol");
        if (sym2) selectSymbol(sym2);
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

    // Market screen search input
    var marketSearch = $("#market-search");
    if (marketSearch) {
      marketSearch.addEventListener("input", function () {
        state.marketQuery = marketSearch.value || "";
        renderMarketScreen();
      });
    }

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

  // ---------- Splash / boot screen ----------
  // The splash shows the QUANTSIGNAL Q-mark, an animated progress bar, and a
  // rotating boot-status line ("Connecting to the market…", "Loading charts…",
  // "Warming up the AI…", "Almost ready…"). Hidden once tickers arrive AND a
  // short minimum display time has passed — bounded by a hard ceiling so the
  // splash never traps the user if the network is slow.
  var splash = (function () {
    var startedAt = Date.now();
    var hidden = false;
    var reduced = false;
    try {
      reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {}
    var MIN_MS = reduced ? 350 : 1400;
    var MAX_MS = reduced ? 1500 : 4500;
    var dataReady = false;
    var steps = ["bootStep1", "bootStep2", "bootStep3", "bootStep4"];
    var stepIdx = 0;
    var rafId = null;
    var hardTimer = null;

    function setStep(key) {
      var el = document.getElementById("boot-status");
      if (el) el.textContent = I18N.t(key);
    }
    function setProgress(pct) {
      var bar = document.getElementById("boot-progress-bar");
      var box = document.getElementById("boot-progress");
      var clamped = Math.max(4, Math.min(100, pct));
      if (bar) bar.style.width = clamped + "%";
      if (box) box.setAttribute("aria-valuenow", String(Math.round(clamped)));
    }
    function tick() {
      if (hidden) return;
      var elapsed = Date.now() - startedAt;
      var pct = dataReady
        ? Math.min(100, 70 + ((elapsed - Math.min(elapsed, 600)) / MAX_MS) * 30)
        : Math.min(70, (elapsed / MAX_MS) * 70);
      setProgress(pct);
      var idx = Math.min(steps.length - 1, Math.floor((elapsed / MAX_MS) * steps.length));
      if (idx !== stepIdx) {
        stepIdx = idx;
        setStep(steps[idx]);
      }
      if (elapsed >= MIN_MS && (dataReady || elapsed >= MAX_MS)) {
        hide();
        return;
      }
      rafId = requestAnimationFrame(tick);
    }
    function hide() {
      if (hidden) return;
      hidden = true;
      if (rafId) cancelAnimationFrame(rafId);
      if (hardTimer) clearTimeout(hardTimer);
      setProgress(100);
      document.body.classList.add("boot-done");
      var node = document.getElementById("boot-splash");
      if (node) {
        setTimeout(function () {
          if (node && node.parentNode) node.parentNode.removeChild(node);
        }, 700);
      }
    }
    return {
      start: function () {
        setStep(steps[0]);
        setProgress(8);
        rafId = requestAnimationFrame(tick);
        // Hard ceiling: never let the splash linger past MAX_MS regardless.
        hardTimer = setTimeout(hide, MAX_MS + 200);
      },
      dataReady: function () {
        dataReady = true;
      },
      hide: hide
    };
  })();

  // ---------- Boot ----------
  function boot() {
    splash.start();
    initTelegram();
    I18N.init();
    applyI18N();
    I18N.on(function () { applyI18N(); });
    wireEvents();
    applyCoinBranding(state.selectedSymbol);
    renderTicker();
    renderOverviewRows();
    renderAIInitial();
    renderKPIs();

    // Spin up the realtime market store. Bybit V5 public, no secrets.
    // Wide REST poll + narrow WS subscription = fast UI without flooding the
    // Telegram WebView connection with 100+ subscription topics.
    realtime = API.createRealtimeStore({
      symbols: API.CURATED_SYMBOLS || API.DEFAULT_SYMBOLS,
      wsSymbols: API.CORE_SYMBOLS
    });
    realtime.onTickers(function (list) {
      onRealtimeTickers(list);
      if (list && list.length) splash.dataReady();
    });
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
