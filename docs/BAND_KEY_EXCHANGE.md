# In-Band Key Exchange

> Обмен ключами внутри канала без использования внешних средств связи

## 📋 Содержание

- [Проблематика](#проблематика)
- [Решение: Rendezvous Protocol](#решение-rendezvous-protocol)
- [Защита от MITM](#защита-от-mitm)
- [Секретный вопрос](#секретный-вопрос)
- [Протокол сжигания](#протокол-сжигания)
- [Риски и ограничения](#риски-и-ограничения)

---

## Проблематика

### Классическая проблема

В стандартных E2EE мессенджерах (Signal, WhatsApp) обмен ключами происходит через сервер, а верификация — через **внешний канал** (звонок, личная встреча).

**Наш сценарий сложнее:**
- Внешние каналы недоступны
- Telegram как посредник не вызывает доверия
- Нужен In-Band обмен с защитой от перехвата

### Угрозы

| Угроза | Описание | Наша защита |
|--------|----------|-------------|
| **Passive MITM** | Перехват трафика | TLS + E2EE |
| **Active MITM** | Подмена ключей | Visual Fingerprint |
| **Identity Spoofing** | Угон аккаунта Telegram | Секретный вопрос |
| **Server Compromise** | Взлом нашего сервера | Zero-knowledge |

---

## Решение: Rendezvous Protocol

### Концепция

Сервер выступает как **точка встречи (rendezvous)**, где пользователи находят друг друга по Telegram ID, но обмен криптографическими данными происходит напрямую через WebSocket.

### Протокол

```
┌─────────────────────────────────────────────────────────────────┐
│                    RENDEZVOUS PROTOCOL                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Alice                    Server                      Bob        │
│    │                         │                         │         │
│    │ 1. SEARCH(@bob)         │                         │         │
│    │────────────────────────►│                         │         │
│    │                         │                         │         │
│    │ 2. CREATE_SESSION       │                         │         │
│    │────────────────────────►│                         │         │
│    │                         │                         │         │
│    │                         │ 3. Notification         │         │
│    │                         │ (Telegram Bot)          │         │
│    │                         │────────────────────────►│         │
│    │                         │                         │         │
│    │                         │ 4. ACCEPT_REQUEST       │         │
│    │                         │◄────────────────────────│         │
│    │                         │                         │         │
│    │ 5. SESSION_STARTED      │ 5. SESSION_STARTED      │         │
│    │◄────────────────────────│────────────────────────►│         │
│    │                         │                         │         │
│    │ 6. PUBLIC_KEY_A ────────┼───────────────────────► │         │
│    │                         │                         │         │
│    │ ◄───────────────────────┼────────── PUBLIC_KEY_B  │         │
│    │                         │                         │         │
│    │ 7. Compute              │                 Compute │         │
│    │    SharedSecret         │            SharedSecret │         │
│    │    (locally)            │               (locally) │         │
│    │                         │                         │         │
│    │ 8. Show Visual          │          Show Visual    │         │
│    │    Fingerprint          │          Fingerprint    │         │
│    │                         │                         │         │
│    ▼                         ▼                         ▼         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Что видит сервер

```typescript
// Сервер видит ТОЛЬКО:
{
  sessionId: "abc123",
  participant1: "111222333",  // Telegram ID Alice
  participant2: "444555666",  // Telegram ID Bob
  publicKey_A: "base64...",   // Публичный ключ (бесполезен без приватного)
  publicKey_B: "base64...",   // Публичный ключ (бесполезен без приватного)
  encryptedMessages: [...]    // Зашифрованные blob'ы
}

// Сервер НЕ видит:
// - Приватные ключи
// - Shared Secret
// - Расшифрованные сообщения
```

---

## Защита от MITM

### Visual Fingerprint

Даже если злоумышленник подменит ключи, пользователи увидят **разные** Visual Fingerprint.

#### Алгоритм генерации

```typescript
async function generateVisualFingerprint(
  sharedSecret: ArrayBuffer
): Promise<FingerprintElement[]> {
  // Детерминированный hash из shared secret
  const hash = await crypto.subtle.digest('SHA-256', sharedSecret);
  const bytes = new Uint8Array(hash);
  
  const SHAPES = ['◆', '○', '□', '△', '⬡', '⬢'];
  const COLORS = ['red', 'blue', 'green', 'purple', 'orange', 'cyan'];
  
  const elements: FingerprintElement[] = [];
  
  for (let i = 0; i < 4; i++) {
    elements.push({
      shape: SHAPES[bytes[i * 2] % SHAPES.length],
      color: COLORS[bytes[i * 2 + 1] % COLORS.length]
    });
  }
  
  return elements;
}
```

#### Почему это работает

```
СЦЕНАРИЙ: MITM атака

Alice ◄──────► Mallory ◄──────► Bob

1. Mallory генерирует 2 пары ключей
2. С Alice использует пару (M1_pub, M1_priv)
3. С Bob использует пару (M2_pub, M2_priv)

Результат:
- Alice вычисляет: SharedSecret_AM = ECDH(A_priv, M1_pub)
- Bob вычисляет: SharedSecret_BM = ECDH(B_priv, M2_pub)

SharedSecret_AM ≠ SharedSecret_BM

→ Visual Fingerprint будут РАЗНЫМИ!

Alice видит: ◆RED ○BLUE □GREEN △PURPLE
Bob видит:   ⬡CYAN ⬢ORANGE ◆RED □BLUE

При сравнении → "Коды не совпадают" → Сессия уничтожается
```

#### Вероятности

```
Комбинаций: 6 × 6 × 6 × 6 × 6 × 6 × 6 × 6 = 1,679,616

Вероятность случайного совпадения: 0.00006%

Для успешной MITM атаки Mallory должен:
1. Угадать fingerprint Alice (1/1,679,616)
2. Подменить UI обоих в реальном времени

→ Практически невозможно
```

---

## Секретный вопрос

### Проблема Identity Spoofing

Visual Fingerprint защищает от MITM, но не от **угона аккаунта**:

```
СЦЕНАРИЙ: Угон аккаунта Bob

1. Mallory получает доступ к Telegram аккаунту Bob
2. Mallory открывает Mini App под видом Bob
3. ECDH работает корректно, Visual Fingerprint совпадает
4. Alice думает, что общается с Bob

→ Alice раскрывает секретную информацию Mallory
```

### Решение: Shared Secret Knowledge

При создании чата Alice может задать вопрос, ответ на который знает только настоящий Bob:

```typescript
// Alice создаёт сессию
socket.emit('CREATE_SESSION', {
  recipientTgId: "444555666",
  secretQuestion: "Как звали моего кота в 2015?"
});

// Bob получает запрос с вопросом
socket.on('INCOMING_REQUEST', (data) => {
  // data.secretQuestion = "Как звали моего кота в 2015?"
});

// Bob отвечает
socket.emit('ACCEPT_REQUEST', {
  sessionId: "abc123",
  secretAnswer: "Барсик"
});
```

### Криптографическая интеграция

Ответ на вопрос становится **salt** для HKDF:

```typescript
// Стандартный HKDF (без секретного вопроса)
const aesKey = await deriveKey(sharedSecret, {
  salt: "BurnedChats-v1",
  info: "encryption-key"
});

// HKDF с секретным вопросом
const answerHash = await sha256(answer.toLowerCase().trim());
const aesKey = await deriveKey(sharedSecret, {
  salt: answerHash,  // ← Ответ как salt
  info: "encryption-key"
});
```

### Результат

| Сценарий | SharedSecret | Salt | AES Key | Сообщения |
|----------|--------------|------|---------|-----------|
| Правильный ответ | ✓ | ✓ | ✓ | Расшифровываются |
| Неправильный ответ | ✓ | ✗ | ✗ | Мусор |
| MITM | ✗ | - | ✗ | Мусор |

**Важно:** Сервер не знает правильный ответ. Он не может проверить, правильно ли Bob ответил — это проверяется криптографически на стороне клиентов.

---

## Протокол сжигания

### Двухсторонняя синхронизация

При уничтожении чата критически важно, чтобы данные были удалены **у обоих** участников.

```
┌─────────────────────────────────────────────────────────────────┐
│                     BURN PROTOCOL                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Alice                    Server                      Bob        │
│    │                         │                         │         │
│    │ 1. BURN_SESSION         │                         │         │
│    │────────────────────────►│                         │         │
│    │                         │                         │         │
│    │ 2. Clear local:         │ 3. Delete Redis:        │         │
│    │    - sessionStorage     │    - session:*          │         │
│    │    - memory             │    - messages:*         │         │
│    │                         │                         │         │
│    │                         │ 4. BURN_SIGNAL          │         │
│    │                         │────────────────────────►│         │
│    │                         │                         │         │
│    │                         │                 5. Clear│         │
│    │                         │                    local│         │
│    │                         │                         │         │
│    │ 6. SESSION_BURNED       │ 6. SESSION_BURNED       │         │
│    │◄────────────────────────│────────────────────────►│         │
│    │                         │                         │         │
│    │ 7. Close Mini App       │                Close App│         │
│    │                         │                         │         │
└─────────────────────────────────────────────────────────────────┘
```

### Гарантии уничтожения

```typescript
// На стороне клиента
async function burnSession(sessionId: string): Promise<void> {
  // 1. Уведомляем сервер
  socket.emit('BURN_SESSION', { sessionId });
  
  // 2. Стираем ключи
  keyStore.burn();
  
  // 3. Очищаем состояние
  messages.clear();
  
  // 4. Перезаписываем память (best effort)
  for (let i = 0; i < 10; i++) {
    sessionStorage.setItem('dummy', crypto.randomUUID());
  }
  sessionStorage.clear();
  
  // 5. Закрываем приложение
  WebApp.close();
}

// Обработка входящего сигнала
socket.on('BURN_SIGNAL', ({ sessionId }) => {
  haptics.heavy();
  showBurnAnimation();
  burnSession(sessionId);
});
```

### Сценарий: Bob offline

```
Alice нажимает Burn, но Bob offline:

1. Alice: данные удалены локально
2. Server: данные удалены из Redis
3. Bob: при следующем подключении получит SESSION_BURNED

→ Сессия недействительна, ключи на сервере отсутствуют
→ Даже если Bob попытается синхронизироваться — нечего синхронизировать
```

---

## Риски и ограничения

### Ограничения In-Band обмена

| Ограничение | Описание | Mitigation |
|-------------|----------|------------|
| **Trust on First Use** | Первый обмен ключами не верифицирован | Visual Fingerprint |
| **Metadata Exposure** | Сервер видит кто с кем общается | Неизбежно в данной архитектуре |
| **Timing Attacks** | Время отправки сообщений видно | Не защищаемся (низкий приоритет) |

### Identity Spoofing

Главный риск — **угон Telegram аккаунта**:

> Если злоумышленник получил доступ к аккаунту, он может притвориться владельцем.

**Защита:**
1. Секретный вопрос (shared knowledge)
2. Рекомендация использовать 2FA в Telegram
3. Предупреждение в UI о рисках

### Физический доступ

| Состояние | Риск |
|-----------|------|
| Mini App открыт | Ключи в памяти — доступны при root |
| Mini App закрыт | sessionStorage очищен — ничего не найти |
| Телефон выключен | Данные не персистируются — безопасно |

### Рекомендации пользователям

```
⚠️ Для максимальной безопасности:

1. Используйте секретный вопрос для важных чатов
2. Всегда проверяйте Visual Fingerprint
3. Нажимайте "Burn" после завершения разговора
4. Включите 2FA в Telegram
5. Не оставляйте телефон без присмотра с открытым чатом
```

---

## Альтернативные подходы

### Стеганография (не реализуем в v1.0)

Идея: маскировка ключей под обычный трафик.

```
Вместо:
  socket.emit('PUBLIC_KEY', { key: "A5B6C7..." })

Отправляем:
  socket.emit('GET_AVATAR', { userId: "123", style: "A5B6C7..." })
```

**Плюсы:** Сложнее обнаружить обмен ключами
**Минусы:** Сложность реализации, ложное чувство безопасности

### QR-код (планируется в v2.0)

Обмен ключами через камеру, минуя сервер полностью:

```
1. Alice генерирует QR с публичным ключом
2. Bob сканирует камерой
3. Bob генерирует QR с ответом
4. Alice сканирует

→ Сервер никогда не видит ключи
```

---

## Связанные документы

- [SECURITY.md](./SECURITY.md) — криптографические примитивы
- [API.md](./API.md) — WebSocket события handshake
- [USER_FLOWS.md](./USER_FLOWS.md) — UX верификации
