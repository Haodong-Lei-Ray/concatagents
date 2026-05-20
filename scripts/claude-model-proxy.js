#!/usr/bin/env node
/**
 * claude-model-proxy — local routing shim for Claude Code.
 *
 * Routing policy:
 * - Model ids matching a configured route's model/matchModels go to that route.
 * - Unknown Claude built-in ids fall back to routes.minimax.
 *
 * Claude Code talks to this shim via ANTHROPIC_BASE_URL=http://127.0.0.1:3889.
 * Upstream base URLs and API keys live in ../api-local.json by default.
 */
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const {
  stripProcessProxyEnv,
  upstreamRequest,
} = require("./upstream-http");

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, "..", "api-local.json");
const CONFIG_PATH = path.resolve(process.env.CLAUDE_PROXY_CONFIG || DEFAULT_CONFIG_PATH);

function parseBooleanFlag(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ""));
}

const tyty_flag = parseBooleanFlag(process.env.tyty_flag || process.env.TYTY_FLAG);

if (!tyty_flag) {
  stripProcessProxyEnv();
}

function loadConfig() {
  let raw;
  try {
    raw = fs.readFileSync(CONFIG_PATH, "utf8");
  } catch (err) {
    console.error(`[claude-model-proxy] Cannot read config: ${CONFIG_PATH}`);
    console.error(`[claude-model-proxy] ${err.message}`);
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[claude-model-proxy] Invalid JSON config: ${CONFIG_PATH}`);
    console.error(`[claude-model-proxy] ${err.message}`);
    process.exit(1);
  }
}

const config = loadConfig();
const LISTEN_PORT = Number(process.env.CLAUDE_PROXY_PORT || config.listen?.port || 3889);
const LISTEN_BIND = process.env.CLAUDE_PROXY_BIND || config.listen?.bind || "127.0.0.1";

function requiredRoute(name) {
  const route = config.routes?.[name];
  if (!route?.baseUrl || !route?.apiKey || !route?.model) {
    console.error(
      `[claude-model-proxy] api-local.json requires routes.${name}.baseUrl/apiKey/model`,
    );
    process.exit(1);
  }
  try {
    route.url = new URL(route.baseUrl.replace(/\/$/, ""));
  } catch (err) {
    console.error(`[claude-model-proxy] Invalid routes.${name}.baseUrl: ${route.baseUrl}`);
    console.error(`[claude-model-proxy] ${err.message}`);
    process.exit(1);
  }
  return route;
}

const routes = Object.fromEntries(
  Object.keys(config.routes || {}).map((name) => [name, requiredRoute(name)]),
);

if (!routes.minimax) {
  console.error("[claude-model-proxy] api-local.json requires routes.minimax");
  process.exit(1);
}

const routeModels = new Map();
for (const [name, route] of Object.entries(routes)) {
  for (const model of [route.model, ...(route.matchModels || [])].filter(Boolean)) {
    routeModels.set(model, { name, route });
  }
}

function chooseRoute(model) {
  return routeModels.get(model) || { name: "minimax", route: routes.minimax };
}

function rewriteJsonBody(buf) {
  if (!buf.length) return { out: buf, routeName: "minimax", modelFrom: "", modelTo: routes.minimax.model };
  let obj;
  try {
    obj = JSON.parse(buf.toString("utf8"));
  } catch {
    return { out: buf, routeName: "minimax", modelFrom: "", modelTo: routes.minimax.model };
  }
  if (!obj || typeof obj.model !== "string") {
    return { out: buf, routeName: "minimax", modelFrom: "", modelTo: routes.minimax.model };
  }

  const from = obj.model;
  const picked = chooseRoute(from);
  obj.model = picked.route.model;
  delete obj.stream;
  if (from !== obj.model) {
    console.error(`[claude-model-proxy][${picked.name}] ${from} -> ${obj.model}`);
  } else {
    console.error(`[claude-model-proxy][${picked.name}] ${from}`);
  }
  return {
    out: Buffer.from(JSON.stringify(obj)),
    routeName: picked.name,
    modelFrom: from,
    modelTo: obj.model,
  };
}

function filterHeaders(headers) {
  const out = { ...headers };
  const drop = new Set([
    "connection",
    "keep-alive",
    "proxy-connection",
    "transfer-encoding",
    "content-length",
    "host",
    "authorization",
    "x-api-key",
  ]);
  for (const key of Object.keys(out)) {
    if (drop.has(key.toLowerCase())) delete out[key];
  }
  return out;
}

function targetFor(route, reqUrl) {
  const parsed = new URL(reqUrl || "/", "http://local");
  const incoming = parsed.pathname || "/";
  const basePath = route.url.pathname.replace(/\/$/, "");
  const targetPath = `${basePath}${incoming.startsWith("/") ? incoming : `/${incoming}`}`;
  const target = new URL(route.url.href);
  target.pathname = targetPath.replace(/\/{2,}/g, "/");
  target.search = "";
  return target;
}

const server = http.createServer((req, res) => {
  if ((req.method === "GET" || req.method === "HEAD") && (req.url === "/" || req.url === "")) {
    res.writeHead(200, { "content-type": "text/plain" });
    if (req.method === "HEAD") res.end();
    else res.end("ok\n");
    console.error(`[claude-model-proxy][local] ${req.method} / -> 200`);
    return;
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("error", (err) => {
    console.error(`[claude-model-proxy][request] ${err.message}`);
    if (!res.headersSent) res.writeHead(400, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  });
  req.on("end", () => {
    const original = Buffer.concat(chunks);
    if ((req.url || "").includes("/count_tokens")) {
      let inputTokens = 1;
      try {
        const obj = JSON.parse(original.toString("utf8") || "{}");
        inputTokens = Math.max(1, Math.ceil(JSON.stringify(obj).length / 4));
      } catch (_) {}
      const body = Buffer.from(JSON.stringify({ input_tokens: inputTokens }));
      res.writeHead(200, {
        "content-type": "application/json",
        "content-length": String(body.length),
      });
      res.end(body);
      console.error(`[claude-model-proxy][local] ${req.method} ${req.url} -> count_tokens=${inputTokens}`);
      return;
    }

    const contentType = String(req.headers["content-type"] || "").toLowerCase();
    const rewritten = contentType.includes("application/json")
      ? rewriteJsonBody(original)
      : { out: original, routeName: "minimax" };
    const route = routes[rewritten.routeName] || routes.minimax;
    console.error(`[claude-model-proxy][${rewritten.routeName}] ${req.method} ${req.url}`);

    let targetUrl;
    try {
      targetUrl = targetFor(route, req.url);
    } catch (err) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
      return;
    }

    const headers = filterHeaders(req.headers);
    headers.host = targetUrl.hostname;
    headers["x-api-key"] = route.apiKey;
    headers.authorization = `Bearer ${route.apiKey}`;

    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    if (hasBody) headers["content-length"] = String(rewritten.out.length);

    console.error(
      `[claude-model-proxy][${rewritten.routeName}] upstream ${targetUrl.hostname} -> direct`,
    );

    upstreamRequest({
      targetUrl: targetUrl.href,
      method: req.method,
      headers,
      body: hasBody ? rewritten.out : undefined,
    })
      .then((upstreamRes) => {
        let out = upstreamRes.body;
        const contentType = String(upstreamRes.headers["content-type"] || "");
        if (contentType.includes("application/json")) {
          try {
            const obj = JSON.parse(out.toString("utf8"));
            if (obj && typeof obj === "object") {
              if (
                rewritten.modelFrom &&
                rewritten.modelTo &&
                rewritten.modelFrom !== rewritten.modelTo &&
                typeof obj.model === "string"
              ) {
                obj.model = rewritten.modelFrom;
              }
              if (Array.isArray(obj.content)) {
                const textParts = [];
                for (const part of obj.content) {
                  if (part && part.type === "text" && typeof part.text === "string") {
                    textParts.push(part.text);
                  }
                }
                if (textParts.length === 0) {
                  for (const part of obj.content) {
                    if (part && part.type === "thinking" && typeof part.thinking === "string") {
                      textParts.push(part.thinking);
                    }
                  }
                }
                obj.content = [{ type: "text", text: textParts.join("\n").trim() || "" }];
              }
              out = Buffer.from(JSON.stringify(obj));
            }
          } catch (_) {
            // Leave non-JSON responses untouched.
          }
        }
        const outHeaders = { ...upstreamRes.headers };
        delete outHeaders.connection;
        delete outHeaders["keep-alive"];
        delete outHeaders["transfer-encoding"];
        outHeaders["content-length"] = String(out.length);
        res.writeHead(upstreamRes.statusCode || 502, outHeaders);
        res.end(out);
      })
      .catch((err) => {
        console.error(`[claude-model-proxy][${rewritten.routeName}] ${err.message}`);
        if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      });
  });
});

server.on("clientError", (err, socket) => {
  console.error(`[claude-model-proxy][client] ${err.message}`);
  try {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  } catch (_) {}
});

server.listen(LISTEN_PORT, LISTEN_BIND, () => {
  console.error(`[claude-model-proxy] config=${CONFIG_PATH}`);
  console.error(`[claude-model-proxy] listening http://${LISTEN_BIND}:${LISTEN_PORT}`);
  console.error(
    `[claude-model-proxy] tyty_flag=${tyty_flag ? "true (leave routing to OS/Tyty TUN)" : "false (strip proxy env; force direct upstream)"}`,
  );
  console.error(
    `[claude-model-proxy] known models: ${Array.from(routeModels.keys()).join(", ")}`,
  );
});
