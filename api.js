/* =========================================================
   QUANTSIGNAL AI — API + realtime market store
   Public Bybit V5 (linear perpetuals) via WebSocket with REST fallback.
   No secrets required. No localStorage / cookies — in-memory only.
   ========================================================= */
(function (global) {
  "use strict";

  /* ---------- Optional self-hosted backend (kept for future use) ---------- */
  var API_BASE = (typeof global.QSI_API_BASE === "string") ? global.QSI_API_BASE : "";
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

  function fetchJSON(url, opts) {
    opts = opts || {};
    var req = fetch(url, {
      method: opts.method || "GET",
      headers: Object.assign({ "Accept": "application/json" }, opts.headers || {}),
      mode: "cors",
      credentials: "omit",
      cache: "no-store"
    }).then(function (r) {
      if (!r.ok) throw new Error("http-" + r.status);
      return r.json();
    });
    return withTimeout(req, opts.timeout || 8000);
  }

  function jsonFetch(path, opts) {
    opts = opts || {};
    if (!API_BASE) return Promise.reject(new Error("no-api"));
    var headers = Object.assign({ "Accept": "application/json" }, opts.headers || {});
    var body = opts.body;
    if (body && typeof body !== "string") {
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
      body = JSON.stringify(body);
    }
    var req = fetch(API_BASE + path, {
      method: opts.method || "GET",
      headers: headers,
      body: body,
      mode: "cors",
      credentials: "omit",
      cache: "no-store"
    }).then(function (r) {
      if (!r.ok) throw new Error("http-" + r.status);
      return r.json();
    });
    return withTimeout(req, opts.timeout || 6000);
  }

  /* ---------- Bybit V5 ---------- */
  var BYBIT_REST = "https://api.bybit.com";
  var BYBIT_WS = "wss://stream.bybit.com/v5/public/linear";
  // Public perpetual symbols we want to track. Bybit lists them on `linear` category.
  var DEFAULT_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "TONUSDT", "BNBUSDT", "XRPUSDT"];

  function normalizeBybitTicker(raw) {
    if (!raw) return null;
    var price = parseFloat(raw.lastPrice);
    if (!isFinite(price)) return null;
    var change = parseFloat(raw.price24hPcnt);
    return {
      symbol: raw.symbol,
      last_price: price,
      change_pct_24h: isFinite(change) ? change * 100 : 0,
      volume_24h: parseFloat(raw.turnover24h) || parseFloat(raw.volume24h) || 0,
      high_24h: parseFloat(raw.highPrice24h) || price,
      low_24h: parseFloat(raw.lowPrice24h) || price
    };
  }

  // Bybit WS sends *deltas* on tickers — merge missing fields with previous snapshot.
  function mergeBybitDelta(prev, raw) {
    var base = prev || {};
    var get = function (k, fallback) {
      var v = raw && raw[k];
      return (v === undefined || v === null || v === "") ? fallback : v;
    };
    var price = parseFloat(get("lastPrice", base.last_price));
    var changeRaw = get("price24hPcnt", null);
    var change = changeRaw == null ? base.change_pct_24h : parseFloat(changeRaw) * 100;
    var turnover = parseFloat(get("turnover24h", base.volume_24h));
    var high = parseFloat(get("highPrice24h", base.high_24h));
    var low = parseFloat(get("lowPrice24h", base.low_24h));
    return {
      symbol: raw.symbol || base.symbol,
      last_price: isFinite(price) ? price : base.last_price,
      change_pct_24h: isFinite(change) ? change : (base.change_pct_24h || 0),
      volume_24h: isFinite(turnover) ? turnover : (base.volume_24h || 0),
      high_24h: isFinite(high) ? high : (base.high_24h || base.last_price),
      low_24h: isFinite(low) ? low : (base.low_24h || base.last_price)
    };
  }

  function bybitGetTickers(symbols) {
    var url = BYBIT_REST + "/v5/market/tickers?category=linear";
    return fetchJSON(url, { timeout: 8000 }).then(function (resp) {
      if (!resp || resp.retCode !== 0 || !resp.result || !resp.result.list) {
        throw new Error("bybit-bad-response");
      }
      var wanted = (symbols && symbols.length) ? symbols : DEFAULT_SYMBOLS;
      var map = {};
      resp.result.list.forEach(function (r) {
        if (wanted.indexOf(r.symbol) >= 0) map[r.symbol] = r;
      });
      // Preserve requested order; drop symbols missing from the response.
      var out = [];
      wanted.forEach(function (s) {
        var n = normalizeBybitTicker(map[s]);
        if (n) out.push(n);
      });
      return out;
    });
  }

  function bybitGetKlines(symbol, interval, limit) {
    var url = BYBIT_REST +
      "/v5/market/kline?category=linear" +
      "&symbol=" + encodeURIComponent(symbol) +
      "&interval=" + encodeURIComponent(interval || "5") +
      "&limit=" + encodeURIComponent(limit || 60);
    return fetchJSON(url, { timeout: 8000 }).then(function (resp) {
      if (!resp || resp.retCode !== 0 || !resp.result || !resp.result.list) {
        throw new Error("bybit-bad-kline");
      }
      // Bybit returns klines newest-first; reverse to chronological.
      return resp.result.list.slice().reverse().map(function (row) {
        return {
          ts: parseInt(row[0], 10),
          open: parseFloat(row[1]),
          high: parseFloat(row[2]),
          low: parseFloat(row[3]),
          close: parseFloat(row[4]),
          volume: parseFloat(row[5])
        };
      });
    });
  }

  /* ---------- Realtime store ---------- */
  function createRealtimeStore(opts) {
    opts = opts || {};
    var symbols = (opts.symbols && opts.symbols.length) ? opts.symbols.slice() : DEFAULT_SYMBOLS.slice();
    var listeners = [];
    var statusListeners = [];

    var tickers = {};        // symbol -> normalized ticker
    var sock = null;
    var wsReady = false;
    var wsAttempts = 0;
    var wsReconnectTimer = null;
    var heartbeatTimer = null;
    var lastWsMessageTs = 0;
    var lastUpdateTs = 0;
    var pollTimer = null;
    var pollFailed = false;
    var transport = "rest";  // "ws" | "rest" | "offline"
    var stopped = false;

    function snapshot() {
      var out = [];
      symbols.forEach(function (s) { if (tickers[s]) out.push(tickers[s]); });
      return out;
    }

    function emit() {
      lastUpdateTs = Date.now();
      var snap = snapshot();
      listeners.forEach(function (fn) { try { fn(snap); } catch (e) {} });
    }

    function emitStatus() {
      var st = getStatus();
      statusListeners.forEach(function (fn) { try { fn(st); } catch (e) {} });
    }

    function getStatus() {
      return {
        transport: transport,
        wsReady: wsReady,
        lastUpdateTs: lastUpdateTs,
        lastMessageAgeMs: lastWsMessageTs ? (Date.now() - lastWsMessageTs) : null,
        provider: "Bybit V5 (linear)",
        symbols: symbols.slice()
      };
    }

    function setTransport(next) {
      if (transport === next) return;
      transport = next;
      emitStatus();
    }

    function applyTickers(list, source) {
      if (!list || !list.length) return;
      var changed = false;
      list.forEach(function (t) {
        if (!t || !t.symbol) return;
        var prev = tickers[t.symbol];
        if (!prev ||
            prev.last_price !== t.last_price ||
            prev.change_pct_24h !== t.change_pct_24h ||
            prev.volume_24h !== t.volume_24h) {
          tickers[t.symbol] = t;
          changed = true;
        }
      });
      if (changed) emit();
      if (source) setTransport(source);
    }

    // ----- REST polling -----
    function poll() {
      if (stopped) return;
      bybitGetTickers(symbols).then(function (list) {
        pollFailed = false;
        applyTickers(list, wsReady ? transport : "rest");
      }).catch(function () {
        pollFailed = true;
        if (!wsReady) setTransport("offline");
      });
    }

    function startPolling(intervalMs) {
      stopPolling();
      poll();
      pollTimer = setInterval(poll, intervalMs || 15000);
    }

    function stopPolling() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    // ----- WebSocket -----
    function scheduleReconnect() {
      if (stopped) return;
      if (wsReconnectTimer) return;
      var delay = Math.min(30000, 1000 * Math.pow(2, Math.min(5, wsAttempts)));
      wsReconnectTimer = setTimeout(function () {
        wsReconnectTimer = null;
        openSocket();
      }, delay);
    }

    function teardownSocket() {
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
      if (sock) {
        try { sock.onopen = sock.onmessage = sock.onerror = sock.onclose = null; } catch (e) {}
        try { sock.close(); } catch (e) {}
        sock = null;
      }
      wsReady = false;
    }

    function openSocket() {
      if (stopped) return;
      if (typeof WebSocket !== "function") {
        // No WS support — REST polling will continue.
        return;
      }
      teardownSocket();
      wsAttempts++;
      var s;
      try { s = new WebSocket(BYBIT_WS); }
      catch (e) { scheduleReconnect(); return; }
      sock = s;

      s.onopen = function () {
        wsReady = true;
        wsAttempts = 0;
        lastWsMessageTs = Date.now();
        setTransport("ws");
        // Subscribe to ticker streams for each symbol.
        try {
          s.send(JSON.stringify({
            op: "subscribe",
            args: symbols.map(function (sym) { return "tickers." + sym; })
          }));
        } catch (e) {}
        // Bybit recommends a ping every 20s.
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(function () {
          try { s.send(JSON.stringify({ op: "ping" })); } catch (e) {}
          // If we haven't heard back for > 60s, force a reconnect.
          if (Date.now() - lastWsMessageTs > 60000) {
            try { s.close(); } catch (e) {}
          }
        }, 20000);
      };

      s.onmessage = function (e) {
        lastWsMessageTs = Date.now();
        var msg;
        try { msg = JSON.parse(e.data); } catch (err) { return; }
        if (!msg) return;
        if (msg.op === "pong" || msg.ret_msg === "pong") return;
        if (msg.topic && msg.topic.indexOf("tickers.") === 0 && msg.data) {
          var raw = msg.data;
          if (Array.isArray(raw)) {
            raw.forEach(function (d) {
              var merged = mergeBybitDelta(tickers[d.symbol], d);
              if (merged && merged.symbol) tickers[merged.symbol] = merged;
            });
          } else {
            var merged = mergeBybitDelta(tickers[raw.symbol], raw);
            if (merged && merged.symbol) tickers[merged.symbol] = merged;
          }
          emit();
        }
      };

      s.onerror = function () {
        // Let onclose handle reconnection.
      };

      s.onclose = function () {
        wsReady = false;
        teardownSocket();
        if (!stopped) {
          setTransport(pollFailed ? "offline" : "rest");
          scheduleReconnect();
        }
      };
    }

    // ----- Public surface -----
    function onTickers(fn) {
      listeners.push(fn);
      // Emit immediately if we have data so late subscribers render straight away.
      if (snapshot().length) {
        try { fn(snapshot()); } catch (e) {}
      }
      return function off() { listeners = listeners.filter(function (x) { return x !== fn; }); };
    }

    function onStatus(fn) {
      statusListeners.push(fn);
      try { fn(getStatus()); } catch (e) {}
      return function off() { statusListeners = statusListeners.filter(function (x) { return x !== fn; }); };
    }

    function get(symbol) { return tickers[symbol] || null; }
    function list() { return snapshot(); }

    function start() {
      stopped = false;
      startPolling(15000);
      openSocket();
    }

    function stop() {
      stopped = true;
      stopPolling();
      teardownSocket();
      if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    }

    return {
      start: start,
      stop: stop,
      onTickers: onTickers,
      onStatus: onStatus,
      get: get,
      list: list,
      getStatus: getStatus,
      symbols: function () { return symbols.slice(); }
    };
  }

  /* ---------- Legacy compatibility wrappers ----------
     These keep the previous QSI_API.* surface usable while the new code
     migrates to the realtime store. */

  function getTickers(symbols) {
    return bybitGetTickers(symbols).then(function (list) {
      return { source: "bybit", ts: Date.now(), tickers: list };
    }).catch(function () {
      // Last-resort static fallback so the UI never goes blank.
      return {
        source: "fallback",
        ts: Date.now(),
        tickers: [
          { symbol: "BTCUSDT", last_price: 67420, change_pct_24h: 1.84, volume_24h: 1.2e9 },
          { symbol: "ETHUSDT", last_price: 3512,  change_pct_24h: 2.31, volume_24h: 8.4e8 },
          { symbol: "SOLUSDT", last_price: 184.2, change_pct_24h: -0.42, volume_24h: 2.1e8 }
        ]
      };
    });
  }

  function getSignals() {
    return jsonFetch("/api/signals").catch(function () {
      // Empty signals — the realtime engine in app.js will generate them from live data.
      return { strategy: "realtime", signals: [] };
    });
  }

  function getHealth() {
    return jsonFetch("/health").catch(function () { return null; });
  }

  function aiChat(messages, languageCode) {
    return jsonFetch("/api/ai/chat", {
      method: "POST",
      body: { messages: messages, language_code: languageCode || null, init_data: INIT_DATA || null },
      timeout: 25000
    }).catch(function () {
      // Local fallback handled inside app.js using realtime data.
      return { content: null, model: "local", mock: true, ts: Date.now() };
    });
  }

  global.QSI_API = {
    setApiBase: setApiBase,
    setInitData: setInitData,
    getTickers: getTickers,
    getSignals: getSignals,
    getHealth: getHealth,
    aiChat: aiChat,
    // Realtime
    createRealtimeStore: createRealtimeStore,
    bybitGetTickers: bybitGetTickers,
    bybitGetKlines: bybitGetKlines,
    DEFAULT_SYMBOLS: DEFAULT_SYMBOLS.slice()
  };
})(window);
