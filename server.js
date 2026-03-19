const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT) || 3000;
const rootDir = __dirname;
const uploadDir = path.join(rootDir, "uploads");
const shareCardsFile = path.join(uploadDir, ".share-cards.json");
const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES) || 50 * 1024 * 1024;
const uploadRequestTimeoutMs = Number(process.env.UPLOAD_REQUEST_TIMEOUT_MS) || 30_000;
const staticAssetMaxAgeSeconds = Number(process.env.STATIC_MAX_AGE_SECONDS) || 3600;
const uploadWindowMs = Number(process.env.UPLOAD_WINDOW_MS) || 10 * 60 * 1000;
const maxUploadsPerWindow = Number(process.env.MAX_UPLOADS_PER_WINDOW) || 20;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".ogg": "video/ogg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const allowedUploadTypes = {
  "video/webm": ".webm",
  "video/mp4": ".mp4",
  "video/ogg": ".ogg",
};

const uploadExtensions = new Set(Object.values(allowedUploadTypes));

const publicRootFiles = new Set(["index.html", "app.js", "styles.css"]);
const uploadRateLimit = new Map();

const envCorsOrigins = String(process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedCorsOrigins = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://video-card-studio.vercel.app",
  "https://video-card-studio-naufalbayhaqis-projects.vercel.app",
  ...envCorsOrigins,
]);

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const shareCards = new Map();

if (fs.existsSync(shareCardsFile)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(shareCardsFile, "utf8"));
    if (parsed && typeof parsed === "object") {
      Object.entries(parsed).forEach(([id, value]) => {
        shareCards.set(id, value);
      });
    }
  } catch {
    console.warn("Could not load persisted share cards; starting fresh.");
  }
}

function defaultHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(self), microphone=(self)",
    "Content-Security-Policy": [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      "media-src 'self' blob: https:",
      "connect-src 'self'",
      "frame-src https://www.youtube.com https://player.vimeo.com",
    ].join("; "),
  };
}

function writeResponse(response, statusCode, headers, body) {
  response.writeHead(statusCode, {
    ...defaultHeaders(),
    ...(response.corsHeaders || {}),
    ...headers,
  });

  if (body) {
    response.end(body);
    return;
  }

  response.end();
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  writeResponse(
    response,
    statusCode,
    {
      ...extraHeaders,
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
    },
    body,
  );
}

function sendText(response, statusCode, message) {
  writeResponse(
    response,
    statusCode,
    {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": Buffer.byteLength(message),
    },
    message,
  );
}

function resolvePublicPath(requestPath) {
  if (requestPath === "/") {
    return path.join(rootDir, "index.html");
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  const normalizedPath = path.normalize(decodedPath).replace(/^[/\\]+/, "");

  if (!normalizedPath || normalizedPath.startsWith("..") || normalizedPath.includes(`..${path.sep}`)) {
    return null;
  }

  const absolutePath = path.resolve(rootDir, normalizedPath);

  if (normalizedPath.startsWith(`uploads${path.sep}`)) {
    const extension = path.extname(normalizedPath).toLowerCase();
    if (!uploadExtensions.has(extension)) {
      return null;
    }

    const uploadsWithSep = `${uploadDir}${path.sep}`;
    if (absolutePath.startsWith(uploadsWithSep)) {
      return absolutePath;
    }
    return null;
  }

  if (!publicRootFiles.has(normalizedPath)) {
    return null;
  }

  return absolutePath;
}

function getCacheControl(filePath, extension) {
  const fileIsUpload = filePath.startsWith(`${uploadDir}${path.sep}`);

  if (extension === ".html") {
    return "no-store";
  }

  if (fileIsUpload) {
    return "public, max-age=31536000, immutable";
  }

  return `public, max-age=${staticAssetMaxAgeSeconds}, must-revalidate`;
}

function makeWeakEtag(stat) {
  return `W/\"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}\"`;
}

function parseContentType(headerValue) {
  return String(headerValue || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function persistShareCards() {
  const serializable = Object.fromEntries(shareCards.entries());
  fs.writeFile(shareCardsFile, JSON.stringify(serializable), () => {});
}

function generateShareId() {
  return crypto.randomBytes(6).toString("base64url");
}

function getPublicBaseUrl(request) {
  const configured = String(process.env.PUBLIC_BASE_URL || "").trim();
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const hostHeader = String(request.headers.host || "").trim();
  if (!hostHeader) {
    return `http://${host}:${port}`;
  }

  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || "http";
  return `${protocol}://${hostHeader}`;
}

function buildShareQuery(record) {
  const params = new URLSearchParams();
  params.set("view", "1");
  params.set("to", record.to || "");
  params.set("from", record.from || "");
  params.set("headline", record.headline || "");
  params.set("msg", record.msg || "");
  params.set("video", record.video || "");
  return params.toString();
}

function readJsonBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const parsed = raw ? JSON.parse(raw) : {};
        resolve(parsed);
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    request.on("error", () => {
      reject(new Error("Read failed"));
    });
  });
}

function normalizeTextInput(value, maxLength) {
  const text = String(value || "").trim().replace(/\s+/g, " ");
  if (text.length > maxLength) {
    return null;
  }
  return text;
}

function getCorsHeaders(request) {
  const origin = String(request.headers.origin || "").trim();
  if (!origin) {
    return {};
  }

  if (allowedCorsOrigins.has("*") || allowedCorsOrigins.has(origin)) {
    return {
      "Access-Control-Allow-Origin": allowedCorsOrigins.has("*") ? "*" : origin,
      "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    };
  }

  return null;
}

function getClientIdentifier(request) {
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  if (forwarded) {
    return forwarded;
  }

  return request.socket.remoteAddress || "unknown";
}

function canUpload(request) {
  const now = Date.now();

  if (uploadRateLimit.size > 2000) {
    for (const [key, value] of uploadRateLimit) {
      if (now - value.windowStart > uploadWindowMs) {
        uploadRateLimit.delete(key);
      }
    }
  }

  const key = getClientIdentifier(request);
  const current = uploadRateLimit.get(key);

  if (!current || now - current.windowStart > uploadWindowMs) {
    uploadRateLimit.set(key, { windowStart: now, count: 1 });
    return true;
  }

  if (current.count >= maxUploadsPerWindow) {
    return false;
  }

  current.count += 1;
  uploadRateLimit.set(key, current);
  return true;
}

function serveFile(filePath, response, method, requestHeaders) {
  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      sendText(response, 404, "Not found");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[extension] || "application/octet-stream";
    const etag = makeWeakEtag(stat);
    const lastModified = stat.mtime.toUTCString();
    const cacheControl = getCacheControl(filePath, extension);
    const fileIsUpload = filePath.startsWith(`${uploadDir}${path.sep}`);

    const requestEtag = requestHeaders["if-none-match"];
    const requestModifiedSince = requestHeaders["if-modified-since"];
    const requestModifiedSinceMs = requestModifiedSince ? Date.parse(requestModifiedSince) : Number.NaN;
    const notModifiedByDate = Number.isFinite(requestModifiedSinceMs) && requestModifiedSinceMs >= stat.mtime.getTime();
    const notModified = requestEtag === etag || notModifiedByDate;

    if (notModified) {
      writeResponse(response, 304, {
        "Cache-Control": cacheControl,
        ETag: etag,
        "Last-Modified": lastModified,
      });
      return;
    }

    const headers = {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
      "Content-Length": stat.size,
      ETag: etag,
      "Last-Modified": lastModified,
      "Cross-Origin-Resource-Policy": fileIsUpload ? "cross-origin" : "same-origin",
    };

    if (method === "HEAD") {
      writeResponse(response, 200, headers);
      return;
    }

    response.writeHead(200, {
      ...defaultHeaders(),
      ...headers,
    });

    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      if (!response.headersSent) {
        sendText(response, 500, "Failed to read file");
      } else {
        response.destroy();
      }
    });
    stream.pipe(response);
  });
}

function handleUpload(request, response) {
  if (!canUpload(request)) {
    sendJson(response, 429, { error: "Too many uploads. Please try again later." }, {
      "Retry-After": Math.ceil(uploadWindowMs / 1000),
    });
    return;
  }

  const contentType = parseContentType(request.headers["content-type"]);
  const extension = allowedUploadTypes[contentType];

  if (!extension) {
    sendJson(response, 415, { error: "Unsupported media type. Use WebM, MP4, or OGG." });
    return;
  }

  const contentLengthHeader = request.headers["content-length"];
  const contentLength = Number(contentLengthHeader);
  if (Number.isFinite(contentLength) && contentLength > maxUploadBytes) {
    sendJson(response, 413, { error: "Upload too large" });
    return;
  }

  request.setTimeout(uploadRequestTimeoutMs, () => {
    request.destroy(new Error("Upload timeout"));
  });

  const fileName = `${Date.now()}-${crypto.randomUUID()}${extension}`;
  const outputPath = path.join(uploadDir, fileName);
  const outputStream = fs.createWriteStream(outputPath, { flags: "wx" });

  let size = 0;
  let responded = false;

  function cleanupPartialFile() {
    fs.rm(outputPath, { force: true }, () => {});
  }

  function fail(statusCode, message) {
    if (responded) {
      return;
    }

    responded = true;
    cleanupPartialFile();
    sendJson(response, statusCode, { error: message });
  }

  outputStream.on("error", () => {
    fail(500, "Failed to save upload");
    request.destroy();
  });

  outputStream.on("finish", () => {
    if (responded) {
      return;
    }
    responded = true;
    sendJson(response, 201, {
      videoUrl: `/uploads/${fileName}`,
    });
  });

  request.on("data", (chunk) => {
    if (responded) {
      return;
    }

    size += chunk.length;
    if (size > maxUploadBytes) {
      outputStream.destroy();
      fail(413, "Upload too large");
      request.destroy();
      return;
    }

    if (!outputStream.write(chunk)) {
      request.pause();
      outputStream.once("drain", () => {
        request.resume();
      });
    }
  });

  request.on("end", () => {
    if (!responded) {
      outputStream.end();
    }
  });

  request.on("aborted", () => {
    outputStream.destroy();
    if (!responded) {
      cleanupPartialFile();
    }
  });

  request.on("error", (error) => {
    outputStream.destroy();
    const message = error && error.message === "Upload timeout" ? "Upload timed out" : "Upload failed";
    fail(500, message);
  });
}

async function handleCreateShare(request, response) {
  if (parseContentType(request.headers["content-type"]) !== "application/json") {
    sendJson(response, 415, { error: "Expected application/json" });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(request, 64 * 1024);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request body";
    if (message === "Body too large") {
      sendJson(response, 413, { error: "Share payload too large" });
      return;
    }
    sendJson(response, 400, { error: "Invalid JSON body" });
    return;
  }

  const to = normalizeTextInput(payload.to, 60);
  const from = normalizeTextInput(payload.from, 60);
  const headline = normalizeTextInput(payload.headline, 80);
  const msg = normalizeTextInput(payload.msg, 280);
  const video = normalizeTextInput(payload.video, 2000);

  if ([to, from, headline, msg, video].some((value) => value === null)) {
    sendJson(response, 400, { error: "One or more fields are too long." });
    return;
  }

  if (video) {
    try {
      const parsedVideo = new URL(video);
      if (!(parsedVideo.protocol === "https:" || parsedVideo.protocol === "http:")) {
        sendJson(response, 400, { error: "Video URL must use http or https." });
        return;
      }
    } catch {
      sendJson(response, 400, { error: "Video URL is invalid." });
      return;
    }
  }

  let id = generateShareId();
  while (shareCards.has(id)) {
    id = generateShareId();
  }

  shareCards.set(id, {
    to: to || "",
    from: from || "",
    headline: headline || "",
    msg: msg || "",
    video: video || "",
    createdAt: new Date().toISOString(),
  });
  persistShareCards();

  const baseUrl = getPublicBaseUrl(request);
  sendJson(response, 201, {
    id,
    shareUrl: `${baseUrl}/s/${id}`,
  });
}

function handleShareRedirect(request, response, url) {
  const segments = url.pathname.split("/").filter(Boolean);
  const shareId = segments[1] || "";
  const record = shareCards.get(shareId);

  if (!record) {
    sendText(response, 404, "Share link not found");
    return;
  }

  const query = buildShareQuery(record);
  writeResponse(response, 302, {
    "Cache-Control": "no-store",
    Location: `/?${query}`,
  });
}

const server = http.createServer((request, response) => {
  const corsHeaders = getCorsHeaders(request);
  response.corsHeaders = corsHeaders || {};

  const startedAt = process.hrtime.bigint();
  response.on("finish", () => {
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    console.log(`${request.method || "UNKNOWN"} ${request.url || ""} ${response.statusCode} ${elapsedMs.toFixed(1)}ms`);
  });

  if (!request.url) {
    sendText(response, 400, "Bad request");
    return;
  }

  let url;
  try {
    url = new URL(request.url, `http://${host}:${port}`);
  } catch {
    sendText(response, 400, "Bad request URL");
    return;
  }

  const isCorsSensitiveRoute = url.pathname === "/api/upload" || url.pathname === "/api/share" || url.pathname === "/healthz";
  if (request.headers.origin && corsHeaders === null && isCorsSensitiveRoute) {
    sendText(response, 403, "CORS origin not allowed");
    return;
  }

  if (request.method === "OPTIONS") {
    if (isCorsSensitiveRoute && corsHeaders !== null) {
      writeResponse(response, 204, {
        "Cache-Control": "no-store",
      });
      return;
    }

    sendText(response, 405, "Method not allowed");
    return;
  }

  if (request.method === "GET" && url.pathname === "/healthz") {
    sendJson(
      response,
      200,
      {
        ok: true,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      },
      {
        "Cache-Control": "no-store",
      },
    );
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/upload") {
    handleUpload(request, response);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/share") {
    handleCreateShare(request, response);
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/s/")) {
    handleShareRedirect(request, response, url);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendText(response, 405, "Method not allowed");
    return;
  }

  const filePath = resolvePublicPath(url.pathname);
  if (!filePath) {
    sendText(response, 404, "Not found");
    return;
  }

  serveFile(filePath, response, request.method, request.headers);
});

server.requestTimeout = 65_000;
server.headersTimeout = 66_000;

server.on("clientError", (error, socket) => {
  if (socket.writable) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  }
  console.error("Client error", error.message);
});

server.listen(port, host, () => {
  console.log(`Video Card server running at http://${host}:${port}`);
});
