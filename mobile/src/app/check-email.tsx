import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { resendVerification } from "@/api/auth";
import { toFormError } from "@/lib/formError";
import { useCooldown } from "@/lib/useCooldown";
import { Button } from "@/ui/Button";
import { LinkText } from "@/ui/LinkText";
import { Notice } from "@/ui/Notice";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

export default function CheckEmailScreen() {
  const { email = "" } = useLocalSearchParams<{ email?: string }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "danger"; text: string } | null>(null);
  const { remaining, start } = useCooldown(60);

  async function resend() {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ kind: "success", text: await resendVerification(email) });
      start();
    } catch (error) {
      setMessage({ kind: "danger", text: toFormError(error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen centered>
      <Text variant="title">Проверьте почту</Text>
      <Text>
        Мы отправили письмо со ссылкой для подтверждения на <Text variant="label">{email}</Text>. Откройте письмо и подтвердите адрес.
      </Text>
      <Text muted>
        Нажмите в письме на ссылку и скопируйте её (удерживайте палец на ссылке и выберите «Копировать адрес»). Затем нажмите кнопку ниже и вставьте её.
      </Text>
      <Text variant="caption" muted>
        Можно и проще: откройте ссылку в браузере, подтвердите адрес на сайте и потом просто войдите в приложении.
      </Text>
      <Button title="У меня есть ссылка из письма" onPress={() => router.push("/verify")} />
      {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}
      <Button
        title={remaining > 0 ? `Отправить ещё раз (${remaining})` : "Отправить письмо ещё раз"}
        variant="secondary"
        onPress={resend}
        loading={busy}
        disabled={remaining > 0 || !email}
      />
      <LinkText style={{ textAlign: "center" }} onPress={() => router.replace("/login")}>
        Вернуться ко входу
      </LinkText>
    </Screen>
  );
}
