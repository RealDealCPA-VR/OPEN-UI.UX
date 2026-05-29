import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, UnsupportedSchemaVersionError } from './db';

let db: Database.Database;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
});

afterEach(() => {
  db.close();
});

describe('applyMigrations downgrade safety', () => {
  it('refuses to open when schema_migrations contains a version beyond MAX_SUPPORTED', () => {
    applyMigrations(db);
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(9_999);
    expect(() => applyMigrations(db)).toThrowError(UnsupportedSchemaVersionError);
    try {
      applyMigrations(db);
    } catch (err) {
      const e = err as UnsupportedSchemaVersionError;
      expect(e.currentVersion).toBe(9_999);
      expect(e.maxSupported).toBeLessThan(9_999);
      expect(e.message).toMatch(/downgrad/i);
    }
  });

  it('is idempotent at the latest applied version', () => {
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();
  });
});
