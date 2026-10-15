import { useCallback, useEffect, useState } from "react";
import { acceptApplication, listApplications, rejectApplication } from "../../api/teams";
import { ApiError } from "../../api/client";
import { toast } from "../../toast";
import type { JoinRequest } from "../../types/team";

export interface ApplicationsState {
  applications: JoinRequest[];
  loading: boolean;
  error: string | null;
  busyId: string | null;
  accept: (requestId: string) => Promise<void>;
  reject: (requestId: string) => Promise<void>;
}

/** Pending join requests of a team. They are loaded up front (not when a panel is opened) so the
 * number can be shown on the collapsed "invitations" header. `onAccepted` refreshes the roster. */
export function useApplications(token: string, teamId: string, enabled: boolean, onAccepted: () => void): ApplicationsState {
  const [applications, setApplications] = useState<JoinRequest[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setApplications([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listApplications(token, teamId)
      .then((list) => {
        if (!cancelled) setApplications(list);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Не удалось загрузить заявки");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, teamId, enabled]);

  const accept = useCallback(
    async (requestId: string) => {
      setBusyId(requestId);
      setError(null);
      try {
        await acceptApplication(token, teamId, requestId);
        setApplications((prev) => prev.filter((a) => a.id !== requestId));
        toast.success("Игрок добавлен в команду");
        onAccepted();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Не удалось принять заявку");
      } finally {
        setBusyId(null);
      }
    },
    [token, teamId, onAccepted],
  );

  const reject = useCallback(
    async (requestId: string) => {
      setBusyId(requestId);
      setError(null);
      try {
        await rejectApplication(token, teamId, requestId);
        setApplications((prev) => prev.filter((a) => a.id !== requestId));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Не удалось отклонить заявку");
      } finally {
        setBusyId(null);
      }
    },
    [token, teamId],
  );

  return { applications, loading, error, busyId, accept, reject };
}
