# main/ipc

IPC handler dispatch. Every channel declared in `src/shared/ipc-types.ts` gets a handler here. All payloads are Zod-validated before reaching domain code.
