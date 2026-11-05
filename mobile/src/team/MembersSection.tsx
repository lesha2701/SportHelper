import { useState } from "react";
import { blockMember, listMembers, removeMember, updateMember } from "@/api/teams";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { TEAM_ROLE_LABELS, type Team, type TeamMember, type TeamRole } from "@/shared/types/team";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Choice } from "@/ui/Choice";
import { ConfirmModal } from "@/ui/ConfirmModal";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";

const ASSIGNABLE: TeamRole[] = ["assistant_coach", "captain", "player"];

export function MembersSection({ team, staff }: { team: Team; staff: boolean }) {
  const members = useLoad(() => listMembers(team.id), [team.id]);
  const toast = useToast();
  const [action, setAction] = useState<{ member: TeamMember; kind: "remove" | "block" } | null>(null);
  const head = team.myRole === "head_coach";

  if (members.loading && !members.data) return <LoadingView />;
  if (members.error && !members.data) return <ErrorView message={members.error} onRetry={members.reload} />;

  async function run(member: TeamMember, kind: "remove" | "block") {
    setAction(null);
    try {
      if (kind === "remove") await removeMember(team.id, member.userId);
      else await blockMember(team.id, member.userId);
      members.reload();
    } catch (e) {
      toast.error(toFormError(e).message);
    }
  }

  async function changeRole(member: TeamMember, role: TeamRole) {
    try {
      await updateMember(team.id, member.userId, { role });
      members.reload();
    } catch (e) {
      toast.error(toFormError(e).message);
    }
  }

  return (
    <>
      {members.data?.map((m) => (
        <Card key={m.userId}>
          <Text variant="label">{[m.firstName, m.lastName].filter(Boolean).join(" ")}</Text>
          <Text muted>{[TEAM_ROLE_LABELS[m.role], m.position].filter(Boolean).join(" · ")}</Text>
          {head && m.role !== "head_coach" ? (
            <Choice
              label="Роль в команде"
              layout="chips"
              options={ASSIGNABLE.map((r) => ({ value: r, title: TEAM_ROLE_LABELS[r] }))}
              value={m.role}
              onChange={(role) => void changeRole(m, role)}
            />
          ) : null}
          {staff && m.role !== "head_coach" ? (
            <>
              <Button title="Удалить из команды" variant="ghost" onPress={() => setAction({ member: m, kind: "remove" })} />
              <Button title="Заблокировать" variant="ghost" onPress={() => setAction({ member: m, kind: "block" })} />
            </>
          ) : null}
        </Card>
      ))}
      <ConfirmModal
        visible={action !== null}
        title={action?.kind === "block" ? "Заблокировать участника?" : "Удалить участника?"}
        message={
          action ? (action.kind === "block" ? `${action.member.firstName} будет удалён и не сможет вернуться по приглашению.` : `${action.member.firstName} потеряет доступ к команде.`) : undefined
        }
        confirmLabel={action?.kind === "block" ? "Заблокировать" : "Удалить"}
        destructive
        onCancel={() => setAction(null)}
        onConfirm={() => action && void run(action.member, action.kind)}
      />
    </>
  );
}
