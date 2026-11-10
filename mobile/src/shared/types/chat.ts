export type ChatTarget = { kind: "booking" | "team"; id: string };

export interface ChatConversation {
  id: string;
  kind: "booking" | "team";
  bookingId: string | null;
  teamId: string | null;
  title: string;
  subtitle: string | null;
  canSend: boolean;
  sendBlockedReason: string | null;
  /** May delete other people's messages (a team's head or assistant coach). */
  canModerate: boolean;
}

export interface ChatConversationDto {
  id: string;
  kind: "booking" | "team";
  booking_id: string | null;
  team_id: string | null;
  title: string;
  subtitle: string | null;
  can_send: boolean;
  send_blocked_reason: string | null;
  can_moderate: boolean;
}

export function mapConversationDto(dto: ChatConversationDto): ChatConversation {
  return {
    id: dto.id,
    kind: dto.kind,
    bookingId: dto.booking_id,
    teamId: dto.team_id,
    title: dto.title,
    subtitle: dto.subtitle,
    canSend: dto.can_send,
    sendBlockedReason: dto.send_blocked_reason,
    canModerate: dto.can_moderate,
  };
}

export interface ChatAttachment {
  kind: "photo" | "video";
  fileId: string;
  filename: string;
  hasThumb: boolean;
}

export interface ChatMessage {
  id: number;
  senderId: string;
  senderName: string;
  body: string | null;
  attachment: ChatAttachment | null;
  createdAt: string;
  deleted: boolean;
}

export interface ChatMessageDto {
  id: number;
  sender_id: string;
  sender_name: string;
  body: string | null;
  attachment: { kind: "photo" | "video"; file_id: string; filename: string; has_thumb: boolean } | null;
  created_at: string;
  deleted: boolean;
}

export function mapMessageDto(dto: ChatMessageDto): ChatMessage {
  return {
    id: dto.id,
    senderId: dto.sender_id,
    senderName: dto.sender_name,
    body: dto.body,
    attachment: dto.attachment ? { kind: dto.attachment.kind, fileId: dto.attachment.file_id, filename: dto.attachment.filename, hasThumb: dto.attachment.has_thumb } : null,
    createdAt: dto.created_at,
    deleted: dto.deleted,
  };
}

export interface ChatUnread {
  booking: Record<string, number>;
  team: Record<string, number>;
  total: number;
}

export const MAX_MESSAGE_CHARS = 2000;

/** The personal-training chat is for a confirmed lesson that is paid (or free): the same rule the server applies. */
export function bookingHasChat(booking: { status: string; paymentStatus: string }): boolean {
  return booking.status === "confirmed" && ["paid", "refund_pending", "not_required"].includes(booking.paymentStatus);
}
