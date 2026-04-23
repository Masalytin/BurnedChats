import type { UseLongPressHandlers } from '@/hooks/useLongPress';

type SwipeHandlers = {
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerCancel: () => void;
};

/**
 * Chains long-press and swipe-right (reply) pointer handlers for message rows.
 */
export function mergeMessagePointerHandlers(
  longPress: UseLongPressHandlers,
  swipe: SwipeHandlers | null,
): UseLongPressHandlers {
  if (!swipe) {
    return longPress;
  }
  return {
    onPointerDown: (e) => {
      longPress.onPointerDown(e);
      swipe.onPointerDown(e);
    },
    onPointerUp: (e) => {
      longPress.onPointerUp(e);
      swipe.onPointerUp(e);
    },
    onPointerMove: (e) => {
      longPress.onPointerMove(e);
      swipe.onPointerMove(e);
    },
    onPointerCancel: (e) => {
      longPress.onPointerCancel(e);
      swipe.onPointerCancel();
    },
    onPointerLeave: longPress.onPointerLeave,
    onContextMenu: longPress.onContextMenu,
    onClickCapture: longPress.onClickCapture,
    onClick: longPress.onClick,
  };
}
