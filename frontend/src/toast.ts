/** Tiny global toast store: usable from anywhere (including the API layer)
 * without React context. <ToastHost /> renders whatever is pushed here. */

export type ToastKind = "success" | "error";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

type Listener = (toasts: ToastItem[]) => void;

const AUTO_DISMISS_MS: Record<ToastKind, number> = { success: 3500, error: 6000 };
const MAX_VISIBLE = 4;

let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit(): void {
  listeners.forEach((listener) => listener(toasts));
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function push(kind: ToastKind, message: string): void {
  // The same message shown again while it's still up would just stack duplicates.
  if (toasts.some((t) => t.kind === kind && t.message === message)) return;
  const id = nextId++;
  toasts = [...toasts, { id, kind, message }].slice(-MAX_VISIBLE);
  emit();
  window.setTimeout(() => dismissToast(id), AUTO_DISMISS_MS[kind]);
}

let successMuted = 0;

/** Runs a multi-step flow (create + schedule + uploads…) without each step
 * announcing its own success; the caller toasts once at the end. Errors are
 * never muted. */
export async function withoutSuccessToasts<T>(run: () => Promise<T>): Promise<T> {
  successMuted++;
  try {
    return await run();
  } finally {
    successMuted--;
  }
}

export const toast = {
  success: (message: string): void => {
    if (successMuted === 0) push("success", message);
  },
  error: (message: string): void => push("error", message),
};

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => {
    listeners.delete(listener);
  };
}
