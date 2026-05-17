# QUANTSIGNAL AI — Content Engine

A production-minded post-generation pipeline that powers branded
Telegram posts for the QUANTSIGNAL AI channel (`@QUANTSIGNAL_AI`) and
bot (`@QUANTSIGNAL_AI_BOT`). It generates captions and a deterministic
branded image without depending on external AI services for the happy
path — so latency is bounded and the pipeline never blocks.

The existing `/api/channel/post` endpoint continues to work unchanged
for the canonical daily channel post. The Content Engine adds:

- A reusable library that builds **post plans** for several post types.
- A reusable **branded SVG image generator** that matches the QSI
  visual language (dark grid, cyan/orange accents, coin/pair, price,
  24h change, bias / confidence / risk blocks, footer bot link).
- Two new endpoints: `/api/content/preview` (public, JSON) and
  `/api/content/publish` (secret-gated).
- An admin/preview HTML page at `/admin` (mobile-friendly, dark) for
  reviewing posts before publishing.

## Post types

| `type`           | Описание                                              |
|------------------|-------------------------------------------------------|
| `market_update`  | Сводка рынка BTC/ETH/SOL/TON/DOGE с настроением и нарративом. |
| `signal_idea`    | Сигнал-идея по одному символу: bias, уверенность, риск, уровни (вход/стоп/цели). |
| `coin_focus`     | Разбор актива: bias + диапазон 24ч + что смотреть дальше. |
| `ai_radar`       | Дайджест "что интересно сейчас" — топ-движения и режим рынка. |

Все подписи — на русском по умолчанию. Текст детерминированный (без
вызовов внешних AI-провайдеров для MVP), что гарантирует стабильную
задержку и отказоустойчивость.

## Endpoints

### `GET /api/content/preview`

Public. Никаких секретов. Возвращает JSON с готовым постом.

Параметры:

- `type` — один из `market_update | signal_idea | coin_focus | ai_radar`
  (по умолчанию `market_update`).
- `symbol` — необязательно, один из `BTC | ETH | SOL | TON | DOGE`.

Пример:

```
curl -s "https://quantsignal-miniapp.vercel.app/api/content/preview?type=signal_idea&symbol=BTC" | jq
```

Ответ:

```json
{
  "ok": true,
  "type": "signal_idea",
  "symbol": "BTC",
  "headline": "BTC: импульс смещается на сторону покупателей",
  "caption_html": "🎯 <b>QUANTSIGNAL AI · Сигнал-идея</b> ...",
  "image_svg_base64": "PD94bWwgdmVyc2lvbj0iMS4wIi4uLg==",
  "image_data_url": "data:image/svg+xml;base64,...",
  "image_content_type": "image/svg+xml",
  "image_path": "/assets/telegram/quantsignal-label.jpeg",
  "label_image_base64": "<...>",
  "snapshot": [{ "sym": "BTC", "last": 67432, "pct": 1.42, "source": "bybit" }, ...],
  "mood":       { "key": "neutral", "label": "Нейтральный", "score": 0.42 },
  "confidence": { "key": "medium", "label": "средняя" },
  "risk":       { "key": "medium", "label": "средний" },
  "warnings": []
}
```

### `POST /api/content/publish`

Защищён секретом. По умолчанию **не публикует**, а возвращает превью —
точно так же, как `/api/channel/post`. Реальная отправка в канал
происходит только когда выполнены **все** условия:

- `QSI_CHANNEL_POSTING_ENABLED === "1"`
- `TELEGRAM_BOT_TOKEN` (или `BOT_TOKEN`) задан
- `QSI_TELEGRAM_CHANNEL_ID` (или `TELEGRAM_CHANNEL_ID`) задан
- `QSI_CRON_SECRET` (или `CRON_SECRET`) задан **и** передан вызывающим:
    - `Authorization: Bearer <secret>`, **или**
    - `?secret=<secret>` (для удобства локального тестирования).

Дополнительный параметр `?dry_run=1` принудительно возвращает превью
даже когда продакшн-флаги включены.

Примеры:

```bash
# превью (publish-роут) — секрет всё равно обязателен,
# просто гарантирует, что в канал ничего не уйдёт
curl -s -X POST "$BASE/api/content/publish?type=ai_radar&dry_run=1" \
  -H "Authorization: Bearer $QSI_CRON_SECRET"

# реальная публикация (когда включены QSI_CHANNEL_POSTING_ENABLED и пр.)
curl -s -X POST "$BASE/api/content/publish?type=market_update" \
  -H "Authorization: Bearer $QSI_CRON_SECRET"
```

## Admin UI

Открыть в браузере: `/admin` (например,
`https://quantsignal-miniapp.vercel.app/admin`).

Что умеет:

- Выбор `type` и `symbol`.
- Кнопка «Сгенерировать превью» — вызывает `/api/content/preview`,
  показывает изображение, caption, снимок рынка и метаданные
  (bias / уверенность / риск).
- Копирование caption в буфер обмена.

UI **не публикует** в канал и **не запрашивает** секрет в браузере. Для
публикации используйте `/api/content/publish` через `curl` (см. выше)
или внешний шедулер (GitHub Actions / cron-job.org / Upstash QStash /
Cloudflare Workers cron — см. `CHANNEL_SETUP.md`).

Файл `admin/index.html` помечен `<meta name="robots" content="noindex,
nofollow" />` и не подключён к основному Mini App — он не влияет на
скорость загрузки приложения.

## Стабильность и фолбэки

Latency-критичные путь:

- Рыночные данные тянутся параллельно через `Promise.allSettled` с
  таймаутом 7 секунд на upstream (см. `api/_lib/market.js`).
- Цепочка фолбэков: Bybit → Coinbase → Kraken. Если все три недоступны
  для конкретного символа, в `snapshot` приходит запись с `last: null`
  и `source: "unavailable"`, а пост всё равно генерируется (caption
  показывает `—` для недоступных цен).
- Картинка генерируется **детерминированно** SVG-строкой без внешних
  зависимостей (нет `sharp`, нет `satori`, нет `canvas`). Это значит,
  что Vercel-функция не упадёт из-за отсутствующего бинаря и не будет
  лагать на cold start.
- Для собственно отправки в Telegram используется тот же канонический
  бренд-баннер (`assets/telegram/quantsignal-label.jpeg`), что и в
  `api/channel/post.js`. SVG идёт только в превью.

`warnings[]` в ответе — это список не-фатальных проблем (например,
`symbol_fetch_failed:TON`). UI и шедулер могут логировать их, не блокируя
публикацию.

## Безопасность

- В исходниках **нет** жёстко зашитых токенов, секретов или URL с
  токеном Telegram. Всё читается из `process.env` на стороне Vercel.
- Публикация без секрета невозможна. `isAuthorized()` в
  `api/content/publish.js` требует **наличия** секрета и его совпадения.
- Admin UI принципиально не имеет UI-кнопки публикации, чтобы не было
  соблазна положить секрет в браузер.

## Структура кода

```
api/
  _lib/
    http.js              # общие HTTP-хелперы (был раньше)
    market.js            # NEW: рыночные фолбэки + Promise.allSettled
    content-engine.js    # NEW: план поста (4 типа), RU-копии, mood/headline/levels
    brand-image.js       # NEW: программный SVG-генератор бренд-карточки
  channel/
    post.js              # без изменений — продолжает обслуживать ежедневный пост
  content/
    preview.js           # NEW: публичное превью (JSON)
    publish.js           # NEW: secret-gated публикация
  ai/chat.js             # без изменений
admin/
  index.html             # NEW: standalone admin/preview UI
scripts/
  verify-content-engine.mjs   # NEW: верификатор
  verify-*.mjs                # без изменений
CONTENT_ENGINE.md          # этот файл
```

## Как подключить к расписанию

`vercel.json` **не** объявляет крон для новых эндпоинтов. На Hobby-плане
доступны только суточные кроны, поэтому для 3/день постов используется
внешний шедулер. Любой из следующих вариантов работает:

- GitHub Actions с `schedule:` cron — три расписания, каждое вызывает
  `POST /api/content/publish?type=...` с `Authorization: Bearer
  ${{ secrets.QSI_CRON_SECRET }}`.
- cron-job.org — три задачи с разными `type=` параметрами.
- Upstash QStash / Cloudflare Workers cron — тот же шаблон.

Не забывайте проверять `warnings[]` в ответе — если все символы пришли
с `source: "unavailable"`, имеет смысл переотправить позже.

## Интеграция с legacy `/api/channel/post`

Существующий эндпоинт `api/channel/post.js` теперь тоже использует
Content Engine для генерации подписи, оставаясь обратно совместимым с
текущим внешним шедулером:

- Подпись (HTML caption) собирается через `engine.planForType(...)`.
- Тип поста выбирается детерминированно по UTC-часу (см. `pickTypeForNow`
  в `api/channel/post.js`) либо переопределяется через `?type=...`.
- Для отрисовки SVG-баннера используется `plan.snapshot` — один общий
  запрос к рынку (Bybit → Coinbase → Kraken), без двойного fetch.
- В JSON-превью добавлены поля `type`, `symbol`, `confidence`, `risk`,
  `hero`, `engine`, `warnings` — старые поля (`caption_html`, `mood`,
  `headline`, `rows`, `image_*`) сохранены без изменений.
- При сбое Content Engine endpoint автоматически возвращается к
  старому детерминированному «Сводка рынка», и в JSON отображается
  `engine: "legacy_fallback"` плюс `engine_error`.

Verifier `npm run verify:content-engine` + `npm run verify:channel-posting`
покрывают и старый, и новый путь.
