/** The phrase the head coach types to hand the team over. The server compares it character by character
 * (backend/app/api/routes/teams.py), so it must stay exactly as the website builds it. */
export function transferPhrase(teamName: string, firstName: string, lastName: string | null | undefined): string {
  return `Я передаю роль главного тренера команды «${teamName}» пользователю ${firstName} ${lastName ?? ""}`.trim();
}
