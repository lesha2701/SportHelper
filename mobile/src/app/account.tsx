import { Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { cancelAccountDeletion, changeEmail, changePassword, listSessions, requestAccountDeletion, revokeSession } from "@/api/auth";
import { useAuth } from "@/auth/AuthProvider";
import { looksLikeEmail, PASSWORD_MIN_LENGTH, toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ConfirmModal } from "@/ui/ConfirmModal";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";

function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string; form?: string }>({});
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const found: typeof errors = {};
    if (!current) found.current = "Введите текущий пароль.";
    if ([...next].length < PASSWORD_MIN_LENGTH) found.next = `Пароль слишком короткий: минимум ${PASSWORD_MIN_LENGTH} символов.`;
    if (next !== confirm) found.confirm = "Пароли не совпадают.";
    setErrors(found);
    setDone(null);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      setDone(await changePassword(current, next, confirm));
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (e) {
      const failure = toFormError(e);
      if (failure.field === "password" || failure.code === "invalid_password") setErrors({ current: failure.message });
      else setErrors({ form: failure.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Text variant="heading">Сменить пароль</Text>
      {errors.form ? <Notice kind="danger">{errors.form}</Notice> : null}
      {done ? <Notice kind="success">{done}</Notice> : null}
      <TextField label="Текущий пароль" value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" error={errors.current} />
      <TextField label={`Новый пароль (минимум ${PASSWORD_MIN_LENGTH} символов)`} value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" error={errors.next} />
      <TextField label="Повторите новый пароль" value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" error={errors.confirm} />
      <Button title="Сменить пароль" variant="secondary" onPress={submit} loading={busy} />
    </Card>
  );
}

function EmailSection() {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const found: typeof errors = {};
    if (!looksLikeEmail(email)) found.email = "Введите email полностью, например name@example.com.";
    if (!password) found.password = "Введите пароль для подтверждения.";
    setErrors(found);
    setDone(null);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      setDone(await changeEmail(email.trim(), password));
      setPassword("");
    } catch (e) {
      const failure = toFormError(e);
      if (failure.field === "password") setErrors({ password: failure.message });
      else if (failure.field === "new_email") setErrors({ email: failure.message });
      else setErrors({ form: failure.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Text variant="heading">Сменить email</Text>
      <Text muted>Сейчас: {user?.email}. Мы отправим письмо со ссылкой на новый адрес; пока вы её не откроете, вход остаётся по старому.</Text>
      {errors.form ? <Notice kind="danger">{errors.form}</Notice> : null}
      {done ? <Notice kind="success">{done}</Notice> : null}
      <TextField label="Новый email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" error={errors.email} />
      <TextField label="Пароль" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" error={errors.password} />
      <Button title="Отправить письмо" variant="secondary" onPress={submit} loading={busy} />
    </Card>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function SessionsSection() {
  const toast = useToast();
  const sessions = useLoad(listSessions);
  const [revoking, setRevoking] = useState<string | null>(null);

  async function revoke(id: string) {
    setRevoking(null);
    try {
      await revokeSession(id);
      sessions.reload();
    } catch (e) {
      toast.error(toFormError(e).message);
    }
  }

  return (
    <Card>
      <Text variant="heading">Где выполнен вход</Text>
      {sessions.error && !sessions.data ? <Notice kind="danger">{sessions.error}</Notice> : null}
      {sessions.data?.map((s) => (
        <View key={s.id} style={{ gap: 4 }}>
          <Text variant="label">
            {s.device}
            {s.current ? " · это устройство" : ""}
          </Text>
          <Text variant="caption" muted>
            Последняя активность: {when(s.lastSeenAt)}
            {s.ipAddress ? ` · ${s.ipAddress}` : ""}
          </Text>
          {!s.current ? <Button title="Завершить сессию" variant="ghost" onPress={() => setRevoking(s.id)} /> : null}
        </View>
      ))}
      <ConfirmModal
        visible={revoking !== null}
        title="Завершить сессию?"
        message="На том устройстве придётся войти заново."
        confirmLabel="Завершить"
        destructive
        onCancel={() => setRevoking(null)}
        onConfirm={() => revoking && void revoke(revoking)}
      />
    </Card>
  );
}

function DeleteSection() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scheduled = user?.deletionRequestedAt;

  async function request() {
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      toast.success(await requestAccountDeletion(password));
      setPassword("");
      await refreshUser();
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    try {
      await cancelAccountDeletion();
      await refreshUser();
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <Text variant="heading">Удаление аккаунта</Text>
      {scheduled ? (
        <>
          <Notice>Удаление запланировано. До срока его можно отменить, и аккаунт останется как был.</Notice>
          {error ? <Notice kind="danger">{error}</Notice> : null}
          <Button title="Отменить удаление" onPress={cancel} loading={busy} />
        </>
      ) : (
        <>
          <Text muted>Аккаунт и данные будут удалены после льготного срока; до его конца удаление можно отменить. Для подтверждения нужен пароль.</Text>
          {error ? <Notice kind="danger">{error}</Notice> : null}
          <TextField
            label="Пароль"
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setError(null);
            }}
            secureTextEntry
            autoCapitalize="none"
          />
          <Button title="Удалить аккаунт" variant="danger" onPress={() => (password ? setConfirming(true) : setError("Введите пароль для подтверждения."))} loading={busy} />
        </>
      )}
      <ConfirmModal
        visible={confirming}
        title="Удалить аккаунт?"
        message="Вы выйдете из приложения. Удаление можно отменить, пока не истёк льготный срок."
        confirmLabel="Удалить"
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => void request()}
      />
    </Card>
  );
}

/** Account security: password, email, where the account is signed in, and deletion. */
export default function AccountScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Аккаунт и безопасность" }} />
      <Screen header>
        <PasswordSection />
        <EmailSection />
        <SessionsSection />
        <DeleteSection />
      </Screen>
    </>
  );
}
