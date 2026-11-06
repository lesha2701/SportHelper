import { Stack, router, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { cancelWithdrawal, getFinanceSummary, listFinanceOperations, listMyWithdrawals } from "@/api/finance";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { formatKopecks } from "@/shared/lib/money";
import { CANCELABLE_WITHDRAWAL_STATUSES, WITHDRAWAL_STATUS_LABELS } from "@/shared/types/finance";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Notice } from "@/ui/Notice";
import { useToast } from "@/ui/Toast";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { StatGrid, StatTile } from "@/ui/StatTile";
import { Text } from "@/ui/Text";

const KIND_LABELS: Record<string, string> = {
  payment_received: "Оплата от спортсмена",
  earning_released: "Доход доступен к выводу",
  withdrawal_reserved: "Заявка на вывод",
  withdrawal_released: "Заявка на вывод отменена",
  withdrawal_paid: "Выплата",
  refund: "Возврат",
};

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

/** The coach's money: balance, payout requests (create, cancel) and the history of operations. */
export default function FinanceScreen() {
  const data = useLoad(async () => {
    const [summary, operations, withdrawals] = await Promise.all([getFinanceSummary(), listFinanceOperations(20, 0), listMyWithdrawals(10, 0)]);
    return { summary, operations, withdrawals };
  });

  const toast = useToast();
  const reload = data.reload;
  // Back from the request form: show the new request and the new balance.
  useFocusEffect(useCallback(() => reload(), [reload]));

  async function cancel(id: string) {
    try {
      await cancelWithdrawal(id);
      toast.success("Заявка отменена, деньги вернулись на баланс");
      data.reload();
    } catch (e) {
      toast.error(toFormError(e).message);
    }
  }

  if (data.loading && !data.data) return <LoadingView />;
  if (data.error || !data.data) return <ErrorView message={data.error ?? "Нет данных"} onRetry={data.reload} />;
  const { summary: s, operations, withdrawals } = data.data;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Финансы" }} />
      <Screen header>
        <StatGrid>
          <StatTile value={formatKopecks(s.availableKopecks)} label="доступно к выводу" />
          <StatTile value={formatKopecks(s.pendingKopecks)} label="ожидает" />
          <StatTile value={formatKopecks(s.reservedKopecks)} label="в заявках на вывод" />
          <StatTile value={formatKopecks(s.paidOutKopecks)} label="выплачено" />
        </StatGrid>
        {s.debtKopecks > 0 ? (
          <Notice kind="danger">За вами числится задолженность {formatKopecks(s.debtKopecks)}: по возврату денег игроку, которые уже были выплачены. Администратор свяжется с вами.</Notice>
        ) : null}
        <Button title="Вывести средства" onPress={() => router.push("/finance/withdraw")} disabled={!s.canWithdraw} />
        {!s.withdrawalsEnabled ? (
          <Text variant="caption" muted>
            Вывод средств пока недоступен.
          </Text>
        ) : s.shortfallKopecks > 0 ? (
          <Text variant="caption" muted>
            Минимальная сумма вывода — {formatKopecks(s.minimumWithdrawalKopecks)}. Не хватает {formatKopecks(s.shortfallKopecks)}.
          </Text>
        ) : null}
        <Text variant="caption" muted>
          Деньги за занятие становятся доступными к выводу после того, как вы отметите занятие проведённым и платформа его подтвердит. Комиссия платформы — {s.commissionPercent}% с каждой оплаты.
          Выплаты выполняются вручную, после проверки заявки.
        </Text>

        <Text variant="heading">Операции</Text>
        {operations.items.length === 0 ? <Text muted>Операций пока нет.</Text> : null}
        {operations.items.map((o) => (
          <Card key={o.id}>
            <Text variant="label">{KIND_LABELS[o.kind] ?? o.kind}</Text>
            <Text muted>
              {formatKopecks(o.amountKopecks)} · {when(o.createdAt)}
              {o.listingTitle ? ` · ${o.listingTitle}` : ""}
            </Text>
          </Card>
        ))}

        {withdrawals.items.length > 0 ? (
          <>
            <Text variant="heading">Заявки на вывод</Text>
            {withdrawals.items.map((w) => (
              <Card key={w.id}>
                <Text variant="label">{formatKopecks(w.amountKopecks)}</Text>
                <Text muted>
                  {WITHDRAWAL_STATUS_LABELS[w.status]} · {when(w.createdAt)}
                </Text>
                {w.detailsHint ? <Text variant="caption" muted>{w.detailsHint}</Text> : null}
                {w.decidedReason ? <Text variant="caption">Причина: {w.decidedReason}</Text> : null}
                {CANCELABLE_WITHDRAWAL_STATUSES.includes(w.status) ? <Button title="Отменить заявку" variant="ghost" onPress={() => void cancel(w.id)} /> : null}
              </Card>
            ))}
          </>
        ) : null}
      </Screen>
    </>
  );
}
