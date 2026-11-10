import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { onSuccessMessage } from "@/api/client";
import { useTheme } from "@/theme/ThemeProvider";
import { radius } from "@/theme/tokens";
import { Text } from "./Text";

type Kind = "success" | "error" | "info";

interface ToastApi {
  show: (message: string, kind?: Kind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {}, success: () => {}, error: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const [toast, setToast] = useState<{ message: string; kind: Kind; id: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((message: string, kind: Kind = "info") => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, kind, id: Date.now() });
    timer.current = setTimeout(() => setToast(null), 3500);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  // Changes that succeeded announce themselves (the `successMessage` of the API call).
  useEffect(() => onSuccessMessage((message) => show(message, "success")), [show]);

  const api = useMemo<ToastApi>(
    () => ({ show, success: (m) => show(m, "success"), error: (m) => show(m, "error") }),
    [show],
  );
  const tone = toast?.kind === "success" ? colors.success : toast?.kind === "error" ? colors.danger : colors.text;

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast ? (
        <View pointerEvents="none" style={styles.host}>
          <View
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={[styles.toast, { backgroundColor: colors.surface, borderColor: tone }]}
          >
            <Text variant="label" style={{ color: tone }}>
              {toast.message}
            </Text>
          </View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

const styles = StyleSheet.create({
  host: { position: "absolute", left: 16, right: 16, bottom: 32, alignItems: "center" },
  toast: { borderWidth: 1, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 16, maxWidth: 480 },
});
