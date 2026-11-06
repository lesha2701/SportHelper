import { Stack, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { deleteListing, listMyListings } from "@/api/coachListings";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ConfirmModal } from "@/ui/ConfirmModal";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";

/** The coach's offers shown in the catalogue. */
export default function MyListingsScreen() {
  const toast = useToast();
  const list = useLoad(listMyListings);
  const reload = list.reload;
  useFocusEffect(useCallback(() => reload(), [reload]));
  const [removing, setRemoving] = useState<string | null>(null);

  if (list.loading && !list.data) return <LoadingView />;
  if (list.error && !list.data) return <ErrorView message={list.error} onRetry={list.reload} />;

  async function remove(id: string) {
    setRemoving(null);
    try {
      await deleteListing(id);
      list.reload();
    } catch (e) {
      toast.error(toFormError(e).message);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Мои предложения" }} />
      <Screen header>
        <Button title="Новое предложение" onPress={() => router.push("/listing/new")} />
        {list.data?.length === 0 ? <Text muted>Предложений пока нет. Опубликуйте первое, и спортсмены смогут записаться на занятие.</Text> : null}
        {list.data?.map((l) => (
          <Card key={l.id} onPress={() => router.push({ pathname: "/listing/[id]", params: { id: l.id } })}>
            <Text variant="label">{l.title}</Text>
            <Text muted>
              {[l.pricePerSession !== null ? `${l.pricePerSession} ${l.currency}` : "Цена не указана", l.isListed ? "в каталоге" : "скрыто", l.location].filter(Boolean).join(" · ")}
            </Text>
            <Button title="Изменить" variant="secondary" onPress={() => router.push({ pathname: "/listing/new", params: { id: l.id } })} />
            <Button title="Удалить" variant="ghost" onPress={() => setRemoving(l.id)} />
          </Card>
        ))}
        <ConfirmModal visible={removing !== null} title="Удалить предложение?" confirmLabel="Удалить" destructive onCancel={() => setRemoving(null)} onConfirm={() => removing && void remove(removing)} />
      </Screen>
    </>
  );
}
