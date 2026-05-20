# Claude Code 双模型参考

## api-local.json 结构

```json
{
  "listen": { "bind": "127.0.0.1", "port": 3889 },
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
      "matchModels": ["deepseek-v4-pro"]
    }
  }
}
```

- `routes.deepseek` 默认就是代理里「custom 上游」对应的 route；不需要额外写 `customRoute`
- `matchModels`：额外 model id 也走该 route（用于 Claude 自定义槽位 id）

## 环境变量（shell）

| 变量 | 用途 |
|------|------|
| `ANTHROPIC_BASE_URL` | 指向本地代理 `http://127.0.0.1:3889` |
| `ANTHROPIC_API_KEY` | 占位即可（如 `local-claude-model-proxy`） |
| `ANTHROPIC_CUSTOM_MODEL_OPTION` | 槽位 5 请求的 model id（须与 deepseek route 一致或在 matchModels 中） |
| `ANTHROPIC_CUSTOM_MODEL_OPTION_NAME` | 槽位 5 显示名 |
| `CLAUDE_PROXY_CONFIG` | `api-local.json` 绝对路径 |

不建议再设置 `ANTHROPIC_DEFAULT_OPUS_MODEL` 等覆盖，除非要把槽位 1 显示为 MiniMax 名称。

## systemd

```bash
systemctl --user restart claude-model-proxy.service
journalctl --user -u claude-model-proxy -n 30 --no-pager
```

## Tyty 开关

现在不再把 Tyty 规则写进 `api-local.json`。网关主变量是 `tyty_flag`，也兼容大写 `TYTY_FLAG`：

- `tyty_flag=false`（默认）：启动时清除进程内 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY`，并强制直连上游，主动避开 Tyty 的 HTTP 代理环境。
- `tyty_flag=true`：不做任何转代理逻辑，也不检测 gsettings 或 Tyty 端口；普通网络连接交给 Tyty 虚拟网卡自动接管。

systemd 模式切换：

```bash
tyty_flag=true ./scripts/claude-code-proxy.sh install-unit
./scripts/claude-code-proxy.sh restart
```

日志示例：`tyty_flag=true (leave routing to OS/Tyty TUN)`，上游行仍应是 `upstream api.minimaxi.com -> direct`。

## 与 agent-model-repair 的分工

- **claude-code-models**：只管 Claude Code + 本地代理 + `api-local.json` 双路由
- **agent-model-repair**：OpenClaw / Hermes / 多网关密钥探测与修复
