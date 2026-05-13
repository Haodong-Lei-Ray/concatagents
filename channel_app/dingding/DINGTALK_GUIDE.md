# ClaudeTalk 钉钉安装指南

将 Claude Code 接入钉钉，通过钉钉机器人直接与 Claude Code 对话。

## 前提条件

- Node.js >= 18（推荐 v20+）
- Claude Code CLI 已安装并认证

## 一键安装（复制整段发给 Claude Code）

```
在 claude code 中执行以下步骤：

1. 克隆并安装 ClaudeTalk：
   git clone https://github.com/suyin58/claudetalk.git && cd claudetalk && npm install && npm run build && npm link

2. 运行交互式配置向导：
   claudetalk --setup

   根据提示输入：
   - 选择平台：dingtalk
   - 输入钉钉凭证：
     DINGTALK_CLIENT_ID: 你的钉钉应用 Client ID
     DINGTALK_CLIENT_SECRET: 你的钉钉应用 Client Secret

3. 启动机器人：
   claudetalk --profile default

4. 在钉钉中向你的机器人发送消息，即可开始对话。
```

## 获取钉钉凭证

1. 打开 [钉钉开放平台](https://open-dev.dingtalk.com/)
2. 创建或进入你的应用
3. 在「凭证与基础信息」中获取 `Client ID` 和 `Client Secret`
4. 确保应用已配置机器人并发布了消息接收权限

## 验证安装

安装成功后，终端会显示：

```
🚀 ClaudeTalk 启动中...
📁 工作目录: C:\Users\xxx\claudetalk
🎭 角色: default
[dingtalk default] DingTalk Stream connected
[dingtalk default] dingtalk Bot 已启动
```

向钉钉机器人发一条消息，Claude Code 会自动回复。

## 多角色配置

如需多个机器人角色（如 PM、开发、测试）：

```bash
claudetalk --setup auto
```

或手动配置：

```bash
claudetalk --setup --profile dev
```

启动指定角色：

```bash
claudetalk --profile dev
```

## 查看聊天记录

- 运行日志：`.claudetalk/claudetalk-YYYY-MM-DD.log`
- 会话管理：`/resume` 查看并恢复历史对话
