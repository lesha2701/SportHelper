import { bookingHasChat } from "../../types/chat";
import { Icon } from "../shared/Icon";
import styles from "./chat.module.css";
import profileStyles from "../profile/profile.module.css";

/** «Чат» on a booking card: only for a confirmed lesson that is paid (or free), exactly when the server would open the chat.
 * Sits inside cards that open the training on click, so the click is kept to itself. */
export function BookingChatButton({
  booking,
  label,
  unread,
  onOpen,
}: {
  booking: { status: string; paymentStatus: string };
  label: string;
  unread: number;
  onOpen: () => void;
}) {
  if (!bookingHasChat(booking)) return null;
  return (
    <button
      type="button"
      className={profileStyles.buttonSecondary}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
    >
      <Icon name="message" size={16} /> {label}
      {unread > 0 && <span className={styles.badge} aria-label={`Непрочитанных: ${unread}`}>{unread > 9 ? "9+" : unread}</span>}
    </button>
  );
}
