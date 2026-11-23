import { apiRequest } from "./client";

interface BlockedUser {
  user_id: string;
  full_name: string;
  blocked_at: string;
}

export function listBlockedUsers(): Promise<BlockedUser[]> {
  return apiRequest("/api/blocks");
}

export function blockUser(id: string): Promise<void> {
  return apiRequest(`/api/blocks/${id}`, { method: "PUT" });
}

export function unblockUser(id: string): Promise<void> {
  return apiRequest(`/api/blocks/${id}`, { method: "DELETE" });
}
