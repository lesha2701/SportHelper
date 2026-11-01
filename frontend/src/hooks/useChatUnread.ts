import { useCallback, useEffect, useState } from "react";
import { getChatUnread } from "../api/chat";
import type { ChatUnread } from "../types/chat";

const EMPTY: ChatUnread = { booking: {}, team: {}, total: 0 };

/** Unread message counts per booking chat and team chat, for the badges on the buttons that open them. Refreshed every half minute
 * while the screen is open and whenever `refresh` is called (after a chat is closed). A failed request just keeps the last numbers. */
export function useChatUnread(token: string): { unread: ChatUnread; refresh: () => void } {
  const [unread, setUnread] = useState<ChatUnread>(EMPTY);
  const refresh = useCallback(() => {
    getChatUnread(token)
      .then(setUnread)
      .catch(() => undefined);
  }, [token]);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);
  return { unread, refresh };
}
