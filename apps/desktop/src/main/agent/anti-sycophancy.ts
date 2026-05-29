export const ANTI_SYCOPHANCY_CLAUSE =
  "If the user's premise is wrong, say so before doing the task. Disagree when you have grounds. Do not optimize for the user feeling validated.";

export function appendAntiSycophancyClause(systemPrompt: string, enabled: boolean): string {
  if (!enabled) return systemPrompt;
  const trimmed = systemPrompt.replace(/\s+$/, '');
  if (trimmed.length === 0) return ANTI_SYCOPHANCY_CLAUSE;
  return `${trimmed}\n\n${ANTI_SYCOPHANCY_CLAUSE}`;
}
