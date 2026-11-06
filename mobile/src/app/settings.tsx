import { Stack, router } from "expo-router";
import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { logoutAll } from "@/api/auth";
import { getNotificationPreferences, setNotificationPreference } from "@/api/profile";
import { getAiAnalysisConsent, setAiAnalysisConsent } from "@/api/privacy";
import { useLoad } from "@/lib/useLoad";
import { SwitchRow } from "@/ui/SwitchRow";
import { useAuth } from "@/auth/AuthProvider";
import { toFormError } from "@/lib/formError";
import { NOTIFICATION_CATEGORY_LABELS, type NotificationPreference } from "@/shared/types/notification";
import { useTheme, type ThemePreference } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Choice } from "@/ui/Choice";
import { ConfirmModal } from "@/ui/ConfirmModal";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";

const THEMES: { value: ThemePreference; title: string }[] = [
  { value: "system", title: "Как в системе" },
  { value: "light", title: "Светлая" },
  { value: "dark", title: "Тёмная" },
];

/** «Конфиденциальность» (as on the website): may a personal coach run the AI analysis on my sports data. */
function PrivacySettings() {
  const consent = useLoad(getAiAnalysisConsent);
  const [value, setValue] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const allowed = value ?? consent.data ?? false;
  return (
    <Card>
      <Text variant="heading">Конфиденциальность</Text>
      {consent.error && !consent.data ? <Notice kind="danger">{consent.error}</Notice> : null}
      <SwitchRow
        label="AI-анализ для личных тренеров"
        value={allowed}
        onChange={async (next) => {
          if (busy || consent.data === undefined) return;
          setBusy(true);
          try {
            setValue(await setAiAnalysisConsent(next));
          } catch {
            // the API layer already showed why; the switch stays where it was
          } finally {
            setBusy(false);
          }
        }}
      />
      <Text variant="caption" muted>
        Разрешить тренерам, у которых с вами есть подтверждённая личная тренировка, использовать ваши спортивные данные для AI-анализа и подготовки к занятию:
        статистику, историю тренировок, посещаемость, показатели, задания и отчёты. Фото и видео из отчётов тренеру не открываются. По умолчанию выключено; если
        отключить, уже подготовленные анализы будут удалены.
      </Text>
    </Card>
  );
}

function NotificationSettings() {
  const [prefs, setPrefs] = useState<NotificationPreference[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    getNotificationPreferences()
      .then(setPrefs)
      .catch((e: unknown) => setError(toFormError(e).message));
  }, []);

  async function toggle(pref: NotificationPreference) {
    setBusy(pref.category);
    setError(null);
    try {
      setPrefs(await setNotificationPreference({ category: pref.category, enabled: !pref.enabled }));
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <Text variant="heading">Уведомления</Text>
      {error ? <Notice kind="danger">{error}</Notice> : null}
      {prefs?.map((pref) => (
        <View key={pref.category} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Text style={{ flex: 1 }}>{NOTIFICATION_CATEGORY_LABELS[pref.category]}</Text>
          <Switch value={pref.enabled} disabled={busy === pref.category} onValueChange={() => void toggle(pref)} />
        </View>
      ))}
    </Card>
  );
}

export default function SettingsScreen() {
  const { signOut } = useAuth();
  const { preference, setPreference } = useTheme();
  const toast = useToast();
  const [confirm, setConfirm] = useState<"out" | "all" | null>(null);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Настройки" }} />
      <Screen header>
        <Card>
          <Text variant="heading">Тема</Text>
          <Choice layout="chips" options={THEMES} value={preference} onChange={setPreference} />
        </Card>
        <Card>
          <Text variant="heading">Знакомство с приложением</Text>
          <Text muted>Короткий обзор возможностей SportArenaGlobal — можно пересмотреть в любой момент.</Text>
          <Button title="Как работает SportArenaGlobal" variant="secondary" onPress={() => router.push("/guide")} />
        </Card>
        <NotificationSettings />
        <PrivacySettings />
        <Button title="Аккаунт и безопасность" variant="secondary" onPress={() => router.push("/account")} />
        <Button title="Выйти" variant="secondary" onPress={() => setConfirm("out")} />
        <Button title="Выйти на всех устройствах" variant="ghost" onPress={() => setConfirm("all")} />
        <ConfirmModal
          visible={confirm !== null}
          title={confirm === "all" ? "Выйти на всех устройствах?" : "Выйти из аккаунта?"}
          confirmLabel="Выйти"
          destructive={confirm === "all"}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const all = confirm === "all";
            setConfirm(null);
            if (all) {
              try {
                await logoutAll();
              } catch (e) {
                toast.error(toFormError(e).message);
                return;
              }
            }
            await signOut();
          }}
        />
      </Screen>
    </>
  );
}
