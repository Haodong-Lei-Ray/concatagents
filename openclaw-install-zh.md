# OpenClaw 安装流程（仅 Agent）

Agent 在执行所有 OpenClaw 相关任务时，必须优先遵循本文件。

## 适用范围

本文件定义从主 README 中拆分出来的 OpenClaw 独立流程：

- OpenClaw 安装与初始化
- 模型 / API 配置
- TUI 验证（`hi`）
- OpenClaw 侧 `websearch` skill 安装与验证

## 分步执行

### 1) 先中断并收集信息（必须）

正式安装前，先暂停并向用户收集：

- `URL`
- `API Key`
- `可用 model 名称`

三项全部拿到后再继续。

### 2) 安装 OpenClaw

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
npm i -g openclaw
```

必须：请在 OpenClaw 配置中禁用 WhatsApp 集成，以减少运行负担并避免不必要的通道开销。

### 3) 配置模型并启动 TUI

```bash
openclaw
# 发送：hi
```

验收标准：

- `openclaw tui` 正常启动
- `hi` 收到有效回复

### 4) 安装并验证 OpenClaw 的 WebSearch Skill

```bash
# 示例命令，按实际 skill 源或注册中心调整
openclaw skill add websearch
openclaw skill list
```

验收标准：

- 已安装列表中出现 `websearch`
- 至少 1 次搜索调用返回有效结果

## 推荐中断提示词

`继续前请先提供：1) 目标 URL，2) API Key，3) 一个可用 model 名称。收到后我将继续自动安装流程。`

