# main/agent

Agent runtime: orchestrates the loop of streaming an LLM response, collecting tool calls, executing them through the tool registry, and feeding results back. Cancellation, approval gating, and audit logging live here.

Depends on `@opencodex/core` (interfaces), `@opencodex/providers` (LLM adapters), `@opencodex/tools` (tool implementations).
