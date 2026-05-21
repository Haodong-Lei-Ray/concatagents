# Claude Code 本地中转代理指南

这份文档写给后续接手的 agent：目标是在本机把 Claude Code 的请求稳定转发到非 Anthropic 上游，例如 DeepSeek 和 MiniMax，同时让 `/model` 菜单尽量清楚、配置文件不乱、网络策略交给用户环境控制。

## 最终目标

Claude Code 只暴露可用的本地中转模型选择：

1. `Default`：保留 Claude Code 的默认入口，但把默认 Opus model id 改成 `deepseek-v4-pro`，由本地代理路由到 DeepSeek。
2. `deepseek-v4-pro`：明确展示 DeepSeek V4 Pro。
3. `MiniMax-M2.7`：明确展示 MiniMax M2.7。

注意：Claude Code 的内置菜单会天然带 Default/Sonnet/Haiku 等选项。要压掉不可用的 Sonnet/Haiku，必须用 `~/.claude/settings.json` 的 `availableModels` 白名单。
/model 只能出现这个俩个模型
## 文件分工

- `api-local.json`：只放监听地址和各厂商上游信息。
- `scripts/claude-model-proxy.js`：本地 HTTP shim，按请求体里的 `model` 选择 route，并改写成上游真实 model id。
- `~/.bashrc` / `~/.zshrc`：设置 Claude Code 指向本地代理，并定义菜单显示的 model id/name/description。
- `~/.claude/settings.json`：限制 `/model` 菜单的可用模型白名单。
- `~/.config/systemd/user/claude-model-proxy.service`：守护本地代理进程。

## api-local.json 保持干净

不要把代理分流规则、Tyty 端口、`NO_PROXY`、`customRoute` 塞进 `api-local.json`。它应该只长这样：

```json
{
  "listen": {
    "bind": "127.0.0.1",
    "port": 3889
  },
  "routes": {
    "minimax": {
      "baseUrl": "https://api.minimaxi.com/anthropic",
      "apiKey": "sk-...",
      "model": "MiniMax-M2.7"
    },
    "deepseek": {
      "baseUrl": "https://api.deepseek.com/anthropic",
      "apiKey": "sk-...",
      "model": "deepseek-v4-pro",
      "matchModels": [
        "deepseek-v4-pro"
      ]
    }
  }
}
```

要点：

- `routes.<name>.model` 是上游真实接受的 model id。
- `matchModels` 可放 Claude Code 菜单里发出的额外 id。
- 不要提交真实 `apiKey`。

## 代理路由原则

代理不要再假设 “Custom 一定是 DeepSeek” 或 “Default 一定是 MiniMax”。正确做法是：

- 启动时遍历 `config.routes`。
- 把每个 route 的 `model` 和 `matchModels` 建成 `model id -> route` 映射。
- 请求体里的 `model` 命中映射时，走对应 route。
- 未命中的 Claude 内置 model id 可以 fallback 到 `routes.minimax`，避免 Sonnet/Haiku 被选中时直接炸。
- 转发前把请求体里的 `model` 改写成目标 route 的真实 `model`。
- 响应里如果带 `model`，尽量改回 Claude Code 原本请求的 id，减少 UI 混乱。

这能同时支持：

- `deepseek-v4-pro` -> `routes.deepseek`
- `MiniMax-M2.7` -> `routes.minimax`
- 未知 Claude 内置 id -> fallback `routes.minimax`

## 网络策略

本地 shim 不再维护 Tyty、HTTP CONNECT、gsettings 或强制清理代理环境等网络策略。

原则：Claude Code 只连本地 `127.0.0.1:3889`，本地 shim 只按 `api-local.json` 普通转发。外网能否访问、是否使用系统代理、VPN 或透明网关，由用户当前 shell/系统网络环境决定。不要在 `api-local.json` 中写 `upstreamProxy`、`directHosts`、`proxyHosts`、`routes.*.proxy`。

## Shell 环境

`~/.bashrc` 和 `~/.zshrc` 的关键段应表达清楚菜单语义：

```bash
unset OPENAI_API_KEY
unset OPENAI_BASE_URL
export ANTHROPIC_BASE_URL='http://127.0.0.1:3889'
export ANTHROPIC_API_KEY='local-claude-model-proxy'
export ANTHROPIC_AUTH_TOKEN="$ANTHROPIC_API_KEY"
export CLAUDE_PROXY_CONFIG="/home/lei/Project1/concatagents/api-local.json"

unset ANTHROPIC_MODEL
unset ANTHROPIC_SMALL_FAST_MODEL

export ANTHROPIC_DEFAULT_OPUS_MODEL="deepseek-v4-pro"
export ANTHROPIC_DEFAULT_OPUS_MODEL_NAME="deepseek-v4-pro"
export ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION="DeepSeek V4 Pro via local Claude model proxy"

unset ANTHROPIC_DEFAULT_SONNET_MODEL ANTHROPIC_DEFAULT_SONNET_MODEL_NAME ANTHROPIC_DEFAULT_SONNET_MODEL_DESCRIPTION
unset ANTHROPIC_DEFAULT_HAIKU_MODEL ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION

export ANTHROPIC_CUSTOM_MODEL_OPTION="MiniMax-M2.7"
export ANTHROPIC_CUSTOM_MODEL_OPTION_NAME="MiniMax-M2.7"
export ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION="MiniMax-M2.7 route via local Claude model proxy"
```

说明：

- `Default` 仍然存在，但它的真实 model id 会显示成 `deepseek-v4-pro`。
- MiniMax 用 Claude Code 的 Custom 槽位展示。
- 不要把 `ANTHROPIC_CUSTOM_MODEL_OPTION` 设成 DeepSeek，否则 MiniMax 会抢 Custom 槽位。

## Claude Code 菜单白名单

`~/.claude/settings.json` 要限制可用模型，否则 Sonnet/Haiku 会回来：

```json
{
  "availableModels": [
    "deepseek-v4-pro",
    "MiniMax-M2.7"
  ],
  "skipDangerousModePermissionPrompt": true,
  "theme": "dark-daltonized"
}
```

不要在这里写死 `"model": "MiniMax-M2.7"`，否则 Claude Code 会把当前模型固定成 MiniMax，DeepSeek 显示和选择都会变乱。

## systemd 单元

用户级 systemd 单元应尽量简单：

```ini
[Unit]
Description=Claude Code local model router (DeepSeek + MiniMax)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=CLAUDE_PROXY_PORT=3889
Environment=CLAUDE_PROXY_BIND=127.0.0.1
Environment=CLAUDE_PROXY_CONFIG=/home/lei/Project1/concatagents/api-local.json
ExecStart=/home/lei/.nvm/versions/node/v22.22.0/bin/node /home/lei/Project1/concatagents/scripts/claude-model-proxy.js
Restart=on-failure
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
```

改完单元后：

```bash
systemctl --user daemon-reload
systemctl --user restart claude-model-proxy.service
```

## 验收步骤

先做静态检查：

```bash
cd /home/lei/Project1/concatagents
node --check scripts/claude-model-proxy.js
node --check scripts/ping-api-local.js
bash -n ~/.bashrc
python3 -m json.tool ~/.claude/settings.json >/dev/null
```

确认 shell 读到的菜单变量：

```bash
bash -ic 'python3 -c "import os; keys=[
\"ANTHROPIC_BASE_URL\",
\"ANTHROPIC_DEFAULT_OPUS_MODEL\",
\"ANTHROPIC_DEFAULT_OPUS_MODEL_NAME\",
\"ANTHROPIC_CUSTOM_MODEL_OPTION\",
\"ANTHROPIC_CUSTOM_MODEL_OPTION_NAME\",
\"CLAUDE_PROXY_CONFIG\"
]; [print(k + \"=\" + os.environ.get(k, \"\")) for k in keys]"'
```

期望看到：

```text
ANTHROPIC_BASE_URL=http://127.0.0.1:3889
ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek-v4-pro
ANTHROPIC_DEFAULT_OPUS_MODEL_NAME=deepseek-v4-pro
ANTHROPIC_CUSTOM_MODEL_OPTION=MiniMax-M2.7
ANTHROPIC_CUSTOM_MODEL_OPTION_NAME=MiniMax-M2.7
CLAUDE_PROXY_CONFIG=/home/lei/Project1/concatagents/api-local.json
```

确认代理运行：

```bash
systemctl --user is-active claude-model-proxy.service
curl -fsS -m 3 http://127.0.0.1:3889/
journalctl --user -u claude-model-proxy.service -n 30 --no-pager
```

代理启动日志应包含：

```text
[claude-model-proxy] known models: MiniMax-M2.7, deepseek-v4-pro
```

最后重新打开 Claude Code，或至少在当前终端执行：

```bash
source ~/.bashrc
```

## 常见坑

- 菜单里只有 MiniMax，没有 DeepSeek：通常是 `ANTHROPIC_CUSTOM_MODEL_OPTION` 被设成 MiniMax，同时 Default 没被改成 DeepSeek，或 shell 没重新 source。
- 菜单里 Sonnet/Haiku 回来了：`~/.claude/settings.json` 缺少 `availableModels` 白名单，或 Claude Code 进程没重启。
- Custom 显示成 DeepSeek：说明 `ANTHROPIC_CUSTOM_MODEL_OPTION` 仍然是 `deepseek-v4-pro`，应改成 `MiniMax-M2.7`。
- Default 显示 Opus 4.7：说明 `ANTHROPIC_DEFAULT_OPUS_MODEL` 没被当前 shell 读到。
- 改了代理 JS 但日志还是旧行为：忘了 `systemctl --user restart claude-model-proxy.service`。
- `api-local.json` 变复杂：不要恢复 `upstreamProxy`、`routes.*.proxy` 或 Tyty 规则，保持 listen + routes 即可。

## 关键原则

本地中转代理的稳定性来自三点：

- 配置边界清晰：`api-local.json` 只描述上游，不描述网络策略。
- 菜单语义清晰：Default 表示 DeepSeek，Custom 表示 MiniMax。
- 路由按 model id 决定，不按 Claude Code 菜单槽位硬编码。
