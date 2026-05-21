#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { spawnSync } = require("child_process");

const DEFAULT_CONFIG = path.resolve(__dirname, "..", "api-local.json");
const configPath = path.resolve(process.argv[2] || process.env.CLAUDE_PROXY_CONFIG || DEFAULT_CONFIG);
const timeoutMs = Number(process.env.PING_API_LOCAL_TIMEOUT_MS || 10000);
const transport = process.env.PING_API_LOCAL_TRANSPORT || "curl";

function loadConfig(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function requestOnce(url, method, body) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const target = new URL(url);
    const client = target.protocol === "http:" ? http : https;
    const req = client.request(
      {
        method,
        hostname: target.hostname,
        port: target.port || (target.protocol === "http:" ? 80 : 443),
        path: `${target.pathname}${target.search}`,
        timeout: timeoutMs,
        headers: {
          "user-agent": "concatagents-api-local-ping/1.0",
          ...(body
            ? {
                "content-type": "application/json",
                "content-length": String(body.length),
              }
            : {}),
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          resolve({
            ok: true,
            statusCode: res.statusCode,
            elapsedMs: Date.now() - startedAt,
          });
        });
      },
    );

    req.on("timeout", () => {
      req.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });
    req.on("error", (err) => {
      resolve({
        ok: false,
        error: err.message,
        elapsedMs: Date.now() - startedAt,
      });
    });
    if (body) req.end(body);
    else req.end();
  });
}

function curlOnce(url, method, body) {
  const startedAt = Date.now();
  const args = [
    "-sS",
    "-m",
    String(Math.ceil(timeoutMs / 1000)),
    "-o",
    "/dev/null",
    "-w",
    "%{http_code}",
    "-X",
    method,
  ];
  if (body) args.push("-H", "content-type: application/json", "--data-binary", body.toString("utf8"));
  args.push(url);
  const result = spawnSync("curl", args, {
    encoding: "utf8",
    env: process.env,
  });
  const elapsedMs = Date.now() - startedAt;
  const statusCode = Number(String(result.stdout || "").trim());
  if (statusCode > 0) {
    return { ok: true, statusCode, elapsedMs };
  }
  return {
    ok: false,
    error: String(result.stderr || result.error?.message || "curl failed").trim(),
    elapsedMs,
  };
}

async function pingUrl(url) {
  const doRequest = transport === "node" ? requestOnce : curlOnce;
  const candidates = [
    new URL("v1/messages", url.endsWith("/") ? url : `${url}/`).href,
    url,
  ];

  let last;
  for (const candidate of candidates) {
    if (candidate.endsWith("/v1/messages")) {
      const post = await doRequest(candidate, "POST", Buffer.from("{}"));
      if (post.ok) return { ...post, url: candidate };
      last = { ...post, url: candidate };
      continue;
    }

    const head = await doRequest(candidate, "HEAD");
    if (head.ok) return { ...head, url: candidate };

    // Some gateways reject HEAD even though the endpoint is reachable.
    const get = await doRequest(candidate, "GET");
    if (get.ok) return { ...get, url: candidate };
    last = { ...head, url: candidate };
  }
  return last;
}

async function main() {
  const config = loadConfig(configPath);
  const routes = config.routes || {};
  const entries = Object.entries(routes);

  if (entries.length === 0) {
    console.error(`No routes found in ${configPath}`);
    process.exitCode = 1;
    return;
  }

  console.log(`config: ${configPath}`);
  console.log(`timeout: ${timeoutMs}ms`);
  console.log(`transport: ${transport}`);
  console.log("");

  let failed = 0;
  for (const [name, route] of entries) {
    if (!route.baseUrl) {
      failed += 1;
      console.log(`[FAIL] ${name}: missing baseUrl`);
      continue;
    }

    const result = await pingUrl(route.baseUrl);
    if (result.ok) {
      console.log(
        `[OK]   ${name}: ${result.url} -> HTTP ${result.statusCode} (${result.elapsedMs}ms)`,
      );
    } else {
      failed += 1;
      console.log(`[FAIL] ${name}: ${result.url} -> ${result.error} (${result.elapsedMs}ms)`);
    }
  }

  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.stack || err.message || String(err));
  process.exitCode = 1;
});
