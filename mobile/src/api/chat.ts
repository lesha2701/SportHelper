import { apiRequest, apiUpload, type UploadFile } from "./client";
import {
  mapConversationDto,
  mapMessageDto,
  type ChatConversation,
  type ChatConversationDto,
  type ChatMessage,
  type ChatMessageDto,
  type ChatTarget,
  type ChatUnread,
} from "@/shared/types/chat";

/** Opens (and, for a paid lesson or a team, creates on first use) the chat. A booking that is not confirmed and paid answers 409 `chat_not_available`. */
export async function openChat(target: ChatTarget): Promise<ChatConversation> {
  const path = target.kind === "booking" ? `/api/chats/for-booking/${target.id}` : `/api/chats/for-team/${target.id}`;
  return mapConversationDto(await apiRequest<ChatConversationDto>(path, { silent: true }));
}

export async function getChat(conversationId: string): Promise<ChatConversation> {
  return mapConversationDto(await apiRequest<ChatConversationDto>(`/api/chats/${conversationId}`, { silent: true }));
}

export async function listChatMessages(
  conversationId: string,
  query: { beforeId?: number; afterId?: number; limit?: number } = {},
): Promise<{ items: ChatMessage[]; hasMoreBefore: boolean }> {
  const params = new URLSearchParams();
  if (query.beforeId !== undefined) params.set("before_id", String(query.beforeId));
  if (query.afterId !== undefined) params.set("after_id", String(query.afterId));
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const qs = params.toString();
  const dto = await apiRequest<{ items: ChatMessageDto[]; has_more_before: boolean }>(`/api/chats/${conversationId}/messages${qs ? `?${qs}` : ""}`, { silent: true });
  return { items: dto.items.map(mapMessageDto), hasMoreBefore: dto.has_more_before };
}

/** `clientKey` is made once per message: sending it again (a double tap, a retry after a lost answer) can only ever create one message. */
export async function sendChatMessage(conversationId: string, body: string, clientKey: string): Promise<ChatMessage> {
  const dto = await apiRequest<ChatMessageDto>(`/api/chats/${conversationId}/messages`, { method: "POST", body: { body, client_key: clientKey }, silent: true });
  return mapMessageDto(dto);
}

export async function sendChatMedia(conversationId: string, file: UploadFile, body: string, clientKey: string): Promise<ChatMessage> {
  const formData = new FormData();
  formData.append("file", file as unknown as Blob);
  formData.append("client_key", clientKey);
  if (body) formData.append("body", body);
  const dto = await apiUpload<ChatMessageDto>(`/api/chats/${conversationId}/messages/media`, { formData, silent: true });
  return mapMessageDto(dto);
}

export async function deleteChatMessage(conversationId: string, messageId: number): Promise<void> {
  await apiRequest(`/api/chats/${conversationId}/messages/${messageId}`, { method: "DELETE", silent: true });
}

export async function markChatRead(conversationId: string, upToId: number): Promise<void> {
  await apiRequest(`/api/chats/${conversationId}/read`, { method: "POST", body: { up_to_id: upToId }, silent: true });
}

export async function getChatUnread(): Promise<ChatUnread> {
  return apiRequest<ChatUnread>("/api/chats/unread", { silent: true });
}
