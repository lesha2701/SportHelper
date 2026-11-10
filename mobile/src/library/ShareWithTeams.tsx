import { useState } from "react";
import { listMyTeams } from "@/api/teams";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { Card } from "@/ui/Card";
import { Notice } from "@/ui/Notice";
import { SwitchRow } from "@/ui/SwitchRow";
import { Text } from "@/ui/Text";

/** «Доступно командам» (as on the website): which of my coached teams see this exercise or plan. */
export function ShareWithTeams({
  sharedTeamIds,
  share,
  unshare,
  what,
}: {
  sharedTeamIds: string[];
  share: (teamId: string) => Promise<{ sharedTeamIds: string[] }>;
  unshare: (teamId: string) => Promise<{ sharedTeamIds: string[] }>;
  what: string;
}) {
  const teams = useLoad(async () => (await listMyTeams()).filter((t) => t.myRole === "head_coach" || t.myRole === "assistant_coach"));
  const [shared, setShared] = useState(sharedTeamIds);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!teams.data || teams.data.length === 0) return null;

  async function toggle(teamId: string, on: boolean) {
    setBusy(teamId);
    setError(null);
    try {
      setShared((on ? await share(teamId) : await unshare(teamId)).sharedTeamIds);
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <Text variant="heading">Доступно командам</Text>
      <Text variant="caption" muted>
        Помощники тренера и игроки этих команд увидят {what}.
      </Text>
      {teams.data.map((t) => (
        <SwitchRow key={t.id} label={t.name} value={shared.includes(t.id)} onChange={(on) => busy === null && void toggle(t.id, on)} />
      ))}
      {error ? <Notice kind="danger">{error}</Notice> : null}
    </Card>
  );
}
