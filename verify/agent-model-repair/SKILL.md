---
name: agent-model-repair
description: Diagnose and repair model availability for Claude/OpenClaw/Hermes by validating live endpoints, rotating dead API keys, and synchronizing config files; `render_gateway_snapshot.py --discover` reads portable paths (see Files in scope).
---

# Agent Model Repair

## Goal

When model calls fail (401/400/unsupported), run a single workflow that:

1. Detects whether the issue is auth, endpoint, or model ID.
2. Finds a working API key/endpoint combination.
3. Repairs the local agent configs consistently.
4. Verifies the repaired path end-to-end.
5. Ends with the **Harness 收尾验收表**（与 `concatagents/README-zh.md` 同结构）及 **网关与密钥快照表**（见 `reference.md`），仅在回复中输出，**不得**为填表去改 README 里的空白模板或提交该模板的 git 改动。

## Typical symptoms

- `HTTP 401: Invalid token`
- `run error: 400 ... unsupported`
- `/model` can select, but send fails
- Hermes/Claude/OpenClaw disagree on which key works

## Files in scope

- `~/.openclaw/.env`
- Shell exports: `~/.bashrc`, `~/.zshrc`, `~/.profile` (lines like `export FOO=...`)
- Hermes per root directory (each may contain `.env` and/or `config.yaml` under `model:`):
  - `~/.hermes/` (Unix / generic)
  - `~/.config/hermes/` when that directory exists (common Linux layout when `XDG_CONFIG_HOME` is unset)
  - `%LOCALAPPDATA%\hermes\` on Windows (e.g. `C:\Users\<you>\AppData\Local\hermes`)
  - `$XDG_CONFIG_HOME/hermes/` when `XDG_CONFIG_HOME` is set (Linux)
- **Process environment**: `OPENAI_*`, `ANTHROPIC_*`, `HERMES_*` fill gaps when not set in files (CI / IDE).
- Optional: `~/.openclaw/openclaw.json` (if provider key is hardcoded there)

## Detection -> Repair workflow

Follow this order every time:

1. Read current config files and extract:
   - OpenAI-compatible `base_url` + candidate API keys
   - Anthropic/MiniMax `base_url` + API key
   - current model IDs
2. Validate auth first:
   - OpenAI-compatible: `GET <base_url>/v1/models`
   - Anthropic-compatible: `POST <base_url>/v1/messages` with a tiny prompt
3. Classify failures:
   - `401` => key invalid/expired
   - connect timeout / connection closed => network or endpoint issue
   - model unsupported/invalid => key works, model config wrong
4. Choose one known-working key per provider path.
5. Repair configs (targeted edits only):
   - `.bashrc`: set live `OPENAI_API_KEY` and Anthropic vars
   - `.openclaw/.env`: set live `OPENAI_API_KEY`
   - `.hermes/config.yaml`: set `model.api_key` (if using custom gateway)
6. Re-run endpoint checks and report final status.
7. **Harness 收尾验收表（必须）**：根据本机实际验收结果，在最终回复（或交付说明）中输出与 `concatagents/README-zh.md`「Agent 收尾填报表」**同结构**的表格；单元格仅填 `是` / `否` / `不适用`。依据：`openclaw --version`、`claude --version`、`hermes doctor`（及本次修复相关的连通性探测）、**各组件最小对话是否按要求输出 `hi`** 等客观结果；未安装或未测到的组件填 `不适用` 或 `否` 并简短说明。
8. **网关与密钥快照表（建议）**：运行 `render_gateway_snapshot.py --discover` 生成（合并顺序见 `reference.md`）；须含 **「用于 Harness」** 列。可选 **`--save-api-keys`** 将解析到的真实 `base_url` / `api_key` 写入 `api-key.json`（默认在脚本同目录，勿提交仓库）。**若生成了 `api-key.json`**，按 `reference.md`「`api-key.json` 验收」小表在交付中一并验收（未生成则该验收表填 **不适用**）。

## Quick command (diagnose)

```bash
python "verify/agent-model-repair/scripts/diagnose_model_auth.py" \
  --openai-base-url "http://35.220.164.252:3888/v1" \
  --openai-key "sk-xxx" \
  --openai-key "sk-yyy" \
  --anthropic-base-url "https://api.minimaxi.com/anthropic" \
  --anthropic-key "sk-cp-zzz"
```

生成「网关与密钥快照表」Markdown（与 `reference.md` 同结构）：

```bash
python "verify/agent-model-repair/scripts/render_gateway_snapshot.py" --discover
python "verify/agent-model-repair/scripts/render_gateway_snapshot.py" --discover --save-api-keys
python "verify/agent-model-repair/scripts/render_gateway_snapshot.py" --discover --save-api-keys --json
```

## Repair rules

- Never invent model IDs.
- Never claim a path works without live probe.
- Keep one active key per path; demote dead keys to comments or `unset`.
- Prefer minimal edits over rewriting whole files.
- If multiple keys work, keep the newest explicitly chosen by the user.

## Output format
表1
Respond in **六**个部分（顺序固定）：

1. `Detected`
2. `Working`
3. `Repaired`
4. `Remaining Risks`
5. `Harness 收尾验收表` — 使用与下面**完全一致**的表头与三行组件名，仅替换单元格内容（`是` / `否` / `不适用`）：

| Harness 组件 | 是否安装 | 是否验收通过 | CLI 可用（无交互自检） | 是否输出hi |
|----------------|----------|----------------|------------------------|------------|
| OpenClaw | | | | |
| Claude Code | | | | |
| Hermes | | | | |
表2
`网关与密钥快照表` — 与 `reference.md`「网关与密钥快照表」同结构；**须含「用于 Harness」列**（填 `OpenClaw` / `Claude Code` / `Hermes` 的组合，逗号分隔，与该行网关实际被哪些组件消费一致）；密钥仅掩码、模型每格 ≤5 个、URL 如实填写。空白模板：

| 用于 Harness | API Key（掩码） | 模型名（最多 5 个） | URL |
|--------------|----------------|---------------------|-----|
| | | | |
| | | | |

**约束（与 README-zh 一致）**：不要把填好的表写进 `README-zh.md` / `README.md` 里的空白模板；模板在仓库中保持原样，**只在对话里**输出已填表。若本次生成了 `api-key.json`，另按 `reference.md`「`api-key.json` 验收」小表在对话里输出验收结果（未生成则该小表可省略或整表填「不适用」）。

## Cursor 侧安装副本

本 skill 可同时安装在 `~/.cursor/skills/agent-model-repair/`（与仓库 `verify/agent-model-repair/` 同步；Agent 优先读 Cursor skills 目录时，命令见该目录下 `SKILL.md` 中的 `$HOME/.cursor/skills/...` 示例）。
