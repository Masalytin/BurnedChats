# План улучшения Debug Panel

> Документ описывает улучшения debug панели для эффективной отладки Telegram Mini App без доступа к DevTools браузера.

## 📋 Содержание

- [Текущее состояние](#текущее-состояние)
- [Проблемы дебага в Telegram Mini Apps](#проблемы-дебага-в-telegram-mini-apps)
- [Альтернативные подходы к дебагу](#альтернативные-подходы-к-дебагу)
- [План улучшения Debug Panel](#план-улучшения-debug-panel)
- [Приоритеты реализации](#приоритеты-реализации)

---

## Текущее состояние

Текущая debug панель (`DebugPanel.tsx`) предоставляет:

| Функционал | Описание |
|------------|----------|
| Статус WebSocket | isConnected, isConnecting, reconnectAttempt |
| Конфигурация | WS URL, MODE (dev/prod) |
| Telegram info | initData (есть/нет), platform, version |
| Test /ws/info | Проверка доступности endpoint |
| Логи | Хранение последних 100 записей с уровнями |
| Действия | Copy logs, Pause/Resume, Clear |

### Ограничения текущей реализации

1. **Нет видимости состояния хуков** — состояние useSession, useHandshake, useIncomingRequests не отображается
2. **Нет STOMP frame трейсинга** — не видно какие именно сообщения отправляются/получаются
3. **Нет информации о подписках** — не видно активные STOMP subscriptions
4. **Нет криптографии состояния** — нет видимости keyStore (сессии, ключи)
5. **Нет network timing** — нет метрик времени ответов
6. **Нет экспорта состояния** — сложно поделиться полным состоянием для анализа

---

## Проблемы дебага в Telegram Mini Apps

### Почему DevTools недоступны

1. **iOS/Android WebView** — ограниченный доступ к инспектору
2. **Telegram Desktop** — использует Electron, но DevTools отключены для Mini Apps
3. **Production** — пользователи не имеют доступа к консоли

### Специфичные проблемы

| Проблема | Влияние |
|----------|---------|
| initData валидация | Сложно понять почему auth fails |
| WebSocket lifecycle | Disconnects не видны без логирования |
| STOMP frames | Нельзя посмотреть в Network tab |
| Crypto operations | Failures в Web Crypto API тихие |

---

## Альтернативные подходы к дебагу

### 1. Remote Debugging (рекомендуется параллельно)

```bash
# Telegram Desktop с флагом дебага
# Windows
telegram.exe --webview-debug

# macOS
/Applications/Telegram.app/Contents/MacOS/Telegram --webview-debug

# После запуска: chrome://inspect в Chrome
```

**Плюсы:** Полный DevTools  
**Минусы:** Только для разработчика, не для продакшена

### 2. ngrok + Local Backend

```bash
ngrok http 8080
# Используйте ngrok URL для VITE_WS_URL
```

**Плюсы:** Видны логи бэкенда  
**Минусы:** Требует setup для каждой сессии дебага

### 3. Eruda / vConsole (встраиваемые DevTools)

```typescript
// В dev режиме можно подключить
import eruda from 'eruda';
if (import.meta.env.DEV) {
  eruda.init();
}
```

**Плюсы:** Console, Network, Elements в приложении  
**Минусы:** Занимает место в UI, может конфликтовать с Mini App

### 4. Улучшенная Debug Panel (основной фокус)

Расширение существующей панели с учетом специфики приложения.

---

## План улучшения Debug Panel

### Фаза 1: State Visibility (Высокий приоритет)

#### 1.1 WebSocket State Tab

```typescript
interface WebSocketDebugState {
  // Connection
  status: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
  reconnectAttempt: number;
  lastConnectedAt: number | null;
  lastDisconnectedAt: number | null;
  connectionDuration: number;
  
  // Subscriptions
  activeSubscriptions: string[];
  storedSubscriptions: string[]; // For reconnect
  
  // Stats
  messagesSent: number;
  messagesReceived: number;
  bytesTransferred: number;
}
```

**UI компонент:**
```
┌─ WebSocket ─────────────────────────┐
│ Status: 🟢 Connected (2m 34s)       │
│ Reconnects: 0                        │
│                                      │
│ Active Subscriptions (5):            │
│  ✓ /user/queue/session-created       │
│  ✓ /user/queue/incoming-request      │
│  ✓ /user/queue/peer-key              │
│  ✓ /user/queue/active-sessions       │
│  ✓ /user/queue/session-accepted      │
│                                      │
│ Stats: ↑ 12 msgs | ↓ 8 msgs         │
└─────────────────────────────────────┘
```

#### 1.2 Session Flow Tab

```typescript
interface SessionFlowState {
  // Current flow
  currentFlow: 'none' | 'creating' | 'pending' | 'incoming' | 'handshaking' | 'active';
  
  // Session
  sessionId: string | null;
  sessionStatus: SessionStatus | null;
  
  // Peer
  peerId: number | null;
  peerName: string | null;
  
  // Handshake
  handshakeStage: HandshakeStage;
  handshakeProgress: number;
  hasLocalKeys: boolean;
  hasPeerKey: boolean;
  hasSharedSecret: boolean;
  
  // Errors
  lastError: string | null;
  errorTimestamp: number | null;
}
```

**UI компонент:**
```
┌─ Session Flow ──────────────────────┐
│ Current: Creating Session           │
│                                      │
│ Flow Timeline:                       │
│ ✓ 10:34:12 Search user @alice       │
│ ✓ 10:34:15 User found (ID: 12345)   │
│ → 10:34:18 Creating session...      │
│ ○ Waiting for recipient             │
│ ○ Handshake                         │
│ ○ Chat ready                        │
│                                      │
│ Session: (none)                      │
│ Peer: alice (12345)                 │
└─────────────────────────────────────┘
```

#### 1.3 Crypto State Tab

```typescript
interface CryptoDebugState {
  // Per session
  sessions: Map<string, {
    sessionId: string;
    hasKeyPair: boolean;
    hasPeerPublicKey: boolean;
    hasSharedSecret: boolean;
    hasAESKey: boolean;
    fingerprint: string | null;
    createdAt: number;
  }>;
  
  // Operations log
  operations: Array<{
    timestamp: number;
    operation: 'generateKeyPair' | 'exportKey' | 'importKey' | 'deriveSecret' | 'encrypt' | 'decrypt' | 'burn';
    sessionId: string;
    success: boolean;
    durationMs: number;
    error?: string;
  }>;
}
```

**UI компонент:**
```
┌─ Crypto State ──────────────────────┐
│ Sessions with Keys: 1               │
│                                      │
│ Session: abc123...                   │
│  KeyPair: ✓                         │
│  Peer Key: ✓                        │
│  Shared Secret: ✓                   │
│  Fingerprint: 7A3F-2B1C-9D4E-6F8A   │
│                                      │
│ Recent Operations:                   │
│ ✓ generateKeyPair (45ms)            │
│ ✓ exportKey (2ms)                   │
│ ✓ importKey (3ms)                   │
│ ✓ computeSharedSecret (12ms)        │
└─────────────────────────────────────┘
```

### Фаза 2: Message Tracing (Средний приоритет)

#### 2.1 STOMP Message Log

```typescript
interface StompMessage {
  id: number;
  timestamp: number;
  direction: 'outgoing' | 'incoming';
  destination: string;
  command: 'SEND' | 'MESSAGE' | 'SUBSCRIBE' | 'UNSUBSCRIBE';
  headers: Record<string, string>;
  body: unknown;
  size: number;
}

// Добавить в useWebSocket:
const messageLogRef = useRef<StompMessage[]>([]);

// Interceptor для логирования
client.onSend = (frame) => {
  logStompMessage('outgoing', frame);
};
```

**UI компонент:**
```
┌─ STOMP Messages ────────────────────┐
│ [Filter: All ▾] [Direction: ↕ ▾]   │
│                                      │
│ 10:34:18.123 → /app/session.create  │
│   { recipientId: 12345 }            │
│                                      │
│ 10:34:18.456 ← /user/queue/session  │
│   { success: true, sessionId: ... } │
│                                      │
│ 10:34:19.001 → /app/handshake.key   │
│   { sessionId: ..., publicKey: ... }│
│                                      │
│ [Expand] [Copy All] [Clear]         │
└─────────────────────────────────────┘
```

#### 2.2 Request/Response Correlation

```typescript
interface CorrelatedMessage {
  requestId: string;
  request: StompMessage;
  response: StompMessage | null;
  latencyMs: number | null;
  status: 'pending' | 'success' | 'error' | 'timeout';
}
```

### Фаза 3: Diagnostics & Export (Средний приоритет)

#### 3.1 Connection Diagnostics

```typescript
interface DiagnosticsResult {
  timestamp: number;
  checks: Array<{
    name: string;
    status: 'pass' | 'fail' | 'warning';
    message: string;
    details?: unknown;
  }>;
}

async function runDiagnostics(): Promise<DiagnosticsResult> {
  return {
    timestamp: Date.now(),
    checks: [
      await checkTelegramEnv(),    // initData, platform, version
      await checkWsEndpoint(),      // /ws/info reachable
      await checkWsConnection(),    // Can establish STOMP
      await checkSubscriptions(),   // Can subscribe to user queue
      await checkCryptoAPI(),       // Web Crypto available
      await checkSessionStorage(),  // Can store keys
    ],
  };
}
```

**UI компонент:**
```
┌─ Diagnostics ───────────────────────┐
│ Last run: 10:34:22                  │
│                                      │
│ ✓ Telegram Environment              │
│   initData present, platform: ios   │
│                                      │
│ ✓ WebSocket Endpoint                │
│   /ws/info returned 200             │
│                                      │
│ ✓ STOMP Connection                  │
│   Connected in 234ms                │
│                                      │
│ ⚠ User Subscriptions               │
│   5/5 subscribed (1 pending)        │
│                                      │
│ ✓ Web Crypto API                    │
│   ECDH P-256, AES-GCM available     │
│                                      │
│ [Run Diagnostics] [Export Report]   │
└─────────────────────────────────────┘
```

#### 3.2 Full State Export

```typescript
interface DebugExport {
  version: string;
  timestamp: number;
  
  // Environment
  env: {
    mode: string;
    wsUrl: string;
    telegram: { initData: boolean; platform: string; version: string };
  };
  
  // State snapshots
  websocket: WebSocketDebugState;
  sessionFlow: SessionFlowState;
  crypto: CryptoDebugState;
  
  // Logs
  logs: LogEntry[];
  stompMessages: StompMessage[];
  
  // Diagnostics
  lastDiagnostics: DiagnosticsResult | null;
}

function exportDebugState(): string {
  const state: DebugExport = { ... };
  
  // Sanitize sensitive data
  delete state.crypto.sessions; // Don't export actual keys
  state.env.telegram.initData = Boolean(WebApp.initData);
  
  return JSON.stringify(state, null, 2);
}
```

**Функции экспорта:**
- `Copy to Clipboard` — копировать JSON
- `Download as File` — скачать debug-{timestamp}.json
- `Share via QR` — сгенерировать QR с URL на paste service (опционально)

### Фаза 4: Visual Improvements (Низкий приоритет)

#### 4.1 Tabs Navigation

```
┌───────────────────────────────────────┐
│ 🐛 Debug  [Status] [Flow] [Messages] │
├───────────────────────────────────────┤
│                                       │
│  (Active tab content)                 │
│                                       │
└───────────────────────────────────────┘
```

#### 4.2 Collapsible Sections

Каждая секция сворачивается для экономии места на маленьких экранах.

#### 4.3 Floating Button Mode

```typescript
// Минимальный режим - только индикатор статуса
<FloatingDebugButton 
  status={isConnected ? 'green' : 'red'}
  hasErrors={logs.some(l => l.level === 'error')}
  onClick={() => setExpanded(true)}
/>
```

#### 4.4 Dark/Light Theme

Автоматическое определение из Telegram theme.

### Фаза 5: Advanced Features (Будущее)

#### 5.1 Mock Server Mode

```typescript
// Для тестирования без реального backend
const mockResponses = {
  '/app/session.create': { success: true, sessionId: 'mock-123' },
  '/app/handshake.key': { success: true, publicKey: 'mock-key' },
};
```

#### 5.2 Replay Mode

Воспроизведение STOMP сообщений из экспортированного лога.

#### 5.3 Performance Metrics

```typescript
interface PerformanceMetrics {
  connectionTime: number;
  avgMessageLatency: number;
  handshakeDuration: number;
  cryptoOperationTimes: Record<string, number>;
}
```

---

## Приоритеты реализации

### Sprint 1 (Критично для дебага текущих проблем)

| Задача | Оценка | Описание |
|--------|--------|----------|
| 1.1 WebSocket State Tab | 4h | Показать subscriptions, stats |
| 1.2 Session Flow Tab | 4h | Визуализация flow с timeline |
| 2.1 STOMP Message Log | 4h | Логирование всех frames |
| 3.2 Full State Export | 2h | Export для sharing |

**Итого: ~14 часов**

### Sprint 2 (Улучшения UX дебага)

| Задача | Оценка | Описание |
|--------|--------|----------|
| 1.3 Crypto State Tab | 3h | Состояние keyStore |
| 3.1 Connection Diagnostics | 4h | Автоматические проверки |
| 4.1 Tabs Navigation | 2h | Организация UI |
| 4.2 Collapsible Sections | 1h | Экономия места |

**Итого: ~10 часов**

### Sprint 3 (Polish)

| Задача | Оценка | Описание |
|--------|--------|----------|
| 2.2 Request/Response Correlation | 3h | Matching pairs |
| 4.3 Floating Button Mode | 2h | Минимальный UI |
| 4.4 Theme Support | 1h | Dark/Light |

**Итого: ~6 часов**

---

## Архитектура

### Новая структура компонентов

```
frontend/src/components/DebugPanel/
├── index.ts                    # Exports
├── DebugPanel.tsx              # Main container
├── DebugPanel.css              # Styles
├── tabs/
│   ├── StatusTab.tsx           # WebSocket status
│   ├── FlowTab.tsx             # Session flow
│   ├── MessagesTab.tsx         # STOMP messages
│   ├── CryptoTab.tsx           # Crypto state
│   └── DiagnosticsTab.tsx      # Diagnostics
├── hooks/
│   ├── useDebugState.ts        # Centralized debug state
│   ├── useStompLogger.ts       # STOMP message logging
│   └── useDiagnostics.ts       # Diagnostic checks
└── utils/
    ├── export.ts               # State export
    └── sanitize.ts             # Remove sensitive data
```

### Debug Context

```typescript
// Централизованное хранение debug state
const DebugContext = createContext<DebugState | null>(null);

function DebugProvider({ children }: { children: React.ReactNode }) {
  const debugState = useDebugState();
  
  return (
    <DebugContext.Provider value={debugState}>
      {children}
    </DebugContext.Provider>
  );
}
```

---

## Интеграция с существующими хуками

### Модификация useWebSocket

```typescript
// Добавить в useWebSocket:
export function useWebSocket(options: UseWebSocketOptions): UseWebSocketReturn {
  // ... existing code ...
  
  // Debug state export
  const debugState = useMemo(() => ({
    status: isConnected ? 'connected' : isConnecting ? 'connecting' : 'disconnected',
    activeSubscriptions: Array.from(subscriptionsRef.current.keys()),
    storedSubscriptions: Array.from(storedSubscriptionsRef.current.keys()),
    reconnectAttempt,
  }), [isConnected, isConnecting, reconnectAttempt]);
  
  return {
    // ... existing return ...
    _debug: debugState, // For debug panel
  };
}
```

### Добавление логирования в хуки

```typescript
// В начало каждого хука добавить:
useEffect(() => {
  debugLog('info', 'useSession: status changed', { status: result.status });
}, [result.status]);
```

---

## Связанные документы

- [ARCHITECTURE.md](./ARCHITECTURE.md) — архитектура системы
- [API.md](./API.md) — WebSocket API спецификация
- [SECURITY.md](./SECURITY.md) — криптография и безопасность

---

## Changelog

| Дата | Версия | Изменения |
|------|--------|-----------|
| 2026-01-28 | 1.0 | Первоначальный план |
