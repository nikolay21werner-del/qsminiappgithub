/* Small HTTP helpers shared by the serverless functions. */
"use strict";

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function applyCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Telegram-Init-Data");
}

function readJson(req, maxBytes) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  const cap = maxBytes || 16 * 1024;
  return new Promise(function (resolve, reject) {
    let raw = "";
    req.on("data", function (chunk) {
      raw += chunk;
      if (raw.length > cap) {
        reject(new Error("payload_too_large"));
        try { req.destroy(); } catch (e) {}
      }
    });
    req.on("end", function () {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(new Error("invalid_json")); }
    });
    req.on("error", reject);
  });
}

function extractInitData(req, body) {
  const fromHdr = req.headers && (req.headers["x-telegram-init-data"] ||
    req.headers["X-Telegram-Init-Data"]);
  if (typeof fromHdr === "string" && fromHdr) return fromHdr;
  if (body && typeof body.initData === "string" && body.initData) return body.initData;
  if (body && typeof body.init_data === "string" && body.init_data) return body.init_data;
  return "";
}

module.exports = {
  sendJson: sendJson,
  applyCors: applyCors,
  readJson: readJson,
  extractInitData: extractInitData
};
