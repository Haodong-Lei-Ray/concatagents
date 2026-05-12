#!/usr/bin/env bash
# concatagents: 在无交互、无人工确认的前提下尽可能自动验收。
# 不读取、不打印任何密钥；仅检测「是否已配置」与连通性、二进制与配置形态。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_JSON="${MODEL_JSON:-$ROOT/../model.json}"
if [[ ! -f "$MODEL_JSON" ]]; then
  MODEL_JSON="$ROOT/model.json"
fi
PASS=0
FAIL=0
SKIP=0

ok() { echo "[OK]   $*"; PASS=$((PASS + 1)); }
bad() { echo "[FAIL] $*"; FAIL=$((FAIL + 1)); }
skp() { echo "[SKIP] $*"; SKIP=$((SKIP + 1)); }

echo "=== Concat Agent Harness — 自动验证 ==="
echo "时间: $(date -Iseconds 2>/dev/null || date)"
echo "model.json: $MODEL_JSON"
echo ""

# --- model.json ---
if [[ -f "$MODEL_JSON" ]]; then
  if command -v jq >/dev/null 2>&1; then
    if jq empty "$MODEL_JSON" 2>/dev/null; then
      ok "model.json 为合法 JSON"
      # 兼容 legacy providers.minimax 与 OpenClaw 常用 minimax-portal
      if jq -e '
        (.providers // {}) as $p |
        (($p.minimax.baseUrl // "") + " " + ($p["minimax-portal"].baseUrl // ""))
        | test("(api\\.minimax\\.io|api\\.minimaxi\\.com)"; "i")
      ' "$MODEL_JSON" >/dev/null 2>&1; then
        ok "model.json: MiniMax Anthropic baseUrl（minimax / minimax-portal）已配置"
      else
        bad "model.json: 缺少或异常 MiniMax 兼容 baseUrl"
      fi
      if jq -e '.defaultAgent.model.primary | test("^(minimax|minimax-portal)/")' "$MODEL_JSON" >/dev/null 2>&1; then
        ok "model.json: defaultAgent.model.primary 为 MiniMax 路由"
      else
        bad "model.json: defaultAgent.model.primary 非 minimax / minimax-portal 前缀"
      fi
    else
      bad "model.json JSON 解析失败"
    fi
  else
    skp "未安装 jq，跳过 model.json 结构校验（brew install jq）"
  fi
else
  bad "未找到 model.json: $MODEL_JSON"
fi

# 供 claude -p 默认端点/模型：与 model.json 对齐，避免国内密钥仍请求 api.minimax.io
MODEL_JSON_ANTHROPIC_BASE=""
MODEL_JSON_INFERENCE_MODEL=""
if [[ -f "$MODEL_JSON" ]] && command -v jq >/dev/null 2>&1 && jq empty "$MODEL_JSON" 2>/dev/null; then
  MODEL_JSON_ANTHROPIC_BASE=$(jq -r '
    [(.providers["minimax-portal"].baseUrl // empty), (.providers.minimax.baseUrl // empty)]
    | map(select(. != "")) | first // empty
  ' "$MODEL_JSON")
  MODEL_JSON_INFERENCE_MODEL=$(jq -r '
    (.defaultAgent.model.primary // "MiniMax-M2.7")
    | if test("/") then (split("/") | last) else . end
  ' "$MODEL_JSON")
fi

echo ""
echo "--- 二进制 ---"
for cmd in claude openclaw hermes node; do
  if command -v "$cmd" >/dev/null 2>&1; then
    ver=$("$cmd" --version 2>&1 | head -1 || true)
    ok "$cmd 已安装 ($ver)"
  else
    bad "未找到命令: $cmd"
  fi
done

echo ""
echo "--- claude-model-proxy.js ---"
PROXY_JS="$HOME/.local/bin/claude-model-proxy.js"
if [[ -f "$PROXY_JS" ]]; then
  if node --check "$PROXY_JS" 2>/dev/null; then
    ok "node --check $PROXY_JS"
  else
    bad "proxy 脚本语法检查失败"
  fi
else
  skp "未安装 $PROXY_JS（可选）"
fi

echo ""
echo "--- MiniMax Anthropic 端点（匿名探测，期望 401/403 表示服务可达）---"
MM_URL="https://api.minimax.io/anthropic/v1/messages"
http_code="000"
http_code=$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 8 -X POST "$MM_URL" \
  -H "content-type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -H "x-api-key: invalid-probe" \
  -d '{"model":"MiniMax-M2.7","max_tokens":4,"messages":[{"role":"user","content":"x"}]}' 2>/dev/null) || http_code="000"
if [[ "${http_code}" == "401" || "${http_code}" == "403" ]]; then
  ok "MiniMax Anthropic reachable, HTTP ${http_code} (need real key for 200)"
elif [[ "${http_code}" == "200" ]]; then
  ok "MiniMax Anthropic HTTP 200 (unexpected for invalid probe key)"
else
  bad "MiniMax endpoint probe HTTP ${http_code:-unknown}"
fi

echo ""
echo "--- 凭据：本执行环境（不显示值）---"
if [[ -n "${ANTHROPIC_API_KEY:-}" || -n "${ANTHROPIC_AUTH_TOKEN:-}" ]]; then
  ok "检测到 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN 已设置 — 将尝试 claude -p"
  _def_base="${MODEL_JSON_ANTHROPIC_BASE:-https://api.minimax.io/anthropic}"
  _def_model="${MODEL_JSON_INFERENCE_MODEL:-MiniMax-M2.7}"
  export ANTHROPIC_BASE_URL="${ANTHROPIC_BASE_URL:-$_def_base}"
  export ANTHROPIC_MODEL="${ANTHROPIC_MODEL:-$_def_model}"
  # macOS 通常无 timeout；用 perl alarm
  if out=$(perl -e 'alarm 45; exec @ARGV' claude -p "Reply with exactly: PONG" < /dev/null 2>&1); then
    if echo "$out" | grep -qi PONG; then
      ok "claude -p 端到端返回包含 PONG"
    else
      bad "claude -p 已退出但输出未包含 PONG: $(echo "$out" | head -c 200)..."
    fi
  else
    bad "claude -p 失败或超时: $(echo "$out" | head -c 300)"
  fi
elif [[ -n "${MINIMAX_API_KEY:-}" ]]; then
  ok "检测到 MINIMAX_API_KEY — 将尝试 claude -p（映射为 ANTHROPIC_*）"
  _def_base="${MODEL_JSON_ANTHROPIC_BASE:-https://api.minimax.io/anthropic}"
  _def_model="${MODEL_JSON_INFERENCE_MODEL:-MiniMax-M2.7}"
  export ANTHROPIC_BASE_URL="${ANTHROPIC_BASE_URL:-$_def_base}"
  export ANTHROPIC_API_KEY="$MINIMAX_API_KEY"
  export ANTHROPIC_MODEL="${ANTHROPIC_MODEL:-$_def_model}"
  if out=$(perl -e 'alarm 45; exec @ARGV' claude -p "Reply with exactly: PONG" < /dev/null 2>&1); then
    if echo "$out" | grep -qi PONG; then
      ok "claude -p 端到端返回包含 PONG"
    else
      bad "claude -p 已退出但输出未包含 PONG: $(echo "$out" | head -c 200)..."
    fi
  else
    bad "claude -p 失败或超时: $(echo "$out" | head -c 300)"
  fi
else
  skp "执行环境中无 ANTHROPIC_API_KEY / MINIMAX_API_KEY — 无法代你完成「真实模型」端到端（密钥不能从 model.json 推断）"
fi

echo ""
echo "--- Hermes doctor（非交互）---"
if command -v hermes >/dev/null 2>&1; then
  if hermes doctor >/dev/null 2>&1; then
    ok "hermes doctor 退出码 0"
  else
    bad "hermes doctor 非零退出"
  fi
else
  skp "hermes 不在 PATH"
fi

echo ""
echo "--- OpenClaw ---"
if command -v openclaw >/dev/null 2>&1; then
  # OpenClaw 可能先打印多行 Config warnings，勿用 head 截断以免漏掉「Skills」表头
  if openclaw skills list 2>&1 | grep -qE "Skills|Skill"; then
    ok "openclaw skills list 有输出"
  else
    bad "openclaw skills list 无预期输出"
  fi
else
  skp "openclaw 不在 PATH"
fi

echo ""
echo "--- Claude skill（需 Anthropic 账号额度；无密钥则跳过）---"
if [[ -n "${ANTHROPIC_API_KEY:-}" || -n "${ANTHROPIC_AUTH_TOKEN:-}" ]]; then
  if claude skill list < /dev/null 2>&1 | head -5; then
    ok "claude skill list 可执行"
  else
    skp "claude skill list 失败（常见原因：额度/订阅，与 model.json 无关）"
  fi
else
  skp "无 Anthropic 官方凭据 — 跳过 claude skill（第三方 MiniMax 路由不包含此能力）"
fi

echo ""
echo "=== 汇总: PASS=$PASS FAIL=$FAIL SKIP=$SKIP ==="
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
