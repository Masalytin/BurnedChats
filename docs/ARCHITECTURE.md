# Архитектура системы

> Техническое описание компонентов Burned Chats

## 📋 Содержание

- [Обзор архитектуры](#обзор-архитектуры)
- [Компоненты системы](#компоненты-системы)
- [Потоки данных](#потоки-данных)
- [Масштабирование](#масштабирование)
- [Отказоустойчивость](#отказоустойчивость)

---

## Обзор архитектуры

### Высокоуровневая схема

```
                                    ┌─────────────────────┐
                                    │   Telegram Cloud    │
                                    │  ┌───────────────┐  │
                                    │  │   Bot API     │  │
                                    │  └───────┬───────┘  │
                                    └──────────┼──────────┘
                                               │ Notifications
                                               ▼
┌──────────────┐     HTTPS/WSS      ┌─────────────────────┐
│              │◄──────────────────►│                     │
│   Frontend   │                    │      Backend        │
│  (Mini App)  │                    │                     │
│              │◄──────────────────►│  ┌───────────────┐  │
└──────────────┘     Socket.io      │  │   Fastify     │  │
       │                            │  │   Server      │  │
       │                            │  └───────┬───────┘  │
       │                            │          │          │
       │                            │  ┌───────▼───────┐  │
       │  Web Crypto API            │  │    Redis      │  │
       │  (все ключи здесь)         │  │  (metadata)   │  │
       │                            │  └───────────────┘  │
       ▼                            └─────────────────────┘
┌──────────────┐
│ sessionStorage│
│  (volatile)   │
└──────────────┘
```

### Принципы проектирования

1. **Zero-Knowledge** — сервер никогда не видит plaintext
2. **Ephemeral by Design** — данные существуют только в RAM клиентов
3. **Fail-Safe Destruction** — при любой ошибке ключи уничтожаются
4. **Minimal Trust** — доверие только к Web Crypto API браузера

---

## Компоненты системы

### 1. Frontend (Telegram Mini App)

```
src/
├── main.tsx                 # Entry point
├── App.tsx                  # Root component
├── components/
│   ├── Chat/
│   │   ├── ChatRoom.tsx     # Основной чат
│   │   ├── MessageList.tsx  # Список сообщений
│   │   ├── MessageInput.tsx # Ввод с шифрованием
│   │   └── BurnButton.tsx   # Кнопка уничтожения
│   ├── Search/
│   │   ├── UserSearch.tsx   # Поиск по Telegram ID
│   │   └── PendingRequest.tsx
│   ├── Verification/
│   │   ├── VisualFingerprint.tsx  # Визуальная верификация
│   │   └── SecretQuestion.tsx     # Опциональный вопрос
│   └── UI/
│       └── ...
├── crypto/
│   ├── ecdh.ts              # ECDH key exchange
│   ├── aes.ts               # AES-GCM encryption
│   ├── fingerprint.ts       # Visual fingerprint generation
│   └── keyStore.ts          # sessionStorage wrapper
├── socket/
│   ├── client.ts            # Socket.io client
│   ├── events.ts            # Event types
│   └── handlers.ts          # Message handlers
├── telegram/
│   ├── init.ts              # Mini App initialization
│   ├── theme.ts             # Adaptive theming
│   └── haptics.ts           # Haptic feedback
├── hooks/
│   ├── useEncryptedChat.ts
│   ├── useKeyExchange.ts
│   └── useTelegram.ts
└── types/
    └── index.ts
```

#### Ключевые особенности Frontend

| Модуль | Ответственность |
|--------|-----------------|
| `crypto/` | Вся криптография изолирована, использует только Web Crypto API |
| `keyStore.ts` | Обёртка над sessionStorage с автоочисткой при закрытии |
| `socket/` | Типизированные события, автореконнект |
| `telegram/` | Интеграция с Telegram: тема, haptics, back button |

---

### 2. Backend (Node.js + Fastify)

```
server/
├── src/
│   ├── index.ts             # Entry point
│   ├── config.ts            # Environment config
│   ├── app.ts               # Fastify app setup
│   ├── routes/
│   │   ├── health.ts        # Health check
│   │   └── telegram.ts      # Webhook для бота
│   ├── socket/
│   │   ├── server.ts        # Socket.io server
│   │   ├── events.ts        # Event definitions
│   │   ├── handlers/
│   │   │   ├── connection.ts
│   │   │   ├── search.ts    # User search
│   │   │   ├── handshake.ts # Key exchange relay
│   │   │   ├── message.ts   # Encrypted message relay
│   │   │   └── burn.ts      # Session destruction
│   │   └── middleware/
│   │       ├── auth.ts      # Telegram initData validation
│   │       └── rateLimit.ts
│   ├── redis/
│   │   ├── client.ts        # Redis connection
│   │   ├── sessions.ts      # Session management
│   │   ├── messages.ts      # Encrypted message queue
│   │   └── requests.ts      # Pending chat requests
│   ├── telegram/
│   │   ├── bot.ts           # Bot instance
│   │   ├── notifications.ts # Notification sender
│   │   └── validation.ts    # initData verification
│   └── utils/
│       ├── logger.ts
│       └── errors.ts
├── Dockerfile
└── package.json
```

#### Backend НЕ делает:

- ❌ Не хранит ключи шифрования
- ❌ Не расшифровывает сообщения
- ❌ Не логирует содержимое
- ❌ Не хранит историю чатов

#### Backend делает:

- ✅ Валидирует Telegram initData
- ✅ Соединяет пользователей (rendezvous)
- ✅ Пересылает зашифрованные пакеты
- ✅ Хранит encrypted blobs с TTL (для offline)
- ✅ Отправляет push-уведомления (без содержимого)

---

### 3. Redis (Хранилище метаданных)

```
Структура ключей:

session:{sessionId}           # Метаданные активной сессии
  → TTL: 1 час
  → { participants, status, createdAt }

request:{recipientTgId}       # Входящие запросы на чат
  → TTL: 5 минут
  → { senderTgId, sessionId, timestamp }

messages:{sessionId}          # Очередь зашифрованных сообщений
  → TTL: 24 часа
  → List of encrypted blobs

online:{tgId}                 # Статус онлайн
  → TTL: 30 секунд (heartbeat)
```

#### TTL стратегия

| Тип данных | TTL | Причина |
|------------|-----|---------|
| Активная сессия | 1 час | Автоочистка неактивных |
| Запрос на чат | 5 минут | Быстрый ответ или отмена |
| Offline сообщения | 24 часа | Баланс между UX и приватностью |
| Online статус | 30 сек | Heartbeat обновление |

---

### 4. Telegram Bot

```
Функции бота:

1. Уведомления о запросах
   "🔔 Вам поступил запрос на приватный чат"
   [Открыть чат] ← inline button

2. Уведомления о сообщениях (если offline)
   "💬 У вас новое зашифрованное сообщение"
   [Открыть] ← inline button

3. НЕ содержит:
   - Имени отправителя
   - Текста сообщения
   - Любых идентификаторов, кроме sessionId
```

---

## Потоки данных

### Flow 1: Установка соединения

```
Alice                    Server                      Bob
  │                         │                         │
  │ 1. SEARCH_USER(@bob)    │                         │
  │────────────────────────►│                         │
  │                         │                         │
  │ 2. REQUEST_CREATED      │ 3. Bot notification     │
  │◄────────────────────────│────────────────────────►│
  │                         │                         │
  │                         │ 4. ACCEPT_REQUEST       │
  │                         │◄────────────────────────│
  │                         │                         │
  │ 5. PEER_JOINED          │ 6. PEER_JOINED          │
  │◄────────────────────────│────────────────────────►│
  │                         │                         │
  │ 7. PUBLIC_KEY (Alice)   │                         │
  │────────────────────────►│────────────────────────►│
  │                         │                         │
  │                         │ 8. PUBLIC_KEY (Bob)     │
  │◄────────────────────────│◄────────────────────────│
  │                         │                         │
  │ 9. Compute SharedSecret │ 9. Compute SharedSecret │
  │         (local)         │         (local)         │
```

### Flow 2: Обмен сообщениями

```
Alice                    Server                      Bob
  │                         │                         │
  │ encrypt(msg, sharedKey) │                         │
  │            │            │                         │
  │            ▼            │                         │
  │ MESSAGE {              │                         │
  │   iv: "...",           │                         │
  │   ciphertext: "...",   │                         │
  │   tag: "..."           │                         │
  │ }─────────────────────►│                         │
  │                         │                         │
  │                         │ if Bob online:         │
  │                         │   relay immediately    │
  │                         │────────────────────────►│
  │                         │                         │
  │                         │ if Bob offline:        │
  │                         │   store in Redis       │
  │                         │   send notification    │
```

### Flow 3: Уничтожение сессии

```
Alice                    Server                      Bob
  │                         │                         │
  │ BURN_SESSION            │                         │
  │────────────────────────►│                         │
  │                         │                         │
  │ Clear sessionStorage    │ Delete Redis keys      │ BURN_SIGNAL
  │ Clear RAM               │                        │◄───────────────
  │ Close Mini App          │                        │ Clear all
  │                         │                         │ Close Mini App
```

---

## Масштабирование

### Горизонтальное масштабирование (v2.0+)

```
                    ┌─────────────────┐
                    │  Load Balancer  │
                    │    (nginx)      │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
         ▼                   ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│   Node Server   │ │   Node Server   │ │   Node Server   │
│   (instance 1)  │ │   (instance 2)  │ │   (instance N)  │
└────────┬────────┘ └────────┬────────┘ └────────┬────────┘
         │                   │                   │
         └───────────────────┼───────────────────┘
                             │
                    ┌────────▼────────┐
                    │  Redis Cluster  │
                    │  (pub/sub)      │
                    └─────────────────┘
```

Socket.io поддерживает Redis Adapter для синхронизации между инстансами.

### Текущая архитектура (v1.0)

Для self-hosted MVP достаточно:
- 1 Node.js инстанс
- 1 Redis инстанс
- nginx как reverse proxy

---

## Отказоустойчивость

### Сценарии сбоев

| Сценарий | Поведение | Восстановление |
|----------|-----------|----------------|
| Потеря соединения | Auto-reconnect Socket.io | Сообщения из Redis очереди |
| Crash сервера | Все активные сессии теряются | Пользователи создают новую сессию |
| Redis недоступен | Сервер возвращает 503 | Автоматически после восстановления Redis |
| Закрытие Mini App | Ключи стираются из sessionStorage | Новый handshake при повторном входе |

### Graceful Degradation

```typescript
// Пример: обработка потери соединения
socket.on('disconnect', () => {
  // Показываем UI индикатор
  setConnectionStatus('reconnecting');
  
  // НЕ стираем ключи — они понадобятся при reconnect
  // Стираем только при явном BURN или закрытии app
});

socket.on('connect', () => {
  // Запрашиваем пропущенные сообщения
  socket.emit('SYNC_MESSAGES', { lastMessageId });
});
```

---

## Подготовка к групповым чатам (v2.0)

Архитектура учитывает будущую поддержку групп:

### Изменения для групповых чатов

1. **Key Distribution** — вместо ECDH 1-на-1, используем Group Key Agreement (например, Tree-DH или Signal's Sender Keys)

2. **Redis структура**:
```
group:{groupId}
  → { participants: [], adminTgId, createdAt }
  
group_keys:{groupId}:{epoch}
  → { encryptedKeys: {} }  # Ключи зашифрованы для каждого участника
```

3. **Ротация ключей** — при выходе участника генерируется новый групповой ключ

---

## Связанные документы

- [SECURITY.md](./SECURITY.md) — детали криптографии
- [API.md](./API.md) — спецификация WebSocket событий
- [DATA_MODELS.md](./DATA_MODELS.md) — структуры данных

