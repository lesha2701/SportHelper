import { useState } from "react";
import { cancelAccountDeletion, requestAccountDeletion } from "@/api/auth";
import { useAuth } from "@/auth/AuthProvider";
import { toFormError } from "@/lib/formError";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ConfirmModal } from "@/ui/ConfirmModal";
import { Notice } from "@/ui/Notice";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { useToast } from "@/ui/Toast";

/** Requesting (with the password) or cancelling the deletion of the account. */
export function DeleteAccountCard() {
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

