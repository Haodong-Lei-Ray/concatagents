---
name: model-config-sanitizer
description: Audit Hermes and Claude model/base_url/api_key settings against a live OpenAI-compatible `/v1/models` endpoint, identify invalid or redundant entries, suggest canonical replacements, and clean config files safely. Use when the user mentions Hermes, Claude, model config, gateway, base_url, api_key, `/v1/models`, invalid model IDs, dead models, or cleaning unused model settings.
---

# Model Config Sanitizer

## Goal

Detect whether Hermes and Claude model settings actually work against the target gateway, remove clearly useless config, and update both configs to canonical live values.

## Scope

Primary targets:

- `%LOCALAPPDATA%/hermes/config.yaml`
- `~/.claude/settings.json`

## Workflow

Follow this order every time:

1. Read the target config files first.
2. Identify the active gateway `base_url` and `api_key`.
3. Fetch the live model catalog from `GET <base_url>/models`.
4. Collect every configured model ID from Hermes and Claude.
5. Run:

```bash
python ".cursor/skills/model-config-sanitizer/scripts/check_gateway_models.py" --base-url "<base_url>" --api-key "<api_key>" --models "<model1>" "<model2>"
```

6. Classify each configured value:
   - `valid`: exact match exists in live `/v1/models`
   - `replaceable`: invalid, but there is one high-confidence canonical replacement
   - `ambiguous`: invalid and multiple plausible replacements exist
   - `useless`: invalid with no safe replacement, or duplicate/conflicting override that adds no value
7. Update configs.
8. Summarize what was kept, replaced, and removed.

## What to inspect

### Hermes

Check these fields when present:

- `model.default`
- `model.base_url`
- `model.api_key`
- `auxiliary.*.model`
- `auxiliary.*.base_url`
- `auxiliary.*.api_key`
- `delegation.model`
- `delegation.base_url`
- `delegation.api_key`
- `fallback_providers[].model`
- `fallback_providers[].base_url`
- `fallback_providers[].api_key`
- `fallback_model.model`

### Claude

Check `~/.claude/settings.json` under `env`:

- `ANTHROPIC_BASE_URL`
- `ANTHROPIC_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_API_KEY`
- any Claude custom model env if present
- `CLAUDE_CODE_GIT_BASH_PATH` only for existence/correctness, not for model validation

## Cleanup rules

Apply these rules conservatively:

1. Keep exact valid model IDs unchanged.
2. Replace invalid model IDs automatically only when there is exactly one high-confidence match.
3. High-confidence replacement patterns include:
   - provider prefix stripped match, for example `deepseek/deepseek-v4-pro` -> `deepseek-v4-pro`
   - dated canonical match, for example `claude-haiku-4-5` -> `claude-haiku-4-5-20251001`
   - case-only normalization
4. Remove clearly useless config:
   - dead model IDs with no valid replacement
   - duplicate overrides that repeat the same live `base_url`/`api_key` without changing behavior
   - stale fallback entries pointing to invalid models
   - stale URL values that conflict with the active gateway and are not intentionally separate
5. Ask the user before deleting anything ambiguous.
6. Preserve unrelated settings.

## Editing rules

- Prefer small targeted edits over rewriting the entire file.
- Keep file format stable.
- Do not invent model IDs.
- Do not claim a config works without checking the live gateway.
- If the gateway is unreachable, stop after reporting findings; do not guess.

## Default outcome

After cleanup:

- Hermes should point to a live gateway URL ending in `/v1`
- Hermes model IDs should all be valid or intentionally omitted
- Claude `env` URLs should use the same canonical gateway when the user intends shared routing
- dead or redundant model config should be removed

## Output format

Report the result in three short sections:

1. `Valid`
2. `Updated`
3. `Removed`

Then include any remaining ambiguous items that still need a user decision.

## Examples

### Example 1

User asks:

```text
检查这些 model 配置是不是活的，然后删掉没用的，更新 Hermes 和 Claude。
```

Expected behavior:

- read Hermes and Claude configs
- query `/v1/models`
- validate all configured model IDs
- replace obvious aliases with canonical IDs
- remove dead fallback or duplicate override entries
- return a concise cleanup summary

### Example 2

Observed config:

```text
Hermes: deepseek/deepseek-v4-pro
Gateway: deepseek-v4-pro
```

Expected behavior:

- detect that the configured ID is invalid
- detect one exact suffix-strip replacement
- update Hermes to `deepseek-v4-pro`

## Additional resources

- For default file locations and replacement heuristics, see [reference.md](reference.md)
