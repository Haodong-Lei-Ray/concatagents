# Hermes Gateway 代理问题处理指南

## 一、Gateway 的两条飞书通道

Gateway 访问飞书有**两条独立通道**，各自走不同的网络路径：

```
┌──────────────────────────────────────────────────────┐
│                    Hermes Gateway                     │
│                                                       │
│   通道 A（WebSocket 长连接）                            │
│   用途：接收用户消息（被动）                            │
│   路径：wss://msg-frontier.feishu.cn/ws/v2           │
│   代理：无  ← 走系统 systemd 服务，不继承桌面代理         │
│                                                       │
│   通道 B（HTTP API 调用）                              │
│   用途：发送回复消息（主动）                           │
│   路径：https://open.feishu.cn/open-apis/...          │
│   代理：无  ← 同上，系统服务无代理环境变量               │
│                                                       │
└──────────────────────────────────────────────────────┘
        ↑                                        ↑
   飞书 WebSocket                         飞书 OpenAPI
   (收消息)                               (发消息)
```

两条通道**缺一不可**：
- 通道 A 断了 → 收不到用户消息
- 通道 B 断了 → 能收到消息，但回复发不出去

本次修复针对的是**通道 B（发消息）**的 DNS 解析失败问题。

---

## 二、如何判断是哪条通道出问题

### 看日志关键词

| 日志关键词 | 问题通道 | 典型错误 |
|-----------|---------|---------|
| `wss://msg-frontier.feishu.cn` | 通道 A | WebSocket 连接失败 |
| `open.feishu.cn` 且是 `GET/POST` | 通道 B | API 请求 DNS 解析失败 |
| `ConnectionError` / `NameResolutionError` | 通道 B | 同上 |

### 快速测试命令

```bash
# 测试通道 A（WebSocket）
curl -v --max-time 5 https://msg-frontier.feishu.cn

# 测试通道 B（OpenAPI）
curl -v --max-time 5 https://open.feishu.cn/open-apis/im/v1/messages
```

---

## 三、如果 OpenAPI 的 URL 也需要代理转发

### 问题场景

某些网络环境下，访问 `https://open.feishu.cn` 需要先经过代理（如公司内网环境）。如果 gateway 的 systemd 服务没有配置代理，API 调用同样会失败。

### 解决方案：环境变量注入

修改 wrapper 脚本，把代理环境变量永久写入（与通道 A 的处理方式完全一致）：

```bash
#!/bin/bash
# 检测代理是否存活（可选：代理可能没开）
if curl -s --max-time 2 -x http://127.0.0.1:9674 http://www.baidu.com > /dev/null 2>&1; then
    export HTTPS_PROXY=http://127.0.0.1:9674/
    export HTTP_PROXY=http://127.0.0.1:9674/
    export ALL_PROXY=socks5://127.0.0.1:9674/
    export NO_PROXY=localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,::1
fi
exec /home/lei/.hermes/hermes-agent/venv/bin/python -m hermes_cli.main gateway run --replace
```

### 关键点：为什么要用 wrapper 脚本而不是 systemd Environment？

用 wrapper 的好处是**动态检测**——代理开着就加环境变量，没开就不加。如果 hardcode 写进 systemd 的 `Environment=`，那么代理没开时 gateway 会尝试连接一个不存在的代理地址，反而导致完全连不上。

---

## 四、其他可能需要代理的 URL

如果公司网络对以下域名都有代理要求，按相同方式处理：

| 域名 | 用途 |
|------|------|
| `open.feishu.cn` | 飞书 OpenAPI |
| `msg-frontier.feishu.cn` | 飞书 WebSocket |
| `open.feishu.cn` | 飞书 OpenAPI 发送消息 |
| `www.baidu.com` | 代理存活检测（wrapper 脚本中） |

只需在 wrapper 脚本中加上对应的 `HTTPS_PROXY`/`HTTP_PROXY` 环境变量即可，gateway 进程会自动对新建立的 HTTP/WebSocket 连接使用这些变量。

---

## 五、修改步骤汇总

如果未来需要给 gateway 加代理（如换了代理端口或新增域名）：

1. 编辑 wrapper 脚本：
   ```bash
   sudo nano /usr/local/bin/hermes-gateway-wrapper.sh
   ```

2. 修改 `curl` 检测地址和代理端口

3. 重载并重启：
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart hermes-gateway.service
   ```

4. 验证：
   ```bash
   sudo systemctl status hermes-gateway.service
   tail -f ~/.hermes/logs/gateway.log
   ```
