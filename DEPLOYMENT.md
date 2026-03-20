# Deployment Guide

## Current status

- Frontend is deployed on Vercel: `https://video-card-studio-iota.vercel.app`
- Vercel backend routes are in `api/` and use Supabase for data + file storage.
- You must provide your Supabase credentials to finish backend activation.

## 1) Supabase setup

1. Open your Supabase project dashboard.
2. Run SQL from `supabase/schema.sql` in the SQL Editor.
3. Copy these values:
   - `SUPABASE_URL` (Project URL)
   - `SUPABASE_SERVICE_ROLE_KEY` (Project Settings -> API)
4. Optional: choose a custom storage bucket name and set `SUPABASE_STORAGE_BUCKET`.

## 2) Configure Vercel environment variables

From this repo directory, run:

```bash
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add SUPABASE_STORAGE_BUCKET production
vercel env add PUBLIC_BASE_URL production
```

Recommended values:

- `SUPABASE_STORAGE_BUCKET=video-card-uploads`
- `PUBLIC_BASE_URL=https://video-card-studio-iota.vercel.app`

Then redeploy:

```bash
vercel deploy --prod --yes
```

## 3) Verify

```bash
curl -i "https://video-card-studio-iota.vercel.app/api/healthz"
```

Expected success response:

```json
{"ok":true,"timestamp":"..."}
```

If it returns `{"ok":false,"error":"Supabase backend unavailable"}`, one or more env vars are missing/invalid.
