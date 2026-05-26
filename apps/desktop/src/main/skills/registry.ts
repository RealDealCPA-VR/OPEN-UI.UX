import { skillRegistrySchema, type SkillRegistryEntry } from '../../shared/skills';

/**
 * Parse a raw registry response into a list of skill registry entries.
 *
 * The remote registry can be shaped either as a top-level array of entries
 * (`[ { name, description, sourceUrl, … }, … ]`) or as an envelope object
 * with an `entries` array (`{ entries: [ … ] }`). Anything else fails the
 * Zod parse and surfaces as an error string.
 */
export function parseRegistryPayload(raw: unknown): {
  entries: SkillRegistryEntry[];
  error: string | null;
} {
  const candidate = Array.isArray(raw) ? raw : (raw as { entries?: unknown })?.entries;
  const parsed = skillRegistrySchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      entries: [],
      error: `schema mismatch: ${parsed.error.issues[0]?.message ?? 'invalid registry shape'}`,
    };
  }
  return { entries: parsed.data, error: null };
}
