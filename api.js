/* =========================================================
   QUANTSIGNAL AI — API client with graceful demo fallback
   ========================================================= */
(function (global) {
  "use strict";

  // window.QSI_API_BASE can be set inline before this script loads to
  // override the API base, e.g. <script>window.QSI_API_BASE="https://...";</script>
  // Empty string -> all requests fall back to demo.
  var API_BASE = (typeof global.QSI_API_BASE === "string") ? global.QSI_API_BASE : "";

  // initData (raw) is captured at boot time. We never trust initDataUnsafe.
  var INIT_DATA = "";

  function setApiBase(url) { API_BASE = url || ""; }
  function setInitData(raw) { INIT_DATA = raw || ""; }

  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error("timeout")); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); },
                   function (e) { clearTimeout(t); reject(e); });
    });
  }

  function jsonFetch(path, opts) {
    opts = opts || {};
    if (!API_BASE) return Promise.reject(new Error("no-api"));
    var headers = Object.assign({ "Accept": "application/json" }, opts.headers || {});
    if (opts.body && typeof opts.body !== "string") {
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
      opts.body = JSON.stringify(opts.body);
    }
    var req = fetch(API_BASE + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body,
      mode: "cors",
      credentials: "omit",
      cache: "no-store"
    }).then(function (r) {
      if (!r.ok) throw new Error("http-" + r.status);
      return r.json();
    });
    return withTimeout(req, opts.timeout || 6000);
  }

  // ---------- Demo data (used when backend is offline) ----------
  var DEMO_TICKERS = {
    source: "demo",
    ts: Date.now(),
    tickers: [
      { symbol: "BTCUSDT", last_price: 67420, change_pct_24h: 1.84, volume_24h: 1.2e9, high_24h: 68100, low_24h: 66800 },
      { symbol: "ETHUSDT", last_price: 3512,  change_pct_24h: 2.31, volume_24h: 8.4e8, high_24h: 3540, low_24h: 3450 },
      { symbol: "SOLUSDT", last_price: 184.2, change_pct_24h: -0.42, volume_24h: 2.1e8, high_24h: 186.8, low_24h: 182.1 },
      { symbol: "BNBUSDT", last_price: 612.05, change_pct_24h: 0.65, volume_24h: 1.6e8, high_24h: 615, low_24h: 608 },
      { symbol: "TONUSDT", last_price: 7.18,  change_pct_24h: 4.12, volume_24h: 1.1e8, high_24h: 7.30, low_24h: 6.85 },
      { symbol: "XRPUSDT", last_price: 0.612, change_pct_24h: -1.08, volume_24h: 9.2e7, high_24h: 0.620, low_24h: 0.608 }
    ]
  };

  function demoSignals() {
    return {
      strategy: "demo",
      signals: DEMO_TICKERS.tickers.map(function (t) {
        var dir = t.change_pct_24h >= 0 ? "LONG" : "SHORT";
        var range = Math.max(0.005, Math.abs(t.change_pct_24h) / 100 + 0.01);
        var entry = t.last_price;
        var sl  = dir === "LONG" ? entry * (1 - range * 1.2) : entry * (1 + range * 1.2);
        var tp1 = dir === "LONG" ? entry * (1 + range)       : entry * (1 - range);
        var tp2 = dir === "LONG" ? entry * (1 + range * 2)   : entry * (1 - range * 2);
        return {
          id: t.symbol + "-demo",
          symbol: t.symbol, direction: dir,
          entry: entry, stop_loss: sl, take_profit_1: tp1, take_profit_2: tp2,
          confidence: Math.min(0.95, 0.45 + Math.abs(t.change_pct_24h) / 20),
          risk_reward: +(Math.abs(tp1 - entry) / Math.max(Math.abs(entry - sl), 1e-9)).toFixed(2),
          rationale: "Demo signal based on 24h momentum.",
          ts: Date.now()
        };
      })
    };
  }

  // ---------- Public API ----------
  function getTickers(symbols) {
    var q = symbols && symbols.length ? "?symbols=" + encodeURIComponent(symbols.join(",")) : "";
    return jsonFetch("/api/market/tickers" + q).catch(function () { return DEMO_TICKERS; });
  }

  function getSignals() {
    return jsonFetch("/api/signals").catch(function () { return demoSignals(); });
  }

  function getHealth() {
    return jsonFetch("/health").catch(function () { return null; });
  }

  function aiChat(messages, languageCode) {
    return jsonFetch("/api/ai/chat", {
      method: "POST",
      body: {
        messages: messages,
        language_code: languageCode || null,
        init_data: INIT_DATA || null
      },
      timeout: 25000
    }).catch(function () {
      return {
        content: (languageCode === "ru")
          ? "Демо-ответ: рынок в нейтрально-бычьем режиме; следите за объёмами и уровнями поддержки."
          : (languageCode === "zh")
          ? "演示回复：市场处于中性偏多状态，请关注成交量与支撑位。"
          : "Demo reply: market is neutral-to-bullish; watch volumes and support levels.",
        model: "mock",
        mock: true,
        ts: Date.now()
      };
    });
  }

  // ---------- WebSocket (optional live updates) ----------
  function openMarketSocket(onMessage, onClose) {
    if (!API_BASE) return null;
    try {
      var wsUrl = API_BASE.replace(/^http/, "ws") + "/ws/market";
      var sock = new WebSocket(wsUrl);
      sock.onmessage = function (e) {
        try { onMessage && onMessage(JSON.parse(e.data)); } catch (err) {}
      };
      sock.onclose = function () { onClose && onClose(); };
      sock.onerror = function () { try { sock.close(); } catch (e) {} };
      return sock;
    } catch (e) {
      return null;
    }
  }

  global.QSI_API = {
    setApiBase: setApiBase,
    setInitData: setInitData,
    getTickers: getTickers,
    getSignals: getSignals,
    getHealth: getHealth,
    aiChat: aiChat,
    openMarketSocket: openMarketSocket
  };
})(window);
