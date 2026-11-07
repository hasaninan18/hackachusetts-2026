-- TrialPath national database (docs/NATIONAL_PLAN.md §2). Postgres 15+ with PostGIS.
-- Rows come from lib/ingest/ctgov.ts (TrialRow / SiteRow) via the nightly import.
-- Holds public ClinicalTrials.gov data only: no user data, ever (NATIONAL_PLAN.md §7).

create extension if not exists postgis;

create table if not exists trials (
  nct_id         text primary key check (nct_id ~ '^NCT[0-9]{8}$'),
  title          text not null,
  conditions     text[] not null default '{}',
  -- Keywords + MeSH terms + MeSH ancestors (lib/ingest/ctgov.ts TrialRow.terms).
  terms          text[] not null default '{}',
  phase          text,
  brief_summary  text not null default '',
  -- Raw ClinicalTrials.gov eligibility module (criteria text, ages, sex, healthy volunteers).
  eligibility    jsonb,
  sponsor        text,
  last_update    date,
  -- Contacts already filtered by buildContacts (central first, then in-region sites).
  contacts       jsonb not null default '[]',
  -- lib/ingest/quality.ts classifyEnglish: none | mentions | required | required-or-other.
  english        text not null default 'none'
                 check (english in ('none', 'mentions', 'required', 'required-or-other')),
  imported_at    timestamptz not null default now()
);

create table if not exists sites (
  nct_id              text not null references trials (nct_id) on delete cascade,
  ordinal             integer not null,
  facility            text not null,
  city                text not null,
  state               char(2) not null,
  zip                 text,
  location            geography(point, 4326) not null,
  -- facility = real building; zip = ZIP centroid; city = ClinicalTrials.gov city centroid.
  location_precision  text not null check (location_precision in ('facility', 'zip', 'city')),
  primary key (nct_id, ordinal)
);

create index if not exists sites_location_gix on sites using gist (location);
create index if not exists sites_state_idx on sites (state);

-- Full-text condition search over title + conditions + terms. array_to_string is only STABLE,
-- which a generated column rejects; joining text[]s is safe to declare IMMUTABLE.
create or replace function trial_search_text(title text, conditions text[], terms text[])
  returns text language sql immutable parallel safe
  as $$ select title || ' ' || array_to_string(conditions, ' ') || ' ' || array_to_string(terms, ' ') $$;

alter table trials add column if not exists search tsvector
  generated always as (
    to_tsvector('english'::regconfig, trial_search_text(title, conditions, terms))
  ) stored;
create index if not exists trials_search_gin on trials using gin (search);

-- One row per import run, for monitoring the nightly job.
create table if not exists import_runs (
  id            bigserial primary key,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  since         date,
  trials        integer,
  sites         integer,
  report        jsonb
);

-- Search: trials with a site within :radius_mi of (:lat, :lon), nearest site first.
--
--   select distinct on (t.nct_id)
--          t.nct_id, t.title, t.phase, s.facility, s.city, s.location_precision,
--          st_distance(s.location, st_makepoint(:lon, :lat)::geography) / 1609.344 as distance_mi
--     from sites s
--     join trials t using (nct_id)
--    where st_dwithin(s.location, st_makepoint(:lon, :lat)::geography, :radius_mi * 1609.344)
--      and (:cond = '' or t.search @@ websearch_to_tsquery('english', :cond))
--    order by t.nct_id, distance_mi;
--
-- (wrap it and order by distance_mi for the ranked list)
