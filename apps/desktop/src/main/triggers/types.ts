/**
 * Trigger types live in the shared layer (`apps/desktop/src/shared/triggers.ts`)
 * so the renderer can import them without crossing the main/renderer boundary.
 * This file re-exports them under the path mandated by the v0.1 architecture
 * doc (`apps/desktop/src/main/triggers/types.ts`).
 */

export * from '../../shared/triggers';
