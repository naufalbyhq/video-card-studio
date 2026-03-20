const {
  generateShareId,
  getConfiguredPublicOrigin,
  json,
  normalizeTextInput,
  parseContentType,
  readJsonBody,
} = require("./_lib/common");
const { getSupabaseClient } = require("./_lib/supabase");

const JSON_BODY_LIMIT = 64 * 1024;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  if (parseContentType(req.headers["content-type"]) !== "application/json") {
    json(res, 415, { error: "Expected application/json" });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(req, JSON_BODY_LIMIT);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request body";
    if (message === "Body too large") {
      json(res, 413, { error: "Share payload too large" });
      return;
    }
    json(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const to = normalizeTextInput(payload.to, 60);
  const from = normalizeTextInput(payload.from, 60);
  const headline = normalizeTextInput(payload.headline, 80);
  const msg = normalizeTextInput(payload.msg, 280);
  const video = normalizeTextInput(payload.video, 2000);

  if ([to, from, headline, msg, video].some((value) => value === null)) {
    json(res, 400, { error: "One or more fields are too long." });
    return;
  }

  if (video) {
    try {
      const parsedVideo = new URL(video);
      if (!(parsedVideo.protocol === "https:" || parsedVideo.protocol === "http:")) {
        json(res, 400, { error: "Video URL must use http or https." });
        return;
      }
    } catch {
      json(res, 400, { error: "Video URL is invalid." });
      return;
    }
  }

  try {
    const supabase = getSupabaseClient();
    let id = generateShareId();
    let attempts = 0;

    while (attempts < 5) {
      const { error } = await supabase.from("share_cards").insert({
        id,
        to_text: to || "",
        from_text: from || "",
        headline_text: headline || "",
        msg_text: msg || "",
        video_url: video || "",
      });

      if (!error) {
        const baseUrl = getConfiguredPublicOrigin(req);
        const sharePath = `/s/${id}`;
        json(res, 201, {
          id,
          shareUrl: baseUrl ? `${baseUrl}${sharePath}` : sharePath,
        });
        return;
      }

      if (error.code !== "23505") {
        throw error;
      }

      id = generateShareId();
      attempts += 1;
    }

    json(res, 503, { error: "Could not generate a unique share id. Try again." });
  } catch {
    json(res, 500, { error: "Failed to create share" });
  }
};
