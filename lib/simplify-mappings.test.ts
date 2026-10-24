// Tests for the DEFAULT-DENY, STUDY-PINNED, EXACT-LINE mapping registry
// (lib/simplify-mappings.ts). Pure, no Bedrock. These prove the SERVER builds the checklist
// deterministically and fails closed on anything it does not explicitly support: a
// free-text question fires ONLY for the pinned study, ONLY when the criteria-revision hash
// matches, and ONLY when EXACTLY ONE line in the declared section EQUALS the reviewed exact
// line (===, not substring). Any altered/negated/extra/merged line is rejected with no
// negation or keyword regex at all.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Lang } from "./types";
import {
  buildChecklist,
  splitSections,
  hasQuestionWording,
  matchExactLine,
  normalizeLine,
  canonicalCriteriaInput,
  criteriaRevisionHash,
  REVIEWED_CRITERIA_HASH,
  freeTextAllowedForStudy,
  CRITERIA_REVISION_WARNING,
} from "./simplify-mappings";
import {
  HERO_CRITERIA,
  T1_LINE,
  T2_LINE,
  HOSPICE_LINE,
  heroDetail,
  heroCriteriaWithHospice,
} from "./test-fixtures/nct07043426";

const detail = heroDetail;

afterEach(() => vi.restoreAllMocks());

describe("normalizeLine — the single line normalizer", () => {
  it("strips a leading bullet marker, collapses whitespace, trims, case-folds", () => {
    expect(normalizeLine("  *   Patients   receiving  hospice care. ")).toBe(
      "patients receiving hospice care.",
    );
    expect(normalizeLine("- Foo")).toBe("foo");
    expect(normalizeLine("• Bar")).toBe("bar");
  });
  it("does NOT strip meaningful punctuation (a trailing period stays)", () => {
    expect(normalizeLine("Patients receiving hospice care.")).not.toBe(
      normalizeLine("Patients receiving hospice care"),
    );
  });
});

describe("matchExactLine — exactly-one equal line or null", () => {
  const exclusionRaw = [
    "Exclusion Criteria:",
    "* Patients enrolled in Complex Care Management (CCM).",
    "* Patients receiving hospice care.",
    "* Patients with Type 1 Diabetes Mellitus (T1DM).",
  ].join("\n");
  it("returns the ORIGINAL line (casing/punctuation preserved) on a unique exact match", () => {
    expect(matchExactLine(exclusionRaw, HOSPICE_LINE)).toBe("Patients receiving hospice care.");
  });
  it("rejects an altered (negated) line that only CONTAINS the words", () => {
    const altered = exclusionRaw.replace(
      "Patients receiving hospice care.",
      "Patients not currently receiving hospice care.",
    );
    expect(matchExactLine(altered, HOSPICE_LINE)).toBeNull();
  });
  it("rejects an extra-word line", () => {
    const altered = exclusionRaw.replace(
      "Patients receiving hospice care.",
      "Patients receiving hospice care or palliative care.",
    );
    expect(matchExactLine(altered, HOSPICE_LINE)).toBeNull();
  });
  it("rejects when the line is absent", () => {
    expect(matchExactLine(exclusionRaw, "Patients in a coma.")).toBeNull();
  });
  it("rejects when the line appears more than once (ambiguous)", () => {
    const dup = exclusionRaw + "\n* Patients receiving hospice care.";
    expect(matchExactLine(dup, HOSPICE_LINE)).toBeNull();
  });
  it("returns null for a null section", () => {
    expect(matchExactLine(null, HOSPICE_LINE)).toBeNull();
  });
});

describe("criteria-revision hash", () => {
  it("canonical input lists section names + normalized lines in order", () => {
    const canon = canonicalCriteriaInput(HERO_CRITERIA);
    expect(canon.startsWith("inclusion criteria:\n")).toBe(true);
    expect(canon).toContain("\nexclusion criteria:\n");
    expect(canon).toContain(normalizeLine(T2_LINE));
    expect(canon).toContain(normalizeLine(HOSPICE_LINE));
    expect(canon).toContain(normalizeLine(T1_LINE));
  });
  it("the hero criteria hash equals the stored reviewed hash", () => {
    expect(criteriaRevisionHash(HERO_CRITERIA)).toBe(REVIEWED_CRITERIA_HASH.NCT07043426);
  });
  it("is stable under pure whitespace/bullet/case reformatting", () => {
    const reformatted = HERO_CRITERIA.replace(/\* /g, "- ").replace(/\n\n/g, "\n");
    expect(criteriaRevisionHash(reformatted)).toBe(criteriaRevisionHash(HERO_CRITERIA));
  });
  it("changes when ANY line is edited or added", () => {
    const edited = heroCriteriaWithHospice("Patients receiving hospice care or palliative care.");
    expect(criteriaRevisionHash(edited)).not.toBe(REVIEWED_CRITERIA_HASH.NCT07043426);
    const added = HERO_CRITERIA + "\n* Patients with an allergy to study drug.";
    expect(criteriaRevisionHash(added)).not.toBe(REVIEWED_CRITERIA_HASH.NCT07043426);
  });
});

describe("splitSections — explicit headings only, fail closed", () => {
  it("splits inclusion/exclusion when both headings are present and ordered", () => {
    const s = splitSections(HERO_CRITERIA);
    expect(s.inclusion).not.toBeNull();
    expect(s.exclusion).not.toBeNull();
    expect(s.inclusion).toContain("type 2 diabetes");
    expect(s.exclusion).toContain("type 1 diabetes");
  });
  it("returns null sections when there are NO headings (never defaults to inclusion)", () => {
    const s = splitSections("Must have type 2 diabetes. Patients in hospice.");
    expect(s.inclusion).toBeNull();
    expect(s.exclusion).toBeNull();
  });
  it("returns null sections when headings are duplicated (ambiguous)", () => {
    const s = splitSections("Inclusion Criteria:\nX\nInclusion Criteria:\nY\nExclusion Criteria:\nZ");
    expect(s.inclusion).toBeNull();
    expect(s.exclusion).toBeNull();
  });
  it("returns null sections when exclusion appears before inclusion (ambiguous order)", () => {
    const s = splitSections("Exclusion Criteria:\nZ\nInclusion Criteria:\nX");
    expect(s.inclusion).toBeNull();
    expect(s.exclusion).toBeNull();
  });
});

describe("hasQuestionWording", () => {
  it("is true only for en/es", () => {
    expect(hasQuestionWording("en")).toBe(true);
    expect(hasQuestionWording("es")).toBe(true);
    for (const l of ["pt", "ht", "zh", "vi"] as Lang[]) expect(hasQuestionWording(l)).toBe(false);
  });
});

describe("buildChecklist — hero trial (pinned study, matching hash, exact lines)", () => {
  it("builds age_min + T2DM + T1DM + hospice in English with ORIGINAL source lines", () => {
    const r = buildChecklist(detail(), "en");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const byId = new Map(r.questions.map((q) => [q.id, q]));
    expect([...byId.keys()].sort()).toEqual(["age_min", "hospice", "t1dm_exclusion", "t2dm_diagnosis"]);
    // T2DM inclusion, rule-out on "no"; source is the ORIGINAL registry line verbatim.
    const t2 = byId.get("t2dm_diagnosis")!;
    expect(t2.kind).toBe("inclusion");
    expect(t2.ruleOutIf).toBe("no");
    expect(t2.source_criterion).toBe(T2_LINE);
    // T1DM exclusion, rule-out on "yes".
    const t1 = byId.get("t1dm_exclusion")!;
    expect(t1.kind).toBe("exclusion");
    expect(t1.ruleOutIf).toBe("yes");
    expect(t1.source_criterion).toBe(T1_LINE);
    // Hospice exclusion.
    const hos = byId.get("hospice")!;
    expect(hos.source_criterion).toBe(HOSPICE_LINE);
    // Age min from the structured bound, inclusion / "no".
    const age = byId.get("age_min")!;
    expect(age.kind).toBe("inclusion");
    expect(age.ruleOutIf).toBe("no");
    expect(age.source_criterion).toBe("minimumAge = 18 years");
  });

  it("localizes question wording to Spanish while keeping rule-out logic + source lines", () => {
    const r = buildChecklist(detail(), "es");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const byId = new Map(r.questions.map((q) => [q.id, q]));
    expect(byId.get("t2dm_diagnosis")!.text).toBe("¿Tiene diabetes tipo 2?");
    expect(byId.get("t2dm_diagnosis")!.ruleOutIf).toBe("no");
    expect(byId.get("age_min")!.text).toBe("¿Tiene al menos 18 años?");
    // source_criterion (evidence) is identical to English — it is the registry quote.
    const en = buildChecklist(detail(), "en");
    if (!en.ok) return;
    const enT2 = en.questions.find((q) => q.id === "t2dm_diagnosis")!;
    expect(byId.get("t2dm_diagnosis")!.source_criterion).toBe(enT2.source_criterion);
  });
});

describe("buildChecklist — fails closed", () => {
  it("rejects unsupported languages", () => {
    for (const l of ["pt", "ht", "zh", "vi"] as Lang[]) {
      expect(buildChecklist(detail(), l).ok).toBe(false);
    }
  });

  it("emits NO age question when the min bound is missing (still has 3 free-text)", () => {
    const r = buildChecklist(detail({ minAgeYears: null, maxAgeYears: null }), "en");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.questions.some((q) => q.id.startsWith("age"))).toBe(false);
    // Still has the three pinned exact-line mappings.
    expect(r.questions.map((q) => q.id).sort()).toEqual(["hospice", "t1dm_exclusion", "t2dm_diagnosis"]);
  });

  it("emits NO age question when bounds conflict (min > max)", () => {
    const r = buildChecklist(detail({ minAgeYears: 70, maxAgeYears: 30 }), "en");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.questions.some((q) => q.id.startsWith("age"))).toBe(false);
  });

  it("emits NO age question for a non-finite / absurd bound", () => {
    const r1 = buildChecklist(detail({ minAgeYears: Number.NaN as unknown as number }), "en");
    if (r1.ok) expect(r1.questions.some((q) => q.id === "age_min")).toBe(false);
    const r2 = buildChecklist(detail({ minAgeYears: 999 }), "en");
    if (r2.ok) expect(r2.questions.some((q) => q.id === "age_min")).toBe(false);
  });

  it("builds a max-age question with the correct wording/polarity (hash still matches)", () => {
    const r = buildChecklist(detail({ minAgeYears: null, maxAgeYears: 65 }), "en");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const age = r.questions.find((q) => q.id === "age_max");
    expect(age).toBeDefined();
    expect(age!.text).toBe("Are you 65 years old or younger?");
    expect(age!.kind).toBe("inclusion");
    expect(age!.ruleOutIf).toBe("no");
    expect(age!.source_criterion).toBe("maximumAge = 65 years");
  });

  it("does NOT fire free-text when there is no inclusion heading (and criteria differ → hash)", () => {
    const noHeadings = "Must have a diagnosis of Type 2 Diabetes Mellitus (T2DM). Patients with Type 1 Diabetes Mellitus (T1DM).";
    const r = buildChecklist(detail({ minAgeYears: null, criteriaText: noHeadings }), "en");
    // No headings -> no sections -> no free-text; also the hash differs. Age null -> error.
    expect(r.ok).toBe(false);
  });

  it("a DIFFERENT nctId with the byte-identical hero criteria gets NO free-text (study pin)", () => {
    // Same criteria, different study: the mappings are pinned to NCT07043426, so none fire.
    const d = { ...detail(), nctId: "NCT99999999" };
    const r = buildChecklist(d, "en");
    // Only age_min would be built (1 question) -> below the floor -> safe error.
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/minimum is 2|supported question/i);
  });

  it("a REVISED hero (any line edited) gets NO free-text + ONE structured warning", () => {
    const warn = vi.fn();
    const revised = heroCriteriaWithHospice("Patients receiving hospice care or palliative care.");
    const r = buildChecklist(detail({ criteriaText: revised }), "en", warn);
    // The three reviewed lines include an edited hospice line → hash mismatch → no free-text.
    // age_min (1) is below the floor → safe error.
    expect(r.ok).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(CRITERIA_REVISION_WARNING);
    expect(warn.mock.calls[0][0]).toContain("NCT07043426");
    // The warning carries hash PREFIXES only, never criteria text.
    expect(warn.mock.calls[0][0]).not.toContain("hospice");
  });

  it("freeTextAllowedForStudy: true for reviewed hero, false (no warn) for unknown study", () => {
    expect(freeTextAllowedForStudy(detail())).toBe(true);
    const warn = vi.fn();
    expect(freeTextAllowedForStudy({ ...detail(), nctId: "NCT99999999" }, warn)).toBe(false);
    expect(warn).not.toHaveBeenCalled(); // unknown study is silent (no revision warning)
  });

  it("an edited inclusion line (T2 altered) drops ALL free-text (hash fails)", () => {
    // Replace the T2 line with an abbreviated one. The exact-line rule would reject it on its
    // own; the hash also changes, so NO free-text is built. Age_min only -> error.
    const altered = HERO_CRITERIA.replace(
      "* " + T2_LINE,
      "* Must have a diagnosis of Type 2 Diabetes Mellitus (T2DM).",
    );
    const r = buildChecklist(detail({ criteriaText: altered }), "en", vi.fn());
    expect(r.ok).toBe(false);
  });

  it("never turns a staff-only / compound / lab criterion into a question", () => {
    const r = buildChecklist(detail(), "en");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const texts = r.questions.map((q) => q.text.toLowerCase()).join(" | ");
    expect(texts).not.toContain("hba1c");
    expect(texts).not.toContain("care management");
    expect(texts).not.toContain("social need");
    expect(texts).not.toContain("deceased");
    expect(r.questions.some((q) => q.id === "ccm")).toBe(false);
  });

  it("returns a safe error when FEWER than MIN_SUPPORTED_QUESTIONS can be built", () => {
    // Different (thin) criteria + no usable age bound -> hash mismatch -> 0 free-text, 0 age.
    const thin = [
      "Inclusion Criteria:",
      "* Must be able to attend visits.",
      "Exclusion Criteria:",
      "* Patients receiving hospice care.",
    ].join("\n");
    const r = buildChecklist(detail({ minAgeYears: null, maxAgeYears: null, criteriaText: thin }), "en", vi.fn());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/minimum is 2|supported question/i);
  });
});
