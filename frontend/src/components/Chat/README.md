# Chat components

UI for direct messages (`ChatRoom`) and encrypted rooms (`RoomChatRoom`): message
list, bubbles, input, headers, and message actions (copy, reply, edit, delete,
selection mode).

## `useLongPress` (`@/hooks/useLongPress`)

- **Purpose:** Long-press (primary pointer, ~400 ms) and right-click (`contextmenu`)
  invoke a callback; movement past a threshold or pointer leave/cancel aborts the
  timer (avoids firing while scrolling).
- **Options:** `onLongPress`, optional `onShortClick` (normal click when a long-press
  did not fire), `delay` (default `400`), `moveThreshold` (default `10`), `enabled`.
- **Returns:** `{ handlers }` — spread onto the interactive wrapper of a message row.

## `useMessageSelection` (`@/hooks/useMessageSelection`)

- **Returns:** `mode` (`'idle' | 'selecting'`), `selectedIds`, `isSelected(id)`,
  `toggle(id)`, `enterSelectionWith(id)`, `clear()`, `count`.
- When `count` becomes `0`, `mode` returns to `'idle'`.

## `MessageActionMenu`

- **Props:** `anchor` (`{ x, y }` or `DOMRect`), `actions` (`MessageAction[]`),
  `onClose`.
- **Behavior:** Portaled to `document.body`, viewport clamping, outside mousedown
  and Escape close, keyboard navigation.

## `ChatSelectionBar`

- **Props:** `count`, `onClose`, `actions` (bulk actions when in selection mode).
- Replaces `ChatScreenHeader` while `useMessageSelection().mode === 'selecting'`.

## `MessageList`

- Optional `selection` and `onMessageLongPress` props.
- Renders `MessageActionMenu` on long-press; **Select** enters selection mode.

Message bubbles (`Message`, `ImageMessageBubble`, etc.) show checkbox affordance
in selection mode.

## i18n

User-visible strings: `chat.messageActions.*`, `chat.selectionCount`,
`chat.selectionModeToolbar` in `src/i18n/locales/en.json` and `ru.json`.
