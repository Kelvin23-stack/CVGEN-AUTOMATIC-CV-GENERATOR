-- =========================================================
-- CVGEN — Pro features add-on migration
-- =========================================================
-- Run this ONCE in your Supabase project's SQL Editor, in
-- addition to (not instead of) supabase-schema.sql, which you
-- should already have run.
--
-- WHY THIS IS NEEDED:
-- The new Pro/pricing feature-gating needs somewhere to record
-- (a) which plan a user is on ('free' or 'pro'), and
-- (b) whether they asked to be notified when AI CV Builder ships.
-- Both are per-user facts, so they live as two new columns on
-- the existing `profiles` table — nothing else changes, no
-- existing data or tables are touched, and both columns default
-- safely so every existing row keeps working immediately.
-- =========================================================

alter table public.profiles
  add column if not exists plan text not null default 'free' check (plan in ('free', 'pro')),
  add column if not exists ai_notify_opt_in boolean not null default false;

-- Existing RLS policies on profiles ("profiles_select_own" / "profiles_update_own")
-- already cover these new columns automatically — no policy changes needed.
