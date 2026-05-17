# main/storage

SQLite (via `better-sqlite3`) for sessions, messages, audit logs, approvals, settings cache. Versioned migrations. Per-workspace state lives in `.opencodex/` inside the user's repo; global state lives in the OS user-data dir.

API keys are NOT stored here — those go through `keytar`.
