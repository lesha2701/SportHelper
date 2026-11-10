import { useState } from "react";
import { listMembers, transferOwnership } from "@/api/teams";
import { toFormError } from "@/lib/formError";
import { useLoad } from "@/lib/useLoad";
import type { Team } from "@/shared/types/team";
import { BottomSheet } from "@/ui/BottomSheet";
import { Button } from "@/ui/Button";
import { Choice } from "@/ui/Choice";
import { Notice } from "@/ui/Notice";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

/** The head coach hands the team over to another member, confirmed by typing the exact phrase (as on the website). */
export function TransferOwnership({ team, visible, onClose, onDone }: { team: Team; visible: boolean; onClose: () => void; onDone: () => void }) {
  const members = useLoad(async () => (visible ? (await listMembers(team.id)).filter((m) => m.role !== "head_coach") : []), [team.id, visible]);
  const [selected, setSelected] = useState<string | null>(null);
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const candidates = members.data ?? [];
  const chosen = candidates.find((c) => c.userId === selected) ?? candidates[0];
  const expected = chosen ? `Я передаю роль главного тренера команды «${team.name}» пользователю ${chosen.firstName} ${chosen.lastName ?? ""}`.trim() : "";

  async function submit() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await transferOwnership(team.id, chosen.userId, phrase);
      setPhrase("");
      onDone();
    } catch (e) {
      setError(toFormError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet visible={visible} title="Передать роль главного тренера" onClose={onClose}>
      {members.loading ? <Text muted>Загрузка участников…</Text> : null}
      {!members.loading && candidates.length === 0 ? <Text muted>В команде пока нет других участников — некому передать роль.</Text> : null}
      {chosen ? (
        <>
          <Choice
            label="Кому передать"
            options={candidates.map((c) => ({ value: c.userId, title: [c.firstName, c.lastName].filter(Boolean).join(" ") }))}
            value={chosen.userId}
            onChange={(v) => {
              setSelected(v);
              setPhrase("");
            }}
          />
          <Text muted>Вы станете обычным участником. Чтобы подтвердить, введите точно эту фразу:</Text>
          <Text selectable variant="label">
            «{expected}»
          </Text>
          <TextField label="Фраза подтверждения" value={phrase} onChangeText={setPhrase} multiline numberOfLines={3} />
          {error ? <Notice kind="danger">{error}</Notice> : null}
          <Button title="Передать роль" onPress={submit} loading={busy} disabled={phrase.trim() !== expected} />
        </>
      ) : null}
      <Button title="Отмена" variant="ghost" onPress={onClose} />
    </BottomSheet>
  );
}
