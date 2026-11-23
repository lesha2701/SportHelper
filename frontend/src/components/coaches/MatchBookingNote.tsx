import profileStyles from "../profile/profile.module.css";

/** «Подобрать тренера»: what each side is told about the first session with a client the platform brought. The trainer: who is hidden
 * and what the platform keeps. The athlete: that this session is paid in the app (and that this is what opens the chat). */
export function MatchBookingNote({
  side,
  fromMatch,
  hidden = false,
  percent = null,
  paid = false,
}: {
  side: "coach" | "athlete";
  fromMatch: boolean;
  hidden?: boolean;
  percent?: number | null;
  paid?: boolean;
}) {
  if (!fromMatch && !hidden) return null;
  const share = percent !== null ? ` Платформа удерживает ${percent}% с этой тренировки (обычная комиссия за неё не берётся).` : "";
  let text: string;
  if (side === "athlete") {
    if (paid) return null;
    text = "Первая тренировка с этим тренером из подбора оплачивается в приложении. После оплаты откроется чат с тренером.";
  } else if (hidden) {
    text = `Клиент из подбора: имя и контакты откроются после оплаты первой тренировки в приложении.${share}`;
  } else {
    text = `Клиент из подбора.${share}`;
  }
  return <p className={profileStyles.subtitle}>{text}</p>;
}
