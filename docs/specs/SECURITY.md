# Безопасность и криптография

> Детальное описание криптографических протоколов и модели угроз

## 📋 Содержание

- [Обзор безопасности](#обзор-безопасности)
- [Криптографические примитивы](#криптографические-примитивы)
- [Протокол обмена ключами](#протокол-обмена-ключами)
- [Шифрование сообщений](#шифрование-сообщений)
- [Файлы: шифрование и хранение (Phase 4)](#файлы-шифрование-и-хранение-phase-4)
- [Visual Fingerprint](#visual-fingerprint)
- [Модель угроз](#модель-угроз)
- [Антиспам / Sybil-защита (PoW)](#антиспам--sybil-защита-pow)
- [Защитные механизмы](#защитные-механизмы)
- [Governance on-chain (Phase 5)](#governance-on-chain-phase-5)
- [Комнаты (Phase 2)](#комнаты-phase-2)

---

## Обзор безопасности

### Гарантии системы

| Свойство | Гарантия | Как достигается |
|----------|----------|-----------------|
| **Confidentiality** | Сервер не видит содержимое | E2EE с ключами только на клиентах |
| **Integrity** | Сообщения не изменены | AES-GCM authentication tag |
| **Forward Secrecy** | Прошлые сообщения защищены | Ephemeral ключи в sessionStorage |
| **Deniability** | Нет доказательства авторства | Нет цифровых подписей |
| **Anti-MITM** | Защита от подмены ключей | Visual Fingerprint verification |

### Что система НЕ защищает

- ❌ **Metadata** — сервер видит кто с кем общается (Telegram ID)
- ❌ **Timing** — время отправки сообщений
- ❌ **Screenshot** — пользователь может сделать скриншот
- ❌ **Compromised device** — если устройство взломано, ключи доступны

### Комнаты (Phase 2)

В **фазе 2** (комнаты с паролем) действуют дополнительные принципы конфиденциальности:

- **Пароль комнаты:** на сервер передаётся только производная от пароля (salt + proof через KDF). Plaintext пароль не передаётся, не хранится и не логируется. Проверка входа выполняется сравнением proof с сохранённым значением (constant-time). Подробнее — в разделе [Комнаты (Phase 2)](#комнаты-phase-2) ниже и в [phases/phase-2-rooms/DEVELOPMENT_PLAN_ROOMS.md](../phases/phase-2-rooms/DEVELOPMENT_PLAN_ROOMS.md).
- **Групповой ключ:** хранится только на клиентах; сервер ретранслирует только зашифрованные ключевые бандлы (opaque blobs).
- **Инвайт-токены:** криптостойкие, с TTL и опциональным лимитом использований; не раскрывают roomId без проверки.

---

## Криптографические примитивы

### 1. ECDH (Elliptic Curve Diffie-Hellman)

```
Кривая: P-256 (secp256r1)
Размер ключа: 256 bit
Стандарт: NIST FIPS 186-4
```

**Почему P-256:**
- Широкая поддержка в Web Crypto API
- Оптимальный баланс безопасности и производительности
- Используется в TLS 1.3, Signal Protocol

### 2. AES-GCM (Advanced Encryption Standard - Galois/Counter Mode)

```
Размер ключа: 256 bit
IV (nonce): 96 bit (12 bytes)
Tag length: 128 bit
```

**Почему AES-GCM:**
- Authenticated encryption (шифрование + проверка целостности)
- Нативная поддержка в Web Crypto API
- Высокая производительность (hardware acceleration)

### 3. HKDF (HMAC-based Key Derivation Function)

```
Hash: SHA-256
Output: 256 bit
```

Используется для получения симметричного ключа из ECDH shared secret.

---

## Протокол обмена ключами

### Шаг 1: Генерация ключевой пары (Frontend - Web Crypto API)

```typescript
// На стороне каждого клиента
const keyPair = await crypto.subtle.generateKey(
  {
    name: 'ECDH',
    namedCurve: 'P-256'
  },
  true,  // extractable (для экспорта публичного ключа)
  ['deriveKey', 'deriveBits']
);

// Экспорт публичного ключа для передачи
const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
const publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(publicKeyRaw)));
```

### Шаг 2: Обмен публичными ключами

```
Alice                         Server                         Bob
  │                              │                             │
  │  publicKey_A (base64)        │                             │
  │─────────────────────────────►│                             │
  │                              │     publicKey_A (relay)     │
  │                              │────────────────────────────►│
  │                              │                             │
  │                              │     publicKey_B (base64)    │
  │     publicKey_B (relay)      │◄────────────────────────────│
  │◄─────────────────────────────│                             │
```

### Шаг 3: Вычисление Shared Secret

```typescript
// Импорт публичного ключа собеседника
const peerPublicKey = await crypto.subtle.importKey(
  'raw',
  peerPublicKeyBuffer,
  { name: 'ECDH', namedCurve: 'P-256' },
  false,
  []
);

// Вычисление shared secret
const sharedBits = await crypto.subtle.deriveBits(
  { name: 'ECDH', public: peerPublicKey },
  keyPair.privateKey,
  256
);
```

### Шаг 4: Получение симметричного ключа (HKDF)

```typescript
// Import shared secret как HKDF key
const hkdfKey = await crypto.subtle.importKey(
  'raw',
  sharedBits,
  'HKDF',
  false,
  ['deriveKey']
);

// Derive AES-GCM key
const aesKey = await crypto.subtle.deriveKey(
  {
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new TextEncoder().encode('BurnedChats-v1'),
    info: new TextEncoder().encode('encryption-key')
  },
  hkdfKey,
  { name: 'AES-GCM', length: 256 },
  false,  // non-extractable!
  ['encrypt', 'decrypt']
);
```

### Диаграмма полного процесса

```
┌─────────────────────────────────────────────────────────────────┐
│                        KEY EXCHANGE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Alice                                              Bob        │
│     │                                                 │         │
│     │  1. Generate ECDH keypair                       │         │
│     │     (privateKey_A, publicKey_A)                 │         │
│     │                                                 │         │
│     │  2. Send publicKey_A ─────────────────────────► │         │
│     │                                                 │         │
│     │                    3. Generate ECDH keypair     │         │
│     │                       (privateKey_B, publicKey_B)         │
│     │                                                 │         │
│     │ ◄───────────────────────────── 4. Send publicKey_B        │
│     │                                                 │         │
│     │  5. Compute:                    5. Compute:     │         │
│     │     sharedSecret =                 sharedSecret =         │
│     │     ECDH(privateKey_A,             ECDH(privateKey_B,     │
│     │          publicKey_B)                   publicKey_A)      │
│     │                                                 │         │
│     │  6. Derive AES key via HKDF                     │         │
│     │                                                 │         │
│     ▼                                                 ▼         │
│  ┌──────────┐                                   ┌──────────┐    │
│  │ aesKey_A │ ══════════ IDENTICAL ═══════════ │ aesKey_B │    │
│  └──────────┘                                   └──────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Шифрование сообщений

### Формат зашифрованного сообщения

```typescript
interface EncryptedMessage {
  id: string;           // UUID v4
  iv: string;           // Base64, 12 bytes
  ciphertext: string;   // Base64
  tag: string;          // Base64, 16 bytes (часть GCM output)
  timestamp: number;    // Unix timestamp (не зашифрован)
  type: 'text' | 'image' | 'video' | 'file'; // медиа: см. Phase 4 и API.md (fileId, encryptedMeta)
}
```

```java
// Java DTO
@Data
public class EncryptedMessage {
    private String id;
    private String iv;
    private String ciphertext;
    private String tag;
    private Long timestamp;
    private String type;
}
```

### Шифрование (отправка)

```typescript
async function encryptMessage(
  plaintext: string,
  aesKey: CryptoKey
): Promise<EncryptedMessage> {
  // 1. Генерируем уникальный IV для каждого сообщения
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  // 2. Шифруем
  const encoder = new TextEncoder();
  const plaintextBuffer = encoder.encode(plaintext);
  
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    plaintextBuffer
  );
  
  // 3. GCM возвращает ciphertext + tag вместе
  // Tag — последние 16 байт
  const ciphertext = new Uint8Array(ciphertextBuffer.slice(0, -16));
  const tag = new Uint8Array(ciphertextBuffer.slice(-16));
  
  return {
    id: crypto.randomUUID(),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
    tag: toBase64(tag),
    timestamp: Date.now(),
    type: 'text'
  };
}
```

### Дешифрование (получение)

```typescript
async function decryptMessage(
  encrypted: EncryptedMessage,
  aesKey: CryptoKey
): Promise<string> {
  const iv = fromBase64(encrypted.iv);
  const ciphertext = fromBase64(encrypted.ciphertext);
  const tag = fromBase64(encrypted.tag);
  
  // Собираем ciphertext + tag обратно
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);
  
  const plaintextBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    combined
  );
  
  return new TextDecoder().decode(plaintextBuffer);
}
```

---

## Файлы: шифрование и хранение (Phase 4)

Реализация на клиенте: `frontend/src/crypto/fileEncryption.ts` (тот же симметричный ключ AES-256-GCM, что и для текстовых сообщений после ECDH / группового ключа комнаты).

### File Encryption (Phase 4) — поток данных

1. Клиент шифрует файл (и при необходимости отдельный thumbnail) **до** отправки.
2. `POST /api/files/upload` передаёт **один** непрерывный зашифрованный blob (`application/octet-stream`); сервер сохраняет его как `{fileId}.enc` и пишет метаданные в Redis (`file_meta:{fileId}`).
3. В STOMP-сообщении (`type`: `image` \| `video` \| `file`) клиент указывает `fileId`, опционально `thumbnailFileId`, `encryptedMeta` (зашифрованные имя и MIME) и `fileSize` (размер **исходного** plaintext).
4. Получатель вызывает `GET /api/files/{fileId}`, получает тот же blob и расшифровывает его локально.

### Формат зашифрованного blob'а (upload body)

Младший байт задаёт вариант упаковки:

- **Один проход** (файлы ≤ 5 MiB):  
  `[0x00][IV — 12 байт][ciphertext ‖ GCM tag]`  
  где `ciphertext ‖ tag` — непосредственный вывод `crypto.subtle.encrypt` (Web Crypto AES-GCM, tag 128 bit).

- **По чанкам** (файлы > 5 MiB, plaintext чанки по 64 KiB):  
  `[0x01][chunk_count — 4 байта big-endian][повтор: IV 12 байт ‖ encrypt(chunk)]`.

Таким образом на диске и по сети везде лежит только opaque-бинарник; сервер не выполняет дешифрование.

**Thumbnail:** генерируется на клиенте, шифруется **тем же** `CryptoKey` и загружается вторым `fileId` (отдельный upload).

**Метаданные (имя файла, MIME):** JSON `FileMetaPlain` шифруется через `encryptFileMetadata` → одна Base64-строка в поле `encryptedMeta` STOMP-сообщения. Сервер видит только непрозрачный blob и число `fileSize` для UX/лимитов.

### File Storage Security (сервер)

| Аспект | Поведение |
|--------|-----------|
| Zero-knowledge | На сервере хранятся только зашифрованные blob'ы и минимальные метаданные (tgId загрузившего, контекст, размер blob'а, время). |
| Filesystem | Файлы без исходного расширения: `{uuid}.enc`. Утечка диска не раскрывает тип содержимого. |
| TTL | Метаданные Redis и политика жизни файлов — **24 часа** (см. `FileStorageProperties`); автоочистка орфанов на диске. |
| Burn cascade | При уничтожении сессии/комнаты набор `fileId` из `file_context:{contextId}` удаляется с диска и из Redis. |
| Access control | Upload и download разрешены только если initData валиден и пользователь — участник указанной сессии или комнаты; ретрансляция STOMP проверяет владельца и контекст файла. |

### Validation (продукт и сервер)

| Уровень | Правило |
|---------|---------|
| Клиент | Whitelist MIME по категориям продукта (см. план Phase 4): изображения (`image/jpeg`, `image/png`, `image/gif`, `image/webp`), видео (`video/mp4`, `video/webm`), документы (`application/pdf`, `text/plain`, `application/zip`). Рекомендуемые **оригинальные** размеры: до 10 MB (изображения), до 25 MB (видео/документы) — до упаковки в AES-GCM. |
| Сервер | Верхняя граница принимаемого **зашифрованного** тела: `MAX_ENCRYPTED_FILE_SIZE` (26 MiB); проверка `Content-Length > 0`; rate limit `POST /api/files/upload`: 10 запросов / минуту на пользователя (`FILE_UPLOAD_RATE_LIMIT`). Тип MIME на REST не проверяется (файл нечитаем). |

---

## Visual Fingerprint

### Концепция

Основной канал сверки — **safety-number** (128 бит). Поверх него идёт быстрый
визуальный якорь: набор **эмодзи** (alphabet v1, см. IMP-FPEMOJI-01) как
мнемоника, которую проще сравнить «на глаз», чем абстрактные фигуры:

```
┌────────────────────────────────────────┐
│                                        │
│   Отпечаток безопасности               │
│   12345 67890 23456 78901              │
│   34567 89012 45678 90123              │
│                                        │
│   ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐        │
│   │🦊│ │🍎│ │🚀│ │🐼│ │⭐│ │🐧│        │
│   └──┘ └──┘ └──┘ └──┘ └──┘ └──┘        │
│                                        │
│   [✓ Совпадают]    [✗ Не совпадают]    │
│                                        │
└────────────────────────────────────────┘
```

> **История:** до IMP-FPEMOJI-01 визуальный якорь был парой `{ фигура, цвет }`
> (6×6, 4 слота). Цвет убран (многоцветные эмодзи делают CSS-`color`
> ненаблюдаемым), энтропия компенсирована числом слотов и размером алфавита.

### Устранённая уязвимость (IMP-AUDIT-01)

| Было (устранено) | Стало |
|------------------|-------|
| Отпечаток из **shared secret**, первые **4 байта hex (32 бита)** | Отпечаток из **sorted SPKI публичных ключей**, SHA-256, **≥16 байт (128 бит)** |
| Визуал: 4×(6×6) ≈ **20.7 бита** — перебор ECDH-ключей атакующим реалистичен | Safety-number: **8 групп × 5 цифр** = 128 бит; визуал-эмодзи — дополнительный UX, не единственный канал |
| Signal safety number ≈ 200 бит; наш старый формат был существенно слабее | Приближение к industry practice (Signal): привязка к **паре identity keys**, не к shared secret |

### Алгоритм генерации

```typescript
const FINGERPRINT_HASH_BYTES = 16; // 128 bits

async function hashSortedPublicKeys(
  localPublicKey: CryptoKey,
  peerPublicKey: CryptoKey
): Promise<Uint8Array> {
  const localRaw = await crypto.subtle.exportKey('spki', localPublicKey);
  const peerRaw = await crypto.subtle.exportKey('spki', peerPublicKey);
  const [first, second] = sortLexicographic(localRaw, peerRaw);
  const material = concat(first, second);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', material));
}

function formatSafetyNumber(hashBytes: Uint8Array): string {
  // 8 groups × 5 decimal digits from first 16 bytes (128 bits)
  const groups: string[] = [];
  for (let i = 0; i < FINGERPRINT_HASH_BYTES; i += 2) {
    const value = (hashBytes[i] << 8) | hashBytes[i + 1];
    groups.push(value.toString().padStart(5, '0'));
  }
  return groups.join(' ');
}

// Visual fingerprint — emoji alphabet v1 (IMP-FPEMOJI-01)
const FINGERPRINT_EMOJI = [
  '🐶', '🐱', '🦊', '🐼', '🦁', '🐸', '🐵', '🐧', '🐙', '🦉',
  '🍎', '🍌', '🍉', '🍕', '🌸', '🌙', '⭐', '⚽', '🚗', '🚀',
] as const;                       // 20 single-codepoint, widely supported emoji
const VISUAL_FINGERPRINT_SLOTS = 6;
const VISUAL_FINGERPRINT_BYTE_OFFSET = 16; // strictly after safety-number (0–15)

async function generateVisualFingerprint(
  localPublicKey: CryptoKey,
  peerPublicKey: CryptoKey
): Promise<FingerprintElement[]> {
  const hashBytes = await hashSortedPublicKeys(localPublicKey, peerPublicKey);
  const elements: FingerprintElement[] = []; // FingerprintElement = { emoji: string }

  for (let i = 0; i < VISUAL_FINGERPRINT_SLOTS; i++) {
    const idx = VISUAL_FINGERPRINT_BYTE_OFFSET + i; // 1 byte per slot, indices 16–21
    elements.push({ emoji: FINGERPRINT_EMOJI[hashBytes[idx] % FINGERPRINT_EMOJI.length] });
  }
  return elements;
}
```

**Инвариант:** Alice(`pubA`, `pubB`) и Bob(`pubB`, `pubA`) получают **идентичный**
safety-number и набор эмодзи — порядок ключей нормализуется сортировкой
(`hashSortedPublicKeys`). Маппинг чисто функциональный от `hashBytes`, без
локали/рандома. Эмодзи берутся **только** из байт 16–21; safety-number (байты
0–15) визуалом не используется.

### Энтропия и threat model (MITM)

| Компонент | Энтропия | Роль |
|-----------|----------|------|
| Safety-number | **128 бит** (16 байт SHA-256) | Основная out-of-band сверка (голос, лично) |
| 6 эмодзи-слотов (alphabet v1, 20 эмодзи) | ~25.9 бит (`6 × log2 20`) — мнемоника | Быстрая визуальная проверка, не заменяет числа |

Активный MITM, подбирающий ECDH-ключи под старый 32-битный отпечаток, должен перебрать
≈2³²–2²⁰ операций — **устранено**. С 128-битным safety-number подбор отпечатка
в реальном времени **непрактичен** (≈2¹²⁸). Визуальная энтропия после перехода на
эмодзи **не понижена** (~25.9 бит против прежних ~20.7).

**Намеренная несовместимость:** (1) клиенты до IMP-AUDIT-01 показывают другой
отпечаток из-за смены источника энтропии; (2) клиенты до IMP-FPEMOJI-01 для той же
пары ключей показывают геометрические фигуры, а не эмодзи. Для ephemeral-сессий
приемлемо.

### Свойства алфавита эмодзи (v1)

1. **Наблюдаемость энтропии** — каждый слот = один сравнимый глазом эмодзи; убран
   невидимый CSS-`color`-канал.
2. **128-бит safety-number** — основной канал защиты от подбора MITM, неизменен.
3. **Кросс-платформенность** — одиночные кодпоинты, Emoji ≤ 3.0, без ZWJ/variation
   selectors; одинаково рендерятся на Apple/Google/Windows/Telegram.
4. **Привязка к публичным ключам** — как Signal, исключает edge-case с одинаковым
   shared secret.

> Версионирование алфавита (`v1`) позволяет пересматривать набор/энтропию без
> потери детерминизма; решение зафиксировано в
> [decision log](../improvements/fingerprint-emoji/decisions/IMP-FPEMOJI-01-emoji-alphabet.md).

---

## Секретный вопрос (опционально)

### Механизм

```typescript
// При создании чата Alice задаёт вопрос
const secretQuestion = "Как звали моего кота?";
const expectedAnswer = "Барсик";

// Ответ хешируется и используется как salt для HKDF
const answerHash = await crypto.subtle.digest(
  'SHA-256',
  new TextEncoder().encode(expectedAnswer.toLowerCase().trim())
);

// Модифицированный HKDF
const aesKey = await crypto.subtle.deriveKey(
  {
    name: 'HKDF',
    hash: 'SHA-256',
    salt: new Uint8Array(answerHash), // ← Ответ как salt
    info: new TextEncoder().encode('encryption-key')
  },
  hkdfKey,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt', 'decrypt']
);
```

### Результат

Если Bob ответит неправильно:
- Его `sharedSecret` будет правильным (ECDH работает)
- Но `aesKey` будет другим (неправильный salt)
- Сообщения не расшифруются

---

## Модель угроз

### Threat Model

| Угроза | Атакующий | Защита |
|--------|-----------|--------|
| **Перехват трафика** | Сетевой уровень | TLS + E2EE |
| **Компрометация сервера** | Хакер/инсайдер | Zero-knowledge, нет ключей |
| **MITM** | Активная атака | Safety-number (128 бит) + Visual Fingerprint из публичных ключей |
| **Identity Spoofing** | Угон аккаунта | Секретный вопрос |
| **Replay Attack** | Повтор сообщений | Уникальный IV + timestamp |
| **Modification** | Изменение сообщений | GCM auth tag |
| **Утечка filesystem / бэкапа файлов** | Физический доступ к диску сервера | Только файлы `.enc` без ключей; отдельно нужен доступ к целевому устройству пользователя |
| **Утечка «метаданных» файла** | Анализ трафика или Redis | Имя и MIME передаются только в `encryptedMeta`; сервер не может их прочитать |
| **Room presence (IMP-ROOM-20)** | Член комнаты запрашивает snapshot или подписан на topic | Видит `online` + грубый `lastSeen` других членов — **не** содержимое сообщений |

### Room presence (metadata)

> Реализация: IMP-ROOM-20. Redis key `room_presence:{roomId}`.

Presence — **метаданные WebSocket-соединения**, которые сервер и так наблюдает при relay STOMP.
Это **снижает приватность** относительно «никто не знает, кто онлайн»:

- Члены комнаты получают `online` (глобальный heartbeat, ~30s TTL) и `lastSeen` (округление **до минуты**).
- Данные эфемерны: hash TTL **10 минут**, удаление при manual `BURN_ROOM`.
- Не затрагивает zero-knowledge invariant для **сообщений и ключей** — только connection metadata.
- Опциональное room-level отключение presence — отдельная карточка (не реализовано).

Mitigations в текущей версии: member-only access, coarse last-seen, короткий TTL.

### Что видит атакующий

```
┌─────────────────────────────────────────────────────────────────┐
│ Уровень атаки            │ Что видит                           │
├──────────────────────────┼──────────────────────────────────────┤
│ Telegram (MITM в app)    │ Только открытие Mini App            │
│ Наш сервер               │ internalIds + TG IDs (if linked) + encrypted blobs │
│ Сетевой перехват         │ TLS encrypted WebSocket             │
│ Redis breach             │ Encrypted messages + metadata       │
│ Физический доступ (off)  │ sessionStorage пуст после закрытия  │
│ Физический доступ (on)   │ Ключи в RAM — требует root/dump     │
└──────────────────────────┴──────────────────────────────────────┘
```

---

## Wallet auth (TON Connect `ton_proof`)

`POST /api/auth/wallet` принимает опциональные поля `walletPublicKey` + `walletStateInit` от TON Connect.
Backend **не доверяет** присланному `walletPublicKey` без криптографической привязки к адресу:

1. `sha256(stateInit_cell) == address.hashPart` — адрес выводится из stateInit.
2. `extractPubkey(stateInit.data) == walletPublicKey` — pubkey зашит в data-cell контракта (v3R2 / v4 / v5).
3. Ed25519-подпись `ton_proof` проверяется с этим pubkey (`TonProofVerifier` + `TonProofSupport`).

Если клиент не прислал пару полей — fallback на toncenter RPC (`PUBLIC_KEY_UNAVAILABLE` → HTTP 502 при сбое).
Сервер по-прежнему не хранит приватные ключи; проверка выполняется только на публичных данных кошелька.

См. [API.md](./API.md) (`/api/auth/wallet`), decision logs
`docs/archive/improvements/wallet-auth-401/decisions/WALLET-401-02-stateinit-verification.md`.

---

## Дискаверабилити пользователей (wallet-only identity)

> Реализация: [IMP-WALLETID-02](../archive/improvements/wallet-only-identity/decisions/IMP-WALLETID-02-discoverability.md).
> STOMP-контракт: [API.md](./API.md#search_user-appsearch).

Wallet-only пользователи не имеют Telegram username / numeric ID. Их можно найти для начала DM по:

| Идентификатор | Формат | Политика |
|---------------|--------|----------|
| `internalId` | UUID v4 (36 символов) | **Exact match** — полная строка после trim |
| Wallet address | `EQ…` / `UQ…` (TON friendly) | **Exact match** после lowercase-normalize |

Telegram-пользователи по-прежнему находятся по `@username` или numeric TG ID (exact match по полному имени / ID).

### Запрет enumeration

- Частичный UUID, префикс wallet address, «похожие» строки → `INVALID_QUERY` или `NOT_FOUND`, **не** список кандидатов.
- Валидация формата на уровне `SearchHandler` / `SearchRequest` — до обращения к Redis.
- Rate limit `search`: 10 req / 1 min на `internalId` инициатора (см. `rate:search:{internalId}`), в т.ч. для wallet-сессий (IMP-WALLETID-01).

### Zero-knowledge инвариант

Миграция на `internalId` **не нарушает** zero-knowledge модель сервера:

- `internalId` — серверный идентификатор сессии/маршрутизации, уже хранился до миграции (`auth_tg:`, `auth_wallet:`).
- Поиск возвращает только **публичный профиль** (display name, avatar, online) — те же классы данных, что для Telegram-поиска.
- E2EE payload (сообщения, group keys, file blobs) по-прежнему opaque; сервер не получает ключей шифрования.
- Wallet address в поиске — публичный on-chain идентификатор, добровольно привязанный пользователем при wallet-auth.

### Приватность vs UX

Пользователь **копирует** свой `internalId` из профиля (`HomePage`) и передаёт собеседнику out-of-band — как публичный contact handle. Сервер не публикует каталог всех wallet-юзеров и не поддерживает wildcard/prefix search.

---

## Антиспам / Sybil-защита (PoW)

> Дизайн и threat model: [DESIGN.md](../improvements/antispam-pow/DESIGN.md).  
> Security-review отчёт: [SECURITY_REVIEW.md](../improvements/antispam-pow/SECURITY_REVIEW.md).

Burned Chats использует **эшелонированную** антиспам-защиту. PoW (Слой 1) **дополняет**, а не заменяет rate-limit (Слой 0) и **не затрагивает** E2EE / zero-knowledge модель содержимого сообщений.

### Слой 0 — Rate limiting (per `internalId`)

- Реализация: [`RateLimitService`](../../backend/src/main/java/dev/burnedchats/service/RateLimitService.java) + Redis sliding-window (`ratelimit:{type}:{internalId}`).
- Закрывает **флуд от одной идентичности** (search, message, session create и др.).
- **Не** останавливает Sybil: новая Telegram/wallet-идентичность получает свой счётчик.
- **STOMP SEND (IMP-WSRL-01):** при превышении лимита в `RateLimitInterceptor` inbound-фрейм **отбрасывается** (`null`), клиент получает `{ error: "RATE_LIMIT_EXCEEDED", retryAfter }` на `/user/queue/errors` через `StompUserMessenger` — WebSocket **не** закрывается (в отличие от STOMP ERROR).
- **`/app/heartbeat`:** whitelist — не учитывается в `GENERAL`, чтобы presence-heartbeat не рвал соединение после выжженного общего бакета.
- **Room read-only STOMP:** `/app/room.getMembers`, `/app/room.getPresence`, `/app/room.getBans` → `ROOM_READ` (30 req / min), отдельно от `GENERAL` (100 req / min).

| `RateLimitType` | Лимит | Назначение |
|-----------------|-------|------------|
| `SEARCH` | 10 / min | `/app/search` |
| `SESSION_CREATE` | 3 / min | после PoW на `/app/session.create` |
| `MESSAGE` | 60 / min | send/sync |
| `SESSION_ACTION` | 10 / min | accept/reject/verification |
| `HANDSHAKE` | 10 / min | key exchange |
| `FILE_UPLOAD` | 10 / min | REST upload |
| `GENERAL` | 100 / min | прочие `/app/*` без явного маппинга |
| `MESSAGE_EDIT` | 10 / min | edit |
| `MESSAGE_DELETE` | 30 / min | delete |
| `POW_CHALLENGE` | 10 / min | `/app/pow.challenge` |
| `ROOM_READ` | 30 / min | room.getMembers / getPresence / getBans |
| *(whitelist)* | — | `/app/heartbeat` |

На gated-маршруте `session.create` rate-limit применяется **после** успешной PoW-верификации (DESIGN §6.2), чтобы атакующий не сжигал чужой cap до доказательства work.

### Слой 1 — Client-side Proof-of-Work

- Примитив: Hashcash на **SHA-256** — `leadingZeroBits(SHA256(challengeId || nonce)) >= difficulty` (битовая сложность, не hex-символы).
- Challenge: STOMP `/app/pow.challenge` → `/user/queue/pow-challenge`; решение `{ challengeId, nonce }` в теле gated-запроса.
- Адаптивность: глобальный abuse-сигнал `pow:abuse:global` (ratio rejected/total) поднимает difficulty; **ceiling 26 bit** защищает слабые устройства.
- **Production/testnet:** `pow.enabled=true` по умолчанию (`application.yml`, override только через `POW_ENABLED`); dev/test-профили могут отключать PoW для UX разработки.

**Текущий enforcement (2026-06-16):** backend gate только на `/app/session.create`; frontend решает PoW при создании чата (`session_create`). Wire-format поддерживает также `search`, `room_create`, `invite` — issuance готов, gate — follow-up (см. SECURITY_REVIEW).

### Место в threat model

| Угроза | Слой 0 | Слой 1 |
|--------|--------|--------|
| Sybil-массовый спам асимметричных действий | слабо (новый `internalId` = новый лимит) | **основная** (CPU × число действий) |
| Флуд от одного аккаунта | **основная** | дополнительная |
| Целенаправленная атака с GPU/фермой | — | частично (экономический барьер, не абсолют) |
| Содержимое / ключи E2EE | — | **не затрагивается** (ортогонально) |

PoW **не** заменяет Visual Fingerprint (MITM), initData/wallet-auth или шифрование сообщений.

### Zero-knowledge инвариант (PoW)

Сервер **не должен** получать новую **долгоживущую** метаданную «identity ↔ попытка действия» из-за PoW:

- Redis `pow:challenge:{id}` и `pow:spent:{id}` **не** содержат `internalId` / userId — только challenge id, action, difficulty, timestamps.
- Нет журнала «кто решил challenge»; TTL challenge ~60s, spent ~120s, затем ключи испаряются.
- `pow:abuse:*` — агрегаты без per-user полей.
- При верификации gated STOMP-запроса сервер знает инициатора из **существующего** STOMP principal — это не новое хранилище связи с challenge.

E2EE payload (сообщения, group keys, file blobs) по-прежнему opaque; PoW защищает **точки создания состояния / назойливости**, не confidentiality сообщений.

---

### 1. Rate Limiting (Java)

```java
// RateLimitService.java
@Service
@RequiredArgsConstructor
public class RateLimitService {
    
    private final ReactiveRedisTemplate<String, String> redisTemplate;
    
    // Upload: отдельно RateLimitType.FILE_UPLOAD — 10 запросов / 1 мин (см. ValidationConstants.FILE_UPLOAD_RATE_LIMIT)
    private static final Map<String, RateLimit> LIMITS = Map.of(
        "search", new RateLimit(Duration.ofMinutes(1), 10),
        "message", new RateLimit(Duration.ofMinutes(1), 30),
        "session", new RateLimit(Duration.ofMinutes(5), 3)
    );
    
    public Mono<Boolean> checkLimit(String type, String userId) {
        RateLimit limit = LIMITS.get(type);
        String key = "rate:" + type + ":" + userId;
        
        return redisTemplate.opsForValue().increment(key)
            .flatMap(count -> {
                if (count == 1) {
                    return redisTemplate.expire(key, limit.window())
                        .thenReturn(true);
                }
                return Mono.just(count <= limit.max());
            });
    }
    
    public Mono<Void> requireLimit(String type, String userId) {
        return checkLimit(type, userId)
            .flatMap(allowed -> {
                if (!allowed) {
                    return Mono.error(new RateLimitExceededException(type));
                }
                return Mono.empty();
            });
    }
}

record RateLimit(Duration window, int max) {}
```

### 2. Input Validation (Java)

```java
// validation/ValidationConstants.java
public final class ValidationConstants {
    public static final int MAX_TEXT_LENGTH = 4096;
    public static final long MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
    public static final int MAX_FILE_NAME_LENGTH = 255;
    public static final int IV_LENGTH = 12;
    public static final int TAG_LENGTH = 16;
    public static final int PUBLIC_KEY_LENGTH = 65; // P-256 uncompressed
    
    /** Ориентир для клиентской валидации (Phase 4); сервер не инспектирует MIME upload. */
    public static final Set<String> ALLOWED_MIME_TYPES = Set.of(
        "image/jpeg", "image/png", "image/gif", "image/webp",
        "video/mp4", "video/webm",
        "application/pdf", "text/plain", "application/zip"
    );
    
    private ValidationConstants() {}
}
```

```java
// dto/request/SendMessageRequest.java
@Data
public class SendMessageRequest {
    
    @NotBlank
    @Size(max = 36)
    private String sessionId;
    
    @NotNull
    @Valid
    private EncryptedMessageDto message;
}

@Data
public class EncryptedMessageDto {
    
    @NotBlank
    @Pattern(regexp = "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
    private String id;
    
    @NotBlank
    @Size(min = 16, max = 24) // Base64 of 12 bytes
    @Pattern(regexp = "^[A-Za-z0-9+/]+=*$")
    private String iv;
    
    @NotBlank
    @Size(max = 8000) // ~4096 chars encrypted + overhead
    @Pattern(regexp = "^[A-Za-z0-9+/]+=*$")
    private String ciphertext;
    
    @NotBlank
    @Size(min = 22, max = 24) // Base64 of 16 bytes
    @Pattern(regexp = "^[A-Za-z0-9+/]+=*$")
    private String tag;
    
    @NotNull
    @Positive
    private Long timestamp;
    
    @NotBlank
    @Pattern(regexp = "^text$")
    private String type;
}
```

### 3. Безопасное хранение ключей (Frontend)

```typescript
// Обёртка над sessionStorage с защитой
class SecureKeyStore {
  private readonly STORAGE_KEY = 'bc_keys';
  
  // Запись
  async store(keyPair: CryptoKeyPair): Promise<void> {
    const exported = await this.exportKeyPair(keyPair);
    sessionStorage.setItem(this.STORAGE_KEY, JSON.stringify(exported));
  }
  
  // Уничтожение
  burn(): void {
    sessionStorage.removeItem(this.STORAGE_KEY);
    
    // Перезаписываем память (best effort)
    for (let i = 0; i < 10; i++) {
      sessionStorage.setItem(this.STORAGE_KEY, crypto.randomUUID());
    }
    sessionStorage.removeItem(this.STORAGE_KEY);
  }
}

// При закрытии страницы
window.addEventListener('beforeunload', () => {
  keyStore.burn();
});

// При visibility change (сворачивание)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Опционально: burn при сворачивании
    // keyStore.burn();
  }
});
```

### 4. Security Headers (Spring Boot)

```java
// config/SecurityConfig.java
@Configuration
@EnableWebFluxSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityWebFilterChain securityWebFilterChain(ServerHttpSecurity http) {
        return http
            .csrf(csrf -> csrf.disable()) // CSRF не нужен для API
            .headers(headers -> headers
                .contentSecurityPolicy(csp -> csp
                    .policyDirectives(
                        "default-src 'self'; " +
                        "script-src 'self'; " +
                        "connect-src 'self' wss://api.burnedchats.com; " +
                        "style-src 'self' 'unsafe-inline'; " +
                        "img-src 'self' data: blob:;"
                    )
                )
                .frameOptions(frame -> frame.deny())
                .xssProtection(xss -> xss.disable()) // Не нужен с CSP
                .contentTypeOptions(Customizer.withDefaults())
            )
            .build();
    }
}
```

### 4.1. Content-Security-Policy для Telegram Mini App (SPA)

Фактическая политика для HTML/загрузки мини-приложения задаётся **обратным прокси** (`nginx/prod.conf`) и дублируется в **`frontend/nginx.prod.conf`** (контейнер статики), чтобы при расхождении деплоя не остаться без критичных директив.

**Обязательно для работы видео (MP4 и др.):** явная директива `media-src`, разрешающая `blob:`. Клиент использует object URL (`URL.createObjectURL`) для превью до отправки, захвата кадра постера и воспроизведения расшифрованного Blob в `<video>`. Если `media-src` не задана, браузер падает обратно на `default-src`; при `default-src 'self'` без `blob:` загрузка медиа с `blob:https://...` блокируется (в консоли: *Loading media from 'blob:...' violates ... default-src*).

**Картинки:** превью в `FilePreview` может использовать `data:` URL — это обходит необходимость `blob:` в `img-src` для этого экрана. Для видео data URL всего файла неприемлем по размеру, поэтому инфраструктурное разрешение `blob:` в `media-src` — основной путь.

**Несколько заголовков `Content-Security-Policy`:** браузер применяет политики совместно (пересечение). Если один из источников (CDN, второй прокси) отдаёт политику без `media-src 'self' blob:` (или эквивалента), медиа с `blob:` может оказаться запрещённой. Нужно либо убрать конфликтующий заголовок, либо добавить согласованную директиву `media-src` на всех уровнях.

Эталонная строка политики для продакшена совпадает с `add_header Content-Security-Policy` в `nginx/prod.conf` (включая `img-src ... blob:` для превью/постеров, использующих object URL для изображений).

**`script-src` (исполнение JS):** `'unsafe-inline'` **не используется** (IMP-AUDIT-04). Production `index.html` после Vite-сборки содержит только внешние скрипты: `'self'` (бандл `/assets/*.js`) и `https://telegram.org` (Telegram WebApp SDK). Inline `<script>` в исходном `frontend/index.html` нет; nonce/hash не требуются до появления inline-скриптов. Динамически вставляемые inline-скрипты (XSS) блокируются. **`style-src 'unsafe-inline'`** оставлен — React/тема используют inline-стили; риск ниже, чем у script XSS для E2EE-клиента.

**Security-заголовки (edge + frontend-контейнер):** `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` — задаются в `nginx/prod.conf` и дублируются в `frontend/nginx.prod.conf`. Дополнительно на edge: `X-Frame-Options: DENY` (для Mini App достаточно `frame-ancestors` в CSP).

**Invite URL fragment (IMP-WEBINVITE-01):** сервер генерирует канонический invite-URL
`{app-domain}/join#invite_{token}`. Токен размещается в **URL-фрагменте** (`#`), а не в path
или query: фрагмент не отправляется браузером на сервер, не попадает в nginx access-логи и не
утекает через `Referer` при переходах на внешние origin. Клиент извлекает токен из
`location.hash` (web) или `start_param` (legacy t.me deep link). Zero-knowledge инвариант
не нарушается — сервер и ранее знал токен (Redis); меняется только транспортная гигиена.

**`connect-src` (сеть из Mini App):** помимо `'self'`, API и WebSocket домена (`burnedchats.net`), `https://telegram.org`, мостов TON Connect (`config.ton.org`, `bridge.tonapi.io`, `tonconnectbridge.mytonwallet.org`, `bridge.tonhub.com`, `walletbot.me` и соответствующие `wss://`) политика явно разрешает клиентский wallet RPC к Ton Center: `https://toncenter.com` (mainnet, без поддомена — wildcard `*.toncenter.com` его не покрывает), `https://testnet.toncenter.com` (testnet), а также `https://tonkeeper.com` и `https://*.tonkeeper.com` (согласованность с diagnostics CLI). Полный список origins — в строке CSP в `nginx/prod.conf` / `frontend/nginx.prod.conf`; при смене `VITE_TON_RPC_URL` или сети обновлять оба файла синхронно.

### 5. HMAC Validation для Telegram (Java)

```java
// util/HmacUtils.java
@UtilityClass
public class HmacUtils {
    
    /**
     * Вычисляет HMAC-SHA256
     */
    public byte[] hmacSha256(byte[] key, byte[] data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            SecretKeySpec secretKeySpec = new SecretKeySpec(key, "HmacSHA256");
            mac.init(secretKeySpec);
            return mac.doFinal(data);
        } catch (NoSuchAlgorithmException | InvalidKeyException e) {
            throw new RuntimeException("HMAC-SHA256 error", e);
        }
    }
    
    /**
     * Конвертирует байты в hex строку
     */
    public String bytesToHex(byte[] bytes) {
        StringBuilder hexString = new StringBuilder();
        for (byte b : bytes) {
            String hex = Integer.toHexString(0xff & b);
            if (hex.length() == 1) {
                hexString.append('0');
            }
            hexString.append(hex);
        }
        return hexString.toString();
    }
    
    /**
     * Constant-time сравнение строк
     */
    public boolean constantTimeEquals(String a, String b) {
        return MessageDigest.isEqual(
            a.getBytes(StandardCharsets.UTF_8),
            b.getBytes(StandardCharsets.UTF_8)
        );
    }
}
```

---

## Governance on-chain (Phase 5)

### Модель веса голоса и анти-flash-stake (IMP-FAUDIT-F01 / F-2)

**Инвариант (после фикса F-2):** знаменатель кворума и эффективный вес голоса
согласованы по **локу капитала**, а не по live-стейку на момент релея.

1. **Знаменатель кворума** фиксируется при создании proposal: Governor запрашивает
   у StakingMaster `RequestTotalVpSnapshot` → `TotalVpSnapshotReply.totalVp`,
   считает `quorumRequired = totalVp × quorumPercent / 100` и деплоит Proposal
   с этим знаменателем (IMP-AUDIT-02).
2. **Вес голоса** при `CastVote` → `GovernorVoteRelay` считается как
   `min(claimedVp, Σ VP стейков с unlockTime > proposal.endTime)`.
   StakingMaster использует `computeOwnerVotingPowerLockedBeyond(voter, voteEndTime)`;
   `voteEndTime` передаёт Governor из карты `proposalEndTimeById` (тот же
   `endTime`, что записан в init Proposal).
3. **Следствие:** Flexible-тир (`durationSeconds = 0` → `unlockTime = startTime`)
   **не даёт права голоса** — капитал можно вывести до конца голосования.
   Ближайший голосующий тир по умолчанию — Silver (лок ~180 дней) при окнах
   голосования 1–7 дней.

**Что закрыто:** путь «post-snapshot стейк в Flexible → голос → анстейк» —
капитало-эффективный захват кворума без lock-издержек (находка F-2,
[REPORT-contracts.md](../improvements/full-audit-2026-07/REPORT-contracts.md)).

**Остаточный риск (осознанный, не полный Compound-style prior-votes):** адрес
может застейкать **после** снапшота в locked-тир (Silver+) и голосовать VP,
которого не было в знаменателе. Атака перестаёт быть flash: капитал блокируется
на 180+ дней. Полный снапшот VP каждого адреса на момент создания proposal
отложен (см. decision-log).

Decision log:
[IMP-FAUDIT-F01 vote snapshot approach](../improvements/full-audit-2026-07/decisions/IMP-FAUDIT-F01-vote-snapshot-approach.md).
Полная сверка остальных разделов SECURITY.md с кодом — [IMP-FAUDIT-F08](../improvements/full-audit-2026-07/cards/IMP-FAUDIT-F08-security-spec-reconcile.md).

### Cashback-петля между auto-cashback контрактами (RC-2)

**Класс уязвимости:** два (или более) служебных контракта с безусловным или рефлексивным
`receive() { cashback(sender()); }`, где один контракт завершает relay-хендлер терминальным
`cashback(sender())` в адрес «партнёра», который сам авто-cashback'ает обратно. `cashback`
использует `SendRemainingValue` — остаток TON переносится почти целиком на каждый хоп →
сотни пустых переводов (`opcode: null`) и **self-DoS** (out-of-gas, exit `-14`) на одном из
контрактов. Не атака извне: срабатывает на **каждом** штатном relayed-голосе.

**Подтверждённый инцидент (testnet):** Governor ⇄ StakingMaster при `GovernorVoteRelay` —
см. [REPORT IMP-GOVOTE](../improvements/governance-vote-tx-fail/REPORT.md) §3 RC-2
(~349 пустых hop'ов в одном trace).

**Принятый паттерн предотвращения (IMP-GOVOTE-02):**

1. **Refund voter, не partner:** в `StakingMaster.GovernorVoteRelay` после форварда
   `ProposalVoteRelay` остаток relay отправляется на **`msg.voter`** терминальным режимом
   (`SendRemainingValue | SendIgnoreErrors`), а не `cashback(sender())` в Governor.
2. **Non-reflective `receive()`:** plain TON от «партнёра по петле» поглощается без cashback:
   - `governor.tact` — `receive()`: cashback только если `sender() != stakingMaster`;
   - `staking-master.tact` — `receive()`: cashback только если `sender() != governorAddr`.
3. **Bounce-хендлеры без re-ping:** `bounced<GovernorVoteRelay>` / `bounced<ProposalVoteRelay>`
   не вызывают `cashback(sender())` в адрес партнёра (IMP-GOVOTE-03).

Паттерн (2) уже используется в staking stack (Pool ↔ Master). При добавлении новых
relay-цепочек между auto-cashback контрактами — **не** завершать relay терминальным cashback
в служебный контракт-партнёр; возвращать остаток инициатору или явному beneficiary.

Decision log: [IMP-GOVOTE-02 break cashback loop](../improvements/governance-vote-tx-fail/decisions/IMP-GOVOTE-02-break-cashback-loop.md).

### Fee-exempt transfers и stale excluded snapshot (IMP-STKFEE-02)

**Проблема:** `BurnJettonWallet.JettonTransfer` проверяет excluded-статус по **локальному снимку**
`feeConfig` отправителя. Если `StakingMaster` (или другой protocol sink) добавлен в excluded на
мастере после sync кошелька пользователя, депозит в стейкинг облагается стандартным 1% fee
(расхождение с `TOKENOMICS.md`).

**Принятый механизм (live resolve на master):**

1. Локальный fast-path: отправитель или получатель в локальном excluded-снимке → excluded transfer.
2. Обычный P2P (`forwardTonAmount < 1 TON`, не excluded локально) → fee path без hop на master
   (газовый профиль IMP-JETTON-GAS-06 сохранён).
3. Protocol notify path (`forwardTonAmount ≥ 1 TON`, типичный стейкинг) при отсутствии локального
   excluded → `ResolveJettonTransfer` (wallet → master). Мастер сверяет **живой** `excludedHead`,
   пушит актуальный `JettonUpdateFeeConfig` на отправителя и выполняет `CommitJettonTransfer`.

**Безопасность:** `excludedTransfer=true` в commit выставляется только если адрес есть в
timelock-управляемом excluded-листе мастера (`AddExcluded` / `RemoveExcluded`). Произвольный
получатель не может обойти комиссию. Wallet авторизован: sender jetton wallet == caller;
`CommitJettonTransfer` принимается только от master.

Opcodes: `ResolveJettonTransfer` `0x6a3b2c20`, `CommitJettonTransfer` `0x6a3b2c21`.

Decision log: [IMP-STKFEE-02 live excluded resolution](../improvements/staking-deposit-fee/decisions/IMP-STKFEE-02-live-excluded-resolution.md).

---

## Аудит безопасности (чеклист)

### Frontend
- [ ] Web Crypto API вместо JS библиотек
- [ ] Уникальный IV для каждого сообщения
- [ ] Non-extractable ключи где возможно
- [ ] sessionStorage вместо localStorage
- [ ] Burn при закрытии / beforeunload

### Backend (Java)
- [ ] HMAC-SHA256 валидация initData
- [ ] Constant-time сравнение хешей
- [ ] Rate limiting на критических эндпоинтах
- [ ] Input validation на всех DTO
- [ ] CSP headers
- [ ] TLS только (no HTTP)

### Общее
- [ ] Telegram initData expiry check (1 час)
- [ ] Session TTL в Redis
- [ ] Нет логирования содержимого сообщений
- [ ] Нет хранения ключей на сервере

---

## Тестирование безопасности

### Unit тесты криптографии (Frontend)

```typescript
describe('Crypto Module', () => {
  test('ECDH key exchange produces same shared secret', async () => {
    const keyPairA = await generateKeyPair();
    const keyPairB = await generateKeyPair();
    
    const publicKeyA = await exportPublicKey(keyPairA.publicKey);
    const publicKeyB = await exportPublicKey(keyPairB.publicKey);
    
    const sharedA = await computeSharedSecret(
      keyPairA.privateKey,
      await importPublicKey(publicKeyB)
    );
    
    const sharedB = await computeSharedSecret(
      keyPairB.privateKey,
      await importPublicKey(publicKeyA)
    );
    
    expect(toBase64(sharedA)).toBe(toBase64(sharedB));
  });
  
  test('AES-GCM encrypt/decrypt roundtrip', async () => {
    const key = await generateAESKey();
    const plaintext = 'Hello, World!';
    
    const encrypted = await encrypt(plaintext, key);
    const decrypted = await decrypt(encrypted, key);
    
    expect(decrypted).toBe(plaintext);
  });
  
  test('Different IV produces different ciphertext', async () => {
    const key = await generateAESKey();
    const plaintext = 'Same message';
    
    const encrypted1 = await encrypt(plaintext, key);
    const encrypted2 = await encrypt(plaintext, key);
    
    expect(encrypted1.iv).not.toBe(encrypted2.iv);
    expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
  });
});
```

### Integration тесты (Java)

```java
@SpringBootTest
@AutoConfigureWebTestClient
class TelegramAuthServiceTest {
    
    @Autowired
    private TelegramAuthService authService;
    
    @Value("${telegram.bot.token}")
    private String botToken;
    
    @Test
    void shouldValidateCorrectInitData() {
        // Генерируем валидный initData
        String initData = generateValidInitData(botToken, 123456789L);
        
        TelegramUser user = authService.validateInitData(initData);
        
        assertThat(user.getId()).isEqualTo(123456789L);
    }
    
    @Test
    void shouldRejectExpiredInitData() {
        // initData старше 1 часа
        String initData = generateExpiredInitData(botToken, 123456789L);
        
        assertThatThrownBy(() -> authService.validateInitData(initData))
            .isInstanceOf(UnauthorizedException.class)
            .hasMessageContaining("expired");
    }
    
    @Test
    void shouldRejectInvalidHash() {
        String initData = generateInitDataWithInvalidHash();
        
        assertThatThrownBy(() -> authService.validateInitData(initData))
            .isInstanceOf(UnauthorizedException.class)
            .hasMessageContaining("Invalid");
    }
}
```

---

## Комнаты (Phase 2)

План разработки комнат: [DEVELOPMENT_PLAN_ROOMS.md](../phases/phase-2-rooms/DEVELOPMENT_PLAN_ROOMS.md).

### Пароль комнаты

#### Алгоритм KDF (реализовано в P2-1)

Используется **PBKDF2-HMAC-SHA256** через Web Crypto API (фронтенд) и `javax.crypto` (бэкенд, только для тестов).

| Параметр | Значение |
|----------|----------|
| Алгоритм | PBKDF2WithHmacSHA256 |
| Итерации | 200 000 |
| Длина proof | 256 бит (32 байта) |
| Salt | 16 байт, `crypto.getRandomValues` |
| Кодировка | Base64 |

#### Поток создания комнаты

```
Клиент                              Сервер
  │                                    │
  ├─ salt = crypto.getRandomValues()   │
  ├─ proof = PBKDF2(password, salt)    │
  ├─── CREATE_ROOM {salt, proof} ─────►│
  │                                    ├─ proofHash = SHA-256(proof)
  │                                    ├─ room.salt = salt
  │                                    ├─ room.passwordProofHash = proofHash
  │                                    ├─ Redis: HSET room:{roomId} ...
  │◄── ROOM_CREATED {roomId} ──────────┤
```

#### Поток проверки пароля при входе

```
Клиент                              Сервер
  │                                    │
  ├─ GET salt (из invite:{token})       │
  ├─── REQUEST_JOIN {token, proof} ────►│
  │                                    ├─ actualHash = SHA-256(proof)
  │                                    ├─ stored = room.passwordProofHash
  │                                    ├─ MessageDigest.isEqual(actual, stored)
  │◄── JOIN_ACCEPTED / JOIN_REJECTED ──┤
```

#### Гарантии безопасности

- **Plaintext пароль** не логируется, не передаётся на сервер, не хранится нигде.
- **Proof** хешируется SHA-256 перед записью в Redis — утечка Redis-дампа не даёт proof напрямую.
- **Constant-time сравнение** (`MessageDigest.isEqual`) предотвращает timing-атаки.
- **Не логировать** `proof`, `salt` и `passwordProofHash` в DEBUG/INFO логах — только уровень TRACE при необходимости диагностики.

#### Защита от перебора (Rate Limiting)

Rate limiting на `REQUEST_JOIN_ROOM` / `JOIN_BY_PASSWORD` по roomId и/или tgId:
- Рекомендуемый лимит: 5 неудачных попыток за 10 минут.
- После N неудач — временная блокировка (15–60 минут) по tgId.
- Реализация через `RateLimitService` (аналогично существующему).

### Групповой ключ комнаты

- Генерируется на клиенте (владелец) при создании комнаты. Хранится в keyStore на устройствах участников.
- При добавлении нового участника групповой ключ шифруется его публичным ключом и доставляется через сервер (relay). Сервер не расшифровывает и не хранит ключ в открытом виде.
- При **добровольном** выходе участника (`/app/room.leave`) владелец получает `ROOM_MEMBER_LEFT` и **должен** выполнить rekey: новый групповой ключ рассылается оставшимся; у вышедшего нет доступа к новому ключу. **Force-unsubscribe (IMP-ROOM-25):** сервер снимает активные подписки вышедшего на `/topic/room/{roomId}` — он не получает новые ciphertext на открытой сессии до disconnect.
- При **принудительном** удалении (`/app/room.kick`, `/app/room.ban`) сервер удаляет жертву из membership, pubkey, join-request и **всех эпох** `room_keys:{roomId}:{epoch}`. Оставшиеся получают `ROOM_MEMBER_REMOVED`; владелец **обязан** немедленно выполнить rekey (`/app/room.rekey`). **Subscribe-guard (IMP-ROOM-22):** inbound STOMP interceptor отклоняет `SUBSCRIBE /topic/room/{roomId}` для не-членов (`NOT_MEMBER` STOMP ERROR) — удалённый участник не может получать новые ciphertext через topic даже до rekey. **Force-unsubscribe (IMP-ROOM-25):** сервер снимает уже открытые подписки жертвы на room topic сразу после kick/ban (все сессии/вкладки); подписки `/user/queue/*` не затрагиваются. Rekey client-driven — сервер relay + cleanup Redis + membership guard + subscription cut-off.
- **Ban (IMP-ROOM-09):** `/app/room.ban` = kick + `SADD room_bans:{roomId}`. Забаненный `internalId` получает `USER_BANNED` при любой попытке join (любой invite token). Бан привязан к **identity** (`internalId`), не к «человеку»: wallet-only identity стабильна; Telegram→internalId детерминирован; **новый кошелёк = новый internalId** и обходит бан прежней identity. Это осознанное ограничение модели угроз (см. wallet-only identity в [ARCHITECTURE.md](./ARCHITECTURE.md)).
- **Mute (IMP-ROOM-11):** `/app/room.mute` добавляет `internalId` в `room_muted:{roomId}` **без** удаления из membership и **без** rekey. Заглушённый участник сохраняет групповой ключ на клиенте и может **читать** ciphertext; сервер отклоняет только `/app/room.message.send` с кодом `MUTED`. Zero-knowledge не нарушается — это policy relay, не доступ сервера к ключам.
- **Read-only (IMP-ROOM-11):** флаг `readOnly` в `room:{roomId}`; при `true` отправлять могут **owner и admin** (`ROOM_READ_ONLY` для member). Участники по-прежнему получают fan-out на topic. Матрица: [IMP-ROOM-14 decision](../improvements/room-management/decisions/IMP-ROOM-14-permission-matrix.md).
- **Роли (IMP-ROOM-13 + IMP-ROOM-14):** источник истины владельца — `room.ownerInternalId`. Overlay `room_roles:{roomId}` хранит только `admin` \| `member` (отсутствие записи = member). `roleOf(roomId, internalId)` → `owner` \| `admin` \| `member`.
  - **Owner-only:** burn, transfer ownership, setRole, setTtl (IMP-ROOM-16), ban/unban/getBans.
  - **Admin or owner:** kick, getInviteLink/revokeInvite/getInvites, mute/unmute/setReadOnly.
  - **Admin restrictions:** не может kick/mute owner или другого admin (`CANNOT_KICK_OWNER`, `CANNOT_KICK_ADMIN`).
  - **setRole** (`/app/room.setRole`, owner-only): `role ∈ {admin, member}`; target ∈ members; нельзя назначить owner через overlay; broadcast `ROOM_ROLE_UPDATED`.
  - **Transfer ownership** (`/app/room.transferOwnership`, owner-only): как в IMP-ROOM-13.
  - **Managed TTL / auto-burn (IMP-ROOM-16):** owner задаёт `autoBurnAt` через `/app/room.setTtl`
    (`ttlSeconds` или абсолютный epoch). Сервер хранит поле в `room:{roomId}`, капит activity-TTL
    hash-ключа по этому instant и ставит dedicated trigger `room:autoburn:{roomId}` (не продлевается
    активностью). По истечении trigger key — полный каскад BURN_ROOM + `ROOM_BURNED` всем членам
    (keyspace listener, как offline queue). Zero-knowledge: сервер видит только метаданные TTL, не
    содержимое сообщений.
  - **Read-only send:** owner и admin могут постить; member получает `ROOM_READ_ONLY`.
- После rekey старая эпоха (`newEpoch - 1`) удаляется сервером (`deleteEpoch` в обработчике `room.rekey`).

> Детальный протокол (выбор схемы, сравнение Sender Keys vs Tree-DH, wrap/unwrap алгоритмы, rekey): [GROUP_KEY_PROTOCOL.md](../phases/phase-2-rooms/GROUP_KEY_PROTOCOL.md)

### Инвайт-токены

- Токен — криптостойкая случайная строка (например 32 байта hex). В Redis хранится только привязка к roomId и метаданные (createdBy, expiresAt, maxUses). Утечка токена даёт возможность отправить заявку на вход или (при режиме by_password) войти, зная пароль; не раскрывает состав комнаты без доступа к серверу.

---

## Связанные документы

- [ARCHITECTURE.md](./ARCHITECTURE.md) — общая архитектура (в т.ч. комнаты)
- [API.md](./API.md) — формат сообщений
- [BAND_KEY_EXCHANGE.md](./BAND_KEY_EXCHANGE.md) — In-Band обмен ключами
- [DEVELOPMENT_PLAN_ROOMS.md](../phases/phase-2-rooms/DEVELOPMENT_PLAN_ROOMS.md) — план фазы 2: комнаты
- [GROUP_KEY_PROTOCOL.md](../phases/phase-2-rooms/GROUP_KEY_PROTOCOL.md) — протокол группового ключа: выбор схемы, wrap/unwrap, rekey
- [DESIGN.md](../improvements/antispam-pow/DESIGN.md) — PoW-протокол антиспама
- [SECURITY_REVIEW.md](../improvements/antispam-pow/SECURITY_REVIEW.md) — security-review Слоя 1

