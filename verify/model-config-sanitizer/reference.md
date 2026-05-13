# Reference

## Default file locations

- Hermes: `%LOCALAPPDATA%/hermes/config.yaml`
- Claude: `~/.claude/settings.json`

## Gateway validation source of truth

Always trust the live gateway catalog:

```text
GET <base_url>/models
```

Use `data[].id` as the only source of truth for valid model IDs.

## Common replacement heuristics

### Provider prefix stripping

Useful when a config uses a marketplace-style or provider-prefixed ID that the target gateway does not expose.

Examples:

- `deepseek/deepseek-v4-pro` -> `deepseek-v4-pro`
- `openai/gpt-4o-mini` -> `gpt-4o-mini`

### Dated canonicalization

Useful when Claude-style short IDs are not exposed by the gateway, but a dated ID is.

Examples:

- `claude-haiku-4-5` -> `claude-haiku-4-5-20251001`
- `claude-sonnet-4-5` -> `claude-sonnet-4-5-20250929`

### Duplicate override removal

Remove duplicate or useless overrides only when the same effective value is already provided by a parent/default setting.

Examples:

- Hermes `auxiliary.*.base_url` equals the same gateway as `model.base_url` and exists only as a redundant repeat
- Hermes fallback entry points to the same dead model already removed elsewhere
- Claude `OPENAI_BASE_URL` or `ANTHROPIC_BASE_URL` points to an old gateway while the other value is the intended current one

## When to ask the user

Ask before changing anything when:

- more than one replacement candidate is plausible
- a config may intentionally target two different gateways
- removing a fallback could reduce resilience in a way the user may care about
- the gateway catalog itself looks inconsistent

## Recommended validation loop

1. Read configs.
2. Fetch live `/v1/models`.
3. Run the helper script with all model IDs.
4. Edit configs.
5. Re-read changed files.
6. Re-run the helper script on the final set of model IDs.
7. Only report success after the second pass is clean.
