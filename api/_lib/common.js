const crypto = require("crypto");

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 50 * 1024 * 1024;
const SHARE_ID_BYTES = 6;

const allowedUploadTypes = {
  "video/webm": ".webm",
  "video/mp4": ".mp4",
  "video/ogg": ".ogg",
};

function json(res, statusCode, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", Buffer.byteLength(body));
  Object.entries(headers).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  res.end(body);
}

function text(res, statusCode, message, headers = {}) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  Object.entries(headers).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  res.end(message);
}

function parseContentType(value) {
  return String(value || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function normalizeTextInput(value, maxLength) {
  const textValue = String(value || "").trim().replace(/\s+/g, " ");
  if (textValue.length > maxLength) {
    return null;
  }
  return textValue;
}

function generateShareId() {
  return crypto.randomBytes(SHARE_ID_BYTES).toString("base64url");
}

function getRequestOrigin(req) {
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const host = String(req.headers.host || "").trim();
  if (!host) {
    return "";
  }
  const protocol = forwardedProto || "https";
  return `${protocol}://${host}`;
}

function getConfiguredPublicOrigin(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || "").trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }
  return getRequestOrigin(req);
}

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    req.on("error", () => {
      reject(new Error("Read failed"));
    });
  });
}

async function readJsonBody(req, maxBytes) {
  const body = await readRawBody(req, maxBytes);
  try {
    return body.length ? JSON.parse(body.toString("utf8")) : {};
  } catch {
    throw new Error("Invalid JSON");
  }
}

module.exports = {
  MAX_UPLOAD_BYTES,
  allowedUploadTypes,
  generateShareId,
  getConfiguredPublicOrigin,
  json,
  normalizeTextInput,
  parseContentType,
  readJsonBody,
  readRawBody,
  text,
};
