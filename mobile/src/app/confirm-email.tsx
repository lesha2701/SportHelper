import { Stack, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { confirmEmailChange } from "@/api/auth";
import { useAuth } from "@/auth/AuthProvider";
import { toFormError } from "@/lib/formError";
import { extractToken } from "@/shared/lib/links";
import { Button } from "@/ui/Button";
import { Notice } from "@/ui/Notice";
import { PasteButton } from "@/ui/PasteButton";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

/** Confirms a new email address with the link from the letter sent to it (as the website's /confirm-email-change). */
export default function ConfirmEmailScreen() {
  const { token: tokenParam = "" } = useLocalSearchParams<{ token?: string }>();
  const { status, refreshUser } = useAuth();
  const [link, setLink] = useState(tokenParam);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit() {
    const token = extractToken(link);
    if (!token) return setError("Вставьте ссылку из письма.");
    setBusy(true);
    setError(null);
    try {
      const { email } = await confirmEmailChange(token);
      setDone(email ? `Готово: теперь вы входите с адресом ${email}.` : "Готово: новый адрес подтверждён.");
      if (status === "signedIn") await refreshUser();
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Подтверждение почты" }} />
      <Screen header>
        <Text muted>Мы отправили письмо на новый адрес. Скопируйте ссылку из него и вставьте сюда — после этого вход будет по новой почте.</Text>
        {done ? <Notice kind="success">{done}</Notice> : null}
        {error ? <Notice kind="danger">{error}</Notice> : null}
        {!done ? (
          <>
            <TextField label="Ссылка из письма" value={link} onChangeText={setLink} autoCapitalize="none" autoCorrect={false} />
            <PasteButton onPaste={setLink} />
            <Button title="Подтвердить" onPress={submit} loading={busy} />
          </>
        ) : (
          <Button title="Готово" onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
        )}
      </Screen>
    </>
  );
}
