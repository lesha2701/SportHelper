import * as Linking from "expo-linking";
import { useCallback, useEffect, useState } from "react";
import { router } from "expo-router";
import { apiRequest } from "@/api/client";
import { useAuth } from "@/auth/AuthProvider";
import { API_BASE_URL } from "@/config";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

interface Application {
  status: "pending" | "needs_info" | "approved" | "rejected";
  admin_note: string | null;
  resubmit_after: string | null;
}

export default function CoachApplicationScreen() {
  const { user, refreshUser, signOut } = useAuth();
  const [application, setApplication] = useState<Application | null>(null);
  const [error, setError] = useState("");
  const [currentTime, setCurrentTime] = useState(0);
  const load = useCallback(async () => {
    try {
      setError("");
      setApplication(await apiRequest<Application>("/api/coach-applications/mine"));
      setCurrentTime(Date.now());
      await refreshUser();
    } catch { setError("Не удалось обновить заявку. Повторите попытку."); }
  }, [refreshUser]);
  useEffect(() => { void load(); }, [load]);
  const status = application?.status ?? user?.coachApplicationStatus;
  return <Screen>
    <Text variant="title">Заявка тренера</Text>
    <Text muted>{status === "pending" ? "Заявка на проверке. Решение придёт на email." : status === "needs_info" ? "Нужны дополнительные сведения." : status === "rejected" ? "Сейчас мы не готовы одобрить заявку." : "Проверяем статус заявки."}</Text>
    {application?.admin_note ? <Notice kind="info">{application.admin_note}</Notice> : null}
    {application?.resubmit_after ? <Text muted>Повторная подача доступна с {new Date(application.resubmit_after).toLocaleDateString("ru-RU")}.</Text> : null}
    {error ? <Notice kind="danger">{error}</Notice> : null}
    <Button title="Обновить статус" onPress={() => void load()} />
    {(status === "needs_info" || (status === "rejected" && (!application?.resubmit_after || Date.parse(application.resubmit_after) <= currentTime))) ? <Button title="Дополнить заявку на сайте" onPress={() => void Linking.openURL(`${API_BASE_URL}/login`)} /> : null}
    <Button title="Аккаунт" onPress={() => router.push("/account")} />
    <Button title="Помощь" onPress={() => router.push("/help")} />
    <Button title="Написать о заявке" onPress={() => void Linking.openURL("mailto:perekrestov_bus@mail.ru")} />
    <Button title="Выйти" onPress={() => void signOut()} />
  </Screen>;
}
