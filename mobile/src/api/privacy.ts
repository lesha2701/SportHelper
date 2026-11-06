import { apiRequest } from "./client";

/** Whether coaches with a confirmed personal session may run the AI analysis on the player's sports data. */
export async function getAiAnalysisConsent(): Promise<boolean> {
  return (await apiRequest<{ allow_ai_analysis_by_personal_coach: boolean }>("/api/users/me/privacy")).allow_ai_analysis_by_personal_coach;
}

export async function setAiAnalysisConsent(allowed: boolean): Promise<boolean> {
  const dto = await apiRequest<{ allow_ai_analysis_by_personal_coach: boolean }>("/api/users/me/privacy", {
    method: "PUT",
    body: { allow_ai_analysis_by_personal_coach: allowed },
    successMessage: allowed ? "AI-анализ для личных тренеров разрешён" : "AI-анализ для личных тренеров отключён",
  });
  return dto.allow_ai_analysis_by_personal_coach;
}
