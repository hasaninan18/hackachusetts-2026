# Find a doctor — reduced optional design

Status: **planning only**, adapted from Neil's proposal; no implementation or Kiro execution is claimed. Read [DOCTORS_REDUCED_PLAN.md](../../../docs/DOCTORS_REDUCED_PLAN.md) first.

- `GET /api/doctors?cond=&lat=&lon=&radius=`: new independent I/O route using the agreed `ProviderSummary`/`DoctorsResponse` contract from the plan. Existing trial APIs/types keep their behavior.
- New `lib/npi.ts`: documented bounded NPI queries plus pure practice filtering, specialty mapping, ZIP-centroid distance and ranking. Follow existing `lib/geo.ts`, `lib/ma-zips.json`, `lib/cache.ts`, and route validation/error conventions. No provider transit enrichment.
- New provider UI components and data adapter: use existing results/contact/language patterns; studies default. Neil owns the one agreed shared-contract commit. EN/ES feature copy has safe other-language navigation; no missing keys or client import of server SDKs.
- Query shape, request/page/result caps and unsupported-language behavior are agreed in Phase 0 before implementation. Source limitations stay visible; bounded NPI retrieval is not exhaustive geographic search.
- Isolated backend/UI worktrees and scoped ownership; Akash adds cross-cutting tests/evidence. No shared-file concurrent edits. All app changes go through Kiro.
- Release gate: integrated real-data flow and regression checks complete by 4:15 PM; otherwise leave feature unmerged/disabled. Feature freeze 5 PM. Full source/feature roadmap lives only in the post-competition reference.

Documentation: [CMS API help](https://npiregistry.cms.hhs.gov/api-page), [NPI endpoint](https://npiregistry.cms.hhs.gov/api/). Read installed Next.js docs before route/page code. Use documented params only and recheck responses.
