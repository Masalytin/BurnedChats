# Bug Report: собственные сообщения отображаются как чужие после возврата из настроек комнаты (wallet-аутентификация)

## Title

Для пользователя, авторизованного **только через крипто-кошелёк**, собственные сообщения в групповой комнате после выхода из «Настроек комнаты» (Room Manage) обратно в чат начинают отображаться как чужие — теряется стиль/логика `isOwn` (исходящего сообщения).

---

## Description & Severity

### Описание

В групповых комнатах принадлежность сообщения текущему пользователю (`isOwn`) определяется сравнением **числового Telegram ID** отправителя (`senderTgId`) с локальным `userId`. У пользователя, вошедшего только через кошелёк, Telegram ID отсутствует:

- на фронтенде локальный `userId` для комнаты схлопывается в `0`;
- на бэкенде `senderTgId` для wallet-сообщений равен `null`.

Пока пользователь находится в чате, отправленные им сообщения отображаются корректно **только за счёт оптимистичного флага** `isOwn: true`, который проставляется локально при отправке. Этот флаг живёт в state хука `useRoomMessages` и теряется при размонтировании компонента чата.

Переход в «Настройки комнаты» (`room-manage`) размонтирует `RoomChatRoom`, а возврат — заново монтирует его и запускает синхронизацию сообщений с сервера. При синхронизации `isOwn` пересчитывается заново через сравнение `senderTgId === userId`, то есть `null === 0` → `false`. В результате **все** собственные сообщения wallet-пользователя начинают рендериться как входящие (чужие).

### Severity

**High (Major / Функциональный + UX/доверие).**

- Прямого нарушения шифрования или zero-knowledge инварианта нет — баг чисто клиентский, касается отображения.
- Однако он критически бьёт по UX и **доверию к продукту**: пользователь видит свои же сообщения как чужие, что в защищённом мессенджере выглядит как «подмена авторства» и может трактоваться как нарушение целостности переписки.
- Затрагивает **всех** пользователей, авторизованных исключительно через кошелёк (без привязанного Telegram), в **любой** групповой комнате. Воспроизводится стабильно (100%) при любом ре-монтировании чата (не только настройки: сворачивание Mini App, реконнект, любая навигация прочь и обратно).

---

## Steps to Reproduce

1. Авторизоваться в приложении **только через крипто-кошелёк** (TON Connect), без привязанного Telegram-аккаунта.
2. Войти в групповую комнату, дождаться получения группового ключа.
3. Отправить одно или несколько собственных сообщений — они отображаются корректно как исходящие (`isOwn`), потому что флаг проставлен оптимистично.
4. Открыть «Настройки комнаты» (кнопка Settings/Manage в шапке комнаты → представление `room-manage`).
5. Вернуться обратно в чат (кнопка «Назад»).
6. **Результат:** ранее отправленные собственные сообщения теперь отображаются как чужие (входящие) — стиль/логика `isOwn` не применяется, появляется лейбл отправителя, выравнивание/цвет как у входящих.

> Тот же эффект воспроизводится при любом другом ре-монтировании `RoomChatRoom`: сворачивание/восстановление Mini App, реконнект WebSocket, навигация на другой экран и обратно. «Настройки комнаты» — лишь самый очевидный сценарий.

---

## Root Cause Analysis

Принадлежность сообщения в комнате определяется по **Telegram ID**, которого у wallet-пользователя нет. Стабильный `internalId` (UUID), который как раз и предназначен для идентификации пользователя независимо от способа входа, **до чата не доносится** и в сравнении не участвует. Ниже — полная цепочка.

### 1. Wallet-пользователь не получает `telegramId`

`buildWalletUser` формирует объект пользователя без поля `telegramId` (в отличие от `buildTelegramUser`, где оно есть):

```58:66:frontend/src/auth/AuthContext.tsx
  const buildWalletUser = useCallback((result: AuthResult): AuthUser => {
    const friendly = result.walletAddress ?? result.userId;
    return {
      internalId: result.userId,
      displayName: result.displayName,
      authType: AuthType.WALLET,
      walletAddress: friendly,
    };
  }, []);
```

### 2. `App` передаёт `telegramUserId = null` и стабильный `internalId` отдельно

```182:183:frontend/src/App.tsx
  const myInternalId = user?.internalId ?? null;
  const telegramUserId = user?.telegramId ?? null;
```

```2047:2052:frontend/src/App.tsx
          <RoomChatRoom
            roomId={activeRoomChat.roomId}
            epoch={activeRoomChat.epoch}
            userId={myInternalId}
            userTelegramId={telegramUserId ?? undefined}
```

Для wallet-пользователя сюда уходит `userTelegramId={undefined}`, а валидный `userId={myInternalId}` (UUID).

### 3. `RoomChatRoom` игнорирует стабильный `internalId` и схлопывает идентификатор в `0`

Проп `userId` (internalId) принимается, но **намеренно не используется** (`_userInternalId`). Для логики сообщений берётся только Telegram ID, который у wallet-пользователя `undefined` → `0`:

```78:107:frontend/src/components/Chat/RoomChatRoom/RoomChatRoom.tsx
export const RoomChatRoom = memo(function RoomChatRoom({
  roomId,
  epoch = 0,
  userId: _userInternalId,
  userTelegramId,
  ...
  const roomMessageUserId = userTelegramId ?? 0;
```

```213:221:frontend/src/components/Chat/RoomChatRoom/RoomChatRoom.tsx
  const { messages, sendMessage, sendFileMessage, isLoading, isSyncing, syncMessages, hideMessages, editMessage, deleteMessage } =
    useRoomMessages({
      roomId,
      userId: roomMessageUserId,
      ws,
      onError: handleRoomMessageError,
      onEditError: handleRoomEditError,
      onMessageDeletedByOwner,
    });
```

Итог: в `useRoomMessages` приходит `userId = 0` для всех wallet-пользователей.

### 4. `isOwn` для входящих/синхронизированных сообщений считается через `senderTgId === userId`

Wire-интерфейсы хука читают только `senderTgId` (поле `senderInternalId`, которое присылает сервер, **не объявлено и не используется**):

```47:63:frontend/src/hooks/useRoomMessages.ts
interface NewRoomMessageEvent {
  roomId: string;
  messageId: string;
  senderTgId: number;
  senderName?: string | null;
  ...
}
```

Живое входящее сообщение:

```620:631:frontend/src/hooks/useRoomMessages.ts
          decryptedMsg = {
            id: event.messageId,
            sessionId: roomId,
            fromUserId: event.senderTgId,
            senderName: event.senderName ?? undefined,
            content: plaintext,
            timestamp: ts,
            status: 'delivered',
            isOwn: event.senderTgId === userId,
            type: 'text',
            replyToMessageId: event.replyToMessageId || undefined,
          };
```

Синхронизированное (с сервера) сообщение:

```774:786:frontend/src/hooks/useRoomMessages.ts
            decryptedMessages.push({
              id: syncedMsg.messageId,
              sessionId: roomId,
              fromUserId: syncedMsg.senderTgId,
              senderName: syncedMsg.senderName ?? undefined,
              content: plaintext,
              timestamp: ts,
              status: 'delivered',
              isOwn: syncedMsg.senderTgId === userId,
              type: 'text',
              replyToMessageId: syncedMsg.replyToMessageId || undefined,
              editedAt: editedAtFromServerIso(syncedMsg.editedAt),
            });
```

Для wallet-пользователя это `null === 0` → **`false`**.

### 5. Бэкенд для wallet-сообщений пишет `senderTgId = null`

`telegramId` у не-Telegram principal равен `null`, и именно он уходит в `senderTgId`:

```435:443:backend/src/main/java/dev/burnedchats/handler/RoomMessageHandler.java
    private ParticipantContext participantContext(Principal principal) {
        if (!(principal instanceof AppPrincipal appPrincipal)) {
            return null;
        }
        Long telegramId = principal instanceof TelegramPrincipal telegramPrincipal
                ? telegramPrincipal.getUserId()
                : null;
        return new ParticipantContext(appPrincipal.getInternalId(), telegramId);
    }
```

При этом сервер **уже отдаёт** стабильный `senderInternalId` в каждом событии и в синке (`.senderInternalId(sender.internalId())`, строки 283, 328, 396 в `RoomMessageHandler.java`) — фронтенд его просто не читает.

### 6. Почему баг «прячется» до выхода в настройки

При локальной отправке `isOwn` проставляется жёстко в `true` (оптимистично), поэтому пока чат не размонтирован — собственные сообщения выглядят корректно:

```298:306:frontend/src/hooks/useRoomMessages.ts
      const localMessage: DecryptedMessage = {
        ...
        status: 'sending',
        isOwn: true,
        type: 'text',
        replyToMessageId,
      };
```

Подтверждение (ack) от сервера лишь меняет `status`, **не трогая** `isOwn`:

```714:717:frontend/src/hooks/useRoomMessages.ts
      if (event.success) {
        setMessages(prev => prev.map(msg =>
          msg.id === event.messageId ? { ...msg, status: 'sent' as MessageStatus } : msg
        ));
```

### 7. Триггер — размонтирование и повторная синхронизация

«Настройки комнаты» — это отдельное представление `room-manage`, переключение на которое размонтирует `RoomChatRoom` (а с ним и весь state `useRoomMessages`, включая оптимистичные `isOwn: true`):

```651:658:frontend/src/App.tsx
    if (currentView === 'room-manage') {
      ...
      setActiveRoomChat(null);
```

После возврата компонент монтируется заново, запускается синхронизация, и `handleSyncMessages` **полностью заменяет** список сообщений серверным, пересчитывая `isOwn` по `senderTgId === userId` (см. п.4) — оптимистичные флаги утеряны:

```797:803:frontend/src/hooks/useRoomMessages.ts
      const serverIdSet = new Set(decryptedMessages.map(m => m.id));
      setMessages(prev => {
        const localInFlight = prev.filter(
          m => (m.status === 'sending' || m.status === 'failed') && !serverIdSet.has(m.id),
        );
        return [...decryptedMessages, ...localInFlight].sort((a, b) => a.timestamp - b.timestamp);
      });
```

**Вывод:** первопричина — определение авторства по `senderTgId` (Telegram ID), отсутствующему у wallet-пользователей, вместо стабильного `internalId`. До ре-монтирования баг маскируется оптимистичным `isOwn: true`; ре-монтирование (выход из настроек комнаты и возврат) сбрасывает оптимистичный state, и синхронизация пересчитывает `isOwn` как `false`.

> Сопутствующее наблюдение: если бы у сервера `senderTgId` оказался не `null`, а `0`, то сравнение `0 === 0` дало бы противоположный дефект — **все** сообщения **всех** wallet-пользователей помечались бы как собственные. Текущая реализация ненадёжна в обе стороны; чинить нужно сам критерий идентичности.

---

## Proposed Fix

Цель — определять авторство по стабильному `internalId` (UUID), который не зависит от способа входа и уже присутствует и на клиенте (`user.internalId`), и на сервере (`senderInternalId` уже шлётся в событиях/синке). Это согласуется с направлением `IMP-WALLETID-08` (комментарий в `RoomChatRoom.tsx:51`: «room message wire still uses tg id until IMP-WALLETID-08»).

### Шаг 1. Объявить и читать `senderInternalId` в wire-интерфейсах хука

В `frontend/src/hooks/useRoomMessages.ts` добавить поле `senderInternalId?: string` в интерфейсы `NewRoomMessageEvent`, `SyncedRoomMessage` (и при необходимости `RoomMessageEditedEventPayload`). Сервер его уже присылает — менять бэкенд не нужно.

### Шаг 2. Пробросить стабильный `userInternalId` в хук

В `useRoomMessages` добавить опцию `userInternalId: string` (рядом с существующим числовым `userId`, либо вместо него после миграции):

```ts
interface UseRoomMessagesOptions {
  roomId: string;
  userId: number;            // legacy Telegram id (DM/обратная совместимость)
  userInternalId: string;    // стабильный UUID — основной критерий авторства
  ws: UseRoomMessagesWebSocket;
  ...
}
```

### Шаг 3. Считать `isOwn` по `internalId` с фолбэком на `senderTgId`

Во всех точках вычисления (`handleNewMessage`, `handleSyncMessages`, file-хелперы `decryptRoomFileEvent` / `decryptSyncedRoomFileMessage`) заменить:

```ts
isOwn: event.senderTgId === userId,
```

на сравнение по стабильному идентификатору с фолбэком на legacy-поле:

```ts
const isOwnMessage =
  (userInternalId && event.senderInternalId
    ? event.senderInternalId === userInternalId
    : false) ||
  (userTelegramId != null && event.senderTgId === userTelegramId);
```

> Фолбэк по `senderTgId` оставляем только для непустого реального Telegram ID (`!= null`/`!= 0`), чтобы исключить ложное `null === 0` / `0 === 0`.

### Шаг 4. Передать стабильный `internalId` из `RoomChatRoom`

В `frontend/src/components/Chat/RoomChatRoom/RoomChatRoom.tsx` перестать игнорировать проп `userId` (сейчас `_userInternalId`) и пробросить его в хук:

```ts
export const RoomChatRoom = memo(function RoomChatRoom({
  roomId,
  epoch = 0,
  userId: userInternalId,   // больше не игнорируем
  userTelegramId,
  ...
}) {
  ...
  useRoomMessages({
    roomId,
    userId: userTelegramId ?? 0, // legacy
    userInternalId,              // основной критерий авторства
    ws,
    ...
  });
```

`App.tsx` уже передаёт валидный `userId={myInternalId}` — менять вызов не требуется.

### Шаг 5. Защитить оптимистичный путь от перезаписи на ре-монтировании (smell-fix, опционально, но желательно)

Корректный критерий `isOwn` (шаги 1–4) полностью устраняет баг. Дополнительно стоит рассмотреть: в `handleSyncMessages` при замене серверным списком не терять авторство, либо гарантировать, что серверные `senderInternalId` всегда заполнены, чтобы пересчёт `isOwn` после ре-монтирования всегда был корректным (он и будет, после шага 3).

### Шаг 6. Проверки / тесты

- Юнит-тест на вычисление `isOwn`: wallet-пользователь (`userTelegramId = undefined`, валидный `userInternalId`), серверное сообщение с тем же `senderInternalId` → `isOwn === true`; с чужим `senderInternalId` → `false`.
- Регрессия для Telegram-пользователя: `senderTgId === userTelegramId` по-прежнему работает.
- Ручной сценарий из «Steps to Reproduce»: после выхода из настроек комнаты и возврата собственные сообщения остаются исходящими.
- Сборка фронтенда: `npm run lint` и `npm run build` в `frontend/`.

### Примечание по смежному коду (вне scope данного фикса)

Тот же паттерн `senderId === userTelegramId` используется и в DM-хуке `useMessages.ts` (строки 628/669/752 и далее), а также в `resolveReplyAuthor` / `quoteSenderLabel` (проп `userTelegramId`). Для wallet-пользователей в DM возможна аналогичная проблема с лейблами авторства. Рекомендуется завести отдельную задачу на унификацию идентичности на `internalId` во всех чат-потоках (в русле `IMP-WALLETID-08`).
