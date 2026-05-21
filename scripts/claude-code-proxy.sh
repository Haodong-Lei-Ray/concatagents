#!/usr/bin/env bash
# Claude Code 本地模型代理 — 启停、环境、验收
#
# 架构（本机实际用法）：
#   Claude Code CLI
#     └─ ANTHROPIC_BASE_URL=http://127.0.0.1:3889  （指向本地 shim，非官方 Anthropic）
#     └─ ANTHROPIC_API_KEY=local-claude-model-proxy （占位；真实密钥在 api-local.json）
#          │
#          ▼
#   claude-model-proxy.js  （默认 127.0.0.1:3889）
#     └─ 读 CLAUDE_PROXY_CONFIG → api-local.json 里的 routes
#     └─ 按请求体 model 选上游：
#          · customRoute（deepseek）的 model / matchModels → routes.deepseek
#          · 其余（含 /model 槽位 1–4 的 claude-*）→ routes.minimax
#     └─ 改写 model id、注入 x-api-key，转发到各上游 Anthropic 兼容端点
#          │
#          ▼
#   上游：api.minimaxi.com/anthropic、api.deepseek.com/anthropic 等
#
# 相关文件：
#   scripts/claude-model-proxy.js
#   api-local.json
#   ~/.bashrc（ANTHROPIC_* / CLAUDE_PROXY_CONFIG）
#   ~/.config/systemd/user/claude-model-proxy.service

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROXY_JS="${REPO_ROOT}/scripts/claude-model-proxy.js"
API_LOCAL="${REPO_ROOT}/api-local.json"
SYSTEMD_UNIT="${HOME}/.config/systemd/user/claude-model-proxy.service"
CLAUDE_MODELS_PY="${REPO_ROOT}/skills/claude-code-models/scripts/claude_models.py"

DEFAULT_PORT=3889
DEFAULT_BIND=127.0.0.1

usage() {
  cat <<'EOF'
用法: claude-code-proxy.sh <命令>

命令:
  status          代理进程 / systemd / HTTP 健康检查
  env             打印 Claude Code 应使用的环境变量（eval 用）
  start           启动 systemd 用户服务（推荐）
  stop            停止 systemd 用户服务
  restart         重启 systemd 用户服务
  run             前台运行代理（调试，Ctrl+C 退出）
  install-unit    写入 ~/.config/systemd/user/claude-model-proxy.service 并 daemon-reload
  verify          代理健康 + 双模型 claude -p 探测（调用 claude_models.py verify）
  logs            查看代理 journal（需 systemd）

示例:
  eval "$(/home/lei/Project1/concatagents/scripts/claude-code-proxy.sh env)"
  claude-code-proxy.sh start
  claude-code-proxy.sh status
  claude -p "只回复 hi" --model MiniMax-M2.7
  claude -p "只回复 hi" --model deepseek-v4-pro

文档: scripts/claude-code-proxy.md
EOF
}

die() { echo "claude-code-proxy: $*" >&2; exit 1; }

need_file() {
  [[ -f "$1" ]] || die "缺少文件: $1"
}

node_bin() {
  if [[ -n "${NODE:-}" && -x "$NODE" ]]; then
    echo "$NODE"
    return
  fi
  if command -v node >/dev/null 2>&1; then
    command -v node
    return
  fi
  local nvm_node="${HOME}/.nvm/versions/node/v22.22.0/bin/node"
  [[ -x "$nvm_node" ]] && echo "$nvm_node" && return
  die "未找到 node，请安装 Node.js 或设置 NODE=..."
}

read_listen() {
  local port bind
  if [[ -f "$API_LOCAL" ]] && command -v python3 >/dev/null 2>&1; then
    port="$(python3 -c "import json; c=json.load(open('$API_LOCAL')); print(c.get('listen',{}).get('port',$DEFAULT_PORT))" 2>/dev/null || echo "$DEFAULT_PORT")"
    bind="$(python3 -c "import json; c=json.load(open('$API_LOCAL')); print(c.get('listen',{}).get('bind','$DEFAULT_BIND'))" 2>/dev/null || echo "$DEFAULT_BIND")"
  else
    port="$DEFAULT_PORT"
    bind="$DEFAULT_BIND"
  fi
  echo "${bind}:${port}"
}

proxy_url() {
  local hp
  hp="$(read_listen)"
  echo "http://${hp}"
}

cmd_env() {
  need_file "$API_LOCAL"
  cat <<EOF
export ANTHROPIC_BASE_URL='$(proxy_url)'
export ANTHROPIC_API_KEY='local-claude-model-proxy'
export ANTHROPIC_AUTH_TOKEN="\$ANTHROPIC_API_KEY"
export CLAUDE_PROXY_CONFIG='$API_LOCAL'
export CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1
EOF
}

http_health() {
  local url code
  url="$(proxy_url)/"
  if command -v curl >/dev/null 2>&1; then
    code="$(curl -fsS -o /dev/null -w '%{http_code}' -m 3 "$url" 2>/dev/null || echo "000")"
    [[ "$code" == "200" ]]
  else
    die "需要 curl 做健康检查"
  fi
}

cmd_status() {
  need_file "$PROXY_JS"
  need_file "$API_LOCAL"
  local url
  url="$(proxy_url)"
  echo "repo:      $REPO_ROOT"
  echo "proxy js:  $PROXY_JS"
  echo "config:    $API_LOCAL"
  echo "listen:    $url"
  echo
  if systemctl --user is-active claude-model-proxy.service &>/dev/null; then
    echo "systemd:   active (claude-model-proxy.service)"
    systemctl --user show claude-model-proxy.service -p MainPID,ActiveState --no-pager 2>/dev/null || true
  else
    echo "systemd:   inactive 或 unit 未安装（可运行: $0 install-unit && $0 start）"
  fi
  echo
  if http_health; then
    echo "http GET /: 200 OK"
  else
    echo "http GET /: FAIL（代理未监听或不可达）"
    return 1
  fi
}

cmd_run() {
  need_file "$PROXY_JS"
  need_file "$API_LOCAL"
  export CLAUDE_PROXY_CONFIG="$API_LOCAL"
  echo "前台启动: node $PROXY_JS"
  echo "CLAUDE_PROXY_CONFIG=$CLAUDE_PROXY_CONFIG"
  exec "$(node_bin)" "$PROXY_JS"
}

write_systemd_unit() {
  local node
  node="$(node_bin)"
  mkdir -p "$(dirname "$SYSTEMD_UNIT")"
  cat >"$SYSTEMD_UNIT" <<EOF
[Unit]
Description=Claude Code local model router (slots 1-4 MiniMax, slot 5 custom)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=CLAUDE_PROXY_PORT=${DEFAULT_PORT}
Environment=CLAUDE_PROXY_BIND=${DEFAULT_BIND}
Environment=CLAUDE_PROXY_CONFIG=${API_LOCAL}
ExecStart=${node} ${PROXY_JS}
Restart=on-failure
RestartSec=3
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF
  echo "已写入: $SYSTEMD_UNIT"
}

cmd_install_unit() {
  need_file "$PROXY_JS"
  write_systemd_unit
  systemctl --user daemon-reload
  systemctl --user enable claude-model-proxy.service
  echo "已 enable claude-model-proxy.service（登录后自动启动需: loginctl enable-linger \$USER）"
}

cmd_start() {
  if [[ ! -f "$SYSTEMD_UNIT" ]]; then
    echo "未找到 systemd unit，先执行 install-unit ..."
    cmd_install_unit
  fi
  systemctl --user start claude-model-proxy.service
  sleep 0.5
  cmd_status
}

cmd_stop() {
  systemctl --user stop claude-model-proxy.service 2>/dev/null || echo "服务未运行"
}

cmd_restart() {
  systemctl --user restart claude-model-proxy.service
  sleep 0.5
  cmd_status
}

cmd_logs() {
  journalctl --user -u claude-model-proxy.service -n 80 --no-pager
}

cmd_verify() {
  need_file "$CLAUDE_MODELS_PY"
  cmd_status || true
  echo
  echo "=== claude_models.py verify ==="
  # 使用与 ~/.bashrc 一致的代理环境
  eval "$(cmd_env)"
  python3 "$CLAUDE_MODELS_PY" --config "$API_LOCAL" verify
}

main() {
  local cmd="${1:-}"
  case "$cmd" in
    status)       cmd_status ;;
    env)          cmd_env ;;
    start)        cmd_start ;;
    stop)         cmd_stop ;;
    restart)      cmd_restart ;;
    run)          cmd_run ;;
    install-unit) cmd_install_unit ;;
    verify)       cmd_verify ;;
    logs)         cmd_logs ;;
    -h|--help|help|"") usage ;;
    *) die "未知命令: $cmd（运行 $0 help）" ;;
  esac
}

main "$@"
