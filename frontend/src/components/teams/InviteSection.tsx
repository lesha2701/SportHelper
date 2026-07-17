import { useEffect, useState } from "react";
import { createInvite, listInvites } from "../../api/teams";
import { ApiError } from "../../api/client";
import type { Invite, InviteKind } from "../../types/team";
import profileStyles from "../profile/profile.module.css";
import styles from "./teams.module.css";

interface InviteSectionProps {
  token: string;
  teamId: string;
  kind: InviteKind;
  title: string;
}

function formatExpiry(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function InviteSection({ token, teamId, kind, title }: InviteSectionProps) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listInvites(token, teamId)
      .then((list) => {
        if (!cancelled) setInvites(list.filter((i) => i.kind === kind));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Не удалось загрузить приглашения");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, teamId, kind]);

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const invite = await createInvite(token, teamId, kind);
      setInvites((prev) => [invite, ...prev]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось создать приглашение");
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async (invite: Invite) => {
    try {
      await navigator.clipboard.writeText(invite.link);
      setCopiedToken(invite.token);
      setTimeout(() => setCopiedToken(null), 1500);
    } catch {
      // Clipboard access can fail outside a secure/user-gesture context; the
      // link is still shown on screen so the user can copy it manually.
    }
  };

  return (
    <div className={profileStyles.card}>
      <h2 className={profileStyles.title}>{title}</h2>
      {loading && <p className={profileStyles.subtitle}>Загрузка…</p>}
      {error && <p className={profileStyles.error}>{error}</p>}

      {!loading &&
        invites.map((invite) => (
          <div key={invite.id} className={styles.inviteBox}>
            <span className={styles.inviteLink}>{invite.link}</span>
            <span className={styles.inviteExpiry}>Действует до {formatExpiry(invite.expiresAt)}</span>
            <button type="button" className={styles.iconButton} onClick={() => void handleCopy(invite)}>
              {copiedToken === invite.token ? "Скопировано" : "Скопировать ссылку"}
            </button>
          </div>
        ))}

      <button type="button" className={profileStyles.buttonSecondary} onClick={() => void handleCreate()} disabled={creating}>
        {creating ? "Создание…" : "Создать новую ссылку"}
      </button>
    </div>
  );
}
