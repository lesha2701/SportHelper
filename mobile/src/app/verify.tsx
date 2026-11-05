import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { verifyEmail } from "@/api/auth";
import { useAuth } from "@/auth/AuthProvider";
import { toFormError } from "@/lib/formError";
import { extractToken } from "@/shared/lib/links";
import { Button } from "@/ui/Button";
import { LinkText } from "@/ui/LinkText";
import { Notice } from "@/ui/Notice";
import { PasteButton } from "@/ui/PasteButton";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

/** Confirms the address: the link (or token) from the email plus the registration password; then the person is signed in. */
export default function VerifyScreen() {
  const { token: tokenParam = "" } = useLocalSearchParams<{ token?: string }>();
  const { applySession } = useAuth();
  const [link, setLink] = useState(tokenParam);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: "link" | "password" | null; text: string; code?: string | null } | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  async function submit() {
    const token = extractToken(link);
    if (!token) return setError({ field: "link", text: "Вставьте ссылку из письма." });
    if (!password) return setError({ field: "password", text: "Введите пароль, указанный при регистрации." });
    setBusy(true);
    setError(null);
    try {
      const result = await verifyEmail(token, password);
      if (result.session) await applySession(result.session);
      else setConfirmed(true);
    } catch (e) {
      const failure = toFormError(e);
      setError({ field: failure.field === "password" ? "password" : null, text: failure.message, code: failure.code });
    } finally {
      setBusy(false);
    }
  }

  if (confirmed) {
    return (
      <Screen centered>
        <Text variant="title">Адрес подтверждён</Text>
        <Text muted>Теперь можно войти.</Text>
        <Button title="Войти" onPress={() => router.replace("/login")} />
      </Screen>
    );
  }

  return (
    <Screen centered>
      <Text variant="title">Подтверждение email</Text>
      <Text muted>Вставьте ссылку из письма и введите пароль, который вы указали при регистрации.</Text>
      {error && !error.field ? <Notice kind="danger">{error.text}</Notice> : null}
      <TextField
        label="Ссылка из письма"
        value={link}
        onChangeText={setLink}
        autoCapitalize="none"
        autoCorrect={false}
        error={error?.field === "link" ? error.text : null}
      />
      <PasteButton onPaste={setLink} />
      <TextField
        label="Пароль"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        onSubmitEditing={submit}
        error={error?.field === "password" ? error.text : null}
      />
      {error?.code === "password_mismatch" ? (
        <Notice>Забыли пароль? Откройте ссылку из письма в браузере: на сайте можно задать новый пароль, а потом войти в приложении.</Notice>
      ) : null}
      <Button title="Подтвердить" onPress={submit} loading={busy} />
      <LinkText style={{ textAlign: "center" }} onPress={() => router.replace("/login")}>
        Вернуться ко входу
      </LinkText>
    </Screen>
  );
}
