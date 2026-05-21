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
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { URL } = require("url");

const DEFAULT_CONFIG_PATH = path.resolve(__dirname, "..", "api-local.json");
const CONFIG_PATH = path.resolve(process.env.CLAUDE_PROXY_CONFIG || DEFAULT_CONFIG_PATH);

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

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if (part.type === "text" && typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function buildAnthropicBodyFromOpenAI(obj, route) {
  const messages = [];
  const system = [];
  for (const message of Array.isArray(obj.messages) ? obj.messages : []) {
    if (!message || typeof message !== "object") continue;
    const text = textFromContent(message.content);
    if (!text) continue;
    if (message.role === "system") {
      system.push(text);
      continue;
    }
    if (message.role === "assistant" || message.role === "user") {
      messages.push({ role: message.role, content: text });
    }
  }
  const out = {
    model: route.model,
    max_tokens: Number(obj.max_tokens || obj.max_completion_tokens || 1024),
    messages,
  };
  if (system.length > 0) out.system = system.join("\n\n");
  if (typeof obj.temperature === "number") out.temperature = obj.temperature;
  if (typeof obj.top_p === "number") out.top_p = obj.top_p;
  return out;
}

function anthropicToOpenAI(obj, requestedModel) {
  const content = Array.isArray(obj.content)
    ? obj.content
        .map((part) => {
          if (!part || typeof part !== "object") return "";
          if (part.type === "text" && typeof part.text === "string") return part.text;
          if (part.type === "thinking" && typeof part.thinking === "string") return part.thinking;
          return "";
        })
        .filter(Boolean)
        .join("\n")
    : "";
  const finishReason = {
    end_turn: "stop",
    stop_sequence: "stop",
    max_tokens: "length",
    tool_use: "tool_calls",
  }[obj.stop_reason] || "stop";
  return {
    id: obj.id || `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: requestedModel,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: finishReason,
      },
    ],
    usage: {
      prompt_tokens: obj.usage?.input_tokens || 0,
      completion_tokens: obj.usage?.output_tokens || 0,
      total_tokens: (obj.usage?.input_tokens || 0) + (obj.usage?.output_tokens || 0),
    },
  };
}

function openAIToSse(obj) {
  const choice = obj.choices?.[0] || {};
  const content = choice.message?.content || "";
  const chunk = {
    id: obj.id,
    object: "chat.completion.chunk",
    created: obj.created,
    model: obj.model,
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content },
        finish_reason: null,
      },
    ],
  };
  const done = {
    id: obj.id,
    object: "chat.completion.chunk",
    created: obj.created,
    model: obj.model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: choice.finish_reason || "stop",
      },
    ],
  };
  return Buffer.from(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(done)}\n\ndata: [DONE]\n\n`);
}

function routeModelsResponse() {
  return {
    object: "list",
    data: Array.from(routeModels.keys()).map((model) => ({
      id: model,
      object: "model",
      created: 0,
      owned_by: "api-local",
    })),
  };
}

function routeTagsResponse() {
  return {
    models: Array.from(routeModels.keys()).map((model) => ({
      name: model,
      model,
      modified_at: "1970-01-01T00:00:00Z",
      size: 0,
    })),
  };
}

function sendJson(res, statusCode, obj, method = "GET") {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": String(body.length),
  });
  if (method === "HEAD") res.end();
  else res.end(body);
}

function upstreamRequest({ targetUrl, method, headers, body }) {
  return new Promise((resolve, reject) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-model-proxy-"));
    const headerFile = path.join(tmpDir, "headers.txt");
    const outFile = path.join(tmpDir, "body.bin");
    const bodyFile = path.join(tmpDir, "request.bin");
    const configFile = path.join(tmpDir, "curl.conf");

    if (body && body.length) fs.writeFileSync(bodyFile, body);

    const quote = (value) => String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const configLines = [
      "silent",
      "show-error",
      'max-time = "120"',
      `request = "${quote(method)}"`,
      `url = "${quote(targetUrl)}"`,
      `dump-header = "${quote(headerFile)}"`,
      `output = "${quote(outFile)}"`,
    ];
    if (body && body.length) configLines.push(`data-binary = "@${quote(bodyFile)}"`);
    for (const [name, value] of Object.entries(headers || {})) {
      if (Array.isArray(value)) {
        for (const item of value) configLines.push(`header = "${quote(`${name}: ${item}`)}"`);
      } else if (value !== undefined) {
        configLines.push(`header = "${quote(`${name}: ${value}`)}"`);
      }
    }
    fs.writeFileSync(configFile, `${configLines.join("\n")}\n`, { mode: 0o600 });

    const child = spawn("curl", ["--config", configFile], {
      env: process.env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const stderr = [];
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (err) => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      reject(err);
    });
    child.on("close", (code) => {
      try {
        if (code !== 0) {
          reject(new Error(Buffer.concat(stderr).toString("utf8").trim() || `curl exited ${code}`));
          return;
        }
        const rawHeaders = fs.existsSync(headerFile) ? fs.readFileSync(headerFile, "utf8") : "";
        const blocks = rawHeaders
          .split(/\r?\n\r?\n/)
          .map((block) => block.trim())
          .filter(Boolean);
        const finalBlock = blocks.reverse().find((block) => /^HTTP\//i.test(block)) || "";
        const lines = finalBlock.split(/\r?\n/);
        const statusCode = Number((lines.shift() || "").match(/\s(\d{3})\s/)?.[1] || 502);
        const responseHeaders = {};
        for (const line of lines) {
          const idx = line.indexOf(":");
          if (idx === -1) continue;
          responseHeaders[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
        }
        resolve({
          statusCode,
          headers: responseHeaders,
          body: fs.existsSync(outFile) ? fs.readFileSync(outFile) : Buffer.alloc(0),
        });
      } catch (err) {
        reject(err);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
}

const server = http.createServer((req, res) => {
  if ((req.method === "GET" || req.method === "HEAD") && (req.url === "/" || req.url === "")) {
    res.writeHead(200, { "content-type": "text/plain" });
    if (req.method === "HEAD") res.end();
    else res.end("ok\n");
    console.error(`[claude-model-proxy][local] ${req.method} / -> 200`);
    return;
  }

  if (
    (req.method === "GET" || req.method === "HEAD") &&
    (/^\/(v1\/models|api\/v1\/models)(\/|$)/.test(req.url || ""))
  ) {
    sendJson(res, 200, routeModelsResponse(), req.method);
    console.error(`[claude-model-proxy][local] ${req.method} ${req.url} -> models`);
    return;
  }

  if ((req.method === "GET" || req.method === "HEAD") && (req.url === "/api/tags" || req.url === "/tags")) {
    sendJson(res, 200, routeTagsResponse(), req.method);
    console.error(`[claude-model-proxy][local] ${req.method} ${req.url} -> tags`);
    return;
  }

  if (
    (req.method === "GET" || req.method === "HEAD") &&
    (req.url === "/props" || req.url === "/v1/props" || req.url === "/version")
  ) {
    sendJson(res, 200, { ok: true, models: Array.from(routeModels.keys()) }, req.method);
    console.error(`[claude-model-proxy][local] ${req.method} ${req.url} -> props`);
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
    if ((req.url || "").includes("/chat/completions")) {
      let obj;
      try {
        obj = JSON.parse(original.toString("utf8") || "{}");
      } catch (err) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: err.message, type: "invalid_request_error" } }));
        return;
      }
      const requestedModel = typeof obj.model === "string" ? obj.model : routes.minimax.model;
      const picked = chooseRoute(requestedModel);
      const anthropicBody = Buffer.from(JSON.stringify(buildAnthropicBodyFromOpenAI(obj, picked.route)));
      const targetUrl = targetFor(picked.route, "/v1/messages");
      const headers = filterHeaders(req.headers);
      headers.host = targetUrl.hostname;
      headers["x-api-key"] = picked.route.apiKey;
      headers.authorization = `Bearer ${picked.route.apiKey}`;
      headers["content-type"] = "application/json";
      headers["anthropic-version"] = "2023-06-01";
      headers["content-length"] = String(anthropicBody.length);

      if (requestedModel !== picked.route.model) {
        console.error(`[claude-model-proxy][${picked.name}] openai ${requestedModel} -> ${picked.route.model}`);
      } else {
        console.error(`[claude-model-proxy][${picked.name}] openai ${requestedModel}`);
      }
      console.error(`[claude-model-proxy][${picked.name}] upstream ${targetUrl.hostname}`);

      upstreamRequest({
        targetUrl: targetUrl.href,
        method: "POST",
        headers,
        body: anthropicBody,
      })
        .then((upstreamRes) => {
          let out = upstreamRes.body;
          const contentType = String(upstreamRes.headers["content-type"] || "");
          if (contentType.includes("application/json")) {
            try {
              const upstreamObj = JSON.parse(out.toString("utf8"));
              if (upstreamRes.statusCode >= 200 && upstreamRes.statusCode < 300) {
                const openAIObj = anthropicToOpenAI(upstreamObj, requestedModel);
                out = obj.stream
                  ? openAIToSse(openAIObj)
                  : Buffer.from(JSON.stringify(openAIObj));
              }
            } catch (_) {
              // Leave invalid JSON untouched.
            }
          }
          res.writeHead(upstreamRes.statusCode || 502, {
            "content-type": obj.stream ? "text/event-stream" : "application/json",
            "cache-control": obj.stream ? "no-cache" : "no-store",
            "content-length": String(out.length),
          });
          res.end(out);
        })
        .catch((err) => {
          console.error(`[claude-model-proxy][${picked.name}] ${err.message}`);
          if (!res.headersSent) res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: err.message, type: "proxy_error" } }));
        });
      return;
    }

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

    console.error(`[claude-model-proxy][${rewritten.routeName}] upstream ${targetUrl.hostname}`);

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
    `[claude-model-proxy] known models: ${Array.from(routeModels.keys()).join(", ")}`,
  );
});
