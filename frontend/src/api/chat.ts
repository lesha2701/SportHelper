import { apiRequest, apiUpload } from "./client";
import {
  mapConversationDto,
  mapMessageDto,
  type ChatConversation,
  type ChatConversationDto,
  type ChatMessage,
  type ChatMessageDto,
  type ChatTarget,
  type ChatUnread,
} from "../types/chat";

const QUIET = { silent: true } as const;

/** Opens (and, for a paid lesson or a team, creates on first use) the chat. A booking that is not confirmed and paid answers 409 `chat_not_available`. */
export async function openChat(token: string, target: ChatTarget): Promise<ChatConversation> {
  const path = target.kind === "booking" ? `/api/chats/for-booking/${target.id}` : `/api/chats/for-team/${target.id}`;
  return mapConversationDto(await apiRequest<ChatConversationDto>(path, { token, ...QUIET }));
}

export async function getChat(token: string, conversationId: string): Promise<ChatConversation> {
  return mapConversationDto(await apiRequest<ChatConversationDto>(`/api/chats/${conversationId}`, { token, ...QUIET }));
}

export async function listChatMessages(
  token: string,
  conversationId: string,
  query: { beforeId?: number; afterId?: number; limit?: number } = {},
): Promise<{ items: ChatMessage[]; hasMoreBefore: boolean }> {
  const params = new URLSearchParams();
  if (query.beforeId !== undefined) params.set("before_id", String(query.beforeId));
  if (query.afterId !== undefined) params.set("after_id", String(query.afterId));
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  const qs = params.toString();
  const dto = await apiRequest<{ items: ChatMessageDto[]; has_more_before: boolean }>(`/api/chats/${conversationId}/messages${qs ? `?${qs}` : ""}`, { token, ...QUIET });
  return { items: dto.items.map(mapMessageDto), hasMoreBefore: dto.has_more_before };
}

/** `clientKey` is made once per message: sending it again (a double click, a retry after a lost answer) can only ever create one message. */
export async function sendChatMessage(token: string, conversationId: string, body: string, clientKey: string): Promise<ChatMessage> {
  const dto = await apiRequest<ChatMessageDto>(`/api/chats/${conversationId}/messages`, { method: "POST", token, body: { body, client_key: clientKey }, ...QUIET });
  return mapMessageDto(dto);
}

export async function sendChatMedia(token: string, conversationId: string, file: File, body: string, clientKey: string): Promise<ChatMessage> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("client_key", clientKey);
  if (body) formData.append("body", body);
  const dto = await apiUpload<ChatMessageDto>(`/api/chats/${conversationId}/messages/media`, { token, formData, silent: true });
  return mapMessageDto(dto);
}

export async function deleteChatMessage(token: string, conversationId: string, messageId: number): Promise<void> {
  await apiRequest(`/api/chats/${conversationId}/messages/${messageId}`, { method: "DELETE", token, ...QUIET });
}

export async function markChatRead(token: string, conversationId: string, upToId: number): Promise<void> {
  await apiRequest(`/api/chats/${conversationId}/read`, { method: "POST", token, body: { up_to_id: upToId }, ...QUIET });
}

export async function getChatUnread(token: string): Promise<ChatUnread> {
  return apiRequest<ChatUnread>("/api/chats/unread", { token, ...QUIET });
}
