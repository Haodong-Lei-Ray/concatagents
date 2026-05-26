#!/usr/bin/env bash
# 统一模型网关：Claude Anthropic (3889) + Codex Responses (8788)
# 配置单一来源：api-local.json

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLAUDE_SH="${REPO_ROOT}/scripts/claude-code-proxy.sh"
CODEX_SH="${REPO_ROOT}/scripts/codex-responses-gateway.sh"
API_LOCAL="${REPO_ROOT}/api-local.json"

usage() {
  cat <<'EOF'
用法: model-gateways.sh <命令>

命令:
  status      两个网关的状态
  start       启动 Claude + Codex 网关
  stop        停止两个网关
  restart     重启两个网关
  install     install-unit（两个服务）
  verify      验收两个网关
  env         打印 Claude 环境变量
  env-codex   打印 Codex 网关 URL

架构:
  Claude Code  → http://127.0.0.1:3889  (Anthropic shim, claude-model-proxy)
  Codex        → http://127.0.0.1:8788/v1 (Responses→Chat, deepseek-responses-proxy)
  PolyWeave    → http://127.0.0.1:8787  (agent 调度，非 LLM API，勿混用)

配置: api-local.json（listen + codexGateway + routes）
EOF
}

die() { echo "model-gateways: $*" >&2; exit 1; }

main() {
  local cmd="${1:-}"
  [[ -x "$CLAUDE_SH" ]] || chmod +x "$CLAUDE_SH"
  [[ -x "$CODEX_SH" ]] || chmod +x "$CODEX_SH"

  case "$cmd" in
    status)
      echo "======== Claude (Anthropic) ========"
      "$CLAUDE_SH" status || true
      echo
      echo "======== Codex (Responses) ========"
      "$CODEX_SH" status || true
      ;;
    start)
      "$CLAUDE_SH" start
      echo
      "$CODEX_SH" start
      ;;
    stop)
      "$CLAUDE_SH" stop
      "$CODEX_SH" stop
      ;;
    restart)
      "$CLAUDE_SH" restart
      echo
      "$CODEX_SH" restart
      ;;
    install)
      "$CLAUDE_SH" install-unit
      echo
      "$CODEX_SH" install-unit
      ;;
    verify)
      "$CLAUDE_SH" status || true
      echo
      "$CODEX_SH" verify
      ;;
    env)          "$CLAUDE_SH" env ;;
    env-codex)    "$CODEX_SH" env ;;
    -h|--help|help|"") usage ;;
    *) die "未知命令: $cmd" ;;
  esac
}

main "$@"
