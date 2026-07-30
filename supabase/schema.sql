create extension if not exists pgcrypto;

-- FORCE Arena database schema for a new Supabase project.
-- Persistent application data and temporary gameplay state use Supabase PostgreSQL.
-- Browser roles have no direct access; all application traffic passes through the server API.

-- =========================================================
-- 1. Core lookup tables
-- =========================================================

create table if not exists public.question_categories (
  key text primary key,
  label text not null,
  description text not null default '',
  sort_order smallint not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint question_categories_key_format check (key ~ '^[a-z0-9_]{2,32}$')
);

insert into public.question_categories (key, label, description, sort_order, active) values
  ('global', 'Global', 'Bahasa Inggris dan Geografi global seperti peta, bendera, dan bangsa-bangsa.', 1, true),
  ('tech', 'Tech', 'Logika, matematika, dan teknologi.', 2, true),
  ('media', 'Media', 'Istilah editing, media, visual thinking, dan cara melihat cakupan luas.', 3, true),
  ('kitchen_cafe', 'Kitchen & Cafe', 'Bisnis praktikal, bahan makanan, teknik memasak, dan jenis makanan.', 4, true),
  ('mentoring', 'Mentoring', 'Jiwa pengajar, komunikasi, dan public speaking.', 5, true),
  ('orchestral', 'Orchestral', 'Musik, nada, dan alat musik.', 6, true),
  ('force_core', 'FORCE CORE', 'Arah hidup, tujuan hidup, loyalitas, kesetiaan, attitude, manner, dan aturan.', 7, true)
on conflict (key) do update
  set label = excluded.label,
      description = excluded.description,
      sort_order = excluded.sort_order,
      active = excluded.active;

create table if not exists public.school_options (
  name text primary key,
  sort_order integer not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint school_options_name_length check (char_length(name) between 2 and 60)
);

insert into public.school_options (name, sort_order, active) values
  ('SMAN 1 Manado', 1, true),
  ('SMAN 2 Manado', 2, true),
  ('SMAN 3 Manado', 3, true),
  ('SMAN 4 Manado', 4, true),
  ('SMAN 5 Manado', 5, true),
  ('SMAN 6 Manado', 6, true),
  ('SMAN 7 Manado', 7, true),
  ('SMAN 8 Manado', 8, true),
  ('SMAN 9 Binsus Manado', 9, true),
  ('SMAN 10 Manado', 10, true),
  ('SMKN 1 Manado', 11, true),
  ('SMKN 2 Manado', 12, true),
  ('SMKN 3 Manado', 13, true),
  ('SMKN 4 Manado', 14, true),
  ('SMKN 5 Manado', 15, true),
  ('SMKN 6 Manado', 16, true),
  ('SMKN 7 Manado', 17, true),
  ('SMKN 8 Manado', 18, true),
  ('SMKN 9 Manado', 19, true),
  ('SMKN 10 Manado', 20, true)
on conflict (name) do update
  set sort_order = excluded.sort_order,
      active = excluded.active;

-- =========================================================
-- 2. Permanent user/auth/profile data
-- =========================================================

create table if not exists public.users (
  id text primary key,
  given_id text not null unique,
  name text not null,
  username text not null unique,
  phone text unique,
  email text unique,
  city text not null default '',
  school text not null default '',
  gender text not null default '',
  password_hash text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,

  -- Permanent score summary. Per-category counters are moved to user_category_stats.
  lifetime_fp integer not null default 0,
  weekly_fp integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  draws integer not null default 0,
  total_correct integer not null default 0,
  total_answer_time_ms integer not null default 0,
  total_answers integer not null default 0,
  current_win_streak integer not null default 0,
  fire_streak_days integer not null default 0,
  last_fire_date date,

  constraint users_username_format check (username ~ '^[a-z0-9._-]{3,24}$'),
  constraint users_email_length check (email is null or char_length(email) <= 80),
  constraint users_email_format check (email is null or email = '' or email ~ '^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$'),
  constraint users_name_length check (char_length(name) between 2 and 60),
  constraint users_city_length check (char_length(city) <= 25),
  constraint users_school_length check (char_length(school) <= 60),
  constraint users_name_no_blocked_symbols check (name = translate(name, $blocked$()*&^%$#@!~`+=_-'":;|\?/.,><[]{}$blocked$, '')),
  constraint users_city_no_blocked_symbols check (city = translate(city, $blocked$()*&^%$#@!~`+=_-'":;|\?/.,><[]{}$blocked$, '')),
  constraint users_school_no_blocked_symbols check (school = translate(school, $blocked$()*&^%$#@!~`+=_-'":;|\?/.,><[]{}$blocked$, '')),
  constraint users_gender_format check (gender in ('', 'male', 'female'))
);

create table if not exists public.user_settings (
  user_id text primary key references public.users(id) on delete cascade,
  music_enabled boolean not null default true,
  sfx_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sessions (
  token_hash text primary key,
  user_id text not null references public.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  user_agent text,
  ip_hint text
);

create unique index if not exists idx_sessions_one_active_per_user on public.sessions (user_id);

create table if not exists public.password_reset_codes (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

-- Stores only explicit favourites. Do not pre-generate relationships for all users.
-- Recommended app behaviour: insert when favourite, delete when unfavourite.
create table if not exists public.relationships (
  owner_id text not null references public.users(id) on delete cascade,
  target_id text not null references public.users(id) on delete cascade,
  is_favourite boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, target_id),
  constraint relationships_not_self check (owner_id <> target_id)
);

create table if not exists public.user_category_stats (
  user_id text not null references public.users(id) on delete cascade,
  category_key text not null references public.question_categories(key),
  answered_count integer not null default 0,
  correct_count integer not null default 0,
  total_answer_time_ms integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, category_key)
);

create table if not exists public.system_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- =========================================================
-- 3. Permanent question bank
-- =========================================================

create table if not exists public.questions (
  id text primary key,
  category_key text not null default 'global' references public.question_categories(key),
  subcategory text not null default '',
  question text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  correct_option text not null check (correct_option in ('A', 'B', 'C', 'D')),

  -- image_url null/empty = text-only question.
  -- image_url has value = image question.
  image_url text,

  active boolean not null default true,

  -- Stable random key used for indexed question selection during high-concurrency matchmaking.
  matchmaking_key double precision not null default random(),

  constraint questions_matchmaking_key_range check (matchmaking_key >= 0 and matchmaking_key < 1),
  constraint questions_subcategory_format check (subcategory = '' or subcategory ~ '^[a-z0-9_ -]{2,48}$')
);

-- Safe re-run cleanup for older FORCE schema versions.
alter table public.questions drop column if exists category;
alter table public.questions drop column if exists random_key;
alter table public.questions drop column if exists created_at;
alter table public.questions drop column if exists updated_at;

-- Safe re-run upgrade for databases created before high-concurrency matchmaking.
alter table public.questions
  add column if not exists matchmaking_key double precision default random();
update public.questions
   set matchmaking_key = random()
 where matchmaking_key is null;
alter table public.questions alter column matchmaking_key set default random();
alter table public.questions alter column matchmaking_key set not null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'questions_matchmaking_key_range'
       and conrelid = 'public.questions'::regclass
  ) then
    alter table public.questions
      add constraint questions_matchmaking_key_range
      check (matchmaking_key >= 0 and matchmaking_key < 1);
  end if;
end;
$$;

-- =========================================================
-- 4. Permanent duel summary + short-lived answer details
-- =========================================================

create table if not exists public.duels (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  opponent_id text references public.users(id) on delete set null,
  opponent_name text not null default 'Force Rival',

  play_mode text not null default 'mix' check (play_mode in ('category', 'mix')),
  category_key text references public.question_categories(key),

  status text not null default 'active' check (status in ('active', 'finished', 'cancelled')),
  user_score integer not null default 0,
  opponent_score integer not null default 0,
  user_avg_time_ms integer not null default 0,
  opponent_avg_time_ms integer not null default 0,
  fp_awarded integer not null default 0,
  opponent_fp_awarded integer not null default 0,
  winner_id text references public.users(id) on delete set null,

  started_at timestamptz not null default now(),
  starts_at timestamptz not null default now(),
  finished_at timestamptz,

  constraint duels_category_mode_check check ((play_mode = 'mix' and category_key is null) or (play_mode = 'category' and category_key is not null))
);

-- Safe re-run additions for API result payload.
alter table public.duels add column if not exists user_avg_time_ms integer not null default 0;
alter table public.duels add column if not exists opponent_avg_time_ms integer not null default 0;

create table if not exists public.duel_questions (
  duel_id text not null references public.duels(id) on delete cascade,
  question_id text not null references public.questions(id) on delete cascade,
  position smallint not null check (position between 1 and 50),
  created_at timestamptz not null default now(),
  primary key (duel_id, position),
  unique (duel_id, question_id)
);

create table if not exists public.duel_answers (
  duel_id text not null references public.duels(id) on delete cascade,
  question_id text not null references public.questions(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  category_key text not null default 'global' references public.question_categories(key),
  selected_option text check (selected_option in ('A', 'B', 'C', 'D')),
  is_correct boolean not null,
  answer_time_ms integer not null default 0,
  points integer not null default 0 check (points between 0 and 100),
  answered_at timestamptz not null default now(),
  primary key (duel_id, question_id, user_id)
);

-- Supabase-only temporary matchmaking queue.
alter table public.duel_answers add column if not exists points integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'duel_answers_points_range'
      and conrelid = 'public.duel_answers'::regclass
  ) then
    alter table public.duel_answers
      add constraint duel_answers_points_range check (points between 0 and 100);
  end if;
end;
$$;

create table if not exists public.duel_queue (
  user_id text primary key references public.users(id) on delete cascade,
  play_mode text not null default 'mix' check (play_mode in ('category', 'mix')),
  category_key text references public.question_categories(key),
  status text not null default 'waiting' check (status in ('waiting', 'matched', 'cancelled')),
  duel_id text references public.duels(id) on delete set null,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint duel_queue_category_mode_check check ((play_mode = 'mix' and category_key is null) or (play_mode = 'category' and category_key is not null))
);

-- Universal active-duel reservation. The primary key guarantees that a player
-- cannot enter two active duels, even if another backend flow creates duels.
create table if not exists public.duel_active_participants (
  user_id text primary key references public.users(id) on delete cascade,
  duel_id text not null references public.duels(id) on delete cascade,
  reserved_at timestamptz not null default now(),
  unique (duel_id, user_id)
);

-- Remove stale reservations before a safe schema re-run.
delete from public.duel_active_participants ap
where not exists (
  select 1
    from public.duels d
   where d.id = ap.duel_id
     and d.status = 'active'
     and ap.user_id in (d.user_id, d.opponent_id)
);

-- Refuse migration when production already contains duplicate active participants.
do $$
begin
  if exists (
    select participant_id
      from (
        select d.user_id as participant_id
          from public.duels d
         where d.status = 'active'
        union all
        select d.opponent_id
          from public.duels d
         where d.status = 'active'
           and d.opponent_id is not null
      ) active_players
     group by participant_id
    having count(*) > 1
  ) then
    raise exception 'DUPLICATE_ACTIVE_DUEL_PARTICIPANT_FOUND';
  end if;
end;
$$;

insert into public.duel_active_participants (user_id, duel_id, reserved_at)
select active_players.user_id, active_players.duel_id, active_players.reserved_at
from (
  select d.user_id, d.id as duel_id, d.started_at as reserved_at
    from public.duels d
   where d.status = 'active'
  union all
  select d.opponent_id, d.id, d.started_at
    from public.duels d
   where d.status = 'active'
     and d.opponent_id is not null
) active_players
on conflict (user_id) do nothing;

create table if not exists public.duel_requests (
  id text primary key,
  requester_id text not null references public.users(id) on delete cascade,
  target_id text not null references public.users(id) on delete cascade,
  play_mode text not null default 'mix' check (play_mode in ('category', 'mix')),
  category_key text references public.question_categories(key),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  duel_id text references public.duels(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 seconds'),
  responded_at timestamptz,
  constraint duel_requests_not_self check (requester_id <> target_id),
  constraint duel_requests_category_mode_check check ((play_mode = 'mix' and category_key is null) or (play_mode = 'category' and category_key is not null))
);

alter table public.duel_requests alter column expires_at set default (now() + interval '30 seconds');

create table if not exists public.weekly_rank_snapshots (
  week_key text not null,
  user_id text not null references public.users(id) on delete cascade,
  rank integer not null,
  weekly_fp integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (week_key, rank)
);

-- =========================================================
-- 5. Indexes
-- =========================================================

create index if not exists idx_users_weekly on public.users (weekly_fp desc, lifetime_fp desc);
create index if not exists idx_users_school_weekly on public.users (school, weekly_fp desc, lifetime_fp desc, created_at);
create index if not exists idx_users_seen on public.users (last_seen_at);
create index if not exists idx_users_lower_username on public.users (lower(username));
create unique index if not exists idx_users_lower_email on public.users (lower(email)) where email is not null and email <> '';

create index if not exists idx_sessions_user_expiry on public.sessions (user_id, expires_at desc);
create index if not exists idx_password_reset_codes_user_expiry on public.password_reset_codes (user_id, expires_at desc);
create index if not exists idx_relationships_target on public.relationships (target_id);

drop index if exists idx_questions_pick_category;
drop index if exists idx_questions_pick_all;
create index if not exists idx_questions_pick_category on public.questions (category_key, active);
create index if not exists idx_questions_pick_all on public.questions (active);
create index if not exists idx_questions_subcategory on public.questions (category_key, subcategory) where active = true;
create index if not exists idx_questions_match_category_pick
  on public.questions (category_key, matchmaking_key, id)
  where active = true;
create index if not exists idx_questions_match_all_pick
  on public.questions (matchmaking_key, id)
  where active = true;

create index if not exists idx_user_category_stats_category on public.user_category_stats (category_key, correct_count desc);

create index if not exists idx_duels_user_started on public.duels (user_id, started_at desc);
create index if not exists idx_duels_opponent_started on public.duels (opponent_id, started_at desc);
create index if not exists idx_duels_status_starts on public.duels (status, starts_at);
create index if not exists idx_duels_category_started on public.duels (category_key, started_at desc);

create index if not exists idx_duel_answers_duel_user on public.duel_answers (duel_id, user_id);
create index if not exists idx_duel_answers_user_answered on public.duel_answers (user_id, answered_at desc);
create index if not exists idx_duel_answers_category on public.duel_answers (category_key, answered_at desc);

create index if not exists idx_duel_queue_waiting on public.duel_queue (play_mode, category_key, status, updated_at, last_seen_at);
create index if not exists idx_duel_queue_match_waiting
  on public.duel_queue (play_mode, category_key, updated_at, user_id)
  include (last_seen_at)
  where status = 'waiting';
create index if not exists idx_duel_requests_target on public.duel_requests (target_id, status, created_at desc);
create index if not exists idx_duel_requests_requester on public.duel_requests (requester_id, target_id, status);
create index if not exists idx_duel_requests_expiry on public.duel_requests (status, expires_at);
create unique index if not exists idx_duel_requests_unique_pending on public.duel_requests (requester_id, target_id) where status = 'pending';

create index if not exists idx_weekly_rank_snapshots_user_rank on public.weekly_rank_snapshots (user_id, rank);
create index if not exists idx_weekly_rank_snapshots_week_rank on public.weekly_rank_snapshots (week_key, rank);

-- =========================================================
-- 6. Helper functions
-- =========================================================

create or replace function public.force_category_label(p_key text)
returns text
language sql
stable
as $$
  select coalesce((select label from public.question_categories where key = p_key), p_key);
$$;

create or replace function public.force_question_category_key(p_value text)
returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(p_value, '')) in ('global', 'bahasa inggris', 'english', 'geografi', 'geography', 'flags', 'bendera', 'peta', 'map', 'nations')
      or lower(coalesce(p_value, '')) like '%english%'
      or lower(coalesce(p_value, '')) like '%inggris%'
      or lower(coalesce(p_value, '')) like '%geografi%'
      or lower(coalesce(p_value, '')) like '%geography%'
      or lower(coalesce(p_value, '')) like '%flag%'
      or lower(coalesce(p_value, '')) like '%bendera%'
      then 'global'
    when lower(coalesce(p_value, '')) in ('tech', 'technology', 'teknologi', 'logic', 'logika', 'math', 'matematika')
      or lower(coalesce(p_value, '')) like '%tech%'
      or lower(coalesce(p_value, '')) like '%teknologi%'
      or lower(coalesce(p_value, '')) like '%logika%'
      or lower(coalesce(p_value, '')) like '%math%'
      or lower(coalesce(p_value, '')) like '%matematika%'
      then 'tech'
    when lower(coalesce(p_value, '')) in ('media', 'editing', 'editor', 'visual')
      or lower(coalesce(p_value, '')) like '%media%'
      or lower(coalesce(p_value, '')) like '%editing%'
      or lower(coalesce(p_value, '')) like '%visual%'
      then 'media'
    when lower(coalesce(p_value, '')) in ('kitchen_cafe', 'kitchen', 'cafe', 'cooking', 'masak', 'dapur')
      or lower(coalesce(p_value, '')) like '%kitchen%'
      or lower(coalesce(p_value, '')) like '%cafe%'
      or lower(coalesce(p_value, '')) like '%masak%'
      or lower(coalesce(p_value, '')) like '%dapur%'
      or lower(coalesce(p_value, '')) like '%makanan%'
      then 'kitchen_cafe'
    when lower(coalesce(p_value, '')) in ('mentoring', 'mentor', 'public speaking', 'teaching', 'pengajar')
      or lower(coalesce(p_value, '')) like '%mentor%'
      or lower(coalesce(p_value, '')) like '%public speaking%'
      or lower(coalesce(p_value, '')) like '%pengajar%'
      or lower(coalesce(p_value, '')) like '%teaching%'
      then 'mentoring'
    when lower(coalesce(p_value, '')) in ('orchestral', 'music', 'musik', 'nada', 'alat musik')
      or lower(coalesce(p_value, '')) like '%orchestra%'
      or lower(coalesce(p_value, '')) like '%musik%'
      or lower(coalesce(p_value, '')) like '%music%'
      or lower(coalesce(p_value, '')) like '%nada%'
      then 'orchestral'
    when lower(coalesce(p_value, '')) in ('force_core', 'force core', 'core', 'arah hidup', 'tujuan hidup', 'loyalitas', 'attitude', 'manner')
      or lower(coalesce(p_value, '')) like '%force core%'
      or lower(coalesce(p_value, '')) like '%tujuan%'
      or lower(coalesce(p_value, '')) like '%loyal%'
      or lower(coalesce(p_value, '')) like '%attitude%'
      or lower(coalesce(p_value, '')) like '%manner%'
      then 'force_core'
    else 'global'
  end;
$$;

create or replace function public.force_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.force_normalize_question()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.category_key := public.force_question_category_key(coalesce(nullif(new.category_key, ''), 'global'));
  return new;
end;
$$;

drop trigger if exists trg_questions_normalize on public.questions;
create trigger trg_questions_normalize
before insert or update on public.questions
for each row execute function public.force_normalize_question();

drop trigger if exists trg_user_settings_updated_at on public.user_settings;
create trigger trg_user_settings_updated_at
before update on public.user_settings
for each row execute function public.force_touch_updated_at();

drop trigger if exists trg_relationships_updated_at on public.relationships;
create trigger trg_relationships_updated_at
before update on public.relationships
for each row execute function public.force_touch_updated_at();

create or replace function public.force_limit_user_favourites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- Limit only active favourite rows. Non-favourite rows should normally be deleted by the app.
  if new.is_favourite = true then
    -- Prevent concurrent inserts from bypassing the 100-favourite limit for the same owner.
    perform pg_advisory_xact_lock(hashtext(new.owner_id));

    if tg_op = 'UPDATE' then
      select count(*) into v_count
        from public.relationships r
       where r.owner_id = new.owner_id
         and r.is_favourite = true
         and r.target_id <> old.target_id;
    else
      select count(*) into v_count
        from public.relationships r
       where r.owner_id = new.owner_id
         and r.is_favourite = true;
    end if;

    if v_count >= 100 then
      raise exception 'FAVOURITE_LIMIT_REACHED_MAX_100';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_relationships_limit_favourites on public.relationships;
create trigger trg_relationships_limit_favourites
before insert or update on public.relationships
for each row execute function public.force_limit_user_favourites();

create or replace function public.force_prune_non_favourite_relationship()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Keep this table small: false favourite rows are not stored permanently.
  if new.is_favourite = false then
    delete from public.relationships
     where owner_id = new.owner_id
       and target_id = new.target_id;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_relationships_prune_non_favourite on public.relationships;
create trigger trg_relationships_prune_non_favourite
after insert or update on public.relationships
for each row execute function public.force_prune_non_favourite_relationship();

-- Pick questions without daily pool.
create or replace function public.force_pick_question_ids(
  p_category_key text default null,
  p_limit integer default 5,
  p_exclude_ids text[] default array[]::text[]
)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids text[] := array[]::text[];
  v_wrap_ids text[] := array[]::text[];
  v_category text := nullif(public.force_question_category_key(coalesce(p_category_key, '')), '');
  v_non_core_mix boolean := lower(trim(coalesce(p_category_key, ''))) in ('mix', 'all', 'random');
  v_pivot double precision := random();
  v_missing integer;
  v_exclusions text[] := coalesce(p_exclude_ids, array[]::text[]);
begin
  if p_limit <= 0 then
    raise exception 'QUESTION_LIMIT_MUST_BE_POSITIVE';
  end if;

  if p_category_key is null or lower(trim(p_category_key)) = '' then
    v_category := null;
    v_non_core_mix := false;
  elsif v_non_core_mix then
    v_category := null;
  end if;

  -- Start at a random indexed pivot and wrap once. This avoids sorting the
  -- complete active question bank with ORDER BY random() for every duel.
  select coalesce(array_agg(picked.id order by picked.matchmaking_key, picked.id), array[]::text[])
    into v_ids
    from (
      select q.id, q.matchmaking_key
        from public.questions q
       where q.active = true
         and (v_category is null or q.category_key = v_category)
         and (not v_non_core_mix or q.category_key <> 'force_core')
         and q.matchmaking_key >= v_pivot
         and not (q.id = any(v_exclusions))
       order by q.matchmaking_key, q.id
       limit p_limit
    ) picked;

  v_missing := p_limit - coalesce(array_length(v_ids, 1), 0);
  if v_missing > 0 then
    select coalesce(array_agg(picked.id order by picked.matchmaking_key, picked.id), array[]::text[])
      into v_wrap_ids
      from (
        select q.id, q.matchmaking_key
          from public.questions q
         where q.active = true
           and (v_category is null or q.category_key = v_category)
           and (not v_non_core_mix or q.category_key <> 'force_core')
           and q.matchmaking_key < v_pivot
           and not (q.id = any(v_exclusions))
           and not (q.id = any(v_ids))
         order by q.matchmaking_key, q.id
         limit v_missing
      ) picked;
    v_ids := v_ids || v_wrap_ids;
  end if;

  -- Fallback: recent-history exclusions may leave too few rows. Retry without
  -- those exclusions, while still using the indexed pivot scan.
  if coalesce(array_length(v_ids, 1), 0) < p_limit then
    v_ids := array[]::text[];

    select coalesce(array_agg(picked.id order by picked.matchmaking_key, picked.id), array[]::text[])
      into v_ids
      from (
        select q.id, q.matchmaking_key
          from public.questions q
         where q.active = true
           and (v_category is null or q.category_key = v_category)
           and (not v_non_core_mix or q.category_key <> 'force_core')
           and q.matchmaking_key >= v_pivot
         order by q.matchmaking_key, q.id
         limit p_limit
      ) picked;

    v_missing := p_limit - coalesce(array_length(v_ids, 1), 0);
    if v_missing > 0 then
      select coalesce(array_agg(picked.id order by picked.matchmaking_key, picked.id), array[]::text[])
        into v_wrap_ids
        from (
          select q.id, q.matchmaking_key
            from public.questions q
           where q.active = true
             and (v_category is null or q.category_key = v_category)
             and (not v_non_core_mix or q.category_key <> 'force_core')
             and q.matchmaking_key < v_pivot
             and not (q.id = any(v_ids))
           order by q.matchmaking_key, q.id
           limit v_missing
        ) picked;
      v_ids := v_ids || v_wrap_ids;
    end if;
  end if;

  if coalesce(array_length(v_ids, 1), 0) < p_limit then
    raise exception 'NOT_ENOUGH_ACTIVE_QUESTIONS';
  end if;

  return v_ids;
end;
$$;

-- Keep active participant reservations synchronized with every duel write.
create or replace function public.force_sync_active_duel_participants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.duel_active_participants where duel_id = old.id;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    delete from public.duel_active_participants where duel_id = old.id;
  end if;

  if new.status = 'active' then
    insert into public.duel_active_participants (user_id, duel_id, reserved_at)
    values (new.user_id, new.id, coalesce(new.started_at, now()));

    if new.opponent_id is not null and new.opponent_id is distinct from new.user_id then
      insert into public.duel_active_participants (user_id, duel_id, reserved_at)
      values (new.opponent_id, new.id, coalesce(new.started_at, now()));
    end if;
  end if;

  return new;
exception
  when unique_violation then
    raise exception 'PLAYER_ALREADY_IN_ACTIVE_DUEL' using errcode = '23505';
end;
$$;

drop trigger if exists trg_duels_active_participants_insert_delete on public.duels;
create trigger trg_duels_active_participants_insert_delete
after insert or delete on public.duels
for each row execute function public.force_sync_active_duel_participants();

drop trigger if exists trg_duels_active_participants_update on public.duels;
create trigger trg_duels_active_participants_update
after update of status, user_id, opponent_id on public.duels
for each row execute function public.force_sync_active_duel_participants();

-- Atomically enqueue or match one quick-match player.
-- The candidate row lock prevents two concurrent callers from claiming the
-- same opponent. Duel creation and queue updates commit in the same transaction.
create or replace function public.force_matchmake_duel(
  p_user_id text,
  p_category_key text default null,
  p_daily_limit integer default 7,
  p_start_buffer_ms integer default 2000
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_today_start timestamptz :=
    date_trunc('day', clock_timestamp() at time zone 'Asia/Jakarta')
      at time zone 'Asia/Jakarta';
  v_category text;
  v_play_mode text;
  v_existing public.duel_queue%rowtype;
  v_opponent public.duel_queue%rowtype;
  v_opponent_name text;
  v_duel_id text;
  v_main_ids text[];
  v_core_ids text[];
  v_question_ids text[];
  v_daily_count integer;
begin
  if nullif(trim(coalesce(p_user_id, '')), '') is null then
    raise exception 'INVALID_USER';
  end if;
  if p_daily_limit < 1 or p_daily_limit > 100 then
    raise exception 'INVALID_DAILY_LIMIT';
  end if;
  if p_start_buffer_ms < 0 or p_start_buffer_ms > 30000 then
    raise exception 'INVALID_START_BUFFER';
  end if;

  if p_category_key is null
     or lower(trim(p_category_key)) in ('', 'mix', 'all', 'random') then
    v_category := null;
    v_play_mode := 'mix';
  else
    v_category := public.force_question_category_key(p_category_key);
    if not exists (
      select 1
      from public.question_categories c
      where c.key = v_category
        and c.active = true
        and c.key <> 'force_core'
    ) then
      raise exception 'INVALID_DUEL_CATEGORY';
    end if;
    v_play_mode := 'category';
  end if;

  if not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception 'USER_NOT_FOUND';
  end if;

  -- Serializes duplicate start/status calls made by the same device/user.
  select *
    into v_existing
    from public.duel_queue q
   where q.user_id = p_user_id
   for update;

  if found
     and v_existing.status = 'matched'
     and v_existing.duel_id is not null
     and exists (
       select 1
       from public.duels d
       where d.id = v_existing.duel_id
         and d.status = 'active'
         and p_user_id in (d.user_id, d.opponent_id)
     ) then
    return jsonb_build_object(
      'state', 'matched',
      'duel_id', v_existing.duel_id,
      'category_key', v_existing.category_key
    );
  end if;

  select ap.duel_id
    into v_duel_id
    from public.duel_active_participants ap
   where ap.user_id = p_user_id
   limit 1;
  if v_duel_id is not null then
    return jsonb_build_object('state', 'matched', 'duel_id', v_duel_id);
  end if;

  select count(*)::integer
    into v_daily_count
    from public.duels d
   where d.started_at >= v_today_start
     and p_user_id in (d.user_id, d.opponent_id);
  if v_daily_count >= p_daily_limit then
    raise exception 'LIMIT_REACHED';
  end if;

  insert into public.duel_queue (
    user_id, play_mode, category_key, status, duel_id, last_seen_at, updated_at
  ) values (
    p_user_id, v_play_mode, v_category, 'waiting', null, v_now, v_now
  )
  on conflict (user_id) do update
    set play_mode = excluded.play_mode,
        category_key = excluded.category_key,
        status = 'waiting',
        duel_id = null,
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at;

  -- Oldest compatible, online candidate wins. SKIP LOCKED lets many pairs form
  -- concurrently without making all callers wait behind one queue row.
  select q.*
    into v_opponent
    from public.duel_queue q
    join public.users u on u.id = q.user_id
   where q.status = 'waiting'
     and q.user_id <> p_user_id
     and q.play_mode = v_play_mode
     and q.category_key is not distinct from v_category
     and q.last_seen_at >= v_now - interval '5 minutes'
     and u.last_seen_at >= v_now - interval '2 minutes'
     and not exists (
       select 1
         from public.duel_active_participants active_player
        where active_player.user_id = q.user_id
     )
     and (
       select count(*)
       from public.duels daily_duel
       where daily_duel.started_at >= v_today_start
         and q.user_id in (daily_duel.user_id, daily_duel.opponent_id)
     ) < p_daily_limit
   order by q.updated_at asc, q.user_id asc
   for update of q skip locked
   limit 1;

  if not found then
    return jsonb_build_object(
      'state', 'waiting',
      'category_key', v_category,
      'play_mode', v_play_mode
    );
  end if;

  select u.username
    into v_opponent_name
    from public.users u
   where u.id = v_opponent.user_id;

  if v_category is not null then
    v_main_ids := public.force_pick_question_ids(
      v_category, 4, array[]::text[]
    );
    v_core_ids := public.force_pick_question_ids(
      'force_core', 1, coalesce(v_main_ids, array[]::text[])
    );
    v_question_ids := v_main_ids || v_core_ids;
  else
    v_core_ids := public.force_pick_question_ids(
      'force_core', 1, array[]::text[]
    );
    v_main_ids := public.force_pick_question_ids(
      'mix', 4, coalesce(v_core_ids, array[]::text[])
    );
    v_question_ids := v_main_ids || v_core_ids;
  end if;

  if coalesce(array_length(v_question_ids, 1), 0) <> 5
     or (
       select count(distinct picked_id)
       from unnest(v_question_ids) as picked(picked_id)
     ) <> 5 then
    raise exception 'NOT_ENOUGH_ACTIVE_QUESTIONS';
  end if;

  v_duel_id := 'duel_' || replace(gen_random_uuid()::text, '-', '');

  insert into public.duels (
    id, user_id, opponent_id, opponent_name, play_mode, category_key,
    status, started_at, starts_at
  ) values (
    v_duel_id, p_user_id, v_opponent.user_id,
    coalesce(v_opponent_name, 'Force Rival'), v_play_mode, v_category,
    'active', v_now, v_now + make_interval(secs => p_start_buffer_ms / 1000.0)
  );

  insert into public.duel_questions (duel_id, question_id, position)
  select v_duel_id, picked.question_id, picked.position::smallint
  from unnest(v_question_ids) with ordinality picked(question_id, position);

  update public.duel_queue
     set status = 'matched',
         duel_id = v_duel_id,
         last_seen_at = v_now,
         updated_at = v_now
   where user_id in (p_user_id, v_opponent.user_id);

  return jsonb_build_object(
    'state', 'matched',
    'duel_id', v_duel_id,
    'opponent_id', v_opponent.user_id,
    'category_key', v_category,
    'play_mode', v_play_mode
  );
end;
$$;

revoke all on function public.force_matchmake_duel(text, text, integer, integer) from public;
revoke all on function public.force_matchmake_duel(text, text, integer, integer) from anon;
revoke all on function public.force_matchmake_duel(text, text, integer, integer) from authenticated;
grant execute on function public.force_matchmake_duel(text, text, integer, integer) to service_role;

-- Compatibility for older API code that still calls get_daily_duel_question_ids().
-- This does not create any daily pool table.
create or replace function public.get_daily_duel_question_ids(
  p_pool_date date default (now() at time zone 'Asia/Jakarta')::date,
  p_limit integer default 5
)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.force_pick_question_ids(null, p_limit, array[]::text[]);
end;
$$;

create or replace function public.force_fill_answer_category()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category text;
begin
  select q.category_key into v_category
    from public.questions q
   where q.id = new.question_id;

  if v_category is not null then
    new.category_key := v_category;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_duel_answers_fill_category on public.duel_answers;
create trigger trg_duel_answers_fill_category
before insert on public.duel_answers
for each row execute function public.force_fill_answer_category();

create or replace function public.force_apply_category_stat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_category_stats (
    user_id,
    category_key,
    answered_count,
    correct_count,
    total_answer_time_ms,
    updated_at
  ) values (
    new.user_id,
    new.category_key,
    1,
    case when new.is_correct then 1 else 0 end,
    greatest(0, new.answer_time_ms),
    now()
  )
  on conflict (user_id, category_key) do update
    set answered_count = public.user_category_stats.answered_count + 1,
        correct_count = public.user_category_stats.correct_count + case when excluded.correct_count > 0 then 1 else 0 end,
        total_answer_time_ms = public.user_category_stats.total_answer_time_ms + excluded.total_answer_time_ms,
        updated_at = now();
  return null;
end;
$$;

drop trigger if exists trg_duel_answers_category_stat on public.duel_answers;
create trigger trg_duel_answers_category_stat
after insert on public.duel_answers
for each row execute function public.force_apply_category_stat();

-- Atomic duel answer submission. Browser timing and question position are never trusted.
create or replace function public.force_submit_duel_answer(
  p_duel_id text,
  p_user_id text,
  p_question_id text,
  p_selected_option text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_duel public.duels%rowtype;
  v_position integer;
  v_expected_position integer;
  v_correct_option text;
  v_category_key text;
  v_previous_answered_at timestamptz;
  v_question_started_at timestamptz;
  v_answered_at timestamptz := clock_timestamp();
  v_elapsed_ms integer;
  v_is_correct boolean;
  v_points integer;
begin
  if p_selected_option is not null and p_selected_option not in ('A', 'B', 'C', 'D') then
    raise exception 'Pilihan jawaban tidak valid';
  end if;

  select * into v_duel
  from public.duels
  where id = p_duel_id
  for update;

  if not found or v_duel.status <> 'active' then
    raise exception 'Duel tidak aktif atau tidak ditemukan';
  end if;

  if p_user_id <> v_duel.user_id and p_user_id is distinct from v_duel.opponent_id then
    raise exception 'User bukan peserta duel';
  end if;

  if v_answered_at + interval '250 milliseconds' < coalesce(v_duel.starts_at, v_duel.started_at) then
    raise exception 'Duel belum mulai';
  end if;

  select dq.position, q.correct_option, q.category_key
    into v_position, v_correct_option, v_category_key
  from public.duel_questions dq
  join public.questions q on q.id = dq.question_id
  where dq.duel_id = p_duel_id
    and dq.question_id = p_question_id;

  if not found then
    raise exception 'Pertanyaan tidak ditemukan dalam duel';
  end if;

  if exists (
    select 1 from public.duel_answers
    where duel_id = p_duel_id
      and question_id = p_question_id
      and user_id = p_user_id
  ) then
    raise exception 'Pertanyaan ini sudah dijawab';
  end if;

  select count(*)::integer + 1
    into v_expected_position
  from public.duel_answers
  where duel_id = p_duel_id
    and user_id = p_user_id;

  if v_position <> v_expected_position then
    raise exception 'Urutan pertanyaan tidak sesuai';
  end if;

  if v_position = 1 then
    v_question_started_at := coalesce(v_duel.starts_at, v_duel.started_at);
  else
    select da.answered_at
      into v_previous_answered_at
    from public.duel_questions previous_question
    join public.duel_answers da
      on da.duel_id = previous_question.duel_id
     and da.question_id = previous_question.question_id
     and da.user_id = p_user_id
    where previous_question.duel_id = p_duel_id
      and previous_question.position = v_position - 1;

    if v_previous_answered_at is null then
      raise exception 'Urutan pertanyaan tidak sesuai';
    end if;

    -- The frontend advances after a short feedback transition. The server owns this
    -- start time so a client cannot claim an arbitrary answer duration.
    v_question_started_at := v_previous_answered_at + interval '200 milliseconds';
  end if;

  if v_answered_at + interval '100 milliseconds' < v_question_started_at then
    raise exception 'Pertanyaan belum dimulai';
  end if;

  v_elapsed_ms := greatest(
    0,
    least(
      10000,
      floor(extract(epoch from (v_answered_at - v_question_started_at)) * 1000)::integer
    )
  );
  v_is_correct := p_selected_option is not null and p_selected_option = v_correct_option;
  v_points := case
    when v_is_correct then 50 + round(50 * greatest(0, 10000 - v_elapsed_ms)::numeric / 10000)::integer
    else 0
  end;

  insert into public.duel_answers (
    duel_id,
    question_id,
    user_id,
    category_key,
    selected_option,
    is_correct,
    answer_time_ms,
    points,
    answered_at
  ) values (
    p_duel_id,
    p_question_id,
    p_user_id,
    v_category_key,
    p_selected_option,
    v_is_correct,
    v_elapsed_ms,
    v_points,
    v_answered_at
  );

  return jsonb_build_object(
    'duel_id', p_duel_id,
    'question_id', p_question_id,
    'position', v_position,
    'is_correct', v_is_correct,
    'answer_time_ms', v_elapsed_ms,
    'points', v_points,
    'answered_at', v_answered_at
  );
exception
  when unique_violation then
    raise exception 'Pertanyaan ini sudah dijawab';
end;
$$;

-- =========================================================
-- 7. Auto-clean temporary Supabase data
-- =========================================================

create or replace function public.force_cleanup_temp_data(
  p_temp_days integer default 2,
  p_answer_detail_days integer default 2,
  p_weekly_snapshot_days integer default 28
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cutoff timestamptz := now() - make_interval(days => greatest(p_temp_days, 1));
  v_answer_cutoff timestamptz := now() - make_interval(days => greatest(p_answer_detail_days, 1));
  v_week_cutoff date := current_date - greatest(p_weekly_snapshot_days, 7);
  v_deleted_sessions integer := 0;
  v_deleted_reset_codes integer := 0;
  v_cancelled_requests integer := 0;
  v_deleted_requests integer := 0;
  v_deleted_queue integer := 0;
  v_cancelled_duels integer := 0;
  v_deleted_cancelled_duels integer := 0;
  v_deleted_answers integer := 0;
  v_deleted_duel_questions integer := 0;
  v_deleted_snapshots integer := 0;
begin
  delete from public.sessions where expires_at < now();
  get diagnostics v_deleted_sessions = row_count;

  delete from public.password_reset_codes
   where expires_at < now()
      or (used_at is not null and used_at < v_cutoff)
      or created_at < v_cutoff;
  get diagnostics v_deleted_reset_codes = row_count;

  update public.duel_requests
     set status = 'cancelled', responded_at = coalesce(responded_at, now())
   where status = 'pending'
     and expires_at < now();
  get diagnostics v_cancelled_requests = row_count;

  delete from public.duel_requests
   where created_at < v_cutoff
      or coalesce(responded_at, created_at) < v_cutoff;
  get diagnostics v_deleted_requests = row_count;

  delete from public.duel_queue
   where updated_at < v_cutoff
      or (status = 'waiting' and last_seen_at < now() - interval '10 minutes')
      or (status = 'matched' and updated_at < now() - interval '30 minutes')
      or status = 'cancelled';
  get diagnostics v_deleted_queue = row_count;

  update public.duels
     set status = 'cancelled', finished_at = coalesce(finished_at, now())
   where status = 'active'
     and starts_at < now() - interval '30 minutes';
  get diagnostics v_cancelled_duels = row_count;

  delete from public.duel_answers a
   using public.duels d
   where a.duel_id = d.id
     and d.finished_at is not null
     and d.finished_at < v_answer_cutoff;
  get diagnostics v_deleted_answers = row_count;

  delete from public.duel_questions q
   using public.duels d
   where q.duel_id = d.id
     and d.finished_at is not null
     and d.finished_at < v_answer_cutoff;
  get diagnostics v_deleted_duel_questions = row_count;

  delete from public.duels
   where status = 'cancelled'
     and coalesce(finished_at, started_at) < v_cutoff;
  get diagnostics v_deleted_cancelled_duels = row_count;

  delete from public.weekly_rank_snapshots
   where week_key ~ '^\d{4}-\d{2}-\d{2}$'
     and week_key::date < v_week_cutoff;
  get diagnostics v_deleted_snapshots = row_count;

  return jsonb_build_object(
    'deleted_sessions', v_deleted_sessions,
    'deleted_reset_codes', v_deleted_reset_codes,
    'cancelled_expired_requests', v_cancelled_requests,
    'deleted_requests', v_deleted_requests,
    'deleted_queue', v_deleted_queue,
    'cancelled_stale_duels', v_cancelled_duels,
    'deleted_cancelled_duels', v_deleted_cancelled_duels,
    'deleted_answer_details', v_deleted_answers,
    'deleted_duel_question_details', v_deleted_duel_questions,
    'deleted_weekly_snapshots', v_deleted_snapshots
  );
end;
$$;

create or replace function public.force_maybe_cleanup_temp_data()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last text;
begin
  select value into v_last
    from public.system_settings
   where key = 'cleanup_last_run_at';

  if v_last is not null then
    begin
      if v_last::timestamptz > now() - interval '6 hours' then
        return null;
      end if;
    exception when others then
      -- Invalid stored timestamp: ignore and run cleanup.
    end;
  end if;

  insert into public.system_settings (key, value, updated_at)
  values ('cleanup_last_run_at', now()::text, now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  perform public.force_cleanup_temp_data(2, 2, 28);
  return null;
end;
$$;

-- Throttled cleanup triggers. They only run cleanup at most once every 6 hours.
drop trigger if exists trg_cleanup_after_session on public.sessions;
create trigger trg_cleanup_after_session
after insert on public.sessions
for each statement execute function public.force_maybe_cleanup_temp_data();

drop trigger if exists trg_cleanup_after_reset_code on public.password_reset_codes;
create trigger trg_cleanup_after_reset_code
after insert on public.password_reset_codes
for each statement execute function public.force_maybe_cleanup_temp_data();

drop trigger if exists trg_cleanup_after_duel_request on public.duel_requests;
create trigger trg_cleanup_after_duel_request
after insert or update on public.duel_requests
for each statement execute function public.force_maybe_cleanup_temp_data();

drop trigger if exists trg_cleanup_after_duel_queue on public.duel_queue;
create trigger trg_cleanup_after_duel_queue
after insert or update on public.duel_queue
for each statement execute function public.force_maybe_cleanup_temp_data();

drop trigger if exists trg_cleanup_after_duel_finish on public.duels;
create trigger trg_cleanup_after_duel_finish
after insert or update on public.duels
for each statement execute function public.force_maybe_cleanup_temp_data();

-- =========================================================
-- 8. RLS
-- =========================================================

alter table public.question_categories enable row level security;
alter table public.school_options enable row level security;
alter table public.users enable row level security;
alter table public.user_settings enable row level security;
alter table public.sessions enable row level security;
alter table public.password_reset_codes enable row level security;
alter table public.relationships enable row level security;
alter table public.user_category_stats enable row level security;
alter table public.system_settings enable row level security;
alter table public.questions enable row level security;
alter table public.duels enable row level security;
alter table public.duel_questions enable row level security;
alter table public.duel_answers enable row level security;
alter table public.duel_queue enable row level security;
alter table public.duel_active_participants enable row level security;
alter table public.duel_requests enable row level security;
alter table public.weekly_rank_snapshots enable row level security;

insert into public.system_settings (key, value, updated_at) values
  ('schema_version', 'force_clean_schema_v5_1_matchmaking_1000', now()),
  ('badge_system_enabled', 'false', now()),
  ('temporary_supabase_retention_days', '2', now()),
  ('answer_detail_retention_days', '2', now()),
  ('state_provider', 'supabase', now())
on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

-- =========================================================
-- 10. FORCE Shops + FORCE Go to Schools
-- =========================================================
-- Consolidated fresh-install definition.
-- Includes the final state of both 20260711 migrations.
-- =========================================================

-- =========================================================
-- 1. Spendable Force Points wallet
-- =========================================================

create table if not exists public.force_wallets (
  user_id text primary key references public.users(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.force_wallet_ledger (
  id text primary key,
  user_id text not null references public.users(id) on delete cascade,
  amount integer not null,
  entry_type text not null check (entry_type in ('initial_sync', 'earn', 'redeem', 'refund', 'admin_adjustment')),
  reference_id text,
  description text not null default '',
  balance_after integer not null check (balance_after >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_force_wallet_ledger_user_created
  on public.force_wallet_ledger (user_id, created_at desc);

insert into public.force_wallets (user_id, balance)
select id, greatest(lifetime_fp, 0)
from public.users
on conflict (user_id) do nothing;

insert into public.force_wallet_ledger (id, user_id, amount, entry_type, reference_id, description, balance_after)
select
  'wallet_initial_' || u.id,
  u.id,
  w.balance,
  'initial_sync',
  u.id,
  'Saldo awal dari Lifetime FP saat fitur shop dibuat',
  w.balance
from public.users u
join public.force_wallets w on w.user_id = u.id
where not exists (
  select 1 from public.force_wallet_ledger l
  where l.id = 'wallet_initial_' || u.id
)
on conflict (id) do nothing;

create or replace function public.force_sync_user_wallet_from_lifetime()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delta integer := 0;
  v_balance integer := 0;
begin
  if tg_op = 'INSERT' then
    insert into public.force_wallets (user_id, balance, updated_at)
    values (new.id, greatest(new.lifetime_fp, 0), now())
    on conflict (user_id) do nothing;
    return new;
  end if;

  v_delta := greatest(new.lifetime_fp - old.lifetime_fp, 0);
  if v_delta <= 0 then
    return new;
  end if;

  insert into public.force_wallets (user_id, balance, updated_at)
  values (new.id, v_delta, now())
  on conflict (user_id) do update
    set balance = public.force_wallets.balance + excluded.balance,
        updated_at = now()
  returning balance into v_balance;

  insert into public.force_wallet_ledger (
    id, user_id, amount, entry_type, reference_id, description, balance_after
  ) values (
    'wallet_earn_' || md5(random()::text || clock_timestamp()::text),
    new.id,
    v_delta,
    'earn',
    null,
    'Force Points dari aktivitas FORCE Arena',
    v_balance
  );

  return new;
end;
$$;

drop trigger if exists trg_force_wallet_sync_user on public.users;
create trigger trg_force_wallet_sync_user
after insert or update of lifetime_fp on public.users
for each row execute function public.force_sync_user_wallet_from_lifetime();

-- =========================================================
-- 2. FORCE Shops
-- =========================================================

create table if not exists public.shop_categories (
  id text primary key,
  name text not null,
  slug text not null unique,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.shop_products (
  id text primary key,
  sku text not null unique,
  category_id text references public.shop_categories(id) on delete set null,
  name text not null,
  subtitle text not null default '',
  description text not null default '',
  image_url text not null default '',
  fp_price integer not null check (fp_price > 0),
  stock integer not null default 0 check (stock >= 0),
  featured boolean not null default false,
  badge text not null default '',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shop_orders (
  id text primary key,
  order_number text not null unique,
  user_id text not null references public.users(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'processing', 'shipped', 'completed', 'cancelled')),
  total_fp integer not null check (total_fp >= 0),
  recipient_name text not null,
  phone text not null,
  address text not null,
  city text not null,
  postal_code text not null,
  notes text not null default '',
  notification_status text not null default 'not_configured'
    check (notification_status in ('not_configured', 'pending', 'sent', 'failed')),
  notification_error text not null default '',
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shop_order_items (
  id text primary key,
  order_id text not null references public.shop_orders(id) on delete cascade,
  product_id text references public.shop_products(id) on delete set null,
  product_name_snapshot text not null,
  sku_snapshot text not null,
  image_url_snapshot text not null default '',
  fp_price integer not null check (fp_price > 0),
  quantity integer not null default 1 check (quantity > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.shop_order_status_history (
  id text primary key,
  order_id text not null references public.shop_orders(id) on delete cascade,
  old_status text,
  new_status text not null,
  note text not null default '',
  changed_at timestamptz not null default now()
);

create index if not exists idx_shop_products_category_active
  on public.shop_products (category_id, active, sort_order);
create index if not exists idx_shop_orders_user_created
  on public.shop_orders (user_id, created_at desc);
create index if not exists idx_shop_orders_status_created
  on public.shop_orders (status, created_at desc);
create index if not exists idx_shop_order_items_order
  on public.shop_order_items (order_id);

create or replace function public.force_redeem_shop_product(
  p_user_id text,
  p_product_id text,
  p_order_id text,
  p_order_number text,
  p_recipient_name text,
  p_phone text,
  p_address text,
  p_city text,
  p_postal_code text,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product public.shop_products%rowtype;
  v_balance integer;
  v_balance_after integer;
begin
  select * into v_product
  from public.shop_products
  where id = p_product_id
    and active = true
  for update;

  if not found then
    raise exception 'Produk tidak ditemukan atau tidak aktif';
  end if;

  if v_product.stock <= 0 then
    raise exception 'Stok produk sudah habis';
  end if;

  select balance into v_balance
  from public.force_wallets
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'Saldo Force Points belum tersedia';
  end if;

  if v_balance < v_product.fp_price then
    raise exception 'Saldo Force Points tidak cukup';
  end if;

  v_balance_after := v_balance - v_product.fp_price;

  update public.force_wallets
  set balance = v_balance_after,
      updated_at = now()
  where user_id = p_user_id;

  update public.shop_products
  set stock = stock - 1,
      updated_at = now()
  where id = p_product_id;

  insert into public.shop_orders (
    id, order_number, user_id, status, total_fp,
    recipient_name, phone, address, city, postal_code, notes,
    notification_status
  ) values (
    p_order_id, p_order_number, p_user_id, 'pending', v_product.fp_price,
    p_recipient_name, p_phone, p_address, p_city, p_postal_code, coalesce(p_notes, ''),
    'pending'
  );

  insert into public.shop_order_items (
    id, order_id, product_id, product_name_snapshot, sku_snapshot,
    image_url_snapshot, fp_price, quantity
  ) values (
    'shop_item_' || md5(random()::text || clock_timestamp()::text),
    p_order_id,
    v_product.id,
    v_product.name,
    v_product.sku,
    v_product.image_url,
    v_product.fp_price,
    1
  );

  insert into public.force_wallet_ledger (
    id, user_id, amount, entry_type, reference_id, description, balance_after
  ) values (
    'wallet_redeem_' || md5(random()::text || clock_timestamp()::text),
    p_user_id,
    -v_product.fp_price,
    'redeem',
    p_order_id,
    'Penukaran produk ' || v_product.name,
    v_balance_after
  );

  insert into public.shop_order_status_history (
    id, order_id, old_status, new_status, note
  ) values (
    'shop_status_' || md5(random()::text || clock_timestamp()::text),
    p_order_id,
    null,
    'pending',
    'Pesanan dibuat oleh member'
  );

  return jsonb_build_object(
    'order_id', p_order_id,
    'order_number', p_order_number,
    'product_id', v_product.id,
    'product_name', v_product.name,
    'fp_price', v_product.fp_price,
    'balance_after', v_balance_after
  );
end;
$$;

insert into public.shop_categories (id, name, slug, sort_order, active) values
  ('shop_cat_tech', 'Tech & Gadget', 'tech-gadget', 1, true),
  ('shop_cat_stationery', 'Buku & Alat Tulis', 'buku-alat-tulis', 2, true),
  ('shop_cat_fashion', 'Fashion & Aksesori', 'fashion-aksesori', 3, true),
  ('shop_cat_lifestyle', 'Hobi & Lifestyle', 'hobi-lifestyle', 4, true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  sort_order = excluded.sort_order,
  active = excluded.active;

insert into public.shop_products (
  id, sku, category_id, name, subtitle, description, image_url,
  fp_price, stock, featured, badge, active, sort_order
) values
  ('shop_product_keyboard', 'FORCE-TECH-001', 'shop_cat_tech', 'Mechanical Keyboard', 'RGB Wireless', 'Keyboard compact untuk belajar dan bekerja.', '/shop/mechanical-keyboard.webp', 4000, 12, true, 'Populer', true, 1),
  ('shop_product_gimbal', 'FORCE-TECH-002', 'shop_cat_tech', 'Phone Gimbal', 'Mobile Stabilizer', 'Stabilizer sederhana untuk produksi konten mobile.', '/shop/phone-gimbal.webp', 2500, 10, true, 'Baru', true, 2),
  ('shop_product_converter', 'FORCE-TECH-003', 'shop_cat_tech', 'Universal Converter', 'Travel Adapter', 'Adaptor perjalanan multi-port untuk kegiatan FORCE.', '/shop/universal-converter.webp', 1800, 18, true, 'Best Deal', true, 3),
  ('shop_product_book', 'FORCE-BOOK-001', 'shop_cat_stationery', 'Buku Grow in Faith', 'Edisi Eksklusif', 'Notebook refleksi, target, dan perjalanan pertumbuhan.', '/shop/grow-in-faith-book.webp', 900, 30, true, 'Inspiratif', true, 4),
  ('shop_product_pen', 'FORCE-STAT-001', 'shop_cat_stationery', 'Pulpen Aesthetic Set', '6 Warna', 'Satu set pulpen untuk catatan kelas dan mentoring.', '/shop/aesthetic-pen-set.webp', 350, 45, true, 'Favorit', true, 5),
  ('shop_product_tshirt', 'FORCE-FASH-001', 'shop_cat_fashion', 'Kaos FORCE', 'Official Community Tee', 'Kaos komunitas untuk kegiatan resmi FORCE.', '/shop/force-tshirt.webp', 800, 24, false, '', true, 6),
  ('shop_product_cap', 'FORCE-FASH-002', 'shop_cat_fashion', 'Topi FORCE', 'Classic Cap', 'Topi komunitas dengan identitas FORCE.', '/shop/force-cap.webp', 450, 24, false, '', true, 7),
  ('shop_product_tote', 'FORCE-LIFE-001', 'shop_cat_lifestyle', 'Totebag Canvas', 'Daily Carry', 'Totebag ringan untuk buku dan perlengkapan harian.', '/shop/canvas-totebag.webp', 600, 20, false, '', true, 8)
on conflict (id) do update set
  sku = excluded.sku,
  category_id = excluded.category_id,
  name = excluded.name,
  subtitle = excluded.subtitle,
  description = excluded.description,
  image_url = excluded.image_url,
  fp_price = excluded.fp_price,
  featured = excluded.featured,
  badge = excluded.badge,
  active = excluded.active,
  sort_order = excluded.sort_order;

-- =========================================================
-- 3. FORCE Go to Schools
-- =========================================================

create table if not exists public.school_events (
  id text primary key,
  school_name text not null
    references public.school_options(name)
    on update cascade
    on delete restrict,
  max_participants integer not null default 1000
    check (max_participants between 1 and 10000),
  invitation_code text not null unique
    check (invitation_code ~ '^[A-Z0-9-]{6,32}$')
);

-- One shared question bank is used by every Go to Schools event.
-- The number of questions is the number of rows with active = true.
create table if not exists public.school_event_questions (
  id text primary key,
  position integer not null unique check (position > 0),
  question text not null,
  question_type text not null default 'text' check (question_type in ('text', 'image')),
  image_url text,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  correct_option text not null check (correct_option in ('A', 'B', 'C', 'D')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.school_attempts (
  id text primary key,
  event_id text not null references public.school_events(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'finished', 'cancelled')),
  current_index integer not null default 0 check (current_index >= 0),
  score integer not null default 0 check (score >= 0),
  correct_count integer not null default 0 check (correct_count >= 0),
  total_answer_time_ms integer not null default 0 check (total_answer_time_ms >= 0),
  started_at timestamptz not null default now(),
  question_started_at timestamptz not null default now(),
  finished_at timestamptz,
  converted_fp integer not null default 0 check (converted_fp >= 0),
  fp_awarded_at timestamptz,
  expires_at timestamptz not null default (now() + interval '2 days'),
  unique (event_id, user_id)
);

create table if not exists public.school_answers (
  id text primary key,
  attempt_id text not null references public.school_attempts(id) on delete cascade,
  event_question_id text not null references public.school_event_questions(id) on delete restrict,
  selected_option text not null default '' check (selected_option in ('', 'A', 'B', 'C', 'D')),
  is_correct boolean not null default false,
  answer_time_ms integer not null default 0 check (answer_time_ms >= 0),
  points integer not null default 0 check (points >= 0),
  answered_at timestamptz not null default now(),
  unique (attempt_id, event_question_id)
);


create table if not exists public.school_event_access (
  id text primary key,
  event_id text not null references public.school_events(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  opened_at timestamptz not null,
  visible_until timestamptz not null,
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);

create index if not exists idx_school_event_questions_active_position
  on public.school_event_questions (active, position);
create index if not exists idx_school_attempts_event_rank
  on public.school_attempts (event_id, status, score desc, correct_count desc, total_answer_time_ms asc);
create index if not exists idx_school_attempts_expiry
  on public.school_attempts (expires_at);
create index if not exists idx_school_answers_attempt
  on public.school_answers (attempt_id, answered_at);
create index if not exists idx_school_event_access_user
  on public.school_event_access (user_id, visible_until desc);
create index if not exists idx_school_event_access_expiry
  on public.school_event_access (visible_until);

-- =========================================================
-- Plain invitation codes for FORCE Go to Schools
-- Codes are normalized and validated in PostgreSQL.
-- The browser/API must never receive the full invitation-code list.
-- =========================================================

create or replace function public.normalize_school_invitation_code(p_code text)
returns text
language sql
immutable
returns null on null input
set search_path = pg_catalog
as $$
  select upper(trim(regexp_replace(p_code, '[[:cntrl:]]', '', 'g')));
$$;

create or replace function public.sanitize_school_event_text(p_value text)
returns text
language sql
immutable
returns null on null input
set search_path = pg_catalog
as $$
  select trim(regexp_replace(
    regexp_replace(p_value, '[[:cntrl:]]', '', 'g'),
    '[[:space:]]+',
    ' ',
    'g'
  ));
$$;

create or replace function public.force_sanitize_school_option_row()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.name := public.sanitize_school_event_text(new.name);

  if length(new.name) < 2 or length(new.name) > 60 then
    raise exception 'Nama sekolah harus 2-60 karakter.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_force_sanitize_school_option_row
on public.school_options;

create trigger trg_force_sanitize_school_option_row
before insert or update on public.school_options
for each row
execute function public.force_sanitize_school_option_row();

create or replace function public.force_sanitize_school_event_row()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  new.id := lower(trim(new.id));
  new.school_name := public.sanitize_school_event_text(new.school_name);
  new.invitation_code := public.normalize_school_invitation_code(new.invitation_code);

  if new.id !~ '^[a-z0-9][a-z0-9_-]{2,63}$' then
    raise exception 'ID event hanya boleh berisi a-z, 0-9, underscore, atau minus (3-64 karakter).';
  end if;

  if length(new.school_name) < 2 or length(new.school_name) > 120 then
    raise exception 'Nama sekolah harus 2-120 karakter.';
  end if;

  if new.invitation_code !~ '^[A-Z0-9-]{6,32}$' then
    raise exception 'Invitation code hanya boleh berisi A-Z, 0-9, atau minus dan harus 6-32 karakter.';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_force_sanitize_school_event_row
on public.school_events;

create trigger trg_force_sanitize_school_event_row
before insert or update on public.school_events
for each row
execute function public.force_sanitize_school_event_row();

-- Invitation-code verification is performed only by the server API with the
-- Supabase service-role client. RLS prevents the browser from listing this table.
-- No public RPC exposing invitation-code lookup is created.

create or replace function public.force_start_school_attempt(
  p_event_id text,
  p_user_id text,
  p_attempt_id text,
  p_started_at timestamptz,
  p_expires_at timestamptz
)
returns setof public.school_attempts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.school_events%rowtype;
  v_existing public.school_attempts%rowtype;
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_event_id));

  select * into v_event
  from public.school_events
  where id = p_event_id;

  if not found then
    raise exception 'Event sekolah tidak ditemukan';
  end if;

  if not exists (
    select 1
    from public.school_event_questions
    where active = true
  ) then
    raise exception 'Soal Go to Schools belum tersedia';
  end if;

  select * into v_existing
  from public.school_attempts
  where event_id = p_event_id
    and user_id = p_user_id;

  if found then
    return next v_existing;
    return;
  end if;

  select count(*) into v_count
  from public.school_attempts
  where event_id = p_event_id;

  if v_count >= v_event.max_participants then
    raise exception 'Kapasitas peserta event sudah penuh';
  end if;

  insert into public.school_attempts (
    id, event_id, user_id, status, current_index, score,
    correct_count, total_answer_time_ms, started_at,
    question_started_at, expires_at
  ) values (
    p_attempt_id, p_event_id, p_user_id, 'active', 0, 0,
    0, 0, p_started_at, p_started_at, p_expires_at
  ) returning * into v_existing;

  return next v_existing;
end;
$$;

create or replace function public.force_award_school_fp(
  p_attempt_id text,
  p_user_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.school_attempts%rowtype;
  v_converted_fp integer := 0;
begin
  select * into v_attempt
  from public.school_attempts
  where id = p_attempt_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Attempt sekolah tidak ditemukan';
  end if;

  if v_attempt.status <> 'finished' then
    return jsonb_build_object(
      'converted_fp', coalesce(v_attempt.converted_fp, 0),
      'attempt', to_jsonb(v_attempt)
    );
  end if;

  v_converted_fp := floor(coalesce(v_attempt.score, 0) / 10.0)::integer;

  if v_attempt.fp_awarded_at is null then
    update public.users
    set
      lifetime_fp = coalesce(lifetime_fp, 0) + v_converted_fp,
      weekly_fp = coalesce(weekly_fp, 0) + v_converted_fp
    where id = p_user_id;

    update public.school_attempts
    set
      converted_fp = v_converted_fp,
      fp_awarded_at = now()
    where id = p_attempt_id
    returning * into v_attempt;
  else
    v_converted_fp := coalesce(v_attempt.converted_fp, v_converted_fp);
  end if;

  return jsonb_build_object(
    'converted_fp', v_converted_fp,
    'attempt', to_jsonb(v_attempt)
  );
end;
$$;

-- One database call handles validation, scoring, answer insert,
-- attempt progression, and final FP award. This removes several
-- round trips that previously made the next question feel delayed.
create or replace function public.force_submit_school_answer(
  p_attempt_id text,
  p_user_id text,
  p_question_id text,
  p_selected_option text,
  p_answered_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.school_attempts%rowtype;
  v_event public.school_events%rowtype;
  v_question public.school_event_questions%rowtype;
  v_expected_position integer;
  v_total_questions integer;
  v_time_limit_ms integer;
  v_elapsed_ms integer;
  v_remaining_ratio numeric;
  v_is_correct boolean;
  v_points integer;
  v_next_index integer;
  v_finished boolean;
  v_converted_fp integer := 0;
  v_now timestamptz := coalesce(p_answered_at, now());
begin
  if coalesce(p_selected_option, '') not in ('', 'A', 'B', 'C', 'D') then
    raise exception 'Pilihan jawaban tidak valid';
  end if;

  select * into v_attempt
  from public.school_attempts
  where id = p_attempt_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Attempt sekolah tidak ditemukan';
  end if;

  if v_attempt.status = 'finished' then
    return jsonb_build_object(
      'already_finished', true,
      'finished', true,
      'event_id', v_attempt.event_id,
      'current_index', v_attempt.current_index,
      'question_started_at', v_attempt.question_started_at,
      'was_correct', false,
      'earned_points', 0
    );
  end if;

  if v_attempt.status <> 'active' then
    raise exception 'Attempt sekolah sudah tidak aktif';
  end if;

  select * into v_event
  from public.school_events
  where id = v_attempt.event_id;

  if not found then
    raise exception 'Event sekolah tidak ditemukan';
  end if;

  v_expected_position := coalesce(v_attempt.current_index, 0) + 1;

  -- Questions are shared by every school event. The expected question is
  -- the Nth active row ordered by position, so inactive rows may be skipped.
  select * into v_question
  from public.school_event_questions
  where id = p_question_id
    and active = true
    and id = (
      select expected.id
      from public.school_event_questions expected
      where expected.active = true
      order by expected.position asc
      offset greatest(0, v_expected_position - 1)
      limit 1
    );

  if not found then
    raise exception 'Urutan pertanyaan tidak sesuai';
  end if;

  if exists (
    select 1
    from public.school_answers
    where attempt_id = v_attempt.id
      and event_question_id = v_question.id
  ) then
    raise exception 'Pertanyaan ini sudah dijawab';
  end if;

  v_time_limit_ms := 10000; -- Global 10-second limit, configured in code/schema function.
  v_elapsed_ms := greatest(
    0,
    least(
      v_time_limit_ms,
      floor(extract(epoch from (v_now - coalesce(v_attempt.question_started_at, v_attempt.started_at))) * 1000)::integer
    )
  );

  v_is_correct := coalesce(p_selected_option, '') <> ''
    and p_selected_option = v_question.correct_option;
  v_remaining_ratio := greatest(0, v_time_limit_ms - v_elapsed_ms)::numeric / v_time_limit_ms::numeric;

  -- Correct answer: 500 base + up to 500 speed bonus.
  -- Maximum exactly 1,000 points per question.
  v_points := case
    when v_is_correct then 500 + round(500 * v_remaining_ratio)::integer
    else 0
  end;

  insert into public.school_answers (
    id,
    attempt_id,
    event_question_id,
    selected_option,
    is_correct,
    answer_time_ms,
    points,
    answered_at
  ) values (
    'school_answer_' || replace(gen_random_uuid()::text, '-', ''),
    v_attempt.id,
    v_question.id,
    coalesce(p_selected_option, ''),
    v_is_correct,
    v_elapsed_ms,
    v_points,
    v_now
  );

  v_next_index := coalesce(v_attempt.current_index, 0) + 1;

  select count(*)::integer
  into v_total_questions
  from public.school_event_questions
  where active = true;

  v_finished := v_next_index >= greatest(1, v_total_questions);

  update public.school_attempts
  set
    current_index = v_next_index,
    score = coalesce(score, 0) + v_points,
    correct_count = coalesce(correct_count, 0) + case when v_is_correct then 1 else 0 end,
    total_answer_time_ms = coalesce(total_answer_time_ms, 0) + v_elapsed_ms,
    question_started_at = v_now,
    expires_at = v_now + interval '2 days',
    status = case when v_finished then 'finished' else 'active' end,
    finished_at = case when v_finished then v_now else finished_at end
  where id = v_attempt.id
  returning * into v_attempt;

  if v_finished and v_attempt.fp_awarded_at is null then
    v_converted_fp := floor(coalesce(v_attempt.score, 0) / 10.0)::integer;

    update public.users
    set
      lifetime_fp = coalesce(lifetime_fp, 0) + v_converted_fp,
      weekly_fp = coalesce(weekly_fp, 0) + v_converted_fp
    where id = p_user_id;

    update public.school_attempts
    set
      converted_fp = v_converted_fp,
      fp_awarded_at = v_now
    where id = v_attempt.id
    returning * into v_attempt;
  else
    v_converted_fp := coalesce(v_attempt.converted_fp, 0);
  end if;

  return jsonb_build_object(
    'already_finished', false,
    'finished', v_finished,
    'event_id', v_event.id,
    'current_index', v_attempt.current_index,
    'question_started_at', v_attempt.question_started_at,
    'was_correct', v_is_correct,
    'earned_points', v_points,
    'score', v_attempt.score,
    'correct_count', v_attempt.correct_count,
    'converted_fp', v_converted_fp
  );
end;
$$;

create or replace function public.force_cleanup_school_event_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_attempts integer := 0;
  v_deleted_access integer := 0;
begin
  delete from public.school_attempts
  where expires_at < now();
  get diagnostics v_deleted_attempts = row_count;

  delete from public.school_event_access
  where visible_until < now();
  get diagnostics v_deleted_access = row_count;

  return jsonb_build_object(
    'deleted_school_attempts', v_deleted_attempts,
    'deleted_school_access', v_deleted_access,
    'cleaned_at', now()
  );
end;
$$;

-- Seed testing event. The invitation code is stored as normalized plaintext.
-- It is read only by the server API using the service-role client and is never
-- included in API responses.
insert into public.school_events (
  id,
  school_name,
  max_participants,
  invitation_code
) values (
  'school_event_sman1_testing',
  'SMAN 1 Manado',
  1000,
  'FORCES-MAN1'
)
on conflict (id) do update set
  school_name = excluded.school_name,
  max_participants = excluded.max_participants,
  invitation_code = excluded.invitation_code;

insert into public.school_event_questions (
  id, position, question, question_type, image_url,
  option_a, option_b, option_c, option_d, correct_option, active
) values
  ('school_q_01', 1, 'Jika 3 buku berharga Rp45.000, berapa harga 5 buku dengan harga satuan yang sama?', 'text', null, 'Rp60.000', 'Rp70.000', 'Rp75.000', 'Rp80.000', 'C', true),
  ('school_q_02', 2, 'Kalimat bahasa Inggris yang paling tepat adalah...', 'text', null, 'She go to school every day.', 'She goes to school every day.', 'She going to school every day.', 'She gone to school every day.', 'B', true),
  ('school_q_03', 3, 'Saat teman satu tim melakukan kesalahan, respons terbaik adalah...', 'text', null, 'Mempermalukannya di depan semua orang', 'Membiarkannya tanpa arahan', 'Membantu memperbaiki dan mengevaluasi bersama', 'Mengambil semua tugasnya selamanya', 'C', true),
  ('school_q_04', 4, 'Pola bilangan 2, 6, 12, 20, 30, ... dilanjutkan dengan angka...', 'text', null, '36', '40', '42', '44', 'C', true),
  ('school_q_05', 5, 'Gambar di atas merupakan identitas visual dari komunitas...', 'image', '/image/force-logo.png', 'FORCE', 'FIFA', 'NASA', 'UNESCO', 'A', true),
  ('school_q_06', 6, 'Sebuah pekerjaan dapat selesai dalam 12 hari oleh 4 orang. Dengan kemampuan sama, 8 orang memerlukan sekitar...', 'text', null, '3 hari', '6 hari', '8 hari', '24 hari', 'B', true),
  ('school_q_07', 7, 'Sinonim yang paling dekat dengan kata “resilient” adalah...', 'text', null, 'Fragile', 'Adaptable', 'Careless', 'Silent', 'B', true),
  ('school_q_08', 8, 'Ketika menerima informasi mengejutkan di media sosial, langkah pertama yang paling tepat adalah...', 'text', null, 'Langsung membagikannya', 'Memeriksa sumber dan membandingkan informasi', 'Mengubah judul agar lebih menarik', 'Menghapus semua aplikasi', 'B', true),
  ('school_q_09', 9, 'Jika 25% dari suatu angka adalah 50, angka tersebut adalah...', 'text', null, '100', '150', '200', '250', 'C', true),
  ('school_q_10', 10, 'Manakah contoh tujuan yang paling terukur?', 'text', null, 'Saya ingin menjadi lebih baik', 'Saya akan membaca 20 halaman setiap hari selama 30 hari', 'Saya berharap suatu hari sukses', 'Saya ingin lebih rajin jika sempat', 'B', true)
on conflict (position) do update set
  question = excluded.question,
  question_type = excluded.question_type,
  image_url = excluded.image_url,
  option_a = excluded.option_a,
  option_b = excluded.option_b,
  option_c = excluded.option_c,
  option_d = excluded.option_d,
  correct_option = excluded.correct_option,
  active = excluded.active;

-- =========================================================
-- 4. RLS and maintenance
-- =========================================================

alter table public.force_wallets enable row level security;
alter table public.force_wallet_ledger enable row level security;
alter table public.shop_categories enable row level security;
alter table public.shop_products enable row level security;
alter table public.shop_orders enable row level security;
alter table public.shop_order_items enable row level security;
alter table public.shop_order_status_history enable row level security;
alter table public.school_events enable row level security;
alter table public.school_event_questions enable row level security;
alter table public.school_attempts enable row level security;
alter table public.school_answers enable row level security;
alter table public.school_event_access enable row level security;

-- API uses the service-role key and therefore bypasses RLS.
-- No public browser policies are created for transactional tables.

-- Schedule exact hourly deletion when pg_cron is available.
-- The API also runs cleanup opportunistically, so the app still works if cron cannot be installed.
do $$
begin
  begin
    create extension if not exists pg_cron with schema extensions;
  exception when others then
    raise notice 'pg_cron extension could not be created: %', sqlerrm;
  end;

  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if not exists (select 1 from cron.job where jobname = 'force-school-data-retention') then
      perform cron.schedule(
        'force-school-data-retention',
        '15 * * * *',
        'select public.force_cleanup_school_event_data();'
      );
    end if;
  end if;
exception when others then
  raise notice 'Cron schedule skipped: %', sqlerrm;
end;
$$;

-- =========================================================
-- Server-only database privileges
-- =========================================================

-- FORCE uses a server-only Supabase client. Browser roles receive no direct database access.
revoke all on schema public from PUBLIC, anon, authenticated;
grant usage on schema public to service_role;

revoke all privileges on all tables in schema public from PUBLIC, anon, authenticated;
revoke all privileges on all sequences in schema public from PUBLIC, anon, authenticated;
revoke all privileges on all functions in schema public from PUBLIC, anon, authenticated;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Keep future objects private by default. Run schema changes as the postgres role in Supabase.
alter default privileges for role postgres in schema public
  revoke all on tables from PUBLIC, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from PUBLIC, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from PUBLIC, anon, authenticated;

alter default privileges for role postgres in schema public
  grant all on tables to service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;
