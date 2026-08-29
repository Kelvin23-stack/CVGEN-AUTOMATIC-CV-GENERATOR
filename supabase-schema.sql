-- =========================================================
-- CVGEN — Supabase schema (normalized, multi-table)
-- =========================================================
-- Run this ONCE in your Supabase project's SQL Editor.
-- Dashboard → your project → SQL Editor → New query → paste
-- this whole file → Run.
--
-- This REPLACES any earlier, simpler version of this schema
-- (a single "cvs" table with one big jsonb column). The DROP
-- statements below give you a clean slate — safe during setup,
-- since there's no real user data riding on it yet.
-- =========================================================

-- ---------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------
create extension if not exists pgcrypto;

-- ---------------------------------------------------------
-- 1. Clean slate (safe to re-run this whole script anytime
--    during setup — it drops and recreates everything below)
-- ---------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.set_updated_at() cascade;

drop table if exists public.projects cascade;
drop table if exists public."references" cascade;
drop table if exists public.languages cascade;
drop table if exists public.certifications cascade;
drop table if exists public.skills cascade;
drop table if exists public.education cascade;
drop table if exists public.experiences cascade;
drop table if exists public.cvs cascade;
drop table if exists public.profiles cascade;

-- ---------------------------------------------------------
-- 2. profiles — one row per user, mirrors auth.users
-- ---------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  email text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

-- Auto-create a profile row whenever someone signs up
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Keeps any "updated_at" column current on every UPDATE, on any table it's attached to
create function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------
-- 3. cvs — one row per CV (personal info + summary live here,
--    since they're one-to-one with a CV; everything repeatable
--    — experience, education, etc — lives in its own table below)
-- ---------------------------------------------------------
create table public.cvs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,

  name text not null default 'Untitled CV',       -- the CV's own label, e.g. "Marketing CV"
  template text not null default 'professional',
  status text not null default 'draft' check (status in ('draft', 'completed')),

  full_name text not null default '',              -- the PERSON's name on this CV
  professional_title text not null default '',
  email text not null default '',
  phone text not null default '',
  location text not null default '',
  website text not null default '',
  linkedin text not null default '',
  photo_url text not null default '',               -- data URL or Supabase Storage URL
  summary text not null default '',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cvs_user_id_idx on public.cvs (user_id);

alter table public.cvs enable row level security;

create policy "cvs_select_own" on public.cvs
  for select using (auth.uid() = user_id);
create policy "cvs_insert_own" on public.cvs
  for insert with check (auth.uid() = user_id);
create policy "cvs_update_own" on public.cvs
  for update using (auth.uid() = user_id);
create policy "cvs_delete_own" on public.cvs
  for delete using (auth.uid() = user_id);

create trigger cvs_set_updated_at
  before update on public.cvs
  for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------
-- 4. experiences — many per CV
-- ---------------------------------------------------------
create table public.experiences (
  id uuid primary key default gen_random_uuid(),
  cv_id uuid not null references public.cvs on delete cascade,
  user_id uuid not null references auth.users on delete cascade,

  job_title text not null default '',
  company text not null default '',
  location text not null default '',
  start_date text not null default '',   -- "YYYY-MM", matches the app's month inputs
  end_date text not null default '',     -- '' means "Present"
  description text not null default '',
  sort_order int not null default 0,

  created_at timestamptz not null default now()
);

create index experiences_cv_id_idx on public.experiences (cv_id);
create index experiences_user_id_idx on public.experiences (user_id);

alter table public.experiences enable row level security;
create policy "experiences_select_own" on public.experiences for select using (auth.uid() = user_id);
create policy "experiences_insert_own" on public.experiences for insert with check (auth.uid() = user_id);
create policy "experiences_update_own" on public.experiences for update using (auth.uid() = user_id);
create policy "experiences_delete_own" on public.experiences for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------
-- 5. education — many per CV
-- ---------------------------------------------------------
create table public.education (
  id uuid primary key default gen_random_uuid(),
  cv_id uuid not null references public.cvs on delete cascade,
  user_id uuid not null references auth.users on delete cascade,

  school text not null default '',
  degree text not null default '',
  field_of_study text not null default '',
  start_date text not null default '',
  end_date text not null default '',
  description text not null default '',
  sort_order int not null default 0,

  created_at timestamptz not null default now()
);

create index education_cv_id_idx on public.education (cv_id);
create index education_user_id_idx on public.education (user_id);

alter table public.education enable row level security;
create policy "education_select_own" on public.education for select using (auth.uid() = user_id);
create policy "education_insert_own" on public.education for insert with check (auth.uid() = user_id);
create policy "education_update_own" on public.education for update using (auth.uid() = user_id);
create policy "education_delete_own" on public.education for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------
-- 6. skills — many per CV
-- ---------------------------------------------------------
create table public.skills (
  id uuid primary key default gen_random_uuid(),
  cv_id uuid not null references public.cvs on delete cascade,
  user_id uuid not null references auth.users on delete cascade,

  name text not null default '',
  level text not null default 'Intermediate' check (level in ('Beginner', 'Intermediate', 'Advanced', 'Expert')),
  sort_order int not null default 0,

  created_at timestamptz not null default now()
);

create index skills_cv_id_idx on public.skills (cv_id);
create index skills_user_id_idx on public.skills (user_id);

alter table public.skills enable row level security;
create policy "skills_select_own" on public.skills for select using (auth.uid() = user_id);
create policy "skills_insert_own" on public.skills for insert with check (auth.uid() = user_id);
create policy "skills_update_own" on public.skills for update using (auth.uid() = user_id);
create policy "skills_delete_own" on public.skills for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------
-- 7. certifications — many per CV
-- ---------------------------------------------------------
create table public.certifications (
  id uuid primary key default gen_random_uuid(),
  cv_id uuid not null references public.cvs on delete cascade,
  user_id uuid not null references auth.users on delete cascade,

  name text not null default '',
  issuing_organization text not null default '',
  issue_date text not null default '',
  sort_order int not null default 0,

  created_at timestamptz not null default now()
);

create index certifications_cv_id_idx on public.certifications (cv_id);
create index certifications_user_id_idx on public.certifications (user_id);

alter table public.certifications enable row level security;
create policy "certifications_select_own" on public.certifications for select using (auth.uid() = user_id);
create policy "certifications_insert_own" on public.certifications for insert with check (auth.uid() = user_id);
create policy "certifications_update_own" on public.certifications for update using (auth.uid() = user_id);
create policy "certifications_delete_own" on public.certifications for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------
-- 8. languages — many per CV
-- ---------------------------------------------------------
create table public.languages (
  id uuid primary key default gen_random_uuid(),
  cv_id uuid not null references public.cvs on delete cascade,
  user_id uuid not null references auth.users on delete cascade,

  name text not null default '',
  level text not null default 'Conversational' check (level in ('Basic', 'Conversational', 'Fluent', 'Native')),
  sort_order int not null default 0,

  created_at timestamptz not null default now()
);

create index languages_cv_id_idx on public.languages (cv_id);
create index languages_user_id_idx on public.languages (user_id);

alter table public.languages enable row level security;
create policy "languages_select_own" on public.languages for select using (auth.uid() = user_id);
create policy "languages_insert_own" on public.languages for insert with check (auth.uid() = user_id);
create policy "languages_update_own" on public.languages for update using (auth.uid() = user_id);
create policy "languages_delete_own" on public.languages for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------
-- 9. "references" — many per CV
--    (quoted everywhere below: REFERENCES is a reserved SQL
--    keyword, so this table name must stay double-quoted in
--    raw SQL. Supabase's JS client handles this transparently
--    — you'll just call .from('references') as normal there.)
-- ---------------------------------------------------------
create table public."references" (
  id uuid primary key default gen_random_uuid(),
  cv_id uuid not null references public.cvs on delete cascade,
  user_id uuid not null references auth.users on delete cascade,

  full_name text not null default '',
  job_position text not null default '',
  organization text not null default '',
  email text not null default '',
  phone text not null default '',
  sort_order int not null default 0,

  created_at timestamptz not null default now()
);

create index references_cv_id_idx on public."references" (cv_id);
create index references_user_id_idx on public."references" (user_id);

alter table public."references" enable row level security;
create policy "references_select_own" on public."references" for select using (auth.uid() = user_id);
create policy "references_insert_own" on public."references" for insert with check (auth.uid() = user_id);
create policy "references_update_own" on public."references" for update using (auth.uid() = user_id);
create policy "references_delete_own" on public."references" for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------
-- 10. projects — many per CV
--     (not wired into the CV builder UI yet — table is ready
--     for when a Projects section is added)
-- ---------------------------------------------------------
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  cv_id uuid not null references public.cvs on delete cascade,
  user_id uuid not null references auth.users on delete cascade,

  title text not null default '',
  description text not null default '',
  link text not null default '',
  start_date text not null default '',
  end_date text not null default '',
  sort_order int not null default 0,

  created_at timestamptz not null default now()
);

create index projects_cv_id_idx on public.projects (cv_id);
create index projects_user_id_idx on public.projects (user_id);

alter table public.projects enable row level security;
create policy "projects_select_own" on public.projects for select using (auth.uid() = user_id);
create policy "projects_insert_own" on public.projects for insert with check (auth.uid() = user_id);
create policy "projects_update_own" on public.projects for update using (auth.uid() = user_id);
create policy "projects_delete_own" on public.projects for delete using (auth.uid() = user_id);
