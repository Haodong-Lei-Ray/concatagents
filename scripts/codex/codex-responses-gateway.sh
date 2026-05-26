#!/usr/bin/env bash
# Codex Responses 网关 — 与 api-local.json 同源配置，转发到 DeepSeek Chat API
#
# 架构：
#   Codex CLI（wire_api=responses）
#     └─ base_url=http://127.0.0.1:8788/v1
#          │
#          ▼
#   deepseek-responses-proxy（本脚本管理的 systemd 服务）
#     └─ POST /v1/responses → 上游 routes.deepseek → api.deepseek.com/chat/completions
#
# 注意：8787 为 PolyWeave agent 调度网关，勿占用。

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_LOCAL="${REPO_ROOT}/api-local.json"
SYSTEMD_UNIT="${HOME}/.config/systemd/user/codex-responses-gateway.service"
ENV_FILE="${HOME}/.config/codex-responses-gateway.env"

DEFAULT_PORT=8788
DEFAULT_BIND=127.0.0.1
DEFAULT_ROUTE=deepseek
DEFAULT_CHAT_BASE=https://api.deepseek.com

usage() {
  cat <<'EOF'
用法: codex-responses-gateway.sh <命令>

命令:
  status          服务状态 + /health
  env             打印 Codex 应使用的 provider base_url（eval 用）
  sync-env        从 api-local.json 同步 DEEPSEEK_API_KEY 到 ~/.config/codex-responses-gateway.env
  start           启动 systemd 用户服务
  stop            停止服务
  restart         重启服务
  install-unit    写入 systemd unit 并 enable
  verify          健康检查 + codex exec 探测
  logs            journal 日志

示例:
  codex-responses-gateway.sh sync-env install-unit start
  eval "$(codex-responses-gateway.sh env)"
  codex -p deepseek-v4-pro
EOF
}

die() { echo "codex-responses-gateway: $*" >&2; exit 1; }

read_gateway_field() {
  local py="$1"
  python3 -c "
import json
c = json.load(open('$API_LOCAL'))
g = c.get('codexGateway', {})
routes = c.get('routes', {})
route = g.get('route', '$DEFAULT_ROUTE')
r = routes.get(route, {})
print($py)
" 2>/dev/null
}

read_listen() {
  [[ -f "$API_LOCAL" ]] || { echo "${DEFAULT_BIND}:${DEFAULT_PORT}"; return; }
  local bind port
  bind="$(read_gateway_field "g.get('bind', '$DEFAULT_BIND')")"
  port="$(read_gateway_field "g.get('port', $DEFAULT_PORT)")"
  echo "${bind}:${port}"
}

gateway_url() {
  echo "http://$(read_listen)/v1"
}

read_route_key() {
  read_gateway_field "g.get('route', '$DEFAULT_ROUTE')"
}

read_chat_base() {
  local from_gw from_route
  from_gw="$(read_gateway_field "g.get('chatBaseUrl', '')")"
  if [[ -n "$from_gw" ]]; then
    echo "$from_gw"
    return
  fi
  from_route="$(read_gateway_field "routes.get(route, {}).get('baseUrl', '').replace('/anthropic', '').rstrip('/')")"
  echo "${from_route:-$DEFAULT_CHAT_BASE}"
}

read_api_key() {
  read_gateway_field "routes.get(route, {}).get('apiKey', '')"
}

cmd_sync_env() {
  [[ -f "$API_LOCAL" ]] || die "缺少 $API_LOCAL"
  local key
  key="$(read_api_key)"
  [[ -n "$key" ]] || die "api-local.json 中 routes.$(read_route_key).apiKey 为空"
  mkdir -p "$(dirname "$ENV_FILE")"
  printf 'DEEPSEEK_API_KEY=%s\n' "$key" >"$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "已同步: $ENV_FILE"
}

write_systemd_unit() {
  local bind port chat_base route
  bind="$(read_gateway_field "g.get('bind', '$DEFAULT_BIND')")"
  port="$(read_gateway_field "g.get('port', $DEFAULT_PORT)")"
  chat_base="$(read_chat_base)"
  mkdir -p "$(dirname "$SYSTEMD_UNIT")"
  cat >"$SYSTEMD_UNIT" <<EOF
[Unit]
Description=Codex Responses gateway (api-local.json codexGateway → DeepSeek)
Documentation=https://github.com/holo-q/deepseek-responses-proxy
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment=HOME=%h
Environment=PATH=%h/.local/bin:%h/.cargo/bin:%h/bin:/usr/local/bin:/usr/bin:/bin
Environment=PYTHONUNBUFFERED=1
EnvironmentFile=-${ENV_FILE}
ExecStart=/usr/bin/env uvx --from git+https://github.com/holo-q/deepseek-responses-proxy deepseek-responses-proxy --bind ${bind} --port ${port} --chat-base-url ${chat_base} --api-key-env DEEPSEEK_API_KEY
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF
  echo "已写入: $SYSTEMD_UNIT (listen ${bind}:${port}, upstream ${chat_base})"
}

cmd_install_unit() {
  [[ -f "$API_LOCAL" ]] || die "缺少 $API_LOCAL"
  cmd_sync_env
  write_systemd_unit
  systemctl --user daemon-reload
  systemctl --user enable codex-responses-gateway.service
  echo "已 enable codex-responses-gateway.service"
}

http_health() {
  local url code
  url="http://$(read_listen)/health"
  code="$(curl -fsS -o /dev/null -w '%{http_code}' -m 3 "$url" 2>/dev/null || echo "000")"
  [[ "$code" == "200" ]]
}

cmd_status() {
  echo "repo:       $REPO_ROOT"
  echo "config:     $API_LOCAL"
  echo "gateway:    $(gateway_url)"
  echo "route:      $(read_route_key)"
  echo "chat upstream: $(read_chat_base)"
  echo
  if systemctl --user is-active codex-responses-gateway.service &>/dev/null; then
    echo "systemd:    active (codex-responses-gateway.service)"
  else
    echo "systemd:    inactive（运行: $0 install-unit && $0 start）"
  fi
  echo
  if http_health; then
    echo "GET /health: 200 OK"
  else
    echo "GET /health: FAIL"
    return 1
  fi
}

cmd_env() {
  cat <<EOF
# Codex ~/.codex/config.toml 中 model_providers.deepseek.base_url 应与此一致
export CODEX_DEEPSEEK_GATEWAY_URL='$(gateway_url)'
EOF
}

cmd_start() {
  [[ -f "$SYSTEMD_UNIT" ]] || { echo "未找到 unit，执行 install-unit ..."; cmd_install_unit; }
  systemctl --user start codex-responses-gateway.service
  sleep 1
  cmd_status
}

cmd_stop() {
  systemctl --user stop codex-responses-gateway.service 2>/dev/null || echo "服务未运行"
}

cmd_restart() {
  systemctl --user restart codex-responses-gateway.service
  sleep 1
  cmd_status
}

cmd_logs() {
  journalctl --user -u codex-responses-gateway.service -n 80 --no-pager
}

cmd_verify() {
  cmd_status
  echo
  echo "=== POST /v1/responses ==="
  curl -fsS -X POST "$(gateway_url)/responses" \
    -H "Authorization: Bearer codex-local" \
    -H "Content-Type: application/json" \
    -d '{"model":"deepseek-v4-pro","input":"只回复hi"}' | head -c 300
  echo
  echo
  if command -v codex >/dev/null 2>&1; then
    echo "=== codex exec ==="
    export DEEPSEEK_API_KEY="$(read_api_key)"
    printf '只回复hi\n' | timeout 90 codex exec -p deepseek-v4-pro \
      --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check 2>&1 | tail -15
  fi
}

main() {
  local cmd="${1:-}"
  case "$cmd" in
    status)       cmd_status ;;
    env)          cmd_env ;;
    sync-env)     cmd_sync_env ;;
    start)        cmd_start ;;
    stop)         cmd_stop ;;
    restart)      cmd_restart ;;
    install-unit) cmd_install_unit ;;
    verify)       cmd_verify ;;
    logs)         cmd_logs ;;
    -h|--help|help|"") usage ;;
    *) die "未知命令: $cmd" ;;
  esac
}

main "$@"
