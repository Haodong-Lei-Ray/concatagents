---
name: claude-code-models
description: >-
  Manage Claude Code dual-upstream models (MiniMax + DeepSeek) via api-local.json
  and the local claude-model-proxy. Use when the user asks to add, remove, update,
  or list Claude Code models, routes, api-local.json, ANTHROPIC_CUSTOM_MODEL_OPTION,
  or to keep only MiniMax and DeepSeek.
---

# Claude Code 模型管理

## 目标

本机 Claude Code 只保留 **两个有效后端**：

| 逻辑名 | 配置键 | 典型 model id | Claude Code 用法 |
|--------|--------|---------------|------------------|
| MiniMax | `routes.minimax` | `MiniMax-M2.7` | `/model` 槽位 1–4，或 `claude --model MiniMax-M2.7` |
| DeepSeek | `routes.deepseek` | `deepseek-v4-pro` | `/model` 槽位 5（Custom），或 `claude --model deepseek-v4-pro` |

本地代理：`scripts/claude-model-proxy.js`（默认 `127.0.0.1:3889`）  
私密配置：`api-local.json`（勿提交 git）

## 何时使用本 skill

- 查询 / 列出当前上游路由
- 增加、删除、修改 `api-local.json` 里的 route
- 确保只剩 MiniMax + DeepSeek（`dual-only`）
- 同步 shell 里 `ANTHROPIC_CUSTOM_MODEL_OPTION*`（槽位 5 显示名）
- 验收代理与两个模型是否可用

## 文件范围

| 文件 | 作用 |
|------|------|
| `Project1/concatagents/api-local.json` | 上游 URL / API Key / model |
| `Project1/concatagents/scripts/claude-model-proxy.js` | 本地路由 shim |
| `~/.bashrc` / `~/.zshrc` | `ANTHROPIC_BASE_URL`、`ANTHROPIC_CUSTOM_MODEL_OPTION*` |
| `~/.config/systemd/user/claude-model-proxy.service` | 代理 systemd 单元 |
| `~/.claude/settings.json` | 可选默认 `model` |

## 管理脚本

仓库内脚本（相对本 skill 目录）：

```bash
SKILL_ROOT="/home/lei/Project1/concatagents/skills/claude-code-models"
CFG="/home/lei/Project1/concatagents/api-local.json"
python3 "$SKILL_ROOT/scripts/claude_models.py" --config "$CFG" <command>
```

### 命令一览

| 命令 | 说明 |
|------|------|
| `list` | 查询所有 route（apiKey 打码） |
| `get <name>` | 查询单条 route |
| `add <name> --base-url ... --api-key ... --model ...` | 增加 route |
| `update <name> [--base-url ...] [--api-key ...] [--model ...] [--match-models a,b]` | 修改 route |
| `delete <name> [--force]` | 删除 route（`minimax`/`deepseek` 默认拒绝，需 `--force`） |
| `dual-only` | **只保留** `listen` + `routes.minimax` + `routes.deepseek` |
| `apply-env [--write]` | 根据 deepseek route 生成/写入 `ANTHROPIC_CUSTOM_MODEL_OPTION*` |
| `verify` | 检查代理 `/` 与 `claude --model` 双模型 |

### 示例

```bash
# 查询
python3 scripts/claude_models.py list
python3 scripts/claude_models.py get deepseek

# 只保留两个上游
python3 scripts/claude_models.py dual-only

# 改 DeepSeek 模型 id 并同步 shell（槽位 5）
python3 scripts/claude_models.py update deepseek --model deepseek-v4-pro
python3 scripts/claude_models.py apply-env --write

# 改 MiniMax 密钥
python3 scripts/claude_models.py update minimax --api-key "sk-..."

# 验收
systemctl --user restart claude-model-proxy.service
source ~/.bashrc
python3 scripts/claude_models.py verify
```

## 代理路由规则（必读）

`claude-model-proxy.js` 行为：

1. 请求体 `model` 若在 **custom 路由** 的 `model` / `matchModels` / `ANTHROPIC_CUSTOM_MODEL_OPTION` 中 → 走 `routes.deepseek`（除非配置显式指定 `customRoute`）
2. **其余所有 model id**（含 Claude 内置 `claude-opus-*`、`claude-sonnet-*` 等）→ 走 `routes.minimax`

因此：**删掉多余的第三方 route 后，菜单里仍可能显示 5 个 Claude 槽位，但后端只有 MiniMax / DeepSeek 两套。** 用户应优先：

- MiniMax：选 `/model` 第 1 项，或 `claude --model MiniMax-M2.7`
- DeepSeek：选 `/model` 第 5 项（Custom），或 `claude --model deepseek-v4-pro`

Claude Code **不能**从 UI 里真正删掉槽位 2–4；它们选中的 Claude id 会被代理改写到 MiniMax。

## 标准工作流

### A. 初始化为双模型

1. `python3 scripts/claude_models.py dual-only`
2. 确认 `~/.bashrc` / `~/.zshrc` 含：
   - `ANTHROPIC_BASE_URL=http://127.0.0.1:3889`
   - `CLAUDE_PROXY_CONFIG=/home/lei/Project1/concatagents/api-local.json`
   - `ANTHROPIC_CUSTOM_MODEL_OPTION` = deepseek 的 model id
3. `python3 scripts/claude_models.py apply-env --write`（可选，同步显示名）
4. `systemctl --user restart claude-model-proxy.service`
5. `python3 scripts/claude_models.py verify`

### B. 增加第三个上游（扩展）

1. `add myvendor --base-url ... --api-key ... --model ... --match-models my-model-id`
2. 在 `api-local.json` 设 `"customRoute": "myvendor"` **或** 把 `matchModels` 配上 Claude 要用的 id（常规双模型配置不需要该字段）
3. 重启代理并 `verify`

### C. 修改 / 删除

- 修改：`update <name> ...` → 重启代理
- 删除非 canonical：`delete <name>`
- 禁止误删双模型：`delete minimax` 无 `--force` 会失败

## 安装到 Claude Code

本 skill 源目录：

`/home/lei/Project1/concatagents/skills/claude-code-models`

让 Claude Code 能 `/claude-code-models` 或自动发现：

```bash
mkdir -p ~/.claude/skills
ln -sfn /home/lei/Project1/concatagents/skills/claude-code-models \
  ~/.claude/skills/claude-code-models
claude skill list
```

## 输出格式（agent 回复用户时）

1. **当前路由表**（`list` 结果，密钥打码）
2. **本次操作**（增/删/改/ dual-only / apply-env）
3. **是否需要重启** `claude-model-proxy.service` 与 `source ~/.bashrc`
4. **验收**（若已跑 `verify`，写明两个 model 是否 `hi` 成功）
5. **提醒**：`/model` 仍显示 5 槽，有效选择为槽位 1（MiniMax）与槽位 5（DeepSeek）

## 安全

- 勿把 `api-local.json` 提交到 git
- 回复用户时不要粘贴完整 `apiKey`
- 密钥轮换后只改 `update ... --api-key`
