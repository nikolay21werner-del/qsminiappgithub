# QUANTSIGNAL AI — Telegram Mini App (full-stack scaffold)

A Telegram Mini App with a premium crypto-terminal frontend (vanilla HTML/CSS/JS,
zero build) and a FastAPI backend that ships with real Telegram `initData`
validation, Bybit V5 public market data, a swappable signal engine, an AI
assistant endpoint, and a WebSocket market stream.

## Frontend UX (app-first)

Opening the Mini App now drops you straight into the working product, not a
presentation page. A mobile-first app shell (≤460px column, fixed bottom
tabbar, top status bar with live ticker) hosts five screens:

| Tab        | What it does                                                        |
| ---------- | ------------------------------------------------------------------- |
| Overview   | BTCUSDT hero card + chart, RSI/MACD/Volume metrics, KPIs, top coins |
| Signals    | List of trading signals (entry/TP/SL, confidence bar, R:R, detail) |
| Market     | 2-column matrix of coins with price, 24h Δ, signal strength chip   |
| AI         | Chat-like assistant with suggestions, mic placeholder, mock fallback |
| Profile    | Telegram identity, language switch (RU/EN/ZH), notification/theme   |
|            | toggles, link to the original roadmap presentation                  |

Tapping a signal opens a bottom sheet with full details. The neon-teal /
dark-navy fintech reference design is preserved; the previous landing-style
roadmap is now opt-in — accessible from **Profile → View user journey**.

No `localStorage`, `sessionStorage`, or cookies — language, AI history, signal
state and UI flags live in memory only. All Telegram SDK calls remain inside
safe try/catch guards.

The frontend is the same lightweight bundle that runs inside Telegram WebView;
the backend is a separate service designed to deploy to Railway, Fly.io, Render
or a plain VPS / Docker host.

```
quantsignal-miniapp/
├── index.html          app shell: top bar, ticker, 5 screens, bottom tabs, sheets
├── styles.css          design tokens, mobile-first layout, animations
├── app.js              frontend logic: screen router, charts, AI chat, signals, profile
├── i18n.js             auto-detected locale (ru/en/zh) with manual override
├── api.js              fetch client + WebSocket; demo fallback when offline
├── assets/             favicon
├── vercel.json         frontend deploy config
├── package.json        local static serve
└── backend/            FastAPI service
    ├── app/
    │   ├── main.py           FastAPI app, CORS, lifespan
    │   ├── core/
    │   │   ├── config.py        env-driven settings
    │   │   └── telegram_auth.py initData HMAC validation
    │   ├── services/
    │   │   ├── bybit.py         V5 REST + WS skeleton + demo fallback
    │   │   ├── signals.py       signal engine + demo strategy
    │   │   ├── ai_assistant.py  /api/ai/chat (LLM or mock)
    │   │   └── bot.py           Telegram sendMessage (disabled w/o token)
    │   ├── routers/             health, auth, market, signals, ai, ws
    │   └── schemas/api.py       Pydantic request/response models
    ├── tests/                   stdlib unittest (12 tests)
    ├── requirements.txt
    ├── .env.example
    ├── Dockerfile
    ├── Procfile
    └── railway.json
```

## Frontend

Pure HTML/CSS/JS – ES5-compatible, no bundler, no `localStorage` /
`sessionStorage` / cookies (Telegram WebView blocks them in some clients). All
state is in-memory.

The app boots directly into the Overview dashboard. Bottom tabs swap the
visible screen; modal sheets handle signal details and the original roadmap.

| Screen          | Trigger                                      |
| --------------- | -------------------------------------------- |
| Overview        | Default — hero, chart, KPIs, AI summary, top |
| Signals         | Signals tab — tap a card for full details    |
| Market matrix   | Market tab — 2-column coin grid + tf filter  |
| AI Assistant    | AI tab — chat + suggestions + mic placeholder|
| Profile         | Profile tab — language, settings, roadmap   |

**Locale**

* Auto-detected from `Telegram.WebApp.initDataUnsafe.user.language_code` at
  boot. `language_code` is intentionally only used for UI hints – it is **not**
  trusted for authorization (initData HMAC is the only source of truth).
* Falls back to `navigator.languages`, then Russian.
* Manual override available from Profile → Language chips (RU / EN / ZH).

**API base**

Set in `index.html`:

```html
<script>window.QSI_API_BASE = "https://your-backend.up.railway.app";</script>
```

Leave it empty (`""`) to run the page as a static demo – every request falls
back to client-side demo data.

### Local preview (frontend only)

```bash
npm run dev          # or: python3 -m http.server 3000
```

## Backend (FastAPI)

### Local

```bash
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # then edit
uvicorn app.main:app --reload --port 8000
```

Visit `http://localhost:8000/docs` for OpenAPI, `/health` for readiness.

### Endpoints

| Method | Path                  | Description                                       |
| ------ | --------------------- | ------------------------------------------------- |
| GET    | `/health`             | Service status + feature flags                    |
| POST   | `/api/auth/telegram`  | Validate raw `initData` (HMAC SHA-256, `auth_date`) |
| GET    | `/api/market/tickers` | Bybit V5 tickers; demo fallback                   |
| GET    | `/api/market/kline`   | Bybit V5 candles                                  |
| GET    | `/api/market/orderbook` | Bybit V5 L2 depth                               |
| GET    | `/api/signals`        | Latest signals from `SignalEngine`                |
| POST   | `/api/ai/chat`        | LLM if `OPENAI_API_KEY` set, else structured mock |
| POST   | `/api/ai/voice`       | Voice placeholder (mock reply)                    |
| WS     | `/ws/market`          | Streams market snapshots to connected clients     |

### Telegram `initData` validation

Implemented in `backend/app/core/telegram_auth.py`. The server-side
algorithm matches the official spec:

1. Parse the raw `initData` query string.
2. Extract and remove the `hash` field.
3. Build the data-check-string: `key=value` pairs sorted alphabetically, joined by `\n`.
4. Derive `secret_key = HMAC_SHA256("WebAppData", bot_token)`.
5. Compute `HMAC_SHA256(secret_key, data_check_string).hexdigest()` and compare with `hmac.compare_digest`.
6. Reject when `auth_date` is older than `TELEGRAM_INIT_DATA_MAX_AGE` (24h default) or in the future (>60s tolerance).

`initDataUnsafe` is **never** trusted server-side. Tests:

```bash
cd backend && . .venv/bin/activate
python -m unittest discover -s tests -v
# Ran 12 tests in 0.085s — OK
```

### Bybit-first market data

`backend/app/services/bybit.py` implements an async client over V5 public REST
(`/v5/market/tickers`, `/v5/market/kline`, `/v5/market/orderbook`) plus a
WebSocket skeleton (`wss://stream.bybit.com/v5/public/<category>`) ready for
topics `tickers.<symbol>`, `kline.<interval>.<symbol>`, `orderbook.<depth>.<symbol>`.
No private key required for any of this.

Whenever Bybit is unreachable (region blocks, rate limits, transient errors)
the service degrades to deterministic demo data so the API never returns 5xx
for clients.

### Signal engine

`backend/app/services/signals.py` exposes a `SignalEngine` that delegates to a
`SignalStrategy` protocol. The shipped `MomentumDemoStrategy` is deterministic
and intended as a placeholder. Swap in a real strategy by implementing
`async evaluate(tickers: list[Ticker]) -> list[Signal]` – no caller changes
required.

### AI assistant

`/api/ai/chat` proxies to OpenAI when `OPENAI_API_KEY` is set, otherwise
returns a localized structured mock (en/ru/zh) so the frontend can be
developed end-to-end without provisioning a model. `/api/ai/voice` is a
placeholder.

### Bot alerts

`backend/app/services/bot.py` exposes `send_message(chat_id, text)` that
no-ops unless `TELEGRAM_BOT_TOKEN` is configured. Wire it into the signal
engine to push high-confidence alerts via Telegram.

## Deployment

### Railway

1. Push the repo to GitHub.
2. Railway → **New Project → Deploy from GitHub** → pick the repo.
3. **Service root** → `backend/` (or set `BACKEND_DIR=backend` and use a service that mounts that path).
4. Railway auto-detects `requirements.txt` (Nixpacks) and uses `Procfile` /
   `railway.json` to start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.
5. Set environment variables (see below). At minimum:
   * `TELEGRAM_BOT_TOKEN` – your @BotFather token (keep it server-only).
   * `CORS_ORIGINS=https://<your-frontend-domain>`
6. Open the generated `https://<svc>.up.railway.app/health` to verify.
7. In the frontend `index.html`, set `window.QSI_API_BASE` to the Railway URL
   and redeploy the frontend (Vercel) – or serve it from any static host.

### Docker / VPS

```bash
cd backend
docker build -t quantsignal-backend .
docker run --rm -p 8000:8000 \
  -e TELEGRAM_BOT_TOKEN=... \
  -e CORS_ORIGINS=https://your-frontend \
  quantsignal-backend
```

Behind nginx (TLS termination + reverse proxy) is the recommended VPS layout.

### Environment variables

| Variable                       | Required | Default                                       | Purpose                                                    |
| ------------------------------ | -------- | --------------------------------------------- | ---------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`           | for auth | empty                                         | Telegram bot token; enables `initData` validation          |
| `TELEGRAM_INIT_DATA_MAX_AGE`   | no       | `86400`                                       | Reject `initData` older than this many seconds             |
| `CORS_ORIGINS`                 | prod     | `*`                                           | Comma-separated list of allowed origins                    |
| `BYBIT_REST_BASE`              | no       | `https://api.bybit.com`                       | Override REST endpoint                                     |
| `BYBIT_WS_PUBLIC`              | no       | `wss://stream.bybit.com/v5/public/linear`     | Public WS endpoint                                         |
| `BYBIT_CATEGORY`               | no       | `linear`                                      | `linear`, `spot`, or `inverse`                             |
| `MARKET_SYMBOLS`               | no       | `BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,TONUSDT,XRPUSDT` | Default tickers                                            |
| `OPENAI_API_KEY`               | no       | empty                                         | Enables real AI replies; mock otherwise                    |
| `OPENAI_MODEL`                 | no       | `gpt-4o-mini`                                 | Model name                                                 |
| `PORT`                         | no       | `8000`                                        | Standard Railway/Heroku port                               |
| `DEBUG`                        | no       | `false`                                       | Verbose logging                                            |

## Security

* **Bot token is server-only.** Never bundle `TELEGRAM_BOT_TOKEN` into the
  frontend, never log it. Mini Apps receive `initData` from Telegram; the
  backend re-computes the HMAC using the secret token and compares.
* **Validate `initData` server-side.** Endpoints that depend on user identity
  must call `validate_init_data`. The shipped `/api/auth/telegram` endpoint
  performs the full check; `/api/ai/chat` enforces validation automatically
  whenever a bot token is configured.
* **Never trust `initDataUnsafe`.** It is the unverified, client-supplied
  twin of `initData`. We use `language_code` from it only as a UI hint.
* **Rotate leaked tokens immediately** via @BotFather (`/revoke` then
  `/token`). Update Railway / VPS env vars. Audit any code path or log file
  that may have captured the old value.
* **CORS:** set `CORS_ORIGINS` to your exact frontend origin(s) in
  production – `*` is for development only.
* **No cookies / `localStorage` / `sessionStorage`.** All client state is
  in-memory; this avoids the Telegram WebView restrictions and removes a
  whole class of token-leak vectors.

## Frontend deploy (unchanged)

`vercel.json` still ships – `vercel --prod` from the repo root deploys
`index.html` + assets. After deploy, edit `window.QSI_API_BASE` to point at
the backend.

## Running tests

```bash
cd backend && . .venv/bin/activate
python -m unittest discover -s tests -v
```

The suite covers Telegram HMAC validation (happy path, tamper detection,
wrong token, expired, missing hash, empty inputs) and FastAPI smoke tests
(`/health`, `/`, `/api/signals`, `/api/ai/chat`, `/api/auth/telegram`).

## Version

`v0.2.0` – full-stack scaffold. The reference-inspired neon design is
preserved bit-for-bit; new logic is additive.
