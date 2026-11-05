import { Stack, router } from "expo-router";
import { listNotifications, markAllNotificationsRead, markNotificationRead } from "@/api/notifications";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { routeForNotification } from "@/shared/lib/notificationRoute";
import type { NotificationItem } from "@/shared/types/notification";
import { useTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const list = useLoad(listNotifications);

  if (list.loading && !list.data) return <LoadingView />;
  if (list.error && !list.data) return <ErrorView message={list.error} onRetry={list.reload} />;
  const items = list.data ?? [];
  const unread = items.filter((n) => !n.readAt).length;

  async function open(n: NotificationItem) {
    try {
      if (!n.readAt) await markNotificationRead(n.id);
    } catch (e) {
      toast.error(toFormError(e).message);
    }
    const route = routeForNotification(n.entityType, n.entityId);
    if (route) router.push(route);
    else list.reload();
  }

  async function readAll() {
    try {
      await markAllNotificationsRead();
      list.reload();
    } catch (e) {
      toast.error(toFormError(e).message);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Уведомления" }} />
      <Screen header>
        {unread > 0 ? <Button title={`Прочитать все (${unread})`} variant="secondary" onPress={readAll} /> : null}
        {items.length === 0 ? <Text muted>Уведомлений пока нет.</Text> : null}
        {items.map((n) => (
          <Card key={n.id} onPress={() => void open(n)} style={!n.readAt ? { borderColor: colors.primary } : undefined}>
            <Text variant="label">{n.title}</Text>
            <Text muted>{n.body}</Text>
            <Text variant="caption" muted>
              {when(n.sendAt)}
            </Text>
          </Card>
        ))}
      </Screen>
    </>
  );
}
