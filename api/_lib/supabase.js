const { createClient } = require("@supabase/supabase-js");

let cachedClient = null;

function getSupabaseClient() {
  if (cachedClient) {
    return cachedClient;
  }

  const url = String(process.env.SUPABASE_URL || "").trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!url || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }

  cachedClient = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return cachedClient;
}

function getStorageBucketName() {
  return String(process.env.SUPABASE_STORAGE_BUCKET || "video-card-uploads").trim();
}

module.exports = {
  getStorageBucketName,
  getSupabaseClient,
};
