import { router } from "expo-router";
import { useState } from "react";
import { forgotPassword } from "@/api/auth";
import { looksLikeEmail, toFormError } from "@/lib/formError";
import { Button } from "@/ui/Button";
import { LinkText } from "@/ui/LinkText";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function submit() {
    if (!looksLikeEmail(email)) return setError("Введите email полностью, например name@example.com.");
    setBusy(true);
    setError(null);
    try {
      setSent(await forgotPassword(email.trim()));
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen centered>
      <Text variant="title">Восстановление пароля</Text>
      {sent ? (
        <>
          <Notice kind="success">{sent}</Notice>
          <Text muted>Ссылка в письме действует 30 минут. Скопируйте её и вставьте на следующем экране.</Text>
          <Button title="У меня есть ссылка из письма" onPress={() => router.replace("/reset-password")} />
        </>
      ) : (
        <>
          <Text muted>Укажите email аккаунта: мы пришлём ссылку для нового пароля.</Text>
          <TextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            onSubmitEditing={submit}
            error={error}
          />
          <Button title="Отправить ссылку" onPress={submit} loading={busy} />
        </>
      )}
      <LinkText style={{ textAlign: "center" }} onPress={() => router.replace("/login")}>
        Вернуться ко входу
      </LinkText>
    </Screen>
  );
}
