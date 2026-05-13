# Reference

## Harness 收尾验收表（与 README-zh 对齐）

来源：`concatagents/README-zh.md`「Agent 收尾填报表（必须）」。

执行本 skill 完成检测与修复后，必须在最终交付中附带**同结构**表格；单元格填 `是` / `否` / `不适用`。不得为填表修改或提交 README 内空白模板。

| Harness 组件 | 是否安装 | 是否验收通过 | CLI 可用（无交互自检） |
|----------------|----------|----------------|------------------------|
| OpenClaw | | | |
| Claude Code | | | |
| Hermes | | | |

## 网关与密钥快照表（建议一并输出）

用于记录**本次检测/修复**所依据的每条调用路径：**用于 Harness** 标明该行网关/密钥主要被谁消费（`OpenClaw` / `Claude Code` / `Hermes`，可组合，逗号分隔）。密钥只写**掩码**（如前 6 位 + `...` + 后 4 位），模型列最多填 **5** 个 ID（逗号分隔），与 live `/v1/models` 或实际探测一致。

| 用于 Harness | API Key（掩码） | 模型名（最多 5 个） | URL |
|--------------|----------------|---------------------|-----|
| | | | |
| | | | |

### 一键生成（推荐）

仓库内（当前工作目录在 `concatagents/` 下时）：

```bash
python "verify/agent-model-repair/scripts/render_gateway_snapshot.py" --discover
```

Cursor 已安装副本：

```bash
python "$HOME/.cursor/skills/agent-model-repair/scripts/render_gateway_snapshot.py" --discover
```

仅 JSON（便于 CI 解析）：

```bash
python "verify/agent-model-repair/scripts/render_gateway_snapshot.py" --discover --json
# 或
python "$HOME/.cursor/skills/agent-model-repair/scripts/render_gateway_snapshot.py" --discover --json
```

手动追加一行 OpenAI-compatible 路径（第三列为模型 CSV，最多取前 5 个；留空则从 live `/models` 自动填）：

```bash
python "verify/agent-model-repair/scripts/render_gateway_snapshot.py" \
  --discover \
  --openai-row "http://other/v1" "sk-other..." "gpt-4o,gpt-4o-mini"
```

### `api-key.json`（真实密钥，可选）

将 `--discover` 解析得到的 **真实** `base_url` 与 `api_key` 写入 JSON（与当前 Markdown 表行一一对应）。**不要提交到 git**（`scripts/.gitignore` 已忽略 `api-key.json`）；文件权限在 Unix 上会设为 `0600`。

- 默认路径（仅写 `--save-api-keys`，不传路径）：与脚本同目录下的 `api-key.json`。
- 自定义路径：`--save-api-keys /path/to/api-key.json`
- 与 `--json` 同用时，stdout JSON 会增加字段 `api_key_json_path`。

```bash
python "verify/agent-model-repair/scripts/render_gateway_snapshot.py" --discover --save-api-keys
python "verify/agent-model-repair/scripts/render_gateway_snapshot.py" --discover --save-api-keys --json
```

**填写说明**

- 一行可对应一条链路（例如 OpenAI-compatible 网关一行、Anthropic-compatible 一行）；行数按实际路径增减。**用于 Harness** 与配置一致（例如 `.bashrc` 的 `OPENAI_*` 多被 OpenClaw 与 Hermes 共用同一网关时可写 `OpenClaw, Hermes`；仅 Claude Code 走 `ANTHROPIC_*` / MiniMax 时写 `Claude Code`）。
- **模型名**：从配置或 `/v1/models` 中摘录，单格内不超过 5 个，超出则省略并注明「+N」在交付文字里说明。
- **URL**：填写实际请求的 base（OpenAI 风格一般为 `.../v1`，Anthropic 风格为 `https://api.minimaxi.com/anthropic` 等）。

**建议判定依据（示例）**

- **是否安装**：对应 CLI 在 `PATH` 中且 `--version` / `doctor` 可执行。
- **是否验收通过**：本次涉及的网关/密钥/模型探测是否通过（含修复后复测）。
- **CLI 可用（无交互自检）**：非交互命令成功退出（如 `openclaw gateway status`、`hermes doctor` 等），不要求用户手动点 UI。

## Health checks

### OpenAI-compatible gateway

```text
GET <base_url>/v1/models
Authorization: Bearer <api_key>
```

Expected:
- `200` => key is valid for model catalog access
- `401` => key invalid/expired

### Anthropic-compatible gateway

```text
POST <base_url>/v1/messages
x-api-key: <api_key>
anthropic-version: 2023-06-01
```

Minimal body:

```json
{
  "model": "MiniMax-M2.7",
  "max_tokens": 8,
  "messages": [{"role": "user", "content": "ping"}]
}
```

Expected:
- `200` => path is usable
- timeout/connection closed => endpoint/network issue
- `4xx` with model error => auth works, model config needs fix

## Repair targets

- `~/.bashrc`
  - `OPENAI_BASE_URL`
  - `OPENAI_API_KEY`
  - `ANTHROPIC_BASE_URL`
  - `ANTHROPIC_API_KEY`
  - `ANTHROPIC_AUTH_TOKEN`
- `~/.openclaw/.env`
  - `OPENAI_API_KEY`
- `~/.hermes/config.yaml`
  - `model.base_url`
  - `model.api_key`

## Common pitfalls

- `.bashrc` early `return` on non-interactive shell means `source ~/.bashrc` may not load keys in automation.
- Mixed key sources (`.env`, `.bashrc`, provider JSON) can cause "some models work, some 401".
- A model can appear in UI but still fail if API type is wrong (`openai-completions` vs `openai-responses`).
