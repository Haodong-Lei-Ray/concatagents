# cc-connect 钉钉安装指南

cc-connect 是一个将本地 AI 编码 Agent（Claude Code、Codex、Cursor 等）桥接到各类聊天平台（钉钉、飞书、Telegram、Discord 等）的工具。

GitHub: https://github.com/chenhg5/cc-connect

## 前提条件

- Node.js >= 18（推荐 v20+）
- Claude Code CLI 已安装并认证
- Go 1.22+（如需源码编译）

## 一、安装 cc-connect

### 方法 A: npm（推荐）

```bash
npm install -g cc-connect
```

### 方法 B: Homebrew

```bash
brew install cc-connect
```

### 方法 C: 直接下载二进制

从 [GitHub Releases](https://github.com/chenhg5/cc-connect/releases) 下载对应平台的二进制文件。

### 方法 D: 源码编译

```bash
git clone https://github.com/chenhg5/cc-connect.git
cd cc-connect
make build
```

## 二、配置

### 1. 生成默认配置

```bash
cc-connect setup
```

配置文件位置：`~/.cc-connect/config.toml`

### 2. 编辑配置

```toml
# cc-connect configuration
# Docs: https://github.com/chenhg5/cc-connect

[log]
level = "info"

[[projects]]
name = "my-project"

[projects.agent]
type = "claudecode"

[projects.agent.options]
work_dir = "/path/to/your/project"  # 修改为你的工作目录
mode = "default"

# DingTalk / 钉钉
[[projects.platforms]]
type = "dingtalk"

[projects.platforms.options]
client_id = "your-dingtalk-client-id"       # 替换为你的 Client ID
client_secret = "your-dingtalk-client-secret"  # 替换为你的 Client Secret
allow_from = "*"  # 允许所有用户，或指定员工 ID
```

## 三、获取钉钉凭证

1. 打开 [钉钉开放平台](https://open-dev.dingtalk.com/)
2. 创建或进入你的应用
3. 在「凭证与基础信息」中获取 `Client ID` 和 `Client Secret`
4. 确保应用已配置机器人并选择了 **Stream 模式**

## 四、启动

### 前台运行

```bash
cc-connect run
```

### 后台运行

```bash
nohup cc-connect run > cc-connect.log 2>&1 &
```

### 验证运行状态

```bash
cc-connect status
```

### 查看日志

```bash
cc-connect logs
```

### 停止

```bash
pkill -f "cc-connect"
```

## 五、常用命令

| 命令 | 说明 |
|------|------|
| `cc-connect setup` | 生成默认配置 |
| `cc-connect run` | 启动 |
| `cc-connect status` | 查看状态 |
| `cc-connect logs` | 查看日志 |
| `cc-connect sessions` | 列出所有会话 |
| `cc-connect stop` | 停止 |
| `cc-connect upgrade` | 升级（需配置 admin_from） |

## 六、代理问题

### 问题描述

```
dingtalk: stream disconnected, reconnecting
error="Post \"https://api.dingtalk.com/v1.0/gateway/connections/open\": context deadline exceeded"
```

钉钉 Stream 连接需要访问 `api.dingtalk.com`，国内可能需要代理。

### 解决方案

#### 方案 1: Clash 增强模式（推荐）

在 Clash Dashboard 中开启「增强模式」或「TUN 模式」，让所有流量走代理。

#### 方案 2: 设置环境变量（cc-connect 可能不完全支持）

```bash
export ALL_PROXY=socks5://127.0.0.1:7897
export HTTPS_PROXY=http://127.0.0.1:7897
export HTTP_PROXY=http://127.0.0.1:7897
cc-connect run
```

注意：cc-connect 的 Go HTTP 客户端默认不走代理，增强模式是更可靠的方案。

## 七、多项目管理

cc-connect 支持一个配置文件中管理多个项目：

```toml
[[projects]]
name = "project-1"
[projects.agent]
type = "claudecode"
[projects.agent.options]
work_dir = "/path/to/project1"
[[projects.platforms]]
type = "dingtalk"
[projects.platforms.options]
client_id = "xxx"
client_secret = "xxx"

[[projects]]
name = "project-2"
[projects.agent]
type = "claudecode"
[projects.agent.options]
work_dir = "/path/to/project2"
[[projects.platforms]]
type = "telegram"
[projects.platforms.options]
token = "xxx"
```

## 八、支持的平台

- DingTalk（钉钉）
- Feishu / Lark（飞书）
- Telegram
- Discord
- Slack
- LINE
- WeChat Work（企业微信）
- QQ
- Weixin（个人微信 via ilink）
- WeCom（腾讯企点）
- Weibo
- MAX

## 九、支持的 Agent

- Claude Code
- Codex
- Cursor
- Gemini CLI
- Qoder
- OpenCode
- iFlow

## 十、配置示例

### 钉钉 + Claude Code

```toml
[log]
level = "info"

[[projects]]
name = "my-project"

[projects.agent]
type = "claudecode"

[projects.agent.options]
work_dir = "/home/user/project"
mode = "default"

[[projects.platforms]]
type = "dingtalk"

[projects.platforms.options]
client_id = "dinggojmvdff3xxxxxx"
client_secret = "your-secret"
allow_from = "*"
```

### 钉钉 + 飞书 + Claude Code

```toml
[log]
level = "info"

[[projects]]
name = "my-project"

[projects.agent]
type = "claudecode"

[projects.agent.options]
work_dir = "/home/user/project"
mode = "default"

[[projects.platforms]]
type = "dingtalk"

[projects.platforms.options]
client_id = "dinggojmvdff3xxxxxx"
client_secret = "your-secret"
allow_from = "*"

[[projects.platforms]]
type = "feishu"

[projects.platforms.options]
app_id = "your-feishu-app-id"
app_secret = "your-feishu-app-secret"
```
