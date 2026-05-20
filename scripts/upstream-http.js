"use strict";

const https = require("https");

function stripProcessProxyEnv() {
  for (const key of [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
  ]) {
    delete process.env[key];
  }
}

function httpsDirect({ targetUrl, method, headers, body }) {
  return new Promise((resolve, reject) => {
    const target = new URL(targetUrl);
    const req = https.request(
      {
        hostname: target.hostname,
        port: target.port || 443,
        path: `${target.pathname}${target.search}`,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode || 502,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on("error", reject);
    if (body && body.length) req.end(body);
    else req.end();
  });
}

async function upstreamRequest({ targetUrl, method, headers, body }) {
  return httpsDirect({ targetUrl, method, headers, body });
}

module.exports = {
  stripProcessProxyEnv,
  upstreamRequest,
};
