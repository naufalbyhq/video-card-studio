create extension if not exists pgcrypto;

create table if not exists public.share_cards (
  id text primary key,
  to_text text not null default '',
  from_text text not null default '',
  headline_text text not null default '',
  msg_text text not null default '',
  video_url text not null default '',
  created_at timestamptz not null default now()
);

alter table public.share_cards enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'share_cards'
      and policyname = 'read share cards'
  ) then
    create policy "read share cards"
      on public.share_cards
      for select
      to anon, authenticated
      using (true);
  end if;
end
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'video-card-uploads',
  'video-card-uploads',
  true,
  52428800,
  array['video/webm', 'video/mp4', 'video/ogg']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
