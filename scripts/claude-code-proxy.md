# Claude Code 本地代理 CLI

`claude-code-proxy.sh` 是管理本机 **Claude Code 模型网关** 的小型命令行工具。网关即 `claude-model-proxy.js`：在 `127.0.0.1:3889` 监听，把 Claude Code 的 Anthropic 兼容请求按 `model` 转发到 MiniMax、DeepSeek 等上游。

适合日常：**看一眼网关是否正常**、启停服务、导出环境变量、改完 `api-local.json` 后做端到端验收。

---

## 快速开始

```bash
# 建议加入 PATH 或做别名
export CONCATAGENTS="$HOME/Project1/concatagents"
alias ccp="$CONCATAGENTS/scripts/claude-code-proxy.sh"

ccp status          # 网关是否在听、systemd 是否 active
ccp verify          # 健康检查 + 双模型对话探测
```

脚本路径（绝对路径）：

```text
/home/lei/Project1/concatagents/scripts/claude-code-proxy.sh
```

---

## 架构一览

```text
Claude Code CLI
  │  ANTHROPIC_BASE_URL=http://127.0.0.1:3889
  │  ANTHROPIC_API_KEY=local-claude-model-proxy   （占位，非真实密钥）
  ▼
claude-model-proxy.js  ← 本 CLI 管理的「网关」
  │  读 api-local.json（CLAUDE_PROXY_CONFIG）
  │  模型路由：deepseek-v4-pro → routes.deepseek；其它 id → routes.minimax
  │  tyty_flag=false：清除进程内 HTTP_PROXY/HTTPS_PROXY/ALL_PROXY，并直连上游
  │  tyty_flag=true：不做转代理逻辑，普通直连 socket 交给 Tyty 虚拟网卡接管
  ▼
上游 Anthropic 兼容 API
  · https://api.minimaxi.com/anthropic
  · https://api.deepseek.com/anthropic
```

| 文件 | 作用 |
|------|------|
| `scripts/claude-code-proxy.sh` | 本 CLI |
| `scripts/claude-model-proxy.js` | 网关进程（Node HTTP） |
| `scripts/upstream-http.js` | 上游 HTTP/HTTPS 请求实现 |
| `api-local.json` | `listen` 与各上游厂商 URL、API Key、模型 id（勿提交 git） |
| `~/.bashrc` / `~/.zshrc` | 常驻 `ANTHROPIC_*`、`CLAUDE_PROXY_CONFIG` |
| `~/.config/systemd/user/claude-model-proxy.service` | 用户级 systemd；可写入 `tyty_flag` |

改上游密钥或模型时，编辑 `api-local.json` 后执行 **`restart`**，再 **`verify`**。

---

## Tyty 开关（重要）

现在不再把 Tyty 规则写进 `api-local.json`。网关主变量是 `tyty_flag`，也兼容大写 `TYTY_FLAG`：

| 值 | 行为 |
|----|------|
| `tyty_flag=false`（默认） | 启动时清除 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 等环境变量，并强制直连上游，避免误走 Tyty 的 HTTP 代理端口。 |
| `tyty_flag=true` | 不做任何转代理逻辑，也不尝试检测 gsettings 或 Tyty 端口；普通网络连接交给 Tyty 虚拟网卡自动接管。 |

`api-local.json` 只保留：

```json
{
  "listen": { "bind": "127.0.0.1", "port": 3889 },
  "routes": {
    "minimax": { "baseUrl": "...", "apiKey": "...", "model": "MiniMax-M2.7" },
    "deepseek": { "baseUrl": "...", "apiKey": "...", "model": "deepseek-v4-pro" }
  }
}
```

写入 systemd 时可这样选择模式：

```bash
tyty_flag=true ./scripts/claude-code-proxy.sh install-unit
./scripts/claude-code-proxy.sh restart
```

### 日志里如何确认分流

```bash
ccp logs
```

正常应看到类似：

```text
[claude-model-proxy] tyty_flag=false (strip proxy env; force direct upstream)
[claude-model-proxy][minimax] upstream api.minimaxi.com -> direct
[claude-model-proxy][custom] upstream api.deepseek.com -> direct
```

---

## 命令参考

### `status` — 查看网关状态（最常用）

检查：配置路径、监听地址、systemd 是否 `active`、`GET /` 是否返回 `200`。

```bash
./scripts/claude-code-proxy.sh status
```

典型成功输出：

```text
repo:      /home/lei/Project1/concatagents
proxy js:  .../scripts/claude-model-proxy.js
config:    .../api-local.json
listen:    http://127.0.0.1:3889

systemd:   active (claude-model-proxy.service)
MainPID=...
ActiveState=active

http GET /: 200 OK
```

| 现象 | 可能原因 |
|------|----------|
| `systemd: inactive` | 服务未启动 → `start` 或 `install-unit && start` |
| `http GET /: FAIL` | 进程挂了或端口被占用 → `logs`、`restart` |
| 缺少 `api-local.json` | 脚本直接报错退出 |

---

### `env` — 导出 Claude Code 环境变量

向 stdout 打印 `export ...`，供当前 shell 加载（与 `~/.bashrc` 中代理段一致）。

```bash
eval "$(./scripts/claude-code-proxy.sh env)"
```

会设置：

- `ANTHROPIC_BASE_URL` → 本地网关（默认 `http://127.0.0.1:3889`）
- `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` → 占位符 `local-claude-model-proxy`
- `CLAUDE_PROXY_CONFIG` → `api-local.json` 绝对路径
- `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1`

**何时用：** 新开的终端还没 `source ~/.bashrc`、CI/脚本里要临时走代理、或排查「环境没配对」时。

---

### `start` / `stop` / `restart` — 管理 systemd 用户服务

| 命令 | 说明 |
|------|------|
| `start` | 启动 `claude-model-proxy.service`；若无 unit 会先 `install-unit` |
| `stop` | 停止服务 |
| `restart` | 重启后自动再跑一遍 `status` |

```bash
./scripts/claude-code-proxy.sh restart
```

**何时用：** 修改 `api-local.json`、升级 Node、或代理异常后恢复。

---

### `run` — 前台运行（调试）

不经过 systemd，直接 `node claude-model-proxy.js`，日志打在终端；`Ctrl+C` 结束。

```bash
./scripts/claude-code-proxy.sh run
```

**注意：** 若 systemd 已在占用 `3889`，前台启动会端口冲突。调试前先 `stop`。

**何时用：** 看实时 `[claude-model-proxy][minimax] model-id -> ...` 路由日志。

---

### `install-unit` — 安装 / 重装 systemd 单元

写入 `~/.config/systemd/user/claude-model-proxy.service`，`daemon-reload` 并 `enable`。

```bash
./scripts/claude-code-proxy.sh install-unit
```

- 自动检测 `node`（`PATH` → 默认 nvm `v22.22.0`）
- 可通过环境变量 `NODE=/path/to/node` 覆盖
- unit 内带 `tyty_flag`，重装 unit 可切换是否交给 Tyty 虚拟网卡接管

**登录后自动启动**（可选）：

```bash
loginctl enable-linger "$USER"
```

---

### `verify` — 网关 + 双模型验收

1. 执行 `status`（失败也继续，便于看完整报告）
2. `eval` 代理环境
3. 调用 `skills/claude-code-models/scripts/claude_models.py verify`：
   - `curl` 本地 `GET /`
   - `claude --model <minimax-model> -p "只回复 hi"`
   - `claude --model <deepseek-model> -p "只回复 hi"`

```bash
./scripts/claude-code-proxy.sh verify
```

**何时用：** 换密钥、改路由、系统更新后确认 Claude Code 两条链路都能对话。

依赖：`curl`、`python3`、`claude` 在 PATH 中。

---

### `logs` — 查看代理日志

```bash
./scripts/claude-code-proxy.sh logs
```

等价于：

```bash
journalctl --user -u claude-model-proxy.service -n 80 --no-pager
```

**何时用：** `status` 显示 active 但 Claude 仍 502；查上游连接错误、model 改写记录、`upstream ... -> direct` 行。

---

### `help` — 帮助

```bash
./scripts/claude-code-proxy.sh help
# 或
./scripts/claude-code-proxy.sh
```

---

## 常用工作流

### 每日：确认网关正常

```bash
ccp status
```

### 修改 `api-local.json` 之后

```bash
ccp restart
ccp verify
```

### 切换 Tyty 虚拟网卡模式

```bash
tyty_flag=true ccp install-unit
ccp restart
ccp logs | tail -20  # 确认 tyty_flag=true，且 upstream 为 direct
ccp verify
```

若要强行避开 Tyty 的 HTTP 代理环境，重新用默认模式安装：

```bash
tyty_flag=false ccp install-unit
ccp restart
```

也可用 Python 管理路由（与 CLI 互补）：

```bash
python3 skills/claude-code-models/scripts/claude_models.py list
python3 skills/claude-code-models/scripts/claude_models.py dual-only
ccp restart && ccp verify
```

### 新机器首次部署

```bash
cd ~/Project1/concatagents
# 1. 准备 api-local.json（从模板或备份复制，填入密钥）
cp api-local.json.example api-local.json   # 若有示例

# 2. 安装并启动网关
./scripts/claude-code-proxy.sh install-unit
./scripts/claude-code-proxy.sh start

# 3. 把 env 写入 ~/.bashrc（或 eval 进当前 shell）
eval "$(./scripts/claude-code-proxy.sh env)"

# 4. 验收
./scripts/claude-code-proxy.sh verify
```

### 终端里手动测 Claude

```bash
eval "$(ccp env)"
claude -p "只回复 hi" --model MiniMax-M2.7
claude -p "只回复 hi" --model deepseek-v4-pro
```

`~/.bashrc` 里若已有 `alias claude='command claude --bare'`，交互式 `claude` 也会走同一网关。

---

## 与 `/model` 菜单的关系

Claude Code 界面仍可能显示多个模型槽位，但**有效后端只有两套**（由 `api-local.json` 定义）：

| 选择方式 | 实际走向 |
|----------|----------|
| `/model` 槽位 1–4 或任意非 DeepSeek id | `routes.minimax`（如 MiniMax-M2.7） |
| `/model` Custom / `deepseek-v4-pro` | `routes.deepseek` |

代理会在转发前把请求体里的 `model` 改写成上游真实 id，并把响应里的 `model` 尽量改回 Claude Code 期望的名称。

---

## 故障排查

| 症状 | 建议步骤 |
|------|----------|
| `claude` 报连接失败 | `ccp status` → `ccp start` → `ccp logs` |
| **开 Tyty 后全部超时/502** | 若使用虚拟网卡模式，`tyty_flag=true ccp install-unit && ccp restart`；否则保持默认 `false` 让网关清理代理环境 |
| 只有 DeepSeek 失败 | 检查 `routes.deepseek` 的 key/url；`logs` 中 `api.deepseek.com -> direct` |
| 只有 MiniMax 失败 | 检查 `routes.minimax`；`logs` 中 `api.minimaxi.com -> direct` |
| 改配置不生效 | 必须 `ccp restart`（热加载不支持） |
| 端口 3889 被占用 | `ss -lntp \| grep 3889`；停掉冲突进程或改 `api-local.json` 的 `listen.port` |
| `verify` 里 claude 超时 | 上游网络或密钥；`curl` 上游；看 `logs` 的 `upstream` 行 |
| 日后加国外上游需翻墙 | 推荐开 Tyty 虚拟网卡并设 `tyty_flag=true`，不要在 `api-local.json` 里写转代理规则 |

**当前服务模式核对：**

```bash
systemctl --user show claude-model-proxy.service -p Environment --no-pager
ccp logs | grep tyty_flag
```

---

## 相关文档

- 路由与分流实现：`scripts/claude-model-proxy.js`、`scripts/upstream-http.js`
- 模型与 `api-local.json` 管理：`skills/claude-code-models/SKILL.md`、`skills/claude-code-models/reference.md`（含 Tyty 小节）
- Agent 栈密钥探测：`verify/agent-model-repair/`

---

## 命令速查表

| 命令 | 一句话 |
|------|--------|
| `status` | 网关是否在听、systemd、HTTP 200 |
| `env` | 打印 `export`，给当前 shell 用 |
| `start` | 启动 systemd 服务 |
| `stop` | 停止服务 |
| `restart` | 重启并显示 status |
| `run` | 前台调试 |
| `install-unit` | 写入并 enable systemd unit |
| `verify` | 健康检查 + MiniMax/DeepSeek 对话测试 |
| `logs` | journal 最近 80 行 |
| `help` | 简要帮助 |
