# Tech (TrialPath MA)

## Stack
- **Next.js (App Router) + TypeScript + Tailwind CSS**.
- Deployed on **Vercel** (free tier → live link for judges).
- Keep it boring and reliable; prefer standard patterns over clever ones.

## Route handlers (server)
- `GET /api/trials?cond=&lat=&lon=&radius=` — proxies ClinicalTrials.gov, slims fields, keeps MA sites, sorts by distance.
- `GET /api/trials/[nct]` — full trial details + nearest MBTA stops.
- `POST /api/simplify` — LLM: plain-language summary + quick-check questions + translation. **Cached per `(NCT id, language)`** so the demo is fast and cheap.

## External data / APIs
- **ClinicalTrials.gov API v2** — `https://clinicaltrials.gov/api/v2/studies`. No key.
  - Params: `query.cond`, `filter.overallStatus=RECRUITING`, `filter.geo=distance(lat,lon,Nmi)`, `fields=...`, `pageSize`.
  - Fields of interest: `eligibilityModule` (criteria text, minimumAge, maximumAge, sex, healthyVolunteers), `contactsLocationsModule.locations[].geoPoint`, `centralContacts`.
- **MBTA V3 API** — `https://api-v3.mbta.com/stops`. No key for demo (add a free key if rate-limited).
  - Params: `filter[latitude]`, `filter[longitude]`, `filter[radius]` (degrees, ~0.01 ≈ 0.7 mi), `filter[route_type]=0,1,2,3`. `wheelchair_boarding` 1 = accessible.
- **ZIP → lat/lon** — browser geolocation, or a small static MA ZIP-centroid JSON (Census ZCTA gazetteer).

## LLM — Amazon Bedrock (DECIDED)
> ⚠️ **Verify in the actual AWS account before relying on these:** (1) that Free-plan accounts are locked to us-east-2, and (2) that the `us.` cross-region inference profile for Claude Haiku 4.5 is actually granted. If either is false, fall back to Nova Lite via the `BEDROCK_MODEL_ID` swap.
- Region **us-east-2 (Ohio)** — Free-plan accounts are reportedly locked to it (verify).
- **Converse API**. Model **Claude Haiku 4.5** via the `us.` cross-region inference profile if access is granted; else **Amazon Nova Lite**.
- Keep the model ID in env **`BEDROCK_MODEL_ID`** (one-line swap).
- Auth via Bedrock long-term API key in Vercel env **`AWS_BEARER_TOKEN_BEDROCK`** — **never commit it**.
- Backups: Anthropic Console $5 trial key → last resort: structured quick-check only + pre-generated summaries for demo trials.

## Secrets & env
- Never commit keys. Use Vercel env vars. Document required vars in README.
- Required: `BEDROCK_MODEL_ID`, `AWS_BEARER_TOKEN_BEDROCK` (+ optional `MBTA_API_KEY`).

## Performance for the demo
- Cache `/api/simplify` results per `(NCT id, language)`.
- **Pre-warm** the cache for the 5–10 trials used in the demo video.
- Expect API rate limits during judging → rely on cache + pre-warm.
