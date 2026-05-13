# Reference

## Harness 收尾验收表（与 README-zh 对齐）

来源：`concatagents/README-zh.md`「Agent 收尾填报表（必须）」。

执行本 skill 完成检测与修复后，必须在最终交付中附带**同结构**表格；单元格填 `是` / `否` / `不适用`。不得为填表修改或提交 README 内空白模板。

| Harness 组件 | 是否安装 | 是否验收通过 | CLI 可用（无交互自检） |
|----------------|----------|----------------|------------------------|
| OpenClaw | | | |
| Claude Code | | | |
| Hermes | | | |

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
