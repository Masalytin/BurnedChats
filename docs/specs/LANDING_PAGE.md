# Landing Page — Спецификация

> Лендинг для пользователей, открывших сайт вне Telegram Mini App.
> Концепция: **"Манифест приватности" + "Техническая витрина"**

## 📋 Содержание

- [Контекст и цель](#контекст-и-цель)
- [Когда показывается лендинг](#когда-показывается-лендинг)
- [Дизайн-система и тональность](#дизайн-система-и-тональность)
- [Структура страницы](#структура-страницы)
  - [1. Hero](#1-hero)
  - [2. Манифест — Принципы](#2-манифест--принципы)
  - [3. How It Works — Жизненный цикл](#3-how-it-works--жизненный-цикл)
  - [4. Trust Block — Что видит сервер](#4-trust-block--что-видит-сервер)
  - [5. Сравнение с альтернативами](#5-сравнение-с-альтернативами)
  - [6. Технологии и Open Source](#6-технологии-и-open-source)
  - [7. Footer CTA](#7-footer-cta)
- [Адаптивность](#адаптивность)
- [Анимации](#анимации)
- [Доступность (a11y)](#доступность-a11y)
- [Технические требования](#технические-требования)
- [Wireframe](#wireframe)

---

## Контекст и цель

Сейчас при открытии приложения вне Telegram показывается заглушка:

```
⚠️ Cannot Start App
Please open this app from Telegram
```

**Цель**: заменить заглушку полноценным лендингом, который:

1. **Объясняет** — что такое Burned Chats и зачем это нужно
2. **Убеждает** — почему этому можно доверять (zero-knowledge, open source)
3. **Конвертирует** — направляет пользователя в Telegram для запуска Mini App
4. **Впечатляет** — визуально передаёт "burned" эстетику и серьёзность подхода к приватности

**Целевая аудитория**:
- Пользователь перешёл по ссылке на сайт (из статьи, соцсетей, поисковика)
- Пользователь скопировал URL приложения и открыл в обычном браузере
- Любопытствующий технический пользователь, который хочет разобраться в проекте

---

## Когда показывается лендинг

Логика определения контекста запуска уже реализована в `useTelegram` хуке:

```
frontend/src/hooks/useTelegram.ts → isInTelegram
```

**Условие**: `isInTelegram === false` в production-режиме.

Текущий код в `App.tsx` (строки 370–373):

```typescript
if (import.meta.env.PROD && !isInTelegram) {
  setInitError('Please open this app from Telegram');
  return;
}
```

**Изменение**: вместо `setInitError(...)` — рендерить компонент `<LandingPage />`.

---

## Дизайн-система и тональность

### Цветовая палитра

Используем существующие переменные из `theme.css` + дополнительные для лендинга:

| Назначение | Переменная / Значение | Использование |
|---|---|---|
| Фон основной | `--bc-bg-primary` (`#0f0f0f`) | Фон страницы |
| Фон секций | `--bc-bg-secondary` (`#1a1a1a`) | Чередующиеся секции |
| Фон карточек | `--bc-bg-elevated` (`#242424`) | Карточки фич, comparison |
| Бренд-оранжевый | `--bc-brand-primary` (`#ff6b35`) | Акценты, CTA, иконки |
| Бренд-градиент | `--bc-brand-gradient` | CTA-кнопки, highlights |
| Бренд-жёлтый | `--bc-brand-secondary` (`#ff9f1c`) | Второй акцент в градиентах |
| Текст основной | `--bc-text-primary` (`#ffffff`) | Заголовки, body |
| Текст вторичный | `--bc-text-secondary` (`#7d7d7d`) | Подзаголовки, описания |
| Зелёный | `--bc-success` (`#34c759`) | "Вы видите" в trust-блоке |
| Красный | `--bc-error` (`#ff4444`) | "Сервер видит" в trust-блоке |

### Типографика

| Элемент | Desktop | Mobile |
|---|---|---|
| Hero заголовок | 56–64px, font-weight: 800 | 36–40px |
| Hero подзаголовок | 20–24px, font-weight: 400 | 16–18px |
| Заголовок секции | 36–40px, font-weight: 700 | 28–32px |
| Подзаголовок секции | 18–20px, font-weight: 400 | 16px |
| Body текст | 16–18px | 15–16px |
| Манифест-цитата | 28–32px, font-weight: 600, italic | 22–24px |
| Моноширинный | `--bc-font-mono` | Для code-блоков, протоколов |

### Тональность текста

- Спокойная уверенность, без агрессии и хайпа
- Короткие декларативные предложения
- Стиль: "мы не просим доверять — мы делаем доверие ненужным"
- Язык лендинга: **английский** (основная аудитория — Telegram-юзеры международно)

---

## Структура страницы

### 1. Hero

**Цель**: захватить внимание, объяснить суть за 5 секунд.

**Содержание**:

```
[Анимированная иконка огня / логотип]

Burned Chats

Messages that leave no trace.

End-to-end encrypted. Self-destructing. 
Built on zero-knowledge architecture.

[Open in Telegram]  ← Primary CTA
```

**Визуальные детали**:
- Логотип / иконка огня в центре с мягной glow-анимацией (оранжевый `--bc-shadow-glow`)
- Заголовок: крупный, белый, font-weight: 800
- Подзаголовок: `--bc-text-secondary`, font-weight: 400
- Три ключевых слова (encrypted / self-destructing / zero-knowledge) — выделены оранжевым или с подчёркиванием
- CTA-кнопка: градиент `--bc-brand-gradient`, крупная, с иконкой Telegram
- Фон: тонкий radial-gradient от `#1a1a1a` к `#0f0f0f`, можно добавить subtle particle-эффект или тонкий grid-паттерн
- Скролл-индикатор внизу (стрелка вниз / chevron с анимацией bounce)

**Высота**: полный viewport (`100vh` / `100dvh`).

---

### 2. Манифест — Принципы

**Цель**: эмоциональный блок — сформировать доверие через принципы.

**Содержание**:

Крупная цитата-statement сверху:

> *"We can't read your messages. Even if we wanted to."*

Далее 4 принципа в виде карточек (2x2 grid на desktop, вертикальный список на mobile):

| # | Иконка | Заголовок | Описание |
|---|--------|-----------|----------|
| 1 | Shield/Lock | **Zero Knowledge** | The server never sees your messages, keys, or passwords. It relays encrypted bytes — nothing more. |
| 2 | Flame | **Ephemeral by Design** | Messages exist only in the moment. When you burn a chat, all data is permanently destroyed. No backups, no traces. |
| 3 | Key | **End-to-End Encrypted** | ECDH key exchange + AES-256-GCM encryption. Keys live only on your device and never leave it. |
| 4 | Eye / Fingerprint | **Verified Identity** | Visual fingerprint verification protects against man-in-the-middle attacks. You know who you're talking to. |

**Визуальные детали**:
- Цитата: крупный текст, italic, по центру, с decorative quotes
- Карточки: фон `--bc-bg-elevated`, border `--bc-border-color`, border-radius `--bc-radius-lg`
- Иконки: оранжевые (`--bc-brand-primary`), размер 32–40px
- Появление карточек: анимация при скролле (staggered fade-in + slide-up)

---

### 3. How It Works — Жизненный цикл

**Цель**: визуально показать как работает протокол, просто и понятно.

**Содержание**:

Заголовок: **"How it works"**
Подзаголовок: *"A secure chat in 5 steps"*

Вертикальный timeline с 5 шагами:

| Шаг | Иконка | Заголовок | Описание |
|-----|--------|-----------|----------|
| 1 | Search | **Find** | Search for a Telegram user by username or ID |
| 2 | Send | **Invite** | Send an encrypted chat request. They get a Telegram notification |
| 3 | Handshake | **Handshake** | Both devices perform an ECDH key exchange. A shared secret is created without the server ever seeing it |
| 4 | Shield | **Verify** | Compare visual fingerprints to ensure no one is intercepting the connection |
| 5 | Chat/Flame | **Chat & Burn** | Exchange messages encrypted with AES-256-GCM. When done — burn everything |

**Визуальные детали**:
- Timeline — вертикальная линия слева (desktop) или по центру (mobile)
- Каждый шаг — кружок с номером на линии + карточка с описанием справа/слева (чередование на desktop)
- Линия: градиент от `--bc-brand-primary` к `--bc-brand-secondary`
- Номера шагов: в оранжевом кружке
- Анимация: шаги появляются по одному при скролле
- Между шагами 3–4 можно показать ASCII-схему протокола:

```
Alice            Server           Bob
  │                │                │
  ├── publicKey ──►│                │
  │                ├── publicKey ──►│
  │                │◄── publicKey ──┤
  │◄── publicKey ──┤                │
  │                │                │
  │  sharedSecret  │   ??? blob    │  sharedSecret
  └────────────────┴────────────────┘
```

Схема — в моноширинном шрифте, стилизованная, с подсветкой "??? blob" красным, а "sharedSecret" — зелёным.

---

### 4. Trust Block — Что видит сервер

**Цель**: конкретно и наглядно показать разницу между тем, что видит сервер, и тем, что видит пользователь.

**Заголовок**: **"Don't trust us. You don't have to."**

**Содержание**: два столбца (или две стопки на mobile):

**Левый столбец — "What the server sees"** (фон с красноватым оттенком):

```
session: a1b2c3d4
from: user_928471
to: user_382910
payload: 0x8a4f2b...e7c103 (encrypted blob)
status: ACTIVE
ttl: 3600s
```

Подпись: *Encrypted bytes. Metadata. Nothing else.*

**Правый столбец — "What you see"** (фон с зеленоватым оттенком):

```
Hey, are we still meeting tomorrow?

Yeah! Let's do 3pm at the usual place.

Sounds good. I'll bring the documents.

[🔥 Burn Chat]
```

Подпись: *Decrypted on your device. Keys never leave your browser.*

**Визуальные детали**:
- Два столбца оформлены как "экраны" или "окна терминала"
- Левый: стиль терминала, тёмный фон, моноширинный шрифт, subtle красный accent (`--bc-error` с низкой opacity для border/glow)
- Правый: стиль мессенджера с bubble-сообщениями, зелёный accent (`--bc-success`)
- На mobile: два блока вертикально (сервер сверху, пользователь снизу)
- Анимация: при скролле сначала появляется левый блок (encrypted), затем правый (decrypted) — эффект "расшифровки"

---

### 5. Сравнение с альтернативами

**Цель**: объективно показать отличия от существующих решений.

**Заголовок**: **"How we compare"**

**Таблица**:

| Feature | Burned Chats | Telegram Secret | Signal | WhatsApp |
|---------|:---:|:---:|:---:|:---:|
| End-to-End Encryption | ✅ | ✅ | ✅ | ✅ |
| Zero-Knowledge Server | ✅ | ❌ | ⚠️ partial | ❌ |
| Self-Destructing Messages | ✅ auto | ⚠️ timer | ⚠️ timer | ⚠️ timer |
| No Persistent Storage | ✅ | ❌ | ❌ | ❌ |
| Visual Verification | ✅ | ❌ | ✅ | ✅ |
| No Phone Number Required | ✅ | ❌ | ❌ | ❌ |
| Open Source | ✅ | ⚠️ client | ✅ | ❌ |

**Визуальные детали**:
- Таблица: фон `--bc-bg-elevated`, rounded corners
- Столбец "Burned Chats" — визуально выделен (accent border сверху или gradient highlight)
- ✅ — зелёный, ❌ — красный/серый, ⚠️ — жёлтый
- На mobile: таблица горизонтально скроллится, или преобразуется в карточки (каждый конкурент — отдельная карточка)
- Под таблицей примечание мелким текстом: *"Comparison based on publicly available information. Last updated: [date]."*

---

### 6. Технологии и Open Source

**Цель**: показать техническую серьёзность, прозрачность кода.

**Заголовок**: **"Built in the open"**

**Содержание**:

Ряд технологических бейджей:

```
[ECDH P-256]  [AES-256-GCM]  [Web Crypto API]  [React]  [Spring Boot]  [Redis]  [TypeScript]  [Java 21]
```

Под бейджами — блок с GitHub:

```
🔗  Source code is public. Audit it yourself.

[View on GitHub]  ← Secondary CTA (link button)
```

Опционально — короткий code snippet как "proof of transparency":

```typescript
// All encryption happens in your browser
const sharedSecret = await crypto.subtle.deriveBits(
  { name: 'ECDH', public: peerPublicKey },
  myPrivateKey,
  256
);
```

**Визуальные детали**:
- Бейджи: pill-shape, фон `--bc-bg-elevated`, border `--bc-border-color`, моноширинный шрифт
- GitHub-блок: по центру, иконка GitHub + кнопка
- Code snippet: стилизованный как IDE с подсветкой синтаксиса, тёмная тема
- Бейджи выстраиваются в ряд с переносом (flexbox wrap)

---

### 7. Footer CTA

**Цель**: финальный призыв к действию + базовая информация.

**Содержание**:

```
Ready to chat without leaving a trace?

[Open in Telegram]  ← Primary CTA (повтор)

---

Burned Chats — ephemeral encrypted messaging inside Telegram.
Built with ❤️ and 🔥

[GitHub]  [Documentation]
```

**Визуальные детали**:
- Заголовок: крупный, по центру
- CTA-кнопка: аналогична hero (градиент, крупная)
- Разделитель: тонкая линия `--bc-border-color`
- Нижний текст: мелкий, `--bc-text-muted`
- Ссылки: иконки + текст, `--bc-text-link`
- Минимальный padding снизу

---

## Адаптивность

Страница должна корректно отображаться на всех устройствах:

| Breakpoint | Ширина | Особенности |
|---|---|---|
| Mobile | < 640px | Один столбец, уменьшенная типографика, вертикальный trust-блок, таблица скроллится или карточки |
| Tablet | 640–1024px | Два столбца где возможно, промежуточная типографика |
| Desktop | > 1024px | Полная раскладка, все grid'ы, timeline чередуется |

**Максимальная ширина контента**: 1200px (`.landing-container`), центрируется.

**Mobile-first**: стили пишутся от mobile, расширяются через `min-width` media queries.

---

## Анимации

Все анимации реализуются через **CSS** (предпочтительно) или **Intersection Observer API**.

| Элемент | Тип анимации | Trigger |
|---|---|---|
| Hero логотип | Мягный glow pulse (бесконечный) | При загрузке |
| Hero текст | Fade-in + slide-up (staggered) | При загрузке |
| Scroll-индикатор | Bounce (бесконечный) | При загрузке, исчезает после первого скролла |
| Манифест-цитата | Fade-in | Scroll into view |
| Карточки принципов | Staggered fade-in + slide-up | Scroll into view |
| Timeline шаги | Sequential appearance | Scroll into view |
| Trust-блок столбцы | Left fade-in, then right fade-in | Scroll into view |
| Таблица сравнения | Fade-in | Scroll into view |
| Бейджи технологий | Staggered scale-in | Scroll into view |

**Требования**:
- Все анимации должны уважать `prefers-reduced-motion: reduce` — при активации анимации отключаются
- Длительность: 300–600ms для появлений, ease-out timing
- Задержки stagger: 100–150ms между элементами
- Никаких тяжёлых JS-библиотек для анимаций (без GSAP, Framer Motion и т.д.)

---

## Доступность (a11y)

- Семантическая HTML-разметка: `<header>`, `<main>`, `<section>`, `<footer>`, `<nav>`
- Все изображения/иконки имеют `alt` / `aria-label`
- CTA-кнопки: `role="link"` или `<a>`, с `aria-label` описывающим действие
- Таблица сравнения: валидная `<table>` с `<thead>`, `<th scope>`, `<caption>`
- Контраст текста: минимум WCAG AA (4.5:1 для body, 3:1 для крупного текста)
- Фокус-стили: видимые, используют `--bc-brand-primary`
- Skip-to-content ссылка для keyboard-навигации
- Корректный `lang="en"` на лендинге

---

## Технические требования

### Компонентная структура

```
frontend/src/
├── pages/
│   └── LandingPage/
│       ├── LandingPage.tsx          — основной компонент
│       ├── LandingPage.css          — стили
│       └── index.ts                 — экспорт
│
├── components/
│   └── Landing/
│       ├── HeroSection.tsx
│       ├── ManifestoSection.tsx
│       ├── HowItWorksSection.tsx
│       ├── TrustBlockSection.tsx
│       ├── ComparisonSection.tsx
│       ├── TechSection.tsx
│       ├── FooterSection.tsx
│       └── index.ts
```

### Точка интеграции

В `App.tsx` — заменить блок с `initError`:

```typescript
// Было:
if (import.meta.env.PROD && !isInTelegram) {
  setInitError('Please open this app from Telegram');
  return;
}

// Стало:
if (import.meta.env.PROD && !isInTelegram) {
  return <LandingPage />;
}
```

Компонент `<LandingPage />` рендерится **вне** `<ToastProvider>` и основного app-flow — это полностью самостоятельная страница.

### Зависимости

- **Никаких новых npm-зависимостей** — только React, CSS, Web API
- Intersection Observer: нативный (поддержка > 95%)
- Анимации: CSS `@keyframes` + `animation`, CSS `transition`
- Иконки: можно использовать существующие из `frontend/src/icons/` или добавить новые SVG inline-компоненты

### Ссылки CTA

| CTA | URL | Примечание |
|---|---|---|
| Open in Telegram | `https://t.me/{BOT_USERNAME}` | Значение из env-переменной `VITE_TELEGRAM_BOT_URL` или захардкоженное |
| View on GitHub | `https://github.com/{ORG}/{REPO}` | Конфигурируемо |

### Производительность

- Лендинг не должен загружать WebSocket-логику, crypto-модули и прочий app-код
- Рассмотреть lazy-загрузку: если `!isInTelegram` — не импортировать основное приложение
- Целевые метрики:
  - LCP < 2.5s
  - CLS < 0.1
  - FID < 100ms
- Никаких внешних шрифтов (используем system font stack из `--bc-font-family`)
- Минимальный bundle: только React + CSS + SVG иконки

### SEO и метаданные

Поскольку лендинг — единственное, что видят поисковики, в `index.html` должны быть:

```html
<title>Burned Chats — Ephemeral Encrypted Messaging</title>
<meta name="description" content="End-to-end encrypted, self-destructing messages inside Telegram. Zero-knowledge server. Open source.">
<meta property="og:title" content="Burned Chats">
<meta property="og:description" content="Messages that leave no trace. E2EE + self-destruct inside Telegram.">
<meta property="og:type" content="website">
<meta property="og:image" content="/og-image.png">
<meta name="twitter:card" content="summary_large_image">
```

OG-изображение (`og-image.png`): логотип + слоган на тёмном фоне, 1200x630px.

---

## Wireframe

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│                         [100vh Hero]                             │
│                                                                  │
│                        🔥 (glow animation)                       │
│                                                                  │
│                       Burned Chats                               │
│                                                                  │
│                Messages that leave no trace.                     │
│                                                                  │
│         End-to-end encrypted. Self-destructing.                  │
│           Built on zero-knowledge architecture.                  │
│                                                                  │
│                   [ Open in Telegram ]                           │
│                                                                  │
│                          ↓ (scroll)                              │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│        "We can't read your messages.                             │
│         Even if we wanted to."                                   │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐                             │
│  │ 🛡 Zero      │  │ 🔥 Ephemeral │                             │
│  │   Knowledge  │  │    by Design │                              │
│  │              │  │              │                              │
│  │  Server sees │  │  Messages    │                              │
│  │  nothing     │  │  burn auto   │                              │
│  └──────────────┘  └──────────────┘                             │
│  ┌──────────────┐  ┌──────────────┐                             │
│  │ 🔑 End-to-   │  │ 👁 Verified  │                             │
│  │    End       │  │   Identity   │                              │
│  │              │  │              │                              │
│  │  AES-256-GCM │  │  Visual      │                              │
│  │  on device   │  │  fingerprint │                              │
│  └──────────────┘  └──────────────┘                             │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                   How it works                                   │
│              A secure chat in 5 steps                            │
│                                                                  │
│          ●─── 1. Find                                            │
│          │    Search for a user                                  │
│          │                                                       │
│          ●─── 2. Invite                                          │
│          │    Send encrypted request                             │
│          │                                                       │
│          ●─── 3. Handshake                                       │
│          │    ECDH key exchange                                  │
│          │                                                       │
│          │    Alice ──► Server ──► Bob                           │
│          │      ◄── ??? blob ──◄                                │
│          │    secret         secret                              │
│          │                                                       │
│          ●─── 4. Verify                                          │
│          │    Compare fingerprints                               │
│          │                                                       │
│          ●─── 5. Chat & Burn                                     │
│               AES-256-GCM encrypted                              │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│          "Don't trust us. You don't have to."                    │
│                                                                  │
│  ┌─ What the server sees ──┐  ┌─ What you see ─────────┐       │
│  │                          │  │                         │       │
│  │  session: a1b2c3d4      │  │  Hey, still meeting     │       │
│  │  from: user_928471      │  │  tomorrow?              │       │
│  │  to: user_382910        │  │                         │       │
│  │  payload: 0x8a4f...     │  │  Yeah! 3pm works.      │       │
│  │  status: ACTIVE         │  │                         │       │
│  │  ttl: 3600s             │  │  [🔥 Burn Chat]        │       │
│  │                          │  │                         │       │
│  │  Encrypted bytes.       │  │  Decrypted on device.  │       │
│  │  Nothing else.          │  │  Keys stay in browser. │       │
│  └──────────────────────────┘  └─────────────────────────┘       │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                     How we compare                               │
│                                                                  │
│  ┌──────────────┬────┬─────┬──────┬─────────┐                   │
│  │ Feature      │ BC │ TG  │ Sig  │ WA      │                   │
│  ├──────────────┼────┼─────┼──────┼─────────┤                   │
│  │ E2EE         │ ✅ │ ✅  │ ✅  │ ✅      │                   │
│  │ Zero-Know    │ ✅ │ ❌  │ ⚠️  │ ❌      │                   │
│  │ Self-Destr   │ ✅ │ ⚠️  │ ⚠️  │ ⚠️      │                   │
│  │ No Storage   │ ✅ │ ❌  │ ❌  │ ❌      │                   │
│  │ Visual Verif │ ✅ │ ❌  │ ✅  │ ✅      │                   │
│  │ No Phone     │ ✅ │ ❌  │ ❌  │ ❌      │                   │
│  │ Open Source  │ ✅ │ ⚠️  │ ✅  │ ❌      │                   │
│  └──────────────┴────┴─────┴──────┴─────────┘                   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                    Built in the open                              │
│                                                                  │
│  [ECDH P-256] [AES-256-GCM] [Web Crypto API] [React]           │
│  [Spring Boot] [Redis] [TypeScript] [Java 21]                   │
│                                                                  │
│  Source code is public. Audit it yourself.                       │
│                  [View on GitHub]                                │
│                                                                  │
│  ┌─────────────────────────────────────────┐                     │
│  │  const sharedSecret = await             │                     │
│  │    crypto.subtle.deriveBits(            │                     │
│  │      { name: 'ECDH', public: peer },   │                     │
│  │      myPrivateKey, 256                  │                     │
│  │    );                                    │                     │
│  └─────────────────────────────────────────┘                     │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│          Ready to chat without leaving a trace?                  │
│                                                                  │
│                   [ Open in Telegram ]                           │
│                                                                  │
│  ─────────────────────────────────────────────                   │
│                                                                  │
│  Burned Chats — ephemeral encrypted messaging                    │
│  inside Telegram. Built with ❤️ and 🔥                           │
│                                                                  │
│  [GitHub]  [Docs]                                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Связанные документы

- [README.md](../../README.md) — обзор проекта
- [SECURITY.md](./SECURITY.md) — криптография (источник для технических деталей лендинга)
- [ARCHITECTURE.md](./ARCHITECTURE.md) — архитектура
- [TELEGRAM.md](./TELEGRAM.md) — интеграция с Telegram (детекция `isInTelegram`)
- [USER_FLOWS.md](./USER_FLOWS.md) — пользовательские сценарии (источник для "How It Works")
