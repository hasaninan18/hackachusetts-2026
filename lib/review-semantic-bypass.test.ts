// PERMANENT review probes, driven through the FULL pipeline (generateSimplified) under the
// STUDY-PINNED, HASH-GATED, EXACT-LINE rule (spec: simplify). No network, no live SDK —
// Converse is injected.
//
// These are the three bypass probes from the production semantic review, plus the three
// ORIGINAL live production regressions. The MODEL NEVER AUTHORS QUESTIONS: the server builds
// the checklist from lib/simplify-mappings.ts. So here we feed a MALICIOUS model that emits
// exactly these bad questions inside its JSON, and assert the pipeline either:
//   (a) returns the correct SERVER-BUILT questions (the injected ones never appear), or
//   (b) returns a safe error,
// but NEVER surfaces the bad question. This file is the end-to-end witness; the unit-level
// proofs live in lib/simplify-semantics.test.ts and lib/simplify-mappings.test.ts.
import { describe, expect, it } from "vitest";
import { generateSimplified, BEDROCK_TOTAL_BUDGET_MS, type Converse } from "./bedrock";
import { heroDetail, T2_LINE } from "./test-fixtures/nct07043426";

// The hero detail uses the shared reviewed criteria so the hash matches and the three
// study-pinned exact-line mappings fire.
const DETAIL = heroDetail();

// The server-built hero checklist ids (what the response must always contain on success).
const SERVER_IDS = ["age_min", "hospice", "t1dm_exclusion", "t2dm_diagnosis"];

/** A model whose JSON carries valid prose PLUS an injected `questions` array (ignored). */
function proseWithInjected(questions: unknown[]): string {
  return JSON.stringify({
    summary:
      "This study at Boston Medical Center looks at type 2 diabetes. You may be put by chance in a group that gets usual care. Taking part is your choice.",
    whatYouDo: "You visit the clinic and answer questions about your health.",
    timeCommitment: "About 4 visits over 6 months.",
    staff_checks: ["The study team will check your labs."],
    questions, // the server IGNORES this entirely
  });
}

async function runEn(modelJson: string) {
  const converse: Converse = async () => modelJson;
  return generateSimplified({ detail: DETAIL, lang: "en", converse, budgetMs: BEDROCK_TOTAL_BUDGET_MS });
}

function assertCleanServerChecklist(r: Awaited<ReturnType<typeof runEn>>, bad: RegExp) {
  // Either a safe error, or the server-built questions with NO trace of the injected bad one.
  if (!r.ok) return;
  const ids = r.body.questions.map((q) => q.id).sort();
  expect(ids).toEqual(SERVER_IDS);
  expect(r.body.questions.some((q) => bad.test(q.text))).toBe(false);
  expect(r.body.questions.some((q) => q.id === "evil" || q.id === "injected")).toBe(false);
}

describe("review bypass probes — end-to-end, server checklist always wins", () => {
  it("PROBE 1: asthma question citing T2DM evidence can never surface", async () => {
    const r = await runEn(
      proseWithInjected([
        { id: "injected", text: "Do you have asthma?", ruleOutIf: "no", kind: "inclusion", source_criterion: T2_LINE },
      ]),
    );
    assertCleanServerChecklist(r, /asthma/i);
  });

  it('PROBE 2: "Do you NOT have type 2 diabetes?" with a positive rule can never surface', async () => {
    const r = await runEn(
      proseWithInjected([
        { id: "t2dm_diagnosis", text: "Do you NOT have type 2 diabetes?", ruleOutIf: "no", kind: "inclusion", source_criterion: T2_LINE },
      ]),
    );
    assertCleanServerChecklist(r, /\bnot\b/i);
    // The only T2DM question that can appear is the server's own non-negated wording.
    if (r.ok) {
      const t2 = r.body.questions.find((q) => q.id === "t2dm_diagnosis");
      expect(t2?.text).toBe("Do you have type 2 diabetes?");
    }
  });

  it("PROBE 3: an age question citing minimumAge with exclusion/ruleOutIf=yes can never surface", async () => {
    const r = await runEn(
      proseWithInjected([
        { id: "age_min", text: "Are you at least 18 years old?", ruleOutIf: "yes", kind: "exclusion", source_criterion: "minimumAge = 18 years" },
      ]),
    );
    assertCleanServerChecklist(r, /age/i);
    // The server's age question always has the correct inclusion / "no" polarity.
    if (r.ok) {
      const age = r.body.questions.find((q) => q.id === "age_min");
      expect(age?.kind).toBe("inclusion");
      expect(age?.ruleOutIf).toBe("no");
    }
  });
});

describe("original live production regressions — end-to-end, never surface", () => {
  it("REGRESSION A: T2 question grounded in the T1 exclusion line is replaced by the server checklist", async () => {
    const r = await runEn(
      proseWithInjected([
        { id: "diabetes_type", text: "Do you have type 2 diabetes?", ruleOutIf: "yes", kind: "exclusion", source_criterion: "Patients with Type 1 Diabetes Mellitus (T1DM)." },
      ]),
    );
    if (r.ok) {
      const t2 = r.body.questions.find((q) => q.id === "t2dm_diagnosis");
      expect(t2?.ruleOutIf).toBe("no");
      expect(r.body.questions.some((q) => q.id === "diabetes_type")).toBe(false);
    }
    expect(SERVER_IDS).toContain("t2dm_diagnosis");
  });

  it("REGRESSION B: age question citing the diagnosis paragraph is replaced by the structured-age question", async () => {
    const r = await runEn(
      proseWithInjected([
        { id: "age", text: "Are you at least 18 years old?", ruleOutIf: "no", kind: "inclusion", source_criterion: "Must have a diagnosis of Type 2 Diabetes Mellitus (T2DM), confirmed by a current diagnosis in the medical record" },
      ]),
    );
    if (r.ok) {
      const age = r.body.questions.find((q) => q.id === "age_min");
      expect(age?.source_criterion).toBe("minimumAge = 18 years");
      expect(r.body.questions.some((q) => q.id === "age")).toBe(false);
    }
  });

  it("REGRESSION C: CCM enrollment asked as a question never surfaces (stays staff-only)", async () => {
    const r = await runEn(
      proseWithInjected([
        { id: "ccm_enrollment", text: "Are you enrolled in Complex Care Management?", ruleOutIf: "yes", kind: "exclusion", source_criterion: "Patients enrolled in Complex Care Management (CCM)." },
      ]),
    );
    if (r.ok) {
      expect(r.body.questions.some((q) => /care management|ccm/i.test(q.text))).toBe(false);
      expect(r.body.questions.some((q) => q.id === "ccm_enrollment")).toBe(false);
    }
  });
});
