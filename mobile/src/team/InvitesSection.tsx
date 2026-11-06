import { useState } from "react";
import { Share, View } from "react-native";
import { acceptApplication, createInvite, listApplications, listInvites, rejectApplication } from "@/api/teams";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import type { Invite, Team } from "@/shared/types/team";
import { Avatar } from "@/ui/Avatar";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Notice } from "@/ui/Notice";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";

/** For the team's staff: an invitation link to send to players, and the requests to join. */
export function InvitesSection({ team }: { team: Team }) {
  const toast = useToast();
  const apps = useLoad(() => listApplications(team.id), [team.id]);
  const links = useLoad(async () => (await listInvites(team.id)).filter((i) => i.kind === "join" && new Date(i.expiresAt).getTime() > Date.now()), [team.id]);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = (apps.data ?? []).filter((a) => a.status === "pending");

  async function makeInvite() {
    setError(null);
    try {
      setInvite(await createInvite(team.id, "join"));
      links.reload();
    } catch (e) {
      setError(toFormError(e).message);
    }
  }

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
    <>
      <Card>
        <Text variant="heading">Ссылка-приглашение</Text>
        <Text muted>Отправьте ссылку игроку: он вставит её в приложении в разделе «Команды» → «Вступить по приглашению».</Text>
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

      {(links.data ?? []).filter((l) => l.id !== invite?.id).length > 0 ? (
        <Card>
          <Text variant="heading">Действующие ссылки</Text>
          {(links.data ?? [])
            .filter((l) => l.id !== invite?.id)
            .map((l) => (
              <View key={l.id} style={{ gap: 4 }}>
                <Text selectable variant="caption">
                  {l.link}
                </Text>
                <Text variant="caption" muted>
                  Действует до {new Date(l.expiresAt).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </Text>
                <Button title="Поделиться" variant="ghost" onPress={() => void Share.share({ message: l.link })} />
              </View>
            ))}
        </Card>
      ) : null}

      <Text variant="heading">Заявки на вступление</Text>
      {pending.length === 0 ? <Text muted>Новых заявок нет.</Text> : null}
      {pending.map((a) => {
        const name = [a.firstName, a.lastName].filter(Boolean).join(" ");
        return (
          <Card key={a.id}>
            <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
              <Avatar name={name} size={40} />
              <Text variant="label" style={{ flex: 1, fontSize: 15 }}>
                {name}
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Button title="Принять" onPress={() => void decide(a.id, true)} style={{ flex: 1 }} />
              <Button title="Отклонить" variant="secondary" onPress={() => void decide(a.id, false)} style={{ flex: 1 }} />
            </View>
          </Card>
        );
      })}
    </>
  );
}
