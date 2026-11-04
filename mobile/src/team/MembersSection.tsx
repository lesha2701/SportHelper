import { useState } from "react";
import { listMembers, removeMember } from "@/api/teams";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import { TEAM_ROLE_LABELS, type Team, type TeamMember } from "@/shared/types/team";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ConfirmModal } from "@/ui/ConfirmModal";
import { ErrorView, LoadingView } from "@/ui/StateViews";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";

export function MembersSection({ team, staff }: { team: Team; staff: boolean }) {
  const members = useLoad(() => listMembers(team.id), [team.id]);
  const toast = useToast();
  const [removing, setRemoving] = useState<TeamMember | null>(null);

  if (members.loading && !members.data) return <LoadingView />;
  if (members.error && !members.data) return <ErrorView message={members.error} onRetry={members.reload} />;

  async function remove(member: TeamMember) {
    setRemoving(null);
    try {
      await removeMember(team.id, member.userId);
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
          {staff && m.role !== "head_coach" ? <Button title="Удалить из команды" variant="ghost" onPress={() => setRemoving(m)} /> : null}
        </Card>
      ))}
      <ConfirmModal
        visible={removing !== null}
        title="Удалить участника?"
        message={removing ? `${removing.firstName} потеряет доступ к команде.` : undefined}
        confirmLabel="Удалить"
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && void remove(removing)}
      />
    </>
  );
}
