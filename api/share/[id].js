const { json } = require("../_lib/common");
const { getSupabaseClient } = require("../_lib/supabase");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  const shareId = String(req.query?.id || "").trim();
  if (!shareId) {
    json(res, 400, { error: "Share id is required" });
    return;
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("share_cards")
      .select("id,to_text,from_text,headline_text,msg_text,video_url,created_at")
      .eq("id", shareId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      json(res, 404, { error: "Share not found" });
      return;
    }

    json(res, 200, {
      id: data.id,
      to: data.to_text || "",
      from: data.from_text || "",
      headline: data.headline_text || "",
      msg: data.msg_text || "",
      video: data.video_url || "",
      createdAt: data.created_at,
    });
  } catch {
    json(res, 500, { error: "Failed to fetch share" });
  }
};
