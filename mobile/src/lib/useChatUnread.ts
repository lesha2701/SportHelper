import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { getChatUnread } from "@/api/chat";
import type { ChatUnread } from "@/shared/types/chat";

const EMPTY: ChatUnread = { booking: {}, team: {}, total: 0 };

/** Unread message counts per booking chat and per team chat, for the badges on the buttons that open them. Refreshed
 * whenever the screen comes back in front (after a chat is closed) and every half minute while it stays. A failed request
 * keeps the last numbers. */
export function useChatUnread(): ChatUnread {
  const [unread, setUnread] = useState<ChatUnread>(EMPTY);
  const refresh = useCallback(() => {
    getChatUnread()
      .then(setUnread)
      .catch(() => undefined);
  }, []);
  useFocusEffect(refresh);
  useEffect(() => {
    const timer = setInterval(refresh, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);
  return unread;
}
