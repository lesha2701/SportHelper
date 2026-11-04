import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useAuth } from "@/auth/AuthProvider";
import { toFormError } from "@/lib/formError";
import { Button } from "@/ui/Button";
import { LinkText } from "@/ui/LinkText";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);

  async function submit() {
    if (busy) return;
    if (!email.trim() || !password) {
      setError("Введите email и пароль.");
      return;
    }
    setBusy(true);
    setError(null);
    setUnverified(false);
    try {
      await signIn(email, password);
    } catch (e) {
      const failure = toFormError(e);
      setError(failure.message);
      setUnverified(failure.code === "email_not_verified");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen centered>
      <Text variant="title">SportArena</Text>
      <Text muted>Войдите, чтобы продолжить</Text>
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="next"
      />
      <TextField
        label="Пароль"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
        error={error}
      />
      {unverified ? (
        <LinkText onPress={() => router.push({ pathname: "/check-email", params: { email: email.trim() } })}>
          Отправить письмо с подтверждением ещё раз
        </LinkText>
      ) : null}
      <Button title="Войти" onPress={submit} loading={busy} />
      <View style={styles.links}>
        <LinkText onPress={() => router.push("/forgot-password")}>Забыли пароль?</LinkText>
        <Text muted>
          Нет аккаунта? <LinkText onPress={() => router.push("/register")}>Зарегистрироваться</LinkText>
        </Text>
      </View>
      {unverified ? <Notice>Подтвердите email: мы отправили письмо со ссылкой при регистрации.</Notice> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  links: { gap: 12, alignItems: "center" },
});
