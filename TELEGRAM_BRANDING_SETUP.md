# QUANTSIGNAL AI — настройка брендинга бота и канала

Этот документ описывает **все ручные шаги оператора**, чтобы привести
бот `@QUANTSIGNAL_AI_BOT` и канал `@QUANTSIGNAL_AI` к премиум-виду:
аватарка, описания, приветствие, баннер канала, закреплённый пост.

Репозиторий уже содержит:

- 📦 Эндпоинт вебхука бота: `api/telegram/bot-webhook.js`
- 🖼 Брендовые ассеты: `assets/telegram/avatar.svg`,
  `assets/telegram/welcome-banner.svg`, `assets/telegram/channel-banner.svg`
- ✅ Верификатор: `npm run verify:telegram-branding`

> ⚠️ Сами Telegram API-вызовы (установка webhook, аватарок и описаний)
> **не выполняются автоматически из репозитория**. Их нужно выполнить
> вручную или прогнать через скрипт оператора с реальным `BOT_TOKEN`.

---

## 0. Переменные окружения (Vercel → Project → Settings → Environment Variables)

| Переменная | Назначение | Обязательно |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` *(или `BOT_TOKEN`)* | Токен бота от BotFather | Да, для реальных ответов |
| `QSI_BOT_WEBHOOK_SECRET` | Секрет для заголовка `X-Telegram-Bot-Api-Secret-Token` | Рекомендуется |
| `QSI_PUBLIC_HOST` *(или `WEBHOOK_PUBLIC_HOST`)* | Например, `quantsignal-miniapp.vercel.app` — используется, чтобы Telegram скачал баннер по публичному URL | Опционально |
| `QSI_TELEGRAM_CHANNEL_ID` | ID канала для авто-постов (см. `CHANNEL_SETUP.md`) | Для канала |
| `QSI_CHANNEL_POSTING_ENABLED` | `1`, чтобы реально публиковать в канал | Для канала |

Никогда не коммитьте токен. Никогда не выкладывайте секрет.

---

## 1. Бот: аватарка, имя, описания

### 1.1. Аватарка бота (только через BotFather)

> ⚠️ **Аватарку профиля бота нельзя установить через Bot API.**
> Это можно сделать только вручную в BotFather. Это ограничение
> платформы Telegram — `setUserProfilePhotos` для ботов недоступен.

1. Открой `@BotFather` → команда `/mybots` → выбери `@QUANTSIGNAL_AI_BOT`.
2. `Edit Bot` → `Edit Botpic` → отправь PNG **512×512**, ≤ 5 МБ.
3. Используй `assets/telegram/avatar.svg` как исходник. Сконвертируй в PNG
   на своей машине, например:
   ```bash
   # вариант 1: rsvg-convert (librsvg)
   rsvg-convert -w 512 -h 512 assets/telegram/avatar.svg -o avatar.png

   # вариант 2: inkscape
   inkscape assets/telegram/avatar.svg -w 512 -h 512 -o avatar.png

   # вариант 3: онлайн-конвертер SVG→PNG, размер 512×512
   ```

### 1.2. Имя бота (Bot Name)

В BotFather: `/setname` → `@QUANTSIGNAL_AI_BOT` →

```
QUANTSIGNAL AI
```

### 1.3. Короткое описание (About / 120 симв.)

BotFather: `/setabouttext` → `@QUANTSIGNAL_AI_BOT` →

```
QUANTSIGNAL AI — премиум-аналитика крипторынка: живой рынок, AI-разбор, сигналы и риск-менеджмент в Mini App.
```

### 1.4. Полное описание (Description / экран старта, 512 симв.)

BotFather: `/setdescription` → `@QUANTSIGNAL_AI_BOT` →

```
QUANTSIGNAL AI — твой торговый терминал в Telegram.

📈 Живой рынок: BTC, ETH, SOL, TON, DOGE (Bybit · Coinbase · Kraken)
🤖 AI-аналитика: настроение, уровни, сценарии на русском
⚡️ Сигналы: вход, стоп, цели, риск
🧭 Дашборд: обзор · рынок · AI-чат · профиль

📡 Канал: @QUANTSIGNAL_AI

Не финансовая рекомендация. Управляйте риском.
```

### 1.5. Команды бота

BotFather: `/setcommands` → `@QUANTSIGNAL_AI_BOT` →

```
start - Запустить QUANTSIGNAL AI
app - Открыть Mini App
help - Что умеет бот
```

### 1.6. Кнопка меню (Menu Button) → Mini App

BotFather: `/setmenubutton` → `@QUANTSIGNAL_AI_BOT` →

- Текст: `Открыть QUANTSIGNAL AI`
- URL: `https://quantsignal-miniapp.vercel.app/`

### 1.7. Mini App в BotFather (если ещё не зарегистрирован)

BotFather: `/newapp` (или `/myapps` → `Edit`) → бот
`@QUANTSIGNAL_AI_BOT`, название `QUANTSIGNAL AI`, описание из 1.4,
аватарка та же, URL `https://quantsignal-miniapp.vercel.app/`.

---

## 2. Webhook для приветствия в боте

Файл `api/telegram/bot-webhook.js` принимает обновления Bot API и на
команды `/start`, `/app`, `/help`, `/menu`, `/open` (или первое
сообщение в личке) отвечает:

- 🖼 Фото-баннер `assets/telegram/welcome-banner.svg` (если он доступен
  по публичному URL — Telegram сам скачает фото)
- 📝 HTML-капшен с описанием возможностей
- 🔘 Inline-клавиатура: `🚀 Открыть QUANTSIGNAL AI` (Mini App) +
  `📡 Канал QUANTSIGNAL AI`

Если фото-баннер не получится отправить (например, Telegram не примет
SVG как фото) — есть автоматический fallback на `sendMessage` с тем же
текстом и клавиатурой.

### 2.1. Зарегистрировать webhook у Telegram

> ⚠️ Этот шаг **не делается из репозитория**. Выполняется оператором
> один раз. Замени `<TOKEN>` и `<SECRET>` на свои значения.

```bash
TOKEN='<TELEGRAM_BOT_TOKEN>'
SECRET='<QSI_BOT_WEBHOOK_SECRET>'
HOST='quantsignal-miniapp.vercel.app'

curl -s "https://api.telegram.org/bot${TOKEN}/setWebhook" \
  -H 'Content-Type: application/json' \
  -d "{
    \"url\": \"https://${HOST}/api/telegram/bot-webhook\",
    \"secret_token\": \"${SECRET}\",
    \"allowed_updates\": [\"message\", \"edited_message\"],
    \"drop_pending_updates\": true
  }"
```

Проверка:

```bash
curl -s "https://api.telegram.org/bot${TOKEN}/getWebhookInfo" | jq .
```

Снять webhook (если потребуется откатить):

```bash
curl -s "https://api.telegram.org/bot${TOKEN}/deleteWebhook?drop_pending_updates=true"
```

### 2.2. Проверка приветствия

1. Открой `@QUANTSIGNAL_AI_BOT` в Telegram.
2. Нажми **Start**.
3. Жди фото-баннер + текст приветствия + кнопки.
4. Если приходит только текст (без фото) — это ожидаемый fallback;
   Telegram не принял SVG. Сконвертируй `assets/telegram/welcome-banner.svg`
   в `welcome-banner.png` (1280×720, ≤ 5 МБ), положи его в
   `assets/telegram/` и при необходимости поменяй
   `WELCOME_BANNER_PATH` в `api/telegram/bot-webhook.js`.

---

## 3. Канал `@QUANTSIGNAL_AI`

### 3.1. Аватарка канала

В Telegram → канал `@QUANTSIGNAL_AI` → **Manage Channel** → **Edit** →
тапни по аватарке → **Set Photo**. Загрузи PNG 512×512 (исходник:
`assets/telegram/avatar.svg`).

> Для канала Bot API позволяет менять фото через
> `setChatPhoto`, но это требует, чтобы бот был администратором канала
> и фото уже было файлом. Проще сделать вручную из приложения Telegram.

### 3.2. Имя и @username

- **Name**: `QUANTSIGNAL AI`
- **Description** (255 симв.):

```
QUANTSIGNAL AI — премиум-аналитика крипторынка.
📈 Живой рынок · 🤖 AI-разбор · ⚡️ Сигналы · 🧭 Риск-менеджмент.
Mini App: t.me/QUANTSIGNAL_AI_BOT
Не финансовая рекомендация. Управляйте риском.
```

### 3.3. Закреплённое приветственное сообщение

Отправить в канал (HTML, через того же бота-админа или вручную с
форматированием Markdown):

```
🛰 QUANTSIGNAL AI — добро пожаловать!

Это канал премиум-аналитики крипторынка.
Что внутри:
• 📈 Живой рынок: BTC, ETH, SOL, TON, DOGE
• 🤖 AI-разбор: настроение, уровни, сценарии
• ⚡️ Сигналы дня: вход, стоп, цели
• 🧭 Управление риском

🚀 Открыть приложение: t.me/QUANTSIGNAL_AI_BOT
📡 Канал: @QUANTSIGNAL_AI

⚠️ Не финансовая рекомендация. Управляйте риском.
```

Закрепить: **Pin** → **Notify all members**.

### 3.4. Автопостинг в канал

Уже настроен в `api/channel/post.js`. См. `CHANNEL_SETUP.md` для
переменных окружения и внешнего шедулера (Hobby-план Vercel не
поддерживает суб-дневные кроны).

---

## 4. Финальный чек-лист оператора

- [ ] BotFather → Botpic = `avatar.png` (512×512)  *(п. 1.1, **только BotFather, не Bot API**)*
- [ ] BotFather → `/setname`, `/setabouttext`, `/setdescription`, `/setcommands`, `/setmenubutton` *(п. 1.2 – 1.6)*
- [ ] Vercel env: `TELEGRAM_BOT_TOKEN`, `QSI_BOT_WEBHOOK_SECRET`, `QSI_PUBLIC_HOST` *(п. 0)*
- [ ] `setWebhook` на `https://<HOST>/api/telegram/bot-webhook` с `secret_token` *(п. 2.1)*
- [ ] `/start` в боте показывает баннер + текст + кнопки *(п. 2.2)*
- [ ] Канал: аватарка, имя, описание *(п. 3.1 – 3.2)*
- [ ] Канал: pin welcome-сообщения *(п. 3.3)*
- [ ] Канал: автопост работает в preview, потом включить `QSI_CHANNEL_POSTING_ENABLED=1` *(см. `CHANNEL_SETUP.md`)*

---

## 5. Откат

- Снять webhook: `deleteWebhook` *(п. 2.1)*.
- Удалить баннеры из BotFather / канала — стандартными средствами
  Telegram.
- Файлы в репозитории можно удалить отдельным PR; они не активны без
  установленного webhook.
