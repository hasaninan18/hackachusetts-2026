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
- Region **us-east-2 (Ohio)** — confirmed.
- **Converse API** via `@aws-sdk/client-bedrock-runtime` (`ConverseCommand`).
- Model: **Amazon Nova 2 Lite** — `us.amazon.nova-2-lite-v1:0` (env `BEDROCK_MODEL_ID`).
- Fallback: **Amazon Nova Pro** — `us.amazon.nova-pro-v1:0` (env `BEDROCK_FALLBACK_MODEL_ID`).
- **Claude is NOT available** — the AWS Free plan blocks the Marketplace subscription it requires. Do not add Claude model IDs.
- Auth: the SDK picks up the Bedrock bearer token from env **`AWS_BEARER_TOKEN_BEDROCK`** automatically; region from **`AWS_REGION`** (= us-east-2). **Never commit these.**
- Last-resort fallback if Bedrock is unreachable: structured quick-check only + pre-generated summaries for demo trials.

## Secrets & env
- Never commit keys. Use Vercel env vars (already set in the `trialpath-ma` project). Document required vars in README.
- Required (all set in Vercel): `AWS_BEARER_TOKEN_BEDROCK`, `AWS_REGION` (= `us-east-2`), `BEDROCK_MODEL_ID` (= `us.amazon.nova-2-lite-v1:0`), `BEDROCK_FALLBACK_MODEL_ID` (= `us.amazon.nova-pro-v1:0`). Optional: `MBTA_API_KEY`.
- Need the Bedrock key locally? Ask Hasan directly — never put it in the repo or Discord. Never commit `.env.local`.

## Performance for the demo
- Cache `/api/simplify` results per `(NCT id, language)`.
- **Pre-warm** the cache for the 5–10 trials used in the demo video.
- Expect API rate limits during judging → rely on cache + pre-warm.
