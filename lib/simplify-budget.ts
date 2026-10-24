// Budget / timeout constants for the simplify pipeline — SDK-FREE on purpose.
//
// WHY THIS MODULE EXISTS (client/server import boundary):
// lib/bedrock.ts is the ONLY module that imports @aws-sdk/client-bedrock-runtime, so it is
// a SERVER-ONLY module and must NEVER be pulled into a "use client" component bundle. The
// client (components/TrialPlain.tsx) needs to coordinate its abort/timeout with the
// server's total budget, but it must NOT import lib/bedrock.ts to get that number (doing so
// would drag the AWS SDK into the client bundle). These are plain numeric constants with no
// imports, so a client component can import CLIENT_TIMEOUT_FLOOR_MS from HERE safely.
//
// lib/bedrock.ts re-exports every constant below, so the server keeps a single source of
// truth and existing server imports are unaffected.

/** Each single Bedrock Converse call is bounded by this ceiling. */
export const PER_CALL_TIMEOUT_MS = 8000;

/** Bounded wall-clock budget for ClinicalTrials.gov study load (enforced in the route). */
export const STUDY_LOAD_BUDGET_MS = 1500;

/**
 * Total budget for ALL Bedrock work (English generation primary+retry+fallback, then, for
 * non-English, the translate primary+retry+fallback). The orchestrator caps the SUM of
 * Bedrock work at this value via a single shared deadline, so a call never starts when less
 * than MIN_CALL_MS remains.
 */
export const BEDROCK_TOTAL_BUDGET_MS = 26000;

/** A call is not started if less than this remains on the deadline (avoids 0ms calls). */
export const MIN_CALL_MS = 250;

/**
 * The whole-operation server budget: study load + all Bedrock work. The server always
 * responds within this bound with a validated body or a safe error — it never hangs.
 */
export const SERVER_TOTAL_BUDGET_MS = STUDY_LOAD_BUDGET_MS + BEDROCK_TOTAL_BUDGET_MS; // 27500

/**
 * The MINIMUM the CLIENT abort/timeout must be set to so the client never gives up before
 * the server's safe error. Equals the server total budget plus a small network/parse
 * margin. This is the SDK-free constant the client component may import.
 */
export const CLIENT_TIMEOUT_FLOOR_MS = SERVER_TOTAL_BUDGET_MS + 2500; // 30000 ms
