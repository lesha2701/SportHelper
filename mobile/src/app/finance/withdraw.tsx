import { Stack, router } from "expo-router";
import { useState } from "react";
import { getFinanceSummary, requestWithdrawal } from "@/api/finance";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { uuid } from "@/lib/uuid";
import { formatKopecks, parseRubles } from "@/shared/lib/money";
import { PAYOUT_METHOD_LABELS, type PayoutMethod } from "@/shared/types/finance";
import { Button } from "@/ui/Button";
import { Choice } from "@/ui/Choice";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";

type Field = { key: string; label: string; placeholder?: string; keyboard?: "phone-pad" | "number-pad"; optional?: boolean };

const FIELDS: Record<PayoutMethod, Field[]> = {
  sbp: [
    { key: "phone", label: "Номер телефона", placeholder: "+7 9XX XXX-XX-XX", keyboard: "phone-pad" },
    { key: "bank", label: "Банк получателя", placeholder: "Например, Сбербанк" },
    { key: "recipient", label: "Получатель (ФИО)" },
  ],
  bank_transfer: [
    { key: "recipient", label: "Получатель (ФИО или название ИП)" },
    { key: "bank", label: "Банк получателя" },
    { key: "bik", label: "БИК (9 цифр)", keyboard: "number-pad" },
    { key: "account", label: "Расчётный счёт (20 цифр)", keyboard: "number-pad" },
    { key: "inn", label: "ИНН (по желанию)", keyboard: "number-pad", optional: true },
  ],
};

const METHODS = (Object.keys(PAYOUT_METHOD_LABELS) as PayoutMethod[]).map((m) => ({ value: m, title: PAYOUT_METHOD_LABELS[m] }));

/** The payout request (as on the website): amount, where to send it (SBP or bank details), confirmed with the password. */
export default function WithdrawScreen() {
  const toast = useToast();
  const summary = useLoad(getFinanceSummary);
  const [clientKey] = useState(uuid);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayoutMethod>("sbp");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: string | null; message: string } | null>(null);

  if (summary.loading && !summary.data) return <LoadingView />;
  if (summary.error || !summary.data) return <ErrorView message={summary.error ?? "Нет данных"} onRetry={summary.reload} />;
  const s = summary.data;
  const errorOf = (field: string) => (error?.field === field ? error.message : undefined);

  async function submit() {
    const kopecks = parseRubles(amount);
    if (kopecks === null) return setError({ field: "amount", message: "Укажите сумму в рублях, не больше двух знаков после запятой." });
    if (kopecks < s.minimumWithdrawalKopecks) return setError({ field: "amount", message: `Минимальная сумма вывода — ${formatKopecks(s.minimumWithdrawalKopecks)}.` });
    if (kopecks > s.availableKopecks) return setError({ field: "amount", message: "Нельзя вывести больше, чем доступно." });
    const details: Record<string, string> = {};
    for (const f of FIELDS[method]) {
      const value = (fields[f.key] ?? "").trim();
      if (value) details[f.key] = value;
      else if (!f.optional) return setError({ field: f.key, message: "Заполните поле." });
    }
    if (!password) return setError({ field: "password", message: "Введите пароль от аккаунта." });
    setBusy(true);
    setError(null);
    try {
      await requestWithdrawal({ amountKopecks: kopecks, method, details, clientKey, password });
      toast.success("Заявка на вывод создана");
      router.back();
    } catch (e) {
      const failure = toFormError(e);
      setError({ field: failure.field ?? null, message: failure.message });
    } finally {
      setBusy(false);
    }
  }

  const known = ["amount", "password", ...FIELDS[method].map((f) => f.key)];
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Заявка на вывод" }} />
      <Screen header>
        <Text muted>Укажите, куда перевести деньги. Номер банковской карты не нужен и не принимается — используйте СБП или банковские реквизиты.</Text>
        <TextField label={`Сумма, ₽ (доступно ${formatKopecks(s.availableKopecks)})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" error={errorOf("amount")} />
        <Choice
          label="Способ получения"
          options={METHODS}
          value={method}
          onChange={(m) => {
            setMethod(m);
            setError(null);
          }}
        />
        {FIELDS[method].map((f) => (
          <TextField
            key={`${method}-${f.key}`}
            label={f.label}
            placeholder={f.placeholder}
            keyboardType={f.keyboard}
            value={fields[f.key] ?? ""}
            onChangeText={(v) => setFields((prev) => ({ ...prev, [f.key]: v }))}
            error={errorOf(f.key)}
            autoComplete="off"
          />
        ))}
        <TextField label="Пароль от аккаунта (для подтверждения)" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" error={errorOf("password")} />
        {error && !(error.field && known.includes(error.field)) ? <Notice kind="danger">{error.message}</Notice> : null}
        <Button title="Создать заявку" onPress={submit} loading={busy} />
      </Screen>
    </>
  );
}
