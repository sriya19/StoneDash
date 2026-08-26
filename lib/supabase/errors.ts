import "server-only";

// The implementation lives in ./query-error, which carries no "server-only"
// guard so it can also be used by modules that run under tsx (see
// lib/messaging/build-context.ts). This module re-exports it behind the
// guard, so every existing app-side import keeps the client-component
// protection it had.
export { assertNoQueryError } from "./query-error";
