# Chat components

UI for direct messages (`ChatRoom`) and encrypted rooms (`RoomChatRoom`): message list, bubbles, input, headers, and **message actions** (IMP-MA-01+).

## Message actions foundation (IMP-MA-01)

### `useLongPress` (`@/hooks/useLongPress`)

- **Purpose:** Long-press (primary pointer, ~400 ms) and right-click (`contextmenu`) invoke a callback; movement past a threshold or pointer leave/cancel aborts the timer (avoids firing while scrolling).
- **Options:** `onLongPress`, optional `onShortClick` (normal click when a long-press did not fire), `delay` (default `400`), `moveThreshold` (default `10`), `enabled` (when `false`, the long-press timer is not armed; `contextmenu` is still prevented so the browser menu does not appear on bubbles).
- **Returns:** `{ handlers }` with pointer handlers, `onContextMenu`, `onClickCapture`, and `onClick` — spread onto the interactive wrapper of a message row.

The public task spec referred to this callback as `onClick`; in code it is named `onShortClick` to avoid clashing with the DOM `onClick` in the returned `handlers`.

### `useMessageSelection` (`@/hooks/useMessageSelection`)

- **Returns:** `mode` (`'idle' | 'selecting'`), `selectedIds`, `isSelected(id)`, `toggle(id)`, `enterSelectionWith(id)`, `clear()`, `count`.
- When `count` becomes `0`, `mode` returns to `'idle'`.

### `MessageActionMenu`

- **Props:** `anchor` (`{ x, y }` or `DOMRect`), `actions` (`MessageAction[]`), `onClose`.
- **Behavior:** Portaled to `document.body`, viewport clamping / flip, outside mousedown and **Escape** close the menu, arrow keys + **Enter** navigate, short scale+fade animation.

### `ChatSelectionBar`

- **Props:** `count`, `onClose`, `actions` (reserved for bulk actions in later IMP-MA tasks).
- Replaces `ChatScreenHeader` while `useMessageSelection().mode === 'selecting'`.

### `MessageList`

- Optional `selection?: UseMessageSelectionReturn` and `onMessageLongPress?: (message, anchor) => void`.
- Renders `MessageActionMenu` when a message triggers the long-press handler (internal state). The **Select** action calls `enterSelectionWith` and closes the menu; other actions are disabled placeholders until IMP-MA-02+.

### Message bubbles

`Message`, `ImageMessageBubble`, `VideoMessageBubble`, and `DocumentMessageBubble` accept `selection` and `onOpenActionMenu` from `MessageList`. In selection mode they show a checkbox affordance, `data-selected`, and tap toggles selection.

### i18n

User-visible strings live under `chat.messageActions.*`, `chat.selectionCount`, `chat.selectionModeToolbar` in `src/i18n/locales/en.json` and `ru.json`.
