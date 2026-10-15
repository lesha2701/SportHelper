import { createContext, useCallback, useContext, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { verifyMfa } from "../../api/auth";
import { ApiError } from "../../api/client";
import { Dialog } from "./adminUi";
import styles from "./admin.module.css";

/** Raised when the administrator closes the code prompt instead of entering a code. */
export class StepUpCancelled extends Error {}

interface StepUp {
  /** Runs an irreversible action. If the server says the second factor is too old, asks for a fresh code once and retries. */
  run: <T>(action: () => Promise<T>) => Promise<T>;
}

const StepUpContext = createContext<StepUp>({ run: (action) => action() });

export function useStepUp(): StepUp {
  return useContext(StepUpContext);
}

export function StepUpProvider({ children }: { children: ReactNode }) {
  const [waiting, setWaiting] = useState<{ done: () => void; cancel: () => void } | null>(null);

  const ask = useCallback(
    () =>
      new Promise<void>((resolve, reject) => {
        setWaiting({
          done: () => {
            setWaiting(null);
            resolve();
          },
          cancel: () => {
            setWaiting(null);
            reject(new StepUpCancelled());
          },
        });
      }),
    [],
  );

  const value = useMemo<StepUp>(
    () => ({
      run: async (action) => {
        try {
          return await action();
        } catch (error) {
          if (error instanceof ApiError && error.code === "mfa_recent_required") {
            await ask();
            return action();
          }
          throw error;
        }
      },
    }),
    [ask],
  );

  return (
    <StepUpContext.Provider value={value}>
      {children}
      {waiting && <CodePrompt onDone={waiting.done} onCancel={waiting.cancel} />}
    </StepUpContext.Provider>
  );
}

function CodePrompt({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyMfa(code);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось проверить код");
      setBusy(false);
    }
  };

  return (
    <Dialog title="Подтвердите действие кодом" onClose={busy ? () => {} : onCancel}>
      <form onSubmit={submit} className={styles.field} style={{ gap: 12 }}>
        <p className={styles.dialogText}>
          Это действие необратимо, поэтому нужен свежий код из приложения-аутентификатора (подойдёт и резервный код).
        </p>
        <input
          className={styles.input}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          aria-label="Код из приложения"
          placeholder="Код из приложения"
          value={code}
          maxLength={32}
          onChange={(event) => setCode(event.target.value)}
          disabled={busy}
        />
        {error && <div className={styles.error}>{error}</div>}
        <div className={styles.dialogActions}>
          <button type="button" className={styles.button} onClick={onCancel} disabled={busy}>
            Отмена
          </button>
          <button type="submit" className={styles.buttonPrimary} disabled={busy || code.trim().length < 6}>
            {busy ? "…" : "Подтвердить"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
