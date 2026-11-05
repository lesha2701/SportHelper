import { Stack } from "expo-router";
import { getFinanceSummary, listFinanceOperations, listMyWithdrawals } from "@/api/finance";
import { useLoad } from "@/lib/useLoad";
import { formatKopecks } from "@/shared/lib/money";
import { WITHDRAWAL_STATUS_LABELS } from "@/shared/types/finance";
import { Card } from "@/ui/Card";
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

/** The coach's money: balance, operations and payout requests (read-only here; payouts are requested on the website). */
export default function FinanceScreen() {
  const data = useLoad(async () => {
    const [summary, operations, withdrawals] = await Promise.all([getFinanceSummary(), listFinanceOperations(20, 0), listMyWithdrawals(10, 0)]);
    return { summary, operations, withdrawals };
  });

  if (data.loading && !data.data) return <LoadingView />;
  if (data.error || !data.data) return <ErrorView message={data.error ?? "Нет данных"} onRetry={data.reload} />;
  const { summary: s, operations, withdrawals } = data.data;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Финансы" }} />
      <Screen>
        <StatGrid>
          <StatTile value={formatKopecks(s.availableKopecks)} label="доступно к выводу" />
          <StatTile value={formatKopecks(s.pendingKopecks)} label="ожидает" />
          <StatTile value={formatKopecks(s.reservedKopecks)} label="в заявках на вывод" />
          <StatTile value={formatKopecks(s.paidOutKopecks)} label="выплачено" />
        </StatGrid>
        <Text variant="caption" muted>
          Комиссия сервиса {s.commissionPercent}%. Заявки на вывод создаются на сайте: для них нужны реквизиты и подтверждение.
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
                {w.decidedReason ? <Text variant="caption">{w.decidedReason}</Text> : null}
              </Card>
            ))}
          </>
        ) : null}
      </Screen>
    </>
  );
}
