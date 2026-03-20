const { json } = require("./_lib/common");
const { getSupabaseClient } = require("./_lib/supabase");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    json(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from("share_cards").select("id").limit(1);

    if (error) {
      throw error;
    }

    json(res, 200, {
      ok: true,
      timestamp: new Date().toISOString(),
    });
  } catch {
    json(res, 500, {
      ok: false,
      error: "Supabase backend unavailable",
    });
  }
};
