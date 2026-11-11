import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { detectEnglishRequirement, type EnglishRequirement } from "./english-requirement";

// ---------------------------------------------------------------------------------------
// Pinned fixtures (R9). The file is a byte-for-byte copy of the hand-off kit fixture.
// ---------------------------------------------------------------------------------------
const FIXTURE_PATH = fileURLToPath(new URL("./test-fixtures/english-requirement.json", import.meta.url));
const FIXTURE_SHA256 = "67f55f6ec93b57f8e4d21f7fdba8e682c35b39dd56a20dfb3c166d29e57dfc21";
const FIXTURE_BYTES = readFileSync(FIXTURE_PATH);

type Expect = "flag" | "no-flag" | "either";
interface LineFixture {
  id: string;
  section: "inclusion" | "exclusion";
  line: string;
  expect: Expect;
}
interface TextFixture {
  id: string;
  criteriaText: string;
  expect: Expect;
  expectReason: string | null;
}
interface FixtureFile {
  lines: LineFixture[];
  studies: TextFixture[];
  synthetic: TextFixture[];
}
const FIXTURES = JSON.parse(FIXTURE_BYTES.toString("utf8")) as FixtureFile;

/** R9.5: wrap a line fixture under its section heading. */
function wrapLine(f: LineFixture): string {
  const heading = f.section === "inclusion" ? "Inclusion" : "Exclusion";
  return `${heading} Criteria:\n\n* ${f.line}`;
}

interface Case {
  group: "lines" | "studies" | "synthetic";
  id: string;
  text: string;
  expect: Expect;
  expectReason: string | null;
}
const CASES: Case[] = [
  ...FIXTURES.lines.map((f) => ({ group: "lines" as const, id: f.id, text: wrapLine(f), expect: f.expect, expectReason: null })),
  ...FIXTURES.studies.map((f) => ({ group: "studies" as const, id: f.id, text: f.criteriaText, expect: f.expect, expectReason: f.expectReason })),
  ...FIXTURES.synthetic.map((f) => ({ group: "synthetic" as const, id: f.id, text: f.criteriaText, expect: f.expect, expectReason: f.expectReason })),
];
const byExpect = (e: Expect) => CASES.filter((c) => c.expect === e);

const MENTIONED_REASONS = ["no-sections", "other-language-allowed", "not-about-patient", "unclear"];
function isValidResult(r: EnglishRequirement): boolean {
  if (r.status === "required") {
    return Array.isArray(r.evidence) && r.evidence.length > 0 && r.evidence.every((e) => typeof e === "string");
  }
  if (r.status === "none") return r.reason === "no-mention";
  if (r.status === "mentioned") return MENTIONED_REASONS.includes(r.reason);
  return false;
}
const label = (r: EnglishRequirement) => (r.status === "required" ? "required" : `${r.status}/${r.reason}`);
const inc = (...lines: string[]) => `Inclusion Criteria:\n\n${lines.map((l) => `* ${l}`).join("\n")}`;
const exc = (...lines: string[]) => `Exclusion Criteria:\n\n${lines.map((l) => `* ${l}`).join("\n")}`;
const both = (incLines: string[], excLines: string[]) => `${inc(...incLines)}\n\n${exc(...excLines)}`;

describe("fixture integrity (R9.1)", () => {
  it("is the pinned fixture, byte for byte", () => {
    const raw = createHash("sha256").update(FIXTURE_BYTES).digest("hex");
    if (raw !== FIXTURE_SHA256 && FIXTURE_BYTES.includes(0x0d)) {
      // The committed blob is LF-only. A Windows checkout with core.autocrlf=true rewrites it
      // to CRLF in the working tree; accept that one transformation and nothing else.
      const lf = Buffer.from(FIXTURE_BYTES.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
      expect(createHash("sha256").update(lf).digest("hex")).toBe(FIXTURE_SHA256);
      return;
    }
    expect(raw).toBe(FIXTURE_SHA256);
  });

  it("has the 57 labelled cases the contract was written against", () => {
    expect(CASES).toHaveLength(57);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(57);
    expect(byExpect("flag")).toHaveLength(16);
    expect(byExpect("no-flag")).toHaveLength(38);
    expect(byExpect("either")).toHaveLength(3);
  });
});

describe("fixtures: no-flag cases never return required (R9.2, hard safety assertion)", () => {
  it.each(byExpect("no-flag").map((c) => [c.id, c] as const))("%s", (_id, c) => {
    expect(detectEnglishRequirement(c.text).status).not.toBe("required");
  });

  it.each(byExpect("no-flag").filter((c) => c.expectReason !== null).map((c) => [c.id, c] as const))(
    "%s reports its expected reason",
    (_id, c) => {
      const r = detectEnglishRequirement(c.text);
      expect(r.status === "required" ? "required" : r.reason).toBe(c.expectReason);
    },
  );
});

describe("fixtures: flag cases return required (R9.3)", () => {
  it.each(byExpect("flag").map((c) => [c.id, c] as const))("%s", (_id, c) => {
    expect(detectEnglishRequirement(c.text).status).toBe("required");
  });
});

describe("fixtures: coverage table (R9.4; 'either' cases are reported, not asserted)", () => {
  it("prints status counts per expectation", () => {
    const rows: Record<string, Record<string, number>> = {};
    for (const c of CASES) {
      const key = `${c.expect} (${c.group})`;
      const r = label(detectEnglishRequirement(c.text));
      rows[key] ??= {};
      rows[key][r] = (rows[key][r] ?? 0) + 1;
    }
    const either = byExpect("either").map((c) => `  ${c.id}: ${label(detectEnglishRequirement(c.text))}`);
    console.log(
      "English-requirement fixture coverage\n" +
        Object.entries(rows)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `  ${k.padEnd(22)} ${Object.entries(v).map(([s, n]) => `${s}=${n}`).join("  ")}`)
          .join("\n") +
        "\n'either' cases:\n" +
        either.join("\n"),
    );
    expect(Object.keys(rows).length).toBeGreaterThan(0);
  });
});

describe("behavior: no mention (R1.3)", () => {
  it.each([
    ["empty", ""],
    ["whitespace only", " \n\t \r\n "],
    ["New England", inc("Lives in New England")],
    ["Englishman", inc("Englishman or Englishwoman by birth")],
    ["no English at all", both(["Age 18 or older"], ["Pregnant"])],
  ])("%s → none/no-mention", (_name, text) => {
    expect(detectEnglishRequirement(text)).toEqual({ status: "none", reason: "no-mention" });
  });
});

describe("behavior: section polarity (R2)", () => {
  it("inclusion ability without negation is a requirement", () => {
    expect(detectEnglishRequirement(inc("English speaking"))).toEqual({ status: "required", evidence: ["English speaking"] });
  });
  it("exclusion inability is a requirement", () => {
    expect(detectEnglishRequirement(exc("Unable to speak English"))).toEqual({
      status: "required",
      evidence: ["Unable to speak English"],
    });
  });
  it("the same ability line under Exclusion is unclear, never required", () => {
    expect(detectEnglishRequirement(exc("English speaking"))).toEqual({ status: "mentioned", reason: "unclear" });
  });
  it("the same inability line under Inclusion is unclear, never required", () => {
    expect(detectEnglishRequirement(inc("Unable to speak English"))).toEqual({ status: "mentioned", reason: "unclear" });
  });
  it("an unclear line anywhere blocks requirement lines elsewhere (R2.7)", () => {
    const text = both(["Must be able to read and speak English"], ["Patients who speak English"]);
    expect(detectEnglishRequirement(text)).toEqual({ status: "mentioned", reason: "unclear" });
  });
  it("'Language other than English' alone in exclusion is a requirement", () => {
    expect(detectEnglishRequirement(exc("Language other than English")).status).toBe("required");
  });
  it("'other than English or Spanish' is a veto, not a requirement", () => {
    expect(detectEnglishRequirement(exc("Primary language other than English or Spanish"))).toEqual({
      status: "mentioned",
      reason: "other-language-allowed",
    });
  });

  // Initially failing behavior test (fixture real-line-30). The first implementation followed
  // contract R2.4 literally: any inclusion English line without a negation (or exclusion line
  // with one) was a requirement, so these lines returned `required`. None of them states that
  // the patient must speak, read, write or understand English, so each is unclear.
  it.each([
    ["exposure (real-line-30)", inc("Lives in an environment where child is exposed to English at least 50% of the time")],
    ["household language", inc("Resides in an English-majority household")],
    ["materials, inclusion", inc("Study materials are written in English")],
    ["materials, exclusion", exc("No prior exposure to English")],
  ])("an English line that states no patient language ability is not a requirement: %s", (_name, text) => {
    expect(detectEnglishRequirement(text)).toEqual({ status: "mentioned", reason: "unclear" });
  });
});

describe("behavior: veto precedence (R3)", () => {
  it("a veto in exclusion cancels a requirement in inclusion", () => {
    const text = both(["Must be able to read and speak English"], ["None. Non-English speakers may join with an interpreter."]);
    expect(detectEnglishRequirement(text)).toEqual({ status: "mentioned", reason: "other-language-allowed" });
  });
  it("a veto before a requirement still wins", () => {
    const text = inc("English or Spanish versions of all surveys are available", "English speaking");
    expect(detectEnglishRequirement(text)).toEqual({ status: "mentioned", reason: "other-language-allowed" });
  });
  it("a veto after an earlier unclear line wins over unclear", () => {
    const text = both(["Unable to speak English"], ["Patients who speak English", "Interpreters are available for all visits in English"]);
    expect(detectEnglishRequirement(text)).toEqual({ status: "mentioned", reason: "other-language-allowed" });
  });
  it.each([
    "English- or Spanish-speaking",
    "Spanish or English",
    "Fluent in English, Mandarin or Cantonese",
    "Speaks English or Haitian Creole",
    "Able to complete surveys in English or another of the study languages",
    "Able to speak English or use an interpreter",
    "Non-English speakers will be offered translated consent forms",
    "Non-English speakers are welcome",
    "Non-English speakers are eligible",
    "Non-English speakers may participate",
    "Speaking English is not required",
    "Non-English speaking patients will not be excluded",
    // hedged or conditional wording: English is preferred or has an exception, not required
    "Ability to read English is preferred",
    "Preferably able to speak English",
    "Able to speak English if possible",
    "Unable to read English, unless a reader is available",
    "Patients who cannot speak English will be accommodated",
  ])("veto: %s", (line) => {
    expect(detectEnglishRequirement(inc(line))).toEqual({ status: "mentioned", reason: "other-language-allowed" });
  });
});

describe("behavior: whose English (R4)", () => {
  it("only subject lines → not-about-patient", () => {
    expect(detectEnglishRequirement(inc("Parent or caregiver must be able to read and write in English"))).toEqual({
      status: "mentioned",
      reason: "not-about-patient",
    });
  });
  it("a subject line is ignored next to a patient requirement", () => {
    const text = inc("Clinician must be able to speak English", "Must be able to speak English");
    expect(detectEnglishRequirement(text)).toEqual({ status: "required", evidence: ["Must be able to speak English"] });
  });
  it("a subject line that also vetoes still vetoes", () => {
    const text = inc("Must be able to speak English", "Parents who do not speak English may use an interpreter");
    expect(detectEnglishRequirement(text)).toEqual({ status: "mentioned", reason: "other-language-allowed" });
  });
});

describe("behavior: missing or ambiguous headings (R2.2)", () => {
  it.each([
    ["no headings", "* Must speak English"],
    ["duplicate inclusion heading", "Inclusion Criteria:\n* English speaking\nInclusion Criteria:\n* Age 18+"],
    ["duplicate exclusion heading", "Exclusion Criteria:\n* Unable to speak English\nExclusion Criteria:\n* Pregnant"],
    ["exclusion before inclusion", `${exc("Unable to speak English")}\n\n${inc("Age 18+")}`],
    ["heading merged into a bullet", inc("cannot participate in English Inclusion criteria for adolescents")],
  ])("%s → mentioned/no-sections", (_name, text) => {
    expect(detectEnglishRequirement(text)).toEqual({ status: "mentioned", reason: "no-sections" });
  });
  it("English mentioned only before the first heading → unclear, not required", () => {
    const text = `All study visits are in English.\n\n${inc("Age 18 or older")}`;
    expect(detectEnglishRequirement(text)).toEqual({ status: "mentioned", reason: "unclear" });
  });
  it("a single exclusion heading is a usable section", () => {
    expect(detectEnglishRequirement(exc("Not proficient in English")).status).toBe("required");
  });
});

describe("behavior: evidence (R5.2)", () => {
  it("keeps original casing, strips the bullet, and follows document order", () => {
    const text =
      "Inclusion Criteria:\n\n* Age 18+\n   *   COMFORTABLE conversing in English  \n\n" +
      "Exclusion Criteria:\n\n- Pregnant\n-   Unable to READ or write English";
    expect(detectEnglishRequirement(text)).toEqual({
      status: "required",
      evidence: ["COMFORTABLE conversing in English", "Unable to READ or write English"],
    });
  });
});

describe("behavior: format changes (R5.3)", () => {
  const base = both(["Must be able to speak English"], ["Unable to read English"]);
  it.each([
    ["upper case", base.toUpperCase()],
    ["lower case", base.toLowerCase()],
    ["CRLF line endings", base.replace(/\n/g, "\r\n")],
    ["tabs and extra spaces", base.replace(/ /g, " \t  ")],
    ["dash bullets", base.replace(/^\* /gm, "- ")],
    ["dot bullets", base.replace(/^\* /gm, "• ")],
    ["no bullets", base.replace(/^\* /gm, "")],
  ])("%s keeps the result", (_name, text) => {
    const r = detectEnglishRequirement(text);
    expect(r.status).toBe("required");
    expect(r.status === "required" && r.evidence).toHaveLength(2);
  });
});

describe("behavior: robustness (R1.4)", () => {
  it("handles 50,000+ characters", () => {
    const filler = Array.from({ length: 1200 }, (_, i) => `Criterion number ${i} about lab values and history`);
    const text = both(["English speaking", ...filler], [...filler, "Unable to write English"]);
    expect(text.length).toBeGreaterThan(50_000);
    expect(detectEnglishRequirement(text)).toEqual({ status: "required", evidence: ["English speaking", "Unable to write English"] });
  });
  it("handles 50,000+ characters of a single line without headings", () => {
    const text = "english ".repeat(7000);
    expect(text.length).toBeGreaterThan(50_000);
    expect(detectEnglishRequirement(text)).toEqual({ status: "mentioned", reason: "no-sections" });
  });
  it("handles non-Latin text", () => {
    expect(detectEnglishRequirement(inc("年满18岁", "能说普通话"))).toEqual({ status: "none", reason: "no-mention" });
    expect(detectEnglishRequirement(inc("Able to speak English (能说英语)")).status).toBe("required");
    expect(detectEnglishRequirement(inc("يتحدث English أو العربية")).status).not.toBe("required");
    expect(detectEnglishRequirement("\u{1F600}\u0000\uD800 English ￿")).toEqual({ status: "mentioned", reason: "no-sections" });
  });
  it("treats a non-string at runtime as empty", () => {
    expect(detectEnglishRequirement(undefined as unknown as string)).toEqual({ status: "none", reason: "no-mention" });
    expect(detectEnglishRequirement(null as unknown as string)).toEqual({ status: "none", reason: "no-mention" });
  });
});

// ---------------------------------------------------------------------------------------
// Property tests (R10), ≥ 100 generated cases each.
// ---------------------------------------------------------------------------------------
const RUNS = { numRuns: 300 };
const VETO_LANGUAGES = [
  "Spanish", "Portuguese", "Haitian Creole", "Creole", "French", "Mandarin", "Cantonese", "Chinese",
  "Vietnamese", "Russian", "Arabic", "Korean", "Cape Verdean", "Somali",
];
// Criteria-shaped fragments, so generated inputs actually reach the section/line logic.
const FRAGMENTS = [
  "Inclusion Criteria:", "Exclusion Criteria:", "inclusion criteria", "EXCLUSION CRITERIA:",
  "* English speaking", "- Unable to speak English", "• Must read English", "* Parent speaks English",
  "* Non-English speakers may join", "* English or Spanish", "* Age 18+", "* Pregnant", "not", "no",
  "English", "english", "ENGLISH", "New England", "interpreter", "\n", "\r\n", "\n\n", " ", "\t", "*", "-", "•",
];
const criteriaLike = fc.array(fc.constantFrom(...FRAGMENTS), { maxLength: 30 }).map((p) => p.join(" "));
const anyText = fc.oneof(fc.string(), fc.string({ unit: "binary" }), criteriaLike, fc.constantFrom(...CASES.map((c) => c.text)));

interface FormatChange {
  caseMode: "upper" | "lower" | "random";
  caseSeed: boolean[];
  bullet: string;
  space: string;
  pad: string;
  blankLines: boolean;
  crlf: boolean;
}
/** Case, bullet-marker and whitespace changes that keep line and heading order. */
function applyFormat(text: string, t: FormatChange): string {
  let i = 0;
  const cased =
    t.caseMode === "upper"
      ? text.toUpperCase()
      : t.caseMode === "lower"
        ? text.toLowerCase()
        : [...text].map((ch) => (t.caseSeed[i++ % t.caseSeed.length] ? ch.toUpperCase() : ch.toLowerCase())).join("");
  const lines = cased.split(/\r?\n/).map((line) => {
    const swapped = line.replace(/^(\s*)[*\-•](\s+)/, `$1${t.bullet}$2`);
    return t.pad + swapped.replace(/ /g, t.space) + t.pad;
  });
  return lines.join(t.blankLines ? "\n\n" : "\n").replace(/\n/g, t.crlf ? "\r\n" : "\n");
}
const formatChange: fc.Arbitrary<FormatChange> = fc.record({
  caseMode: fc.constantFrom("upper" as const, "lower" as const, "random" as const),
  caseSeed: fc.array(fc.boolean(), { minLength: 1, maxLength: 64 }),
  bullet: fc.constantFrom("*", "-", "•"),
  space: fc.constantFrom(" ", "  ", "\t", " \t "),
  pad: fc.constantFrom("", " ", "  ", "\t"),
  blankLines: fc.boolean(),
  crlf: fc.boolean(),
});

describe("properties (R10)", () => {
  it("R10.1 never throws and always returns a valid shape", () => {
    fc.assert(
      fc.property(anyText, (s) => {
        expect(isValidResult(detectEnglishRequirement(s))).toBe(true);
      }),
      RUNS,
    );
  });

  it("R10.2 is deterministic", () => {
    fc.assert(
      fc.property(anyText, (s) => {
        expect(detectEnglishRequirement(s)).toEqual(detectEnglishRequirement(s));
      }),
      RUNS,
    );
  });

  it("R10.3 no whole-word 'english' → never required (always none/no-mention)", () => {
    const noEnglish = anyText.filter((s) => !/\benglish\b/i.test(s));
    fc.assert(
      fc.property(noEnglish, (s) => {
        expect(detectEnglishRequirement(s)).toEqual({ status: "none", reason: "no-mention" });
      }),
      RUNS,
    );
  });

  const requiredTexts = CASES.map((c) => c.text).filter((t) => detectEnglishRequirement(t).status === "required");
  const swapHeadings = (t: string) =>
    t.replace(/inclusion|exclusion/gi, (m) => {
      const to = m.toLowerCase() === "inclusion" ? "exclusion" : "inclusion";
      if (m === m.toUpperCase()) return to.toUpperCase();
      if (m[0] === m[0].toUpperCase()) return to[0].toUpperCase() + to.slice(1);
      return to;
    });

  it("R10.4 swapping Inclusion/Exclusion on a required fixture → never required", () => {
    expect(requiredTexts.length).toBeGreaterThanOrEqual(16);
    for (const t of requiredTexts) expect(detectEnglishRequirement(swapHeadings(t)).status).not.toBe("required");
    fc.assert(
      fc.property(fc.constantFrom(...requiredTexts), formatChange, (t, f) => {
        expect(detectEnglishRequirement(swapHeadings(applyFormat(t, f))).status).not.toBe("required");
      }),
      RUNS,
    );
  });

  it("R10.5 appending any veto line to any criteria → never required", () => {
    const vetoLine = fc.oneof(
      fc.constant("* Non-English speakers may join with an interpreter."),
      fc.tuple(fc.constantFrom(...VETO_LANGUAGES), fc.boolean()).map(([lang, upper]) => {
        const l = `* English or ${lang} speaking`;
        return upper ? l.toUpperCase() : l;
      }),
    );
    fc.assert(
      fc.property(anyText, vetoLine, (s, veto) => {
        expect(detectEnglishRequirement(`${s}\n${veto}`).status).not.toBe("required");
      }),
      RUNS,
    );
  });

  it("R10.6 case, bullet-marker and whitespace changes keep every fixture's status", () => {
    fc.assert(
      fc.property(fc.constantFrom(...CASES), formatChange, (c, f) => {
        const before = detectEnglishRequirement(c.text);
        const after = detectEnglishRequirement(applyFormat(c.text, f));
        expect(label(after)).toBe(label(before));
        if (before.status === "required" && after.status === "required") {
          expect(after.evidence).toHaveLength(before.evidence.length);
        }
      }),
      { numRuns: 500 },
    );
  });
});
