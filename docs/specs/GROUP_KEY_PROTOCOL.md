# Протокол группового ключа — Burned Chats Rooms

> Исследование и выбор схемы группового E2EE для комнат (P2-3.1.1)

## 📋 Содержание

- [Сравнение протоколов](#сравнение-протоколов)
- [Выбор: один групповой ключ (MVP)](#выбор-один-групповой-ключ-mvp)
- [Протокол: жизненный цикл группового ключа](#протокол-жизненный-цикл-группового-ключа)
- [Схема выдачи ключа новому участнику](#схема-выдачи-ключа-новому-участнику)
- [Ротация ключа при выходе участника](#ротация-ключа-при-выходе-участника)
- [Хранение в Redis](#хранение-в-redis)
- [Ограничения и будущее](#ограничения-и-будущее)

---

## Сравнение протоколов

### Вариант A: Один общий групповой ключ (Shared Group Key)

**Принцип:** Один симметричный AES-256-GCM ключ для всей комнаты. Все участники шифруют и расшифровывают сообщения одним ключом. При добавлении нового участника владелец шифрует ключ его ECDH публичным ключом. При выходе — rekey.

**Преимущества:**
- Максимально простая реализация: один ключ на комнату, нет сложных рatchet-структур.
- Полностью базируется на уже существующем стеке (ECDH P-256 + AES-GCM, Web Crypto API).
- Нет дополнительных зависимостей.
- Понятная схема шифрования при передаче ключа: ECIES-like (ECDH ephemeral + HKDF + AES-GCM).
- Низкая нагрузка на клиент при шифровании/расшифровке.

**Ограничения:**
- Нет per-sender forward secrecy: все участники, владея групповым ключом, теоретически могут читать сообщения друг друга до точки rekey.
- Компрометация ключа одного участника — компрометация всей истории до rekey.
- Rekey при выходе участника — O(N) операций (N зашифрованных копий нового ключа).

---

### Вариант B: Signal Sender Keys

**Принцип:** Каждый участник генерирует собственный `SenderKey` — набор из `SenderKeyId`, `ChainKey` и подписи. При отправке сообщения участник зашифровывает его своим Sender Key (по сути, Message Ratchet). При вступлении в группу новый участник получает `SenderKeyDistributionMessage` от каждого уже присутствующего участника.

**Преимущества:**
- Per-sender forward secrecy: компрометация одного участника не раскрывает сообщения других.
- Отправитель выполняет только 1 операцию шифрования независимо от размера группы.
- Используется в Signal Group Messaging, WhatsApp.

**Ограничения:**
- Существенно более сложная реализация: нужен полный рatchet (Double Ratchet или упрощённый Message Ratchet).
- Нет нативной поддержки в Web Crypto API; нужна отдельная JS-библиотека (например `@signalapp/libsignal-client`) или собственная реализация.
- При вступлении нового участника он получает Sender Key только от участников, которые в это время онлайн, что создаёт сложности для offline delivery.
- При выходе участника rekey всё равно нужен (иначе вышедший продолжает расшифровывать сообщения до следующей ротации).
- Усложняет синхронизацию состояния при reconnect.

---

### Вариант C: Tree-DH / MLS (Messaging Layer Security)

**Принцип:** Каждый участник — листовой узел бинарного дерева ключей (Ratchet Tree). Общий ключ вычисляется через цепочку DH по дереву. Добавление/удаление участника обновляет только путь от листа до корня — O(log N) операций.

**Преимущества:**
- Оптимальная эффективность обновления ключей: O(log N) вместо O(N).
- Полная forward secrecy.
- RFC 9420 (MLS) — стандартизированный протокол.

**Ограничения:**
- Самая сложная реализация из всех рассматриваемых.
- Нет зрелой JS-библиотеки для браузера без native bindings.
- Требует строгой синхронизации состояния дерева между участниками — сложно с STOMP / WebSocket без собственного механизма консенсуса.
- Избыточно для комнат до 50 участников.

---

## Выбор: один групповой ключ (MVP)

**Решение: Вариант A — один общий симметричный групповой ключ.**

### Обоснование

| Критерий | Shared Group Key | Sender Keys | Tree-DH / MLS |
|----------|:---:|:---:|:---:|
| Сложность реализации | ✅ Низкая | ⚠️ Высокая | ❌ Очень высокая |
| Web Crypto API native | ✅ Полностью | ❌ Нет | ❌ Нет |
| Forward secrecy | ⚠️ Только после rekey | ✅ Per-sender | ✅ Полная |
| Эффективность rekey | ⚠️ O(N) | ⚠️ O(N) | ✅ O(log N) |
| Offline доставка ключа | ✅ Просто | ❌ Сложно | ❌ Сложно |
| Размер комнаты ≤ 50 | ✅ Достаточно | ✅ Достаточно | ✅ Избыточно |
| Соответствует стеку | ✅ ECDH + AES-GCM | ❌ Нет | ❌ Нет |

**Для MVP с лимитом 50 участников** Sender Keys и Tree-DH дают несоразмерную сложность реализации без значительного выигрыша в безопасности для данного сценария использования.

> При росте требований (>50 участников или повышенный профиль угроз) — переход на Sender Keys в v2.1.

---

## Протокол: жизненный цикл группового ключа

### Криптографические примитивы

| Операция | Алгоритм |
|----------|----------|
| Групповой ключ | AES-256-GCM (256-bit) |
| Шифрование ключа для участника | ECDH P-256 (ephemeral) + HKDF-SHA256 + AES-256-GCM |
| Генерация ключа | `crypto.subtle.generateKey({ name: "AES-GCM", length: 256 })` |

### Epoch

Каждый групповой ключ имеет номер эпохи (`epoch`), начиная с `0`. При rekey epoch инкрементируется. Участники знают текущий epoch и могут расшифровать сообщения только своей эпохи.

```
epoch=0  → начальный ключ (при создании комнаты)
epoch=1  → после первого rekey
epoch=N  → после N-го выхода участника
```

---

## Схема выдачи ключа новому участнику

### Сценарий: заявка принята, участник добавлен в комнату

Ключ доставляется через сервер в виде opaque blob — зашифрованного ключевого бандла. Сервер видит только зашифрованный blob, он не может расшифровать групповой ключ.

```
Владелец (Owner)                Сервер                  Новый участник (Joiner)
     │                              │                              │
     │  (получает publicKey Joiner) │                              │
     │  ← из STOMP-события JOIN_ACCEPTED или KEY_BUNDLE_REQUEST    │
     │                              │                              │
     │  1. ephemeralKey = ECDH.generateKeyPair()                   │
     │  2. sharedSecret = ECDH(ephemeralKey.private, joiner.pubKey)│
     │  3. wrapKey = HKDF(sharedSecret, salt="BurnedChats-KeyWrap")│
     │  4. encryptedGroupKey = AES-GCM(wrapKey, groupKey)          │
     │                              │                              │
     │  KEY_BUNDLE {                │                              │
     │    roomId,                   │                              │
     │    epoch,                    │                              │
     │    ephemeralPublicKey,       │                              │
     │    encryptedKey,             │                              │
     │    iv, tag                   │                              │
     │  } ─────────────────────────►│                              │
     │                              │─── relay to Joiner ─────────►│
     │                              │                              │
     │                              │              5. sharedSecret = ECDH(joiner.private, ephemeralPublicKey)
     │                              │              6. wrapKey = HKDF(sharedSecret, "BurnedChats-KeyWrap")
     │                              │              7. groupKey = AES-GCM.decrypt(wrapKey, encryptedKey)
     │                              │              8. keyStore.set(roomId, epoch, groupKey)
```

### Формат ключевого бандла (TypeScript)

```typescript
interface KeyBundle {
  roomId: string;
  epoch: number;
  recipientTgId: string;        // кому предназначен бандл
  ephemeralPublicKey: string;   // Base64, 65 bytes (P-256 uncompressed)
  encryptedKey: string;         // Base64, AES-256-GCM ciphertext (32 bytes + tag)
  iv: string;                   // Base64, 12 bytes
}
```

### Алгоритм обёртки ключа (wrap / unwrap)

#### Wrap (Owner → Joiner)

```typescript
async function wrapGroupKey(
  groupKey: CryptoKey,        // AES-256-GCM, extractable=true для wrap
  joinerPublicKey: CryptoKey  // ECDH P-256
): Promise<KeyBundle> {
  // 1. Ephemeral ECDH keypair
  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveKey', 'deriveBits']
  );

  // 2. ECDH shared bits
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: joinerPublicKey },
    ephemeral.privateKey,
    256
  );

  // 3. HKDF → wrap key
  const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  const wrapKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('BurnedChats-KeyWrap-v1'),
      info: new Uint8Array(0)
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey']
  );

  // 4. Wrap group key
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedKey = await crypto.subtle.wrapKey('raw', groupKey, wrapKey, { name: 'AES-GCM', iv });

  // 5. Export ephemeral public key
  const ephemeralPubRaw = await crypto.subtle.exportKey('raw', ephemeral.publicKey);

  return {
    ephemeralPublicKey: toBase64(ephemeralPubRaw),
    encryptedKey: toBase64(wrappedKey),
    iv: toBase64(iv)
  };
}
```

#### Unwrap (Joiner)

```typescript
async function unwrapGroupKey(
  bundle: KeyBundle,
  myPrivateKey: CryptoKey  // ECDH P-256
): Promise<CryptoKey> {
  // 1. Import ephemeral public key
  const ephemeralPub = await crypto.subtle.importKey(
    'raw',
    fromBase64(bundle.ephemeralPublicKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    false, []
  );

  // 2. ECDH shared bits
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: ephemeralPub },
    myPrivateKey,
    256
  );

  // 3. HKDF → unwrap key
  const hkdfKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  const unwrapKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('BurnedChats-KeyWrap-v1'),
      info: new Uint8Array(0)
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['unwrapKey']
  );

  // 4. Unwrap group key
  return await crypto.subtle.unwrapKey(
    'raw',
    fromBase64(bundle.encryptedKey),
    unwrapKey,
    { name: 'AES-GCM', iv: fromBase64(bundle.iv) },
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
```

---

## Ротация ключа при выходе участника

### Принцип

При выходе участника из комнаты (или исключении владельцем):
1. Владелец генерирует новый групповой ключ (epoch + 1).
2. Владелец шифрует новый ключ для каждого **оставшегося** участника (N-1 зашифрованных бандлов).
3. Все бандлы отправляются серверу одним батчем через STOMP-событие `REKEY`.
4. Сервер сохраняет бандлы в `room_keys:{roomId}:{epoch+1}` и рассылает каждому участнику его бандл.
5. Участники обновляют keyStore для данного roomId.
6. Вышедший участник не получает новый ключ → не может читать сообщения после rekey.

```
Owner                          Сервер                     Members A, B, C
  │                               │                              │
  │ (User D left/kicked)          │                              │
  │                               │                              │
  │ 1. newGroupKey = generateKey()│                              │
  │ 2. bundleA = wrap(newKey, pubA)│                              │
  │ 3. bundleB = wrap(newKey, pubB)│                              │
  │ 4. bundleC = wrap(newKey, pubC)│                              │
  │                               │                              │
  │ REKEY {                       │                              │
  │   roomId, epoch+1,            │                              │
  │   bundles: [A, B, C]          │                              │
  │ } ───────────────────────────►│                              │
  │                               ├─ сохранить в Redis ────────  │
  │                               ├─── bundle A → Member A ─────►│
  │                               ├─── bundle B → Member B ─────►│
  │                               └─── bundle C → Member C ─────►│
  │                               │                              │
  │                               │              5. unwrap(bundle)
  │                               │              6. keyStore.set(roomId, epoch+1, newKey)
```

### Поведение при offline участниках

Если участник был offline в момент rekey:
- Его бандл сохраняется в Redis (`room_keys:{roomId}:{epoch}:{tgId}`) до получения.
- При reconnect участник запрашивает `KEY_BUNDLE` для своего tgId и текущего roomId.
- Сервер возвращает последний доступный бандл.
- TTL бандла: 7 дней (или TTL самой комнаты, если меньше).

---

## Хранение в Redis

```
room_keys:{roomId}:{epoch}:{tgId}
  → { ephemeralPublicKey, encryptedKey, iv }  — зашифрованный бандл для конкретного участника
  → TTL: 7 дней

room_key_epoch:{roomId}
  → текущий epoch (integer)
  → обновляется при rekey
  → TTL: совпадает с room:{roomId}
```

**Гарантии сервера:**
- Сервер хранит только зашифрованные бандлы (opaque blobs) — расшифровать без приватного ключа участника невозможно.
- Бандлы для вышедшего/исключённого участника не создаются; старые — удаляются при rekey (или по TTL).
- Сервер не хранит групповой ключ в открытом виде.

---

## Ограничения и будущее

### Текущие ограничения MVP

| Свойство | MVP (Shared Group Key) | Желаемое |
|----------|------------------------|---------- |
| Per-sender forward secrecy | ❌ Нет | ✅ Sender Keys |
| Breakin / Break-out secrecy | ✅ Rekey при выходе | — |
| Эффективность rekey при N>50 | ⚠️ O(N) | ✅ Tree-DH O(log N) |
| Независимость сообщений участников | ❌ Общий ключ | ✅ Sender Keys |

### Roadmap

- **v2.0 (MVP):** Shared Group Key — один ключ, rekey при выходе.
- **v2.1:** Рассмотреть переход на **Sender Keys** при появлении зрелой браузерной реализации или при росте требований к приватности отдельных отправителей.
- **v3.0:** Tree-DH / MLS при масштабировании за 50 участников.

---

## Связанные документы

- [SECURITY.md](../../specs/SECURITY.md) — криптографические примитивы и модель угроз
- [DATA_MODELS.md](../../specs/DATA_MODELS.md) — структуры Redis для комнат
- [DEVELOPMENT_PLAN_ROOMS.md](DEVELOPMENT_PLAN_ROOMS.md) — план фазы 2
- [P2-3-1-2](cards/P2-3-1-2.md) — Frontend: генерация и распределение группового ключа
- [P2-3-1-3](cards/P2-3-1-3.md) — Redis: хранение зашифрованных бандлов
- [P2-3-2-1](cards/P2-3-2-1.md) — Выдача ключа новому участнику (KEY_BUNDLE event)
- [P2-3-2-2](cards/P2-3-2-2.md) — Ротация ключа (REKEY event)
