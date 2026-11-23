import { useEffect, useState, type ReactNode } from "react";
import { Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { apiRequest } from "@/api/client";
import { androidClient, onUpdateRequired, type UpdateNotice } from "@/config/clientVersion";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";

interface AppConfig {
  client?: {
    update_required: boolean;
    update_available: boolean;
    update_url: string | null;
  } | null;
}

function UpdateLink({ url }: { url: string | null }) {
  const [error, setError] = useState(false);
  if (!url || !/^(https:\/\/|market:\/\/)/i.test(url)) return null;
  return (
    <>
      <Button title="Обновить приложение" onPress={() => void Linking.openURL(url).catch(() => setError(true))} />
      {error ? <Notice kind="danger">Не удалось открыть магазин приложений.</Notice> : null}
    </>
  );
}

export function ClientVersionGate({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const [checking, setChecking] = useState(androidClient);
  const [notice, setNotice] = useState<UpdateNotice | null>(null);

  useEffect(() => {
    if (!androidClient) return;
    const stop = onUpdateRequired(setNotice);
    const request = new AbortController();
    let active = true;
    const timeout = setTimeout(() => {
      request.abort();
      setChecking(false);
    }, 5000);
    void apiRequest<AppConfig>("/api/app-config", { signal: request.signal })
      .then(({ client }) => {
        if (request.signal.aborted || !client || (!client.update_required && !client.update_available)) return;
        setNotice((current) => current?.required ? current : { required: client.update_required, url: client.update_url });
      })
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timeout);
        if (active) setChecking(false);
      });
    return () => {
      active = false;
      clearTimeout(timeout);
      request.abort();
      stop();
    };
  }, []);

  if (checking) return <LoadingView />;
  if (notice?.required) {
    return (
      <Screen centered>
        <Text variant="title">Обновите приложение</Text>
        <Text>Эта версия SportArena больше не поддерживается. Установите обновление, чтобы продолжить.</Text>
        <UpdateLink url={notice.url} />
      </Screen>
    );
  }
  return (
    <>
      {notice ? (
        <SafeAreaView edges={["top"]} style={{ paddingHorizontal: 16, paddingVertical: 8, gap: 6, backgroundColor: colors.surface }}>
          <Text variant="label">Доступна новая версия SportArena</Text>
          <UpdateLink url={notice.url} />
          <Button title="Позже" variant="ghost" onPress={() => setNotice((current) => current?.required ? current : null)} />
        </SafeAreaView>
      ) : null}
      {children}
    </>
  );
}
