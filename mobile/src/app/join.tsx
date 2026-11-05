import { Stack, router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { applyViaInvite, previewInvite } from "@/api/teams";
import { toFormError } from "@/lib/formError";
import { extractToken } from "@/shared/lib/links";
import type { Team } from "@/shared/types/team";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Notice } from "@/ui/Notice";
import { PasteButton } from "@/ui/PasteButton";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

/** Joins a team by an invitation: the link the coach sent (or just its code). */
export default function JoinScreen() {
  const { invite = "" } = useLocalSearchParams<{ invite?: string }>();
  const [link, setLink] = useState(invite);
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"pending" | "joined" | null>(null);

  // The invitation link has the shape ".../?invite=<token>".
  const token = () => {
    const match = /[?&]invite=([^&#\s]+)/.exec(link);
    return match ? decodeURIComponent(match[1]!) : extractToken(link);
  };

  async function check() {
    if (!token()) return setError("Вставьте ссылку-приглашение.");
    setBusy(true);
    setError(null);
    try {
      setTeam(await previewInvite(token()));
    } catch (e) {
      setTeam(null);
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      setResult((await applyViaInvite(token())).status);
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: "Вступить в команду" }} />
      <Screen header>
        {result ? (
          <>
            <Text variant="title">{result === "joined" ? "Вы в команде" : "Заявка отправлена"}</Text>
            <Text muted>{result === "joined" ? "Команда появилась в вашем списке." : "Тренер рассмотрит заявку, мы сообщим о решении."}</Text>
            <Button title="К командам" onPress={() => router.replace("/teams")} />
          </>
        ) : (
          <>
            <Text muted>Вставьте ссылку-приглашение, которую прислал тренер.</Text>
            <TextField label="Ссылка-приглашение" value={link} onChangeText={setLink} autoCapitalize="none" autoCorrect={false} error={error} />
            <PasteButton onPaste={setLink} />
            {!team ? <Button title="Проверить" onPress={check} loading={busy} /> : null}
            {team ? (
              <>
                <Card>
                  <Text variant="heading">{team.name}</Text>
                  <Text muted>{[team.sport, team.ageCategory].filter(Boolean).join(" · ")}</Text>
                  {team.description ? <Text>{team.description}</Text> : null}
                </Card>
                <Button title="Подать заявку" onPress={apply} loading={busy} />
              </>
            ) : null}
            {error && team ? <Notice kind="danger">{error}</Notice> : null}
          </>
        )}
      </Screen>
    </>
  );
}
