#!/usr/bin/env node
/**
 * claude-model-proxy — local HTTP shim for Claude Code (see concatagents/claude-code-proxy.html).
 * - Rewrites Claude menu model ids to ids your upstream accepts (MODEL_ALIASES).
 * - If model id starts with "minimax-" and MINIMAX_API_KEY is set, strips the prefix and
 *   forwards to MiniMax Anthropic-compatible base (default https://api.minimax.io/anthropic).
 * - Otherwise forwards to CLAUDE_PROXY_UPSTREAM (required for non-MiniMax traffic).
 *
 * Env:
 *   CLAUDE_PROXY_UPSTREAM   e.g. http://host:3888
 *   CLAUDE_PROXY_PORT       default 3889
 *   CLAUDE_PROXY_BIND       default 127.0.0.1
 *   MINIMAX_API_KEY         optional; enables minimax-* routing
 *   MINIMAX_ANTHROPIC_BASE_URL  default https://api.minimax.io/anthropic
 */
"use strict";

const http = require("http");
const https = require("https");
const { URL } = require("url");

const LISTEN_PORT = Number(process.env.CLAUDE_PROXY_PORT || 3889);
const LISTEN_BIND = process.env.CLAUDE_PROXY_BIND || "127.0.0.1";
const UPSTREAM_RAW = process.env.CLAUDE_PROXY_UPSTREAM || "";
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || "";
const MINIMAX_ANTHROPIC_BASE = (
  process.env.MINIMAX_ANTHROPIC_BASE_URL || "https://api.minimax.io/anthropic"
).replace(/\/$/, "");

let UPSTREAM;
try {
  UPSTREAM = UPSTREAM_RAW ? new URL(UPSTREAM_RAW) : null;
} catch {
  console.error("[claude-model-proxy] Invalid CLAUDE_PROXY_UPSTREAM");
  process.exit(1);
}

const MODEL_ALIASES = {
  "claude-opus-4-7-1m": "claude-opus-4-7",
  "claude-opus-4-6-1m": "claude-opus-4-6",
  "claude-opus-4-5-1m": "claude-opus-4-5-20251101",
  "claude-sonnet-4-6-1m": "claude-sonnet-4-6",
  "claude-sonnet-4-5-1m": "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5": "claude-haiku-4-5-20251001",
  "claude-opus-4-5": "claude-opus-4-5-20251101",
  "claude-sonnet-4-5": "claude-sonnet-4-5-20250929",
  "claude-sonnet-4": "claude-sonnet-4-20250514",
  "claude-opus-4": "claude-opus-4-20250514",
};

function rewriteJsonBody(buf) {
  if (!buf.length) return { out: buf, mode: "upstream" };
  let obj;
  try {
    obj = JSON.parse(buf.toString("utf8"));
  } catch {
    return { out: buf, mode: "upstream" };
  }
  if (!obj || typeof obj.model !== "string") {
    return { out: buf, mode: "upstream" };
  }
  const m = obj.model;
  if (MINIMAX_API_KEY && m.toLowerCase().startsWith("minimax-")) {
    obj.model = m.replace(/^minimax-/i, "");
    return { out: Buffer.from(JSON.stringify(obj)), mode: "minimax" };
  }
  const mapped = MODEL_ALIASES[m];
  if (mapped && mapped !== m) {
    obj.model = mapped;
    console.error(`[claude-model-proxy][alias] ${m} -> ${mapped}`);
  }
  return { out: Buffer.from(JSON.stringify(obj)), mode: "upstream" };
}

function filterHeaders(h) {
  const out = { ...h };
  const drop = new Set([
    "connection",
    "keep-alive",
    "proxy-connection",
    "transfer-encoding",
    "content-length",
    "host",
  ]);
  for (const k of Object.keys(out)) {
    if (drop.has(k.toLowerCase())) delete out[k];
  }
  return out;
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const buf = Buffer.concat(chunks);
    const ct = (req.headers["content-type"] || "").toLowerCase();
    let bodyForForward = buf;
    let useMinimax = false;

    if (ct.includes("application/json") && buf.length) {
      const rw = rewriteJsonBody(buf);
      bodyForForward = rw.out;
      useMinimax = rw.mode === "minimax";
    }

    if (useMinimax && !MINIMAX_API_KEY) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error: "minimax-* model requires MINIMAX_API_KEY",
        }),
      );
      return;
    }

    if (!useMinimax && !UPSTREAM) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          error:
            "Set CLAUDE_PROXY_UPSTREAM for non-MiniMax requests (or use minimax-* with MINIMAX_API_KEY)",
        }),
      );
      return;
    }

    const baseHref = useMinimax
      ? `${MINIMAX_ANTHROPIC_BASE}/`
      : `${UPSTREAM.origin}/`;

    let targetUrl;
    try {
      targetUrl = new URL(req.url || "/", baseHref);
    } catch (e) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(e.message) }));
      return;
    }

    const isHttps = targetUrl.protocol === "https:";
    const lib = isHttps ? https : http;
    const headers = filterHeaders(req.headers);
    headers.host = targetUrl.host;
    if (useMinimax && MINIMAX_API_KEY) {
      headers.authorization = `Bearer ${MINIMAX_API_KEY}`;
      headers["x-api-key"] = MINIMAX_API_KEY;
    }
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    if (hasBody) {
      headers["content-length"] = String(bodyForForward.length);
    }

    const preq = lib.request(
      {
        hostname: targetUrl.hostname,
        port: targetUrl.port || (isHttps ? 443 : 80),
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers,
      },
      (pres) => {
        res.writeHead(pres.statusCode || 502, pres.headers);
        pres.pipe(res);
      },
    );
    preq.on("error", (err) => {
      console.error("[claude-model-proxy]", err);
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "application/json" });
      }
      res.end(JSON.stringify({ error: err.message }));
    });
    preq.end(hasBody ? bodyForForward : undefined);
  });
});

server.listen(LISTEN_PORT, LISTEN_BIND, () => {
  console.error(
    `[claude-model-proxy] http://${LISTEN_BIND}:${LISTEN_PORT} -> upstream=${UPSTREAM_RAW || "(unset)"} | minimax=${MINIMAX_ANTHROPIC_BASE}`,
  );
});
