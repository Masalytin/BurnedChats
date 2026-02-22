# Безопасность и криптография

> Детальное описание криптографических протоколов и модели угроз

## 📋 Содержание

- [Обзор безопасности](#обзор-безопасности)
- [Криптографические примитивы](#криптографические-примитивы)
- [Протокол обмена ключами](#протокол-обмена-ключами)
- [Шифрование сообщений](#шифрование-сообщений)
- [Visual Fingerprint](#visual-fingerprint)
- [Модель угроз](#модель-угроз)
- [Защитные механизмы](#защитные-механизмы)
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
  type: 'text' | 'file';
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

### Шифрование файлов

Для файлов используется chunked encryption:

```typescript
const CHUNK_SIZE = 64 * 1024; // 64 KB chunks

async function encryptFile(
  file: File,
  aesKey: CryptoKey
): Promise<EncryptedFile> {
  const chunks: EncryptedChunk[] = [];
  
  for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
    const chunk = file.slice(offset, offset + CHUNK_SIZE);
    const buffer = await chunk.arrayBuffer();
    
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      buffer
    );
    
    chunks.push({
      index: chunks.length,
      iv: toBase64(iv),
      data: toBase64(new Uint8Array(encrypted))
    });
  }
  
  return {
    id: crypto.randomUUID(),
    fileName: encryptString(file.name, aesKey), // Имя тоже шифруем
    mimeType: file.type,
    size: file.size,
    chunks
  };
}
```

---

## Visual Fingerprint

### Концепция

Вместо стандартных эмодзи (как в Signal), используем уникальную систему **"Геометрических отпечатков"**:

```
┌────────────────────────────────────────┐
│                                        │
│   ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐   │
│   │ ◆◆◆ │  │ ○○○ │  │ □□□ │  │ △△△ │   │
│   │ RED │  │ BLUE│  │GREEN│  │PURP │   │
│   └─────┘  └─────┘  └─────┘  └─────┘   │
│                                        │
│   "Четыре фигуры должны совпадать"     │
│                                        │
│   [✓ Совпадают]    [✗ Не совпадают]    │
│                                        │
└────────────────────────────────────────┘
```

### Почему это лучше эмодзи

1. **Меньше интерпретаций** — фигуры и цвета однозначны
2. **Быстрое сравнение** — 4 элемента легко проверить
3. **Устойчивость к локализации** — не зависит от платформы эмодзи
4. **Уникальность** — выделяет приложение от Signal/WhatsApp

### Алгоритм генерации

```typescript
const SHAPES = ['◆', '○', '□', '△', '⬡', '⬢'] as const;
const COLORS = ['red', 'blue', 'green', 'purple', 'orange', 'cyan'] as const;

interface FingerprintElement {
  shape: typeof SHAPES[number];
  color: typeof COLORS[number];
}

async function generateVisualFingerprint(
  sharedSecret: ArrayBuffer
): Promise<FingerprintElement[]> {
  // Hash shared secret to get deterministic bytes
  const hash = await crypto.subtle.digest('SHA-256', sharedSecret);
  const bytes = new Uint8Array(hash);
  
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

### Вероятность коллизии

```
Комбинаций: 6 фигур × 6 цветов = 36 вариантов на элемент
4 элемента: 36^4 = 1,679,616 уникальных отпечатков

Вероятность случайного совпадения: 1/1,679,616 ≈ 0.00006%
```

Этого достаточно для защиты от атаки в реальном времени.

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
| **MITM** | Активная атака | Visual Fingerprint |
| **Identity Spoofing** | Угон аккаунта | Секретный вопрос |
| **Replay Attack** | Повтор сообщений | Уникальный IV + timestamp |
| **Modification** | Изменение сообщений | GCM auth tag |

### Что видит атакующий

```
┌─────────────────────────────────────────────────────────────────┐
│ Уровень атаки            │ Что видит                           │
├──────────────────────────┼──────────────────────────────────────┤
│ Telegram (MITM в app)    │ Только открытие Mini App            │
│ Наш сервер               │ TG IDs + encrypted blobs            │
│ Сетевой перехват         │ TLS encrypted WebSocket             │
│ Redis breach             │ Encrypted messages + metadata       │
│ Физический доступ (off)  │ sessionStorage пуст после закрытия  │
│ Физический доступ (on)   │ Ключи в RAM — требует root/dump     │
└──────────────────────────┴──────────────────────────────────────┘
```

---

## Защитные механизмы

### 1. Rate Limiting (Java)

```java
// RateLimitService.java
@Service
@RequiredArgsConstructor
public class RateLimitService {
    
    private final ReactiveRedisTemplate<String, String> redisTemplate;
    
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
    
    public static final Set<String> ALLOWED_MIME_TYPES = Set.of(
        "image/jpeg", "image/png", "image/gif", "image/webp",
        "application/pdf",
        "text/plain"
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
- При выходе участника выполняется rekey: генерируется новый групповой ключ, рассылается оставшимся; у вышедшего нет доступа к новому ключу (forward secrecy для группы).

### Инвайт-токены

- Токен — криптостойкая случайная строка (например 32 байта hex). В Redis хранится только привязка к roomId и метаданные (createdBy, expiresAt, maxUses). Утечка токена даёт возможность отправить заявку на вход или (при режиме by_password) войти, зная пароль; не раскрывает состав комнаты без доступа к серверу.

---

## Связанные документы

- [ARCHITECTURE.md](./ARCHITECTURE.md) — общая архитектура (в т.ч. комнаты)
- [API.md](./API.md) — формат сообщений
- [BAND_KEY_EXCHANGE.md](./BAND_KEY_EXCHANGE.md) — In-Band обмен ключами
- [DEVELOPMENT_PLAN_ROOMS.md](../phases/phase-2-rooms/DEVELOPMENT_PLAN_ROOMS.md) — план фазы 2: комнаты

