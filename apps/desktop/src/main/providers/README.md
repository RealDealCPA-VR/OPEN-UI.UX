# main/providers

Provider registry wiring. Loads built-in provider adapters from `@opencodex/provider-openai`, `@opencodex/provider-anthropic`, `@opencodex/provider-google`, `@opencodex/provider-xai`, `@opencodex/provider-mistral`, `@opencodex/provider-ollama`, and `@opencodex/provider-openrouter`, plus any plugin-contributed providers. Reads API keys from `keytar` and validates configs against `LLMProvider` capabilities.
