# Hermes Agent 使用指南

> 官方文档: https://hermes-agent.nousresearch.com/docs/
> GitHub: https://github.com/NousResearch/hermes-agent
> 版本: v0.13.0 (2026.5.7)

---

## 安装

```bash
# 官方安装脚本（推荐）
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | sh

# 或通过 pip/uv
pip install hermes-cli
uv tool install hermes-cli
```

安装路径: `~/.hermes/hermes-agent/`
可执行文件: `~/.local/bin/hermes`

---

## 基础使用

### 启动方式

```bash
# 交互式 TUI（推荐）
hermes

# 单次提问（非交互）
hermes -z "你的问题"

# 指定模型
hermes -m deepseek-v4-pro --provider custom

# 指定 provider
hermes --provider custom

# YOLO 模式（自动确认所有工具调用，不打断）
hermes --yolo

# 继续上次会话
hermes --continue

# 恢复指定 session
hermes --resume <session-id>

# 带 TUI 强制启动
hermes --tui
```

### 配置文件

```bash
# 查看配置
hermes config show

# 编辑配置
hermes config edit

# 设置某项
hermes config set model.default deepseek-v4-pro

# 查看配置文件路径
hermes config path        # → ~/.hermes/config.yaml
hermes config env-path    # → ~/.hermes/.env（API Keys）
```

---

## Skills 技能系统

### 搜索与安装

```bash
# 搜索技能
hermes skills search <关键词>
hermes skills search comfyui --source clawhub

# 浏览所有可用技能（分页）
hermes skills browse

# 预览技能（不安装）
hermes skills inspect <skill-id>

# 安装技能
hermes skills install <skill-id>
hermes skills install openai/skills/skill-creator

# 从 URL 直接安装
hermes skills install https://example.com/path/to/SKILL.md --name my-skill

# 跳过确认
hermes skills install <skill-id> --yes
```

### 管理已安装技能

```bash
# 查看已安装列表
hermes skills list

# 检查更新
hermes skills check

# 更新所有技能
hermes skills update

# 启用/禁用（交互式）
hermes skills config

# 卸载
hermes skills uninstall <skill-name>

# 添加自定义 GitHub 来源
hermes skills tap add <github-user/repo>
hermes skills tap list
hermes skills tap remove <tap-name>
```

### 唤起技能

在交互对话中，**直接用自然语言**触发，hermes 自动匹配：

```
> 帮我画一个系统架构图          # → architecture-diagram
> 用 excalidraw 画流程图        # → excalidraw
> 生成一段 ASCII art            # → ascii-art
> 帮我看 GitHub issues          # → github-issues
```

也可以启动时明确指定：

```bash
# 指定单个技能
hermes --skills ascii-art

# 指定多个技能
hermes --skills "github-issues,codebase-inspection"

# 一次性调用并指定技能
hermes -z "帮我生成一张图" --skills comfyui
```

---

## 消息队列与非打断式运行 ⭐

这是 Hermes 最重要的并发控制机制。当 Agent 正在执行任务时，你有 **4 种**方式发送新消息：

### 对比总览

| 方式 | 命令 | 行为 | 是否打断当前任务 |
|------|------|------|-----------------|
| 直接发送 | 普通输入 | **中断**当前任务，立即响应新消息 | ✅ 打断 |
| 队列模式 | `/queue <消息>` | 当前任务完成后再执行 | ❌ 不打断 |
| 后台并行 | `/bg <消息>` 或 `/btw <消息>` | 异步并行运行，不影响主任务 | ❌ 不打断 |
| 软引导 | `/steer <消息>` | 在下一次工具调用后注入，轻柔引导方向 | ❌ 不打断 |

---

### `/queue` — 排队等待（推荐 ✅）

**当前任务跑完之后再执行你的新消息。** 适合你想继续追问、补充需求，但不想打断当前长任务的场景。

```
/queue 任务完成后，再帮我写一份总结报告
/queue 顺便检查一下有没有语法错误
```

- 当前 Agent 循环**不会被中断**
- 队列中的消息在当前回合结束后**按顺序**依次执行
- 可以连续 `/queue` 多条，形成任务链

---

### `/bg` / `/btw` — 后台并行

**立即启动一个异步并行任务**，与当前主任务同时运行，互不干扰。

```
/bg 同时去查一下最新的 API 文档
/btw 顺手把 README 更新一下
```

- 主任务继续运行，后台任务独立执行
- 适合不依赖主任务结果的独立子任务
- 结果会在后台完成后回显

---

### `/steer` — 软引导

**在下一次工具调用完成后注入消息**，温和地调整 Agent 的执行方向，不强制中断。

```
/steer 注意要保留原有的注释，不要删掉
/steer 先处理 Python 文件，跳过测试文件
```

- 比直接中断更"礼貌"，等待一个自然停顿点
- 适合微调方向而不是完全改变任务

---

### `/busy` — 配置默认行为

控制**直接按 Enter 发送消息时**（非 slash 命令）的默认行为：

```
/busy queue       # 默认排队，不打断
/busy steer       # 默认软引导
/busy interrupt   # 默认打断（系统默认）
/busy status      # 查看当前配置
```

> 💡 **推荐设置**: `/busy queue`，这样你平时直接发消息也不会打断任务，更安全。

---

### 其他会话控制命令

```bash
# 查看当前运行中的 agents 和任务
/agents

# 停止所有后台进程
/stop

# 审批危险命令
/approve
/deny

# 重试上一条消息
/retry

# 撤销上一次对话
/undo

# 回滚文件系统到某个检查点
/rollback

# 压缩对话上下文（节省 token）
/compress
```

---

## 模型管理

```bash
# 交互式切换模型
hermes model
# 或在对话中
/model

# 启动时指定
hermes -m deepseek-v4-pro --provider custom
hermes -m claude-sonnet-4-6 --provider custom

# 查看 fallback 配置
hermes fallback --help
```

---

## 会话管理

```bash
# 浏览历史会话
hermes sessions
# 或在对话中
/sessions

# 继续上次会话
hermes --continue

# 恢复指定名称的会话
hermes --resume <session-name-or-id>
# 或在对话中
/resume <name>

# 为当前会话命名
/title 我的项目会话

# 分支当前会话（探索不同路径）
/branch

# 新建会话
/new
```

---

## 定时任务 Cron

```bash
# 在对话中管理定时任务
/cron list
/cron add
/cron pause <id>
/cron resume <id>
/cron remove <id>
/cron run <id>    # 立即触发
```

---

## 更新与维护

```bash
# 检查并更新 hermes
hermes update

# 诊断问题
hermes doctor

# 查看日志
hermes logs

# 导出诊断数据（提交 bug 用）
hermes export
```

---

## 本机配置参考

| 项目 | 值 |
|------|----|
| 配置文件 | `~/.hermes/config.yaml` |
| API Keys | `~/.hermes/.env` |
| Provider | `custom` |
| Base URL | `http://35.220.164.252:3888/v1` |
| 默认模型 | `deepseek-v4-pro` |
| 可用模型 | `deepseek-v4-pro` ✅ `claude-sonnet-4-6` ✅ `claude-opus-4-7-thinking` ✅ |
| 不可用模型 | `gpt-4o` ❌ `gpt-5.3-codex` ❌ |

使用 custom provider 时需加 `--provider custom` 参数（或在配置里固定）。

---

*文档更新时间: 2026-05-11*
