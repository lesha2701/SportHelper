import { apiRequest } from "./client";

export interface PrivacySettings {
  allowAiAnalysisByPersonalCoach: boolean;
}

interface PrivacySettingsDto {
  allow_ai_analysis_by_personal_coach: boolean;
}

function mapDto(dto: PrivacySettingsDto): PrivacySettings {
  return { allowAiAnalysisByPersonalCoach: dto.allow_ai_analysis_by_personal_coach };
}

export async function getPrivacySettings(token: string): Promise<PrivacySettings> {
  return mapDto(await apiRequest<PrivacySettingsDto>("/api/users/me/privacy", { token }));
}

export async function setAiAnalysisConsent(token: string, allowed: boolean): Promise<PrivacySettings> {
  const dto = await apiRequest<PrivacySettingsDto>("/api/users/me/privacy", {
    method: "PUT",
    token,
    body: { allow_ai_analysis_by_personal_coach: allowed },
    successMessage: allowed ? "AI-анализ для личных тренеров разрешён" : "AI-анализ для личных тренеров отключён",
  });
  return mapDto(dto);
}
