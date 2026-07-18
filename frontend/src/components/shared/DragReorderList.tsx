import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { Icon } from "./Icon";
import styles from "../library/library.module.css";

interface DragReorderListProps<T> {
  items: T[];
  keyFn: (item: T) => string;
  onReorder: (items: T[]) => void;
  renderItem: (item: T) => ReactNode;
}

/**
 * Pointer-based (touch + mouse) drag-to-reorder list — no HTML5 DnD, since
 * that API doesn't fire reliably in mobile WebViews (this app runs inside
 * Telegram's in-app browser). Reordering is purely local array state; the
 * caller decides what, if anything, gets persisted.
 */
export function DragReorderList<T>({ items, keyFn, onReorder, renderItem }: DragReorderListProps<T>) {
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const orderRef = useRef(items);
  orderRef.current = items;

  const reorderTo = (clientY: number) => {
    const current = orderRef.current;
    const draggingIndex = current.findIndex((item) => keyFn(item) === draggingKey);
    if (draggingIndex === -1) return;

    let targetIndex = current.length - 1;
    for (let i = 0; i < current.length; i++) {
      const item = current[i];
      if (!item) continue;
      const el = rowRefs.current.get(keyFn(item));
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        targetIndex = i;
        break;
      }
    }

    if (targetIndex !== draggingIndex) {
      const next = current.slice();
      const moved = next.splice(draggingIndex, 1)[0];
      if (!moved) return;
      next.splice(targetIndex, 0, moved);
      onReorder(next);
    }
  };

  const handlePointerDown = (key: string) => (event: PointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    setDraggingKey(key);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<HTMLSpanElement>) => {
    if (draggingKey === null) return;
    reorderTo(event.clientY);
  };

  const endDrag = () => setDraggingKey(null);

  return (
    <div>
      {items.map((item) => {
        const key = keyFn(item);
        return (
          <div
            key={key}
            ref={(el) => {
              if (el) rowRefs.current.set(key, el);
              else rowRefs.current.delete(key);
            }}
            className={draggingKey === key ? `${styles.dragRow} ${styles.dragging}` : styles.dragRow}
          >
            <span
              className={styles.dragHandle}
              onPointerDown={handlePointerDown(key)}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              aria-label="Перетащить для изменения порядка"
              role="button"
            >
              <Icon name="grip" size={18} />
            </span>
            <div className={styles.dragRowContent}>{renderItem(item)}</div>
          </div>
        );
      })}
    </div>
  );
}
