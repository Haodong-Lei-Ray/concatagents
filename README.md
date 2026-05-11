# 🦞🤖 Concat Agent Harness 一句话安装指南

你是否还在犹豫换台机器又要重装agent的焦虑，别担心，我一句话这里有一句话就能安装完的一个流程。

目标：在 `openclaw` 中用“一句话任务”自动完成 Agent Harness 全链路安装与验证。

## 一句话总命令（交给 Agent 执行）

```bash
openclaw "请作为安装代理执行以下流程：1) 先暂停并提示我提供 URL、API Key、可用 model；2) 安装并初始化 OpenClaw，配置模型后用 hi 测试 openclaw tui；3) 切换到 openclaw 工作流，为其安装 websearch skill 并验证；4) 安装 Claude Code（按官方文档）；5) 在 Claude 工作流中也安装 websearch skill 并验证；6) 使用 /home/lei/personality/concatagents/claude-code-proxy.html 的桥接方案完成 Claude Code API 桥接；7) 全部完成后输出验证结果并恭喜我，带一个笑脸表情。"
```

## 标准执行步骤（Agent 内部应遵循）

### 1) 必须先中断，等待用户准备凭据

Agent 首次执行时必须停下来，明确提示用户准备：

- `URL`
- `API Key`
- `可用 model 名称`

并在拿到这三项后再继续下一步。

### 2) 安装 OpenClaw 并验证 TUI

参考 OpenClaw 官方一键安装：

```bash
curl -fsSL https://openclaw.ai/install.sh | bash
npm i -g openclaw
```

完成后配置模型，然后验证：

```bash
openclaw
# 在 TUI 中发送：hi
```

验收标准：`openclaw tui` 可正常进入，`hi` 有有效回复。

### 3) 切换到 OpenClaw 工作流并安装 WebSearch skill

在 OpenClaw 内执行（名称可按仓库实际 skill 名调整）：

```bash
# 示例：按实际可用 skill 仓库/市场安装
openclaw skill add websearch
openclaw skill list
```

验收标准：`websearch` skill 出现在已安装列表，且可被调用一次并返回结果。

### 4) 安装 Claude Code（官方方式）

按 Claude Code 官方文档安装（Linux/macOS）：

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

可选验证：

```bash
claude --version
```

### 5) 在 Claude 工作流中安装 WebSearch skill

在 Claude 侧完成安装并验证（命令按实际可用方式调整）：

```bash
# 示例：在 Claude 可用的 skill/插件机制中安装 websearch
claude skill add websearch
claude skill list
```

验收标准：Claude 侧 `websearch` 已安装，且能完成 1 次搜索调用。

### 6) 使用 `claude-code-proxy.html` 执行桥接手术

桥接说明文件：

- `/home/lei/personality/concatagents/claude-code-proxy.html`

要求 Agent 按该文档的方法完成：

- 本地代理/转发层部署
- Claude Code API 基地址改写
- 模型映射与连通性验证

至少验证一次：

```bash
claude
# 发起一个最小请求，确认经桥接可正常返回
```

### 7) 收尾提示（必须）

所有步骤完成后，Agent 必须输出类似：

`安装完成，全部 Agent Harness 已可用，恭喜你 😄`

---

## 推荐给 Agent 的“中断提示模板”

可直接复用：

`继续安装前请先提供：1) 目标 URL，2) API Key，3) 一个可用 model 名称。我收到后立即继续自动安装。`

---

## 参考链接

- OpenClaw 官网与安装入口：[https://openclaw.ai/](https://openclaw.ai/)
- Claude Code Overview（安装说明）：[https://code.claude.com/docs/en/overview](https://code.claude.com/docs/en/overview)

## 流程图（Mermaid）

```mermaid
flowchart TD
A["用户输入: openclaw 一句话任务"] --> B["Cursor 执行阶段"]
B --> C["Cursor Agent 解析任务"]
C --> C1["收集用户信息: URL / API Key / Model"]
C1 --> C2["生成初始配置与代码脚本"]
C2 --> C3["准备 OpenClaw 安装与配置方案"]
C3 --> D["输出到 OpenClaw 执行"]
D --> E["OpenClaw 启动"]
E --> E1["安装 OpenClaw CLI"]
E1 --> E2["配置模型与 API Key"]
E2 --> E3["启动 openclaw TUI"]
E3 --> F["验证基础能力 hi test"]
F --> G["切换 OpenClaw Workflow"]
G --> G1["安装 websearch skill"]
G1 --> G2["验证 websearch"]
G2 --> H["进入 Claude Code 相关流程"]
H --> H1["安装 Claude Code"]
H1 --> H2["Claude 内安装 websearch skill"]
H2 --> I["执行 proxy bridge 接入"]
I --> I1["加载 claude-code-proxy.html"]
I1 --> I2["API 转发与 endpoint 重写"]
I2 --> I3["连通性测试"]
I3 --> J{"全部系统验证通过?"}
J -->|否| B
J -->|是| K["输出最终成功报告"]
```

## Q&A

### Q1：为什么以 OpenClaw 作为入口？

A：因为 OpenClaw 当前可用性更高，作为入口可以更早用上更强模型。在你的实际使用场景里，这比直接依赖 Cursor 内部高阶模型更划算（后者通常需要额外付费）。

### Q2：为什么不安装 Hermes、Kimi、OpenCode？

A：主要是稳定性和兼容性问题。

- **Kimi**：在 `MiniMax 2.7` 场景下出现过直接崩溃。
- **OpenCode**：在 `dpsk` 场景下出现过乱码输出。
- **Hermes**：在 Windows 环境出现大量符号错误。

因此当前流程优先选择更稳定、可持续运行的方案，避免在关键链路中引入高风险组件。

### Q3：如果服务器较老、Cursor 无法安装怎么办？

A：在部分较老的服务器环境中，确实会出现 Cursor 安装失败或运行不稳定的情况。此时建议直接安装并使用 Claude Code，先保证核心能力可用，再按需补齐其他组件。
