import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { resetPassword } from "@/api/auth";
import { PASSWORD_MIN_LENGTH, toFormError } from "@/lib/formError";
import { extractToken } from "@/shared/lib/links";
import { Button } from "@/ui/Button";
import { LinkText } from "@/ui/LinkText";
import { Notice } from "@/ui/Notice";
import { PasteButton } from "@/ui/PasteButton";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

export default function ResetPasswordScreen() {
  const { token: tokenParam = "" } = useLocalSearchParams<{ token?: string }>();
  const [link, setLink] = useState(tokenParam);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ link?: string; password?: string; confirm?: string; form?: string }>({});
  const [done, setDone] = useState(false);

  async function submit() {
    const token = extractToken(link);
    const found: typeof errors = {};
    if (!token) found.link = "Вставьте ссылку из письма.";
    if ([...password].length < PASSWORD_MIN_LENGTH) found.password = `Пароль слишком короткий: минимум ${PASSWORD_MIN_LENGTH} символов.`;
    if (password !== confirm) found.confirm = "Пароли не совпадают.";
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      await resetPassword(token, password, confirm);
      setDone(true);
    } catch (e) {
      const failure = toFormError(e);
      if (failure.field === "password") setErrors({ password: failure.message });
      else setErrors({ form: failure.message });
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen centered>
        <Text variant="title">Пароль изменён</Text>
        <Text muted>Войдите с новым паролем.</Text>
        <Button title="Войти" onPress={() => router.replace("/login")} />
      </Screen>
    );
  }

  return (
    <Screen centered>
      <Text variant="title">Новый пароль</Text>
      {errors.form ? <Notice kind="danger">{errors.form}</Notice> : null}
      <TextField label="Ссылка из письма" value={link} onChangeText={setLink} autoCapitalize="none" autoCorrect={false} error={errors.link} />
      <PasteButton onPaste={setLink} />
      <TextField
        label={`Новый пароль (минимум ${PASSWORD_MIN_LENGTH} символов)`}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        error={errors.password}
      />
      <TextField label="Повторите пароль" value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" error={errors.confirm} />
      <Button title="Сохранить пароль" onPress={submit} loading={busy} />
      <LinkText style={{ textAlign: "center" }} onPress={() => router.replace("/login")}>
        Вернуться ко входу
      </LinkText>
    </Screen>
  );
}
