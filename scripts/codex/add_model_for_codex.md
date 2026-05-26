# Codex + 统一模型网关

## 架构（与 Claude 并列）

配置单一来源：`Project1/concatagents/api-local.json`

```text
api-local.json
├── listen :3889          → Claude Code（Anthropic shim）
├── codexGateway :8788    → Codex（Responses → DeepSeek Chat）
└── routes.deepseek       → 两网关共用同一 apiKey / 模型 id

Claude Code  ANTHROPIC_BASE_URL=http://127.0.0.1:3889
Codex        model_providers.deepseek.base_url=http://127.0.0.1:8788/v1
PolyWeave    :8787（agent 调度，不是 LLM 网关，勿混用）
```

| 工具 | 本地端口 | 协议 | 管理脚本 |
|------|----------|------|----------|
| Claude Code | 3889 | Anthropic `/v1/messages` | `scripts/claude-code-proxy.sh` |
| Codex | 8788 | OpenAI Responses `/v1/responses` | `scripts/codex-responses-gateway.sh` |
| 两者 | — | — | `scripts/model-gateways.sh` |

Codex 0.132 **只认 Responses API**；DeepSeek 官方只有 Chat Completions，故 8788 使用 [deepseek-responses-proxy](https://github.com/holo-q/deepseek-responses-proxy) 做协议转换，密钥与 `routes.deepseek` 一致。

---

## 一键启停

```bash
cd /home/lei/Project1/concatagents

# 首次：安装并启动两个网关
chmod +x scripts/*.sh
./scripts/model-gateways.sh install
./scripts/model-gateways.sh start

# 日常
./scripts/model-gateways.sh status
./scripts/model-gateways.sh verify
```

仅 Codex 网关：

```bash
./scripts/codex-responses-gateway.sh sync-env install-unit start
./scripts/codex-responses-gateway.sh verify
```

---

## `~/.codex/config.toml`

```toml
[model_providers.deepseek]
name = "DeepSeek"
base_url = "http://127.0.0.1:8788/v1"
env_key = "DEEPSEEK_API_KEY"

[profiles.deepseek-v4-pro]
model_provider = "deepseek"
model = "deepseek-v4-pro"
```

Shell（与 `api-local.json` 同步，或由 `sync-env` 写入 `~/.config/codex-responses-gateway.env`）：

```bash
export DEEPSEEK_API_KEY='…'   # 见 routes.deepseek.apiKey
codex -p deepseek-v4-pro
```

### 为什么「Select Model」里看不到 deepseek-v4-pro？

交互菜单里的 1–5 项是 **ChatGPT 账号下的 GPT 模型目录**，不会列出 `[model_providers]` 客座模型（Codex 当前已知限制）。

| 方式 | 是否走 8788 + DeepSeek |
|------|------------------------|
| 菜单里选 gpt-5.4-mini | 否（OpenAI） |
| `codex -m deepseek-v4-pro` | **通常仍否**（只改模型名，provider 还是默认 OpenAI） |
| `codex -p deepseek-v4-pro` | **是** |
| `config.toml` 顶部 `profile = "deepseek-v4-pro"` | **是**（每次启动默认客座） |

启动后可在界面/状态里确认：`provider: deepseek`、`model: deepseek-v4-pro`。

---

## `api-local.json` 片段

```json
{
  "listen": { "bind": "127.0.0.1", "port": 3889 },
  "codexGateway": {
    "bind": "127.0.0.1",
    "port": 8788,
    "route": "deepseek",
    "chatBaseUrl": "https://api.deepseek.com"
  },
  "routes": {
    "deepseek": {
      "baseUrl": "https://api.deepseek.com/anthropic",
      "apiKey": "…",
      "model": "deepseek-v4-pro"
    }
  }
}
```

- Claude 用 `routes.*.baseUrl` 的 **Anthropic** 路径  
- Codex 网关用同一 `apiKey`，上游 Chat 为 `chatBaseUrl`

---

## 排错

| 现象 | 处理 |
|------|------|
| `404 … /responses`（直连 api.deepseek.com） | 必须走 8788 网关，勿把 `base_url` 指到官方域名 |
| `8788 Address already in use` | 检查是否已有旧进程；`model-gateways.sh restart` |
| Codex 仍走 OpenAI | 使用 `codex -p deepseek-v4-pro`，不要只用 `-m` |
| `GET /health` 失败 | `codex-responses-gateway.sh start` |
