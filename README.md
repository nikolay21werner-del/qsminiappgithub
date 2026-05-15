# QUANTSIGNAL AI — Telegram Mini App

Статическое Telegram Mini App (русский язык) с тёмной крипто/AI‑аналитической стилистикой.
Готово к открытию по HTTPS‑ссылке и привязке в BotFather. Бэкенда нет.

## Стек

- Чистый HTML / CSS / JavaScript (ES5‑совместимый), без сборщиков
- Telegram Web App SDK: <https://telegram.org/js/telegram-web-app.js>
- Шрифты Inter + JetBrains Mono через Google Fonts
- Деплой: Vercel (статический сайт)

## Структура

```
quantsignal-miniapp/
├── index.html        — разметка страницы
├── styles.css        — дизайн‑токены, layout, темизация, анимации
├── app.js            — инициализация Telegram SDK, тикер, KPI, секции
├── assets/
│   └── favicon.svg   — фавикон
├── vercel.json       — заголовки, кеш, CSP, разрешение iframe
├── package.json      — скрипты локального запуска (через `serve`)
└── README.md
```

## Локальный запуск

Требуется Node.js 18+ (для `npx`). Внутри директории проекта:

```bash
npm run dev
```

Команда поднимает статический сервер `serve` на `http://localhost:3000`.

Альтернативы без Node:

```bash
# Python 3
python3 -m http.server 3000

# либо любой другой статический сервер
```

Откройте `http://localhost:3000` в браузере. Внутри Telegram SDK не запустится
(объект `Telegram.WebApp` отсутствует вне клиента) — это нормально, страница
корректно деградирует.

## Тестирование внутри Telegram

1. Разверните проект (см. ниже) и получите HTTPS‑URL.
2. В BotFather: `/mybots` → выбрать бота → `Bot Settings` → `Menu Button` →
   `Configure menu button` → задать текст и вставить HTTPS‑URL.
3. Откройте бота в Telegram, нажмите кнопку меню — приложение загрузится в WebView.

## Деплой на Vercel

### Быстрый путь: Vercel CLI

```bash
npm i -g vercel
cd quantsignal-miniapp
vercel        # для preview
vercel --prod # для production
```

CLI обнаружит `vercel.json` и развернёт статику. Никакой `Build Command` не нужен —
выходом служит сам корень проекта.

### Через Git (рекомендуется)

1. Запушьте репозиторий на GitHub / GitLab / Bitbucket.
2. На <https://vercel.com> → `Add New… → Project` → импорт репозитория.
3. Framework Preset: `Other`. Build Command: пусто. Output Directory: `.` (точка).
4. `Deploy`. Vercel выдаст HTTPS‑URL вида `https://<project>.vercel.app`.

`vercel.json` уже настроен:

- `cleanUrls: true` — без `.html` в адресе
- CSP разрешает Telegram SDK и Google Fonts
- `X-Frame-Options: ALLOWALL` и `frame-ancestors *` — чтобы Telegram WebView мог встраивать
- Кеш `immutable` для `/assets/*` и `must-revalidate` для `styles.css` / `app.js`

## Как обновить текст и ссылки

| Что нужно поменять              | Где                                          |
|---------------------------------|-----------------------------------------------|
| Заголовок, подзаголовок, баджи  | `index.html`, секция `.hero`                  |
| Названия и описания карточек    | `index.html`, блок `.grid` (`.card.feature`)  |
| KPI‑значения по умолчанию       | `app.js`, функция `renderKPIs()`              |
| Бегущая строка (цены, символы)  | `app.js`, массив `TICKER`                     |
| Содержимое разделов (Сигналы и т.д.) | `app.js`, объект `SECTIONS`              |
| Цвета бренда                    | `styles.css`, переменные в `:root`            |
| Шрифты                          | `index.html` (`<link>` на Google Fonts), `--font-sans` в `styles.css` |
| Логотип                         | SVG прямо в `index.html` (`.logo-mark`) + `assets/favicon.svg` |
| Заголовок вкладки / OG          | `<title>` и `<meta property="og:*">` в `index.html` |

CTA‑кнопки и карточки используют атрибут `data-action="..."` — обработчик в `app.js`,
функция `handleAction()`. Чтобы добавить новый раздел, расширьте объект `SECTIONS`
и добавьте кейс в `handleAction`.

## Ограничения и решения

- **Не используются** `localStorage`, `sessionStorage`, `cookies` — Telegram WebView
  это запрещает в части клиентов; всё состояние — только в памяти.
- **Внешней авторизации нет.** Если потребуется идентификация — данные пользователя
  доступны через `window.Telegram.WebApp.initDataUnsafe` (только на стороне Telegram).
- **Сторонние ссылки**: внутри Mini App открывайте их через
  `Telegram.WebApp.openLink(url)` или `openTelegramLink(url)`.

## Telegram‑интеграции, уже подключённые

- `WebApp.ready()` и `WebApp.expand()` при загрузке
- `setHeaderColor` / `setBackgroundColor` синхронизируют шапку с дизайном
- `themeChanged` слушается и пробрасывает `themeParams` в CSS‑переменные
- `HapticFeedback` срабатывает на нажатия кнопок и карточек
- Бережно ловим ошибки — без SDK страница работает как обычная веб‑страница

## Версия

`v0.1.0` — стартовая интерактивная заглушка с демо‑данными.
