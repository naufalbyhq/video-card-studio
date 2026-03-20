const crypto = require("crypto");
const {
  MAX_UPLOAD_BYTES,
  allowedUploadTypes,
  json,
  parseContentType,
  readRawBody,
} = require("./_lib/common");
const { getStorageBucketName, getSupabaseClient } = require("./_lib/supabase");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  const contentType = parseContentType(req.headers["content-type"]);
  const extension = allowedUploadTypes[contentType];
  if (!extension) {
    json(res, 415, { error: "Unsupported media type. Use WebM, MP4, or OGG." });
    return;
  }

  const contentLength = Number(req.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
    json(res, 413, { error: "Upload too large" });
    return;
  }

  let buffer;
  try {
    buffer = await readRawBody(req, MAX_UPLOAD_BYTES);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Read failed";
    if (message === "Body too large") {
      json(res, 413, { error: "Upload too large" });
      return;
    }
    json(res, 400, { error: "Invalid upload body" });
    return;
  }

  if (!buffer.length) {
    json(res, 400, { error: "Upload body is empty" });
    return;
  }

  try {
    const supabase = getSupabaseClient();
    const bucket = getStorageBucketName();
    const objectPath = `${Date.now()}-${crypto.randomUUID()}${extension}`;

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(objectPath, buffer, {
        contentType,
        upsert: false,
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
    if (!data.publicUrl) {
      throw new Error("Could not generate public URL");
    }

    json(res, 201, { videoUrl: data.publicUrl });
  } catch {
    json(res, 500, { error: "Failed to save upload" });
  }
};
