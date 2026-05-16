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
    // Same-origin URLs (the Bybit proxy) need `same-origin` mode in some
    // strict CSP contexts; external URLs need `cors`. The browser tolerates
    // `cors` for same-origin requests, but explicit is friendlier to DevTools.
    var isAbsolute = /^https?:/i.test(url);
    var req = fetch(url, {
      method: opts.method || "GET",
      headers: Object.assign({ "Accept": "application/json" }, opts.headers || {}),
      mode: isAbsolute ? "cors" : "same-origin",
      credentials: "omit",
      cache: "no-store"
    }).then(function (r) {
      if (!r.ok) throw new Error("http-" + r.status);
      return r.json();
    });
    return withTimeout(req, opts.timeout || 8000);
  }

  // Resolve API base. When API_BASE is empty, requests go to same-origin
  // (e.g. Vercel serverless functions deployed alongside the static site).
  function jsonFetch(path, opts) {
    opts = opts || {};
    var url = (API_BASE || "") + path;
    var headers = Object.assign({ "Accept": "application/json" }, opts.headers || {});
    var body = opts.body;
    if (body && typeof body !== "string") {
      headers["Content-Type"] = headers["Content-Type"] || "application/json";
      body = JSON.stringify(body);
    }
    var req = fetch(url, {
      method: opts.method || "GET",
      headers: headers,
      body: body,
      mode: API_BASE ? "cors" : "same-origin",
      credentials: "omit",
      cache: "no-store"
    }).then(function (r) {
      var ct = r.headers && r.headers.get && r.headers.get("content-type") || "";
      var parse = ct.indexOf("application/json") >= 0 ? r.json() : r.text();
      return parse.then(function (data) {
        if (!r.ok) {
          var err = new Error("http-" + r.status);
          err.status = r.status;
          err.payload = data;
          throw err;
        }
        return data;
      });
    });
    return withTimeout(req, opts.timeout || 6000);
  }

  /* ---------- Bybit V5 ---------- */
  // Same-origin Vercel serverless proxy. Bybit's REST API rejects browser
  // CORS preflights, so calling api.bybit.com directly from a Telegram
  // WebView fails. Routing through `/api/bybit/*` puts the request on our
  // own origin and avoids CORS entirely. The direct host is kept as a
  // last-resort fallback for local dev (`npm run dev` serves the static
  // bundle without serverless functions).
  var BYBIT_PROXY = "/api/bybit";
  var BYBIT_REST_DIRECT = "https://api.bybit.com";
  var BYBIT_WS = "wss://stream.bybit.com/v5/public/linear";
  // Per-process flag: once the proxy answers successfully we stop trying
  // the direct host (avoids needless CORS errors in the console).
  var proxyHealthy = null; // null = unknown, true = working, false = unavailable
  function proxyUrl(endpoint, params) {
    var qs = [];
    if (params) {
      Object.keys(params).forEach(function (k) {
        var v = params[k];
        if (v === undefined || v === null || v === "") return;
        qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
      });
    }
    return BYBIT_PROXY + "/" + endpoint + (qs.length ? "?" + qs.join("&") : "");
  }
  // Try the same-origin proxy first; if it fails (e.g. static-only deploy,
  // local `npm run dev` without functions, or 5xx) fall back to direct
  // Bybit so feature parity is preserved when the proxy genuinely isn't
  // available. Once the proxy is known-healthy we stop falling back.
  function bybitFetch(endpoint, params, directUrl, timeoutMs) {
    var url = proxyUrl(endpoint, params);
    var attempt = fetchJSON(url, { timeout: timeoutMs });
    if (proxyHealthy === false) {
      // Proxy already proven unavailable — skip straight to direct.
      return fetchJSON(directUrl, { timeout: timeoutMs });
    }
    return attempt.then(function (data) {
      proxyHealthy = true;
      return data;
    }, function (err) {
      // Only fall back when the proxy itself failed (404/5xx/timeout). If
      // the proxy reports an upstream Bybit problem we surface it as-is.
      if (proxyHealthy === true) throw err;
      proxyHealthy = false;
      return fetchJSON(directUrl, { timeout: timeoutMs });
    });
  }
  // Curated Bybit V5 linear USDT perpetual universe. Names follow Bybit's
  // conventions (1000PEPE/1000SHIB for low-priced memes; POLUSDT replaced
  // MATICUSDT after the Polygon rebrand). The CORE subset is kept narrow
  // because every symbol becomes a WebSocket subscription; the wider
  // CURATED_SYMBOLS list is browsable via REST polling.
  var CORE_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "TONUSDT", "BNBUSDT", "XRPUSDT"];
  var CURATED_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "TONUSDT", "BNBUSDT", "XRPUSDT",
    "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT", "POLUSDT",
    "LTCUSDT", "TRXUSDT", "NEARUSDT", "ARBUSDT", "OPUSDT", "SUIUSDT",
    "APTUSDT", "1000PEPEUSDT", "1000SHIBUSDT", "BCHUSDT", "UNIUSDT",
    "ATOMUSDT", "ETCUSDT", "FILUSDT", "INJUSDT", "TIAUSDT", "WLDUSDT",
    "AAVEUSDT", "RNDRUSDT", "FTMUSDT", "HBARUSDT", "ICPUSDT", "ALGOUSDT",
    "GALAUSDT", "SANDUSDT", "MANAUSDT", "AXSUSDT", "STXUSDT", "SEIUSDT",
    "BLURUSDT", "PYTHUSDT", "JTOUSDT", "JUPUSDT", "WIFUSDT", "ORDIUSDT",
    "BONKUSDT", "FLOKIUSDT", "RUNEUSDT", "GMXUSDT", "DYDXUSDT", "ENSUSDT",
    "CRVUSDT", "COMPUSDT", "MKRUSDT", "SNXUSDT", "1INCHUSDT", "LDOUSDT",
    "GMTUSDT", "APEUSDT", "CHZUSDT", "FLOWUSDT", "ENJUSDT", "GRTUSDT",
    "EOSUSDT", "XLMUSDT", "VETUSDT", "THETAUSDT", "KAVAUSDT", "ZECUSDT",
    "DASHUSDT", "QTUMUSDT", "WAVESUSDT", "IOTAUSDT", "NEOUSDT", "BSVUSDT",
    "MASKUSDT", "PEOPLEUSDT", "ROSEUSDT", "JASMYUSDT", "AGIXUSDT", "FETUSDT",
    "OCEANUSDT", "MINAUSDT", "ZILUSDT", "ONEUSDT", "HOTUSDT", "CELRUSDT",
    "ANKRUSDT", "BANDUSDT", "ARUSDT", "WOOUSDT", "CFXUSDT", "ASTRUSDT",
    "GLMRUSDT", "MAGICUSDT", "PENDLEUSDT", "ARKMUSDT", "IDUSDT", "SSVUSDT",
    "MAVUSDT", "LQTYUSDT", "RPLUSDT", "SUPERUSDT", "TRUUSDT", "LOOMUSDT"
  ];
  // Legacy alias — older callers (and tests) read DEFAULT_SYMBOLS.
  var DEFAULT_SYMBOLS = CURATED_SYMBOLS;
  var INSTRUMENT_CACHE = null;
  var INSTRUMENT_CACHE_TS = 0;

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
    var directUrl = BYBIT_REST_DIRECT + "/v5/market/tickers?category=linear";
    return bybitFetch("tickers", null, directUrl, 8000).then(function (resp) {
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

  // Fetch the full linear USDT perpetual instrument list. Result is cached in
  // memory for 30 minutes — Bybit's catalog rarely changes intraday and the
  // payload is ~300KB which is wasteful to re-fetch on every chart render.
  function bybitGetInstruments(force) {
    var now = Date.now();
    if (!force && INSTRUMENT_CACHE && (now - INSTRUMENT_CACHE_TS) < 30 * 60 * 1000) {
      return Promise.resolve(INSTRUMENT_CACHE.slice());
    }
    var directUrl = BYBIT_REST_DIRECT + "/v5/market/instruments-info?category=linear&limit=1000";
    return bybitFetch("instruments-info", { limit: 1000 }, directUrl, 10000).then(function (resp) {
      if (!resp || resp.retCode !== 0 || !resp.result || !resp.result.list) {
        throw new Error("bybit-bad-instruments");
      }
      var out = resp.result.list
        .filter(function (r) {
          // Linear perpetual on USDT, currently trading.
          return r && r.symbol && /USDT$/.test(r.symbol) &&
                 (r.status === "Trading" || r.status === "trading");
        })
        .map(function (r) { return r.symbol; });
      INSTRUMENT_CACHE = out;
      INSTRUMENT_CACHE_TS = now;
      return out.slice();
    });
  }

  function bybitGetKlines(symbol, interval, limit) {
    var safeInterval = interval || "5";
    var safeLimit = limit || 60;
    var directUrl = BYBIT_REST_DIRECT +
      "/v5/market/kline?category=linear" +
      "&symbol=" + encodeURIComponent(symbol) +
      "&interval=" + encodeURIComponent(safeInterval) +
      "&limit=" + encodeURIComponent(safeLimit);
    return bybitFetch("kline", {
      symbol: symbol,
      interval: safeInterval,
      limit: safeLimit
    }, directUrl, 8000).then(function (resp) {
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

  /* ---------- Realtime store ----------
     Strategy when many symbols are tracked:
       - REST poll for the full `symbols` list (1 request returns all linear
         tickers; we filter client-side).
       - WebSocket subscribes only to `wsSymbols` (default: CORE_SYMBOLS plus
         any explicitly-selected symbol via setWsSymbols) so we don't ship
         100+ subscription topics over a Telegram WebView connection. */
  function createRealtimeStore(opts) {
    opts = opts || {};
    var symbols = (opts.symbols && opts.symbols.length) ? opts.symbols.slice() : DEFAULT_SYMBOLS.slice();
    var wsSymbols = (opts.wsSymbols && opts.wsSymbols.length)
      ? opts.wsSymbols.slice()
      : CORE_SYMBOLS.slice();
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
        // Subscribe to ticker streams for the WS subset only (core watchlist
        // + the user's selected symbol). The wider universe is polled via REST.
        try {
          s.send(JSON.stringify({
            op: "subscribe",
            args: wsSymbols.map(function (sym) { return "tickers." + sym; })
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

    function setSymbols(next) {
      if (!next || !next.length) return;
      symbols = next.slice();
      // Trigger an immediate REST poll so newly-added symbols populate right away.
      poll();
    }

    function setWsSymbols(next) {
      if (!next || !next.length) return;
      var sorted = next.slice().sort();
      var same = sorted.length === wsSymbols.length &&
                 sorted.every(function (s, i) { return s === wsSymbols.slice().sort()[i]; });
      if (same) return;
      wsSymbols = next.slice();
      if (wsReady && sock) {
        try {
          sock.send(JSON.stringify({
            op: "subscribe",
            args: wsSymbols.map(function (sym) { return "tickers." + sym; })
          }));
        } catch (e) {}
      }
    }

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
      setSymbols: setSymbols,
      setWsSymbols: setWsSymbols,
      symbols: function () { return symbols.slice(); },
      wsSymbols: function () { return wsSymbols.slice(); }
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

  // Real AI chat. Throws an error with a structured `code` so the UI can show
  // an honest config/error message — never a fake demo reply.
  function aiChat(messages, languageCode, marketContext) {
    var headers = {};
    if (INIT_DATA) headers["X-Telegram-Init-Data"] = INIT_DATA;
    return jsonFetch("/api/ai/chat", {
      method: "POST",
      headers: headers,
      body: {
        messages: messages,
        language_code: languageCode || null,
        market_context: marketContext || null,
        init_data: INIT_DATA || null
      },
      timeout: 30000
    }).then(function (data) {
      return {
        content: (data && data.content) || "",
        model: (data && data.model) || "unknown",
        ts: (data && data.ts) || Date.now()
      };
    }).catch(function (err) {
      var code = "ai_unreachable";
      if (err && err.payload) {
        if (typeof err.payload === "object") {
          code = err.payload.error
            || (err.payload.detail && err.payload.detail.error)
            || code;
        }
      } else if (err && err.message === "timeout") {
        code = "ai_upstream_timeout";
      }
      var aiErr = new Error(code);
      aiErr.code = code;
      aiErr.status = (err && err.status) || 0;
      throw aiErr;
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
    bybitGetInstruments: bybitGetInstruments,
    DEFAULT_SYMBOLS: DEFAULT_SYMBOLS.slice(),
    CORE_SYMBOLS: CORE_SYMBOLS.slice(),
    CURATED_SYMBOLS: CURATED_SYMBOLS.slice()
  };
})(window);
