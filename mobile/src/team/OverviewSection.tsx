import { router } from "expo-router";
import { useState } from "react";
import { Share } from "react-native";
import { acceptApplication, createInvite, leaveTeam, listApplications, rejectApplication } from "@/api/teams";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { SKILL_LEVEL_LABELS } from "@/shared/types/profile";
import { TEAM_ROLE_LABELS, type Invite, type Team } from "@/shared/types/team";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ConfirmModal } from "@/ui/ConfirmModal";
import { Notice } from "@/ui/Notice";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";

function Applications({ team }: { team: Team }) {
  const apps = useLoad(() => listApplications(team.id), [team.id]);
  const toast = useToast();
  const pending = (apps.data ?? []).filter((a) => a.status === "pending");
  if (pending.length === 0) return null;

  async function decide(id: string, accept: boolean) {
    try {
      if (accept) await acceptApplication(team.id, id);
      else await rejectApplication(team.id, id);
      apps.reload();
    } catch (e) {
      toast.error(toFormError(e).message);
    }
  }

  return (
    <Card>
      <Text variant="heading">Заявки на вступление</Text>
      {pending.map((a) => (
        <Card key={a.id}>
          <Text variant="label">{[a.firstName, a.lastName].filter(Boolean).join(" ")}</Text>
          <Button title="Принять" onPress={() => void decide(a.id, true)} />
          <Button title="Отклонить" variant="secondary" onPress={() => void decide(a.id, false)} />
        </Card>
      ))}
    </Card>
  );
}

export function OverviewSection({ team, staff }: { team: Team; staff: boolean }) {
  const toast = useToast();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  async function makeInvite() {
    setError(null);
    try {
      setInvite(await createInvite(team.id, "join"));
    } catch (e) {
      setError(toFormError(e).message);
    }
  }

  async function leave() {
    setLeaving(false);
    try {
      await leaveTeam(team.id);
      router.replace("/teams");
    } catch (e) {
      toast.error(toFormError(e).message);
    }
  }

  return (
    <>
      <Card>
        <Text muted>{[team.sport, team.ageCategory, team.level ? SKILL_LEVEL_LABELS[team.level] : null].filter(Boolean).join(" · ")}</Text>
        {team.description ? <Text>{team.description}</Text> : null}
        {team.myRole ? <Text variant="caption">Ваша роль: {TEAM_ROLE_LABELS[team.myRole]}</Text> : null}
        {team.myRole === "head_coach" ? <Button title="Изменить данные команды" variant="secondary" onPress={() => router.push({ pathname: "/team/new", params: { id: team.id } })} /> : null}
      </Card>

      {staff ? (
        <>
          <Card>
            <Text variant="heading">Приглашение игроков</Text>
            <Text muted>Создайте ссылку и отправьте её игроку. Он вставит её в приложении в разделе «Вступить по приглашению».</Text>
            {error ? <Notice kind="danger">{error}</Notice> : null}
            {invite ? (
              <>
                <Text selectable variant="caption">
                  {invite.link}
                </Text>
                <Button title="Поделиться ссылкой" onPress={() => void Share.share({ message: invite.link })} />
              </>
            ) : null}
            <Button title={invite ? "Создать новую ссылку" : "Создать ссылку"} variant="secondary" onPress={makeInvite} />
          </Card>
          <Applications team={team} />
        </>
      ) : null}

      <Button title="Выйти из команды" variant="ghost" onPress={() => setLeaving(true)} />
      <ConfirmModal
        visible={leaving}
        title="Выйти из команды?"
        message="Вы больше не будете видеть тренировки и задания команды."
        confirmLabel="Выйти"
        destructive
        onCancel={() => setLeaving(false)}
        onConfirm={leave}
      />
    </>
  );
}
