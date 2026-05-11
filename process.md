flowchart TD

A[用户输入：openclaw 一句话任务] --> B[Cursor 执行阶段]

%% ===== Cursor Phase =====
B --> C[Cursor Agent 解析任务]

C --> C1[收集用户信息\nURL / API Key / Model]
C1 --> C2[生成初始配置与代码/脚本]
C2 --> C3[准备 OpenClaw 安装与配置方案]

C3 --> D[输出到 OpenClaw 执行]

%% ===== OpenClaw Phase =====
D --> E[OpenClaw 启动]

E --> E1[安装 OpenClaw CLI]
E1 --> E2[配置模型 / API Key]
E2 --> E3[启动 openclaw TUI]

E3 --> F[验证基础能力（hi test）]

F --> G[切换 OpenClaw Workflow]

G --> G1[安装 websearch skill]
G1 --> G2[验证 websearch]

G2 --> H[进入 Claude Code 相关流程]

H --> H1[安装 Claude Code]
H1 --> H2[Claude 内安装 websearch skill]

H2 --> I[执行 proxy bridge 接入]

I --> I1[加载 claude-code-proxy.html]
I1 --> I2[API 转发 / endpoint 重写]
I2 --> I3[连通性测试]

I3 --> J{全部系统验证通过?}

J -->|否| B
J -->|是| K[输出最终成功报告 😄]