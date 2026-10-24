// Pure helpers for the separated summary: checklist reasons, code/number token preservation,
// and banned words in every language. No Bedrock, no network.
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import {
  ALL_BANNED_PHRASES,
  PLACEBO_SENTENCE,
  buildTitleAndProseTranslatePrompt,
  checkEnglishComparison,
  checkTokensPreserved,
  checkTranslatedComparison,
  codeSourceText,
  comparisonRule,
  detectComparison,
  withComparisonRule,
  codeTokens,
  findBannedPhrase,
  numberTokens,
  parseTranslatedTitle,
  resolveChecklist,
  validateEnglishFields,
  validateTranslatedFields,
} from "./simplify-auto";
import { FORBIDDEN_PHRASES, buildEnglishProsePrompt } from "./bedrock";
import { heroCriteriaWithHospice, heroDetail } from "./test-fixtures/nct07043426";
import { LANGS } from "./types";

const HERO_IDS = ["age_min", "hospice", "t1dm_exclusion", "t2dm_diagnosis"];
const quiet = () => {};

describe("resolveChecklist (rules unchanged, failures become questions: [])", () => {
  it("hero keeps its exact 4 questions in en and es, with no reason", () => {
    for (const lang of ["en", "es"] as const) {
      const out = resolveChecklist(heroDetail(), lang, quiet);
      expect(out.reason).toBeUndefined();
      expect(out.questions.map((q) => q.id).sort()).toEqual(HERO_IDS);
    }
    const es = resolveChecklist(heroDetail(), "es", quiet);
    expect(es.questions.find((q) => q.id === "hospice")?.text).toBe(
      "¿Está recibiendo cuidados de hospicio (hospice) actualmente?",
    );
  });

  it("languages without reviewed wording get no questions", () => {
    for (const lang of ["pt", "ht", "zh", "vi"] as const) {
      expect(resolveChecklist(heroDetail(), lang, quiet)).toEqual({
        questions: [],
        reason: "unsupported-language",
      });
    }
  });

  it("an unpinned study gets no questions (unsupported-study)", () => {
    const other = { ...heroDetail(), nctId: "NCT10000001" };
    expect(resolveChecklist(other, "en", quiet)).toEqual({ questions: [], reason: "unsupported-study" });
  });

  it("a semantic-backstop disagreement drops every question (semantic-check-failed)", async () => {
    vi.resetModules();
    vi.doMock("./bedrock", async (importOriginal) => ({
      ...(await importOriginal<typeof import("./bedrock")>()),
      checkQuestionSemantics: () => 'question "hospice": forced disagreement',
    }));
    try {
      const fresh = await import("./simplify-auto");
      const warn = vi.fn();
      expect(fresh.resolveChecklist(heroDetail(), "es", warn)).toEqual({
        questions: [],
        reason: "semantic-check-failed",
      });
      expect(warn).toHaveBeenCalledWith("checklist-semantic-backstop nctId=NCT07043426 lang=es");
    } finally {
      vi.doUnmock("./bedrock");
      vi.resetModules();
    }
  });

  it("revised criteria get no questions and one data-free warning", () => {
    const warn = vi.fn();
    const revised = heroDetail({
      criteriaText: heroCriteriaWithHospice("Patients not currently receiving hospice care."),
    });
    expect(resolveChecklist(revised, "es", warn)).toEqual({
      questions: [],
      reason: "criteria-revision-changed",
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/^criteria-revision-changed nctId=NCT07043426/);
    expect(warn.mock.calls[0][0]).not.toContain("hospice");
  });
});

describe("code and number tokens", () => {
  it("finds study codes, not ordinals or glued units", () => {
    expect(codeTokens("LY5724886 for T2DM; HbA1c ≥9%, 1st visit, 10mg, NCT07043426")).toEqual([
      "LY5724886",
      "T2DM",
      "HbA1c",
      "NCT07043426",
    ]);
  });

  it("treats locale number formatting as the same number", () => {
    expect(numberTokens("1,000 people, 6.5%")).toEqual(["1000", "6.5"]);
    expect(numberTokens("1.000 personas, 6,5 %")).toEqual(["1000", "6.5"]);
  });

  const word = fc.constantFrom("un", "estudio", "de", "en", "adultos", "研究", "nghiên", "cứu", "pou", "moun");
  const words = fc.array(word, { maxLength: 6 }).map((ws) => ws.join(" "));
  const code = fc.stringMatching(/^[A-Z]{1,4}[0-9]{2,8}$/);

  it("property: any output that keeps the code verbatim passes", () => {
    fc.assert(
      fc.property(code, words, words, (c, pre, post) => {
        expect(checkTokensPreserved("title", `A Study of ${c} in Adults`, `${pre} ${c} ${post}`)).toBeNull();
      }),
    );
  });

  it("property: splitting or dropping a code always fails", () => {
    fc.assert(
      fc.property(code, words, fc.nat(), (c, pre, cut) => {
        const at = 1 + (cut % (c.length - 1));
        const split = `${c.slice(0, at)}-${c.slice(at)}`;
        expect(checkTokensPreserved("title", `A Study of ${c}`, `${pre} ${split}`)).not.toBeNull();
        expect(checkTokensPreserved("title", `A Study of ${c}`, pre)).not.toBeNull();
      }),
    );
  });

  it("property: dropping any number from a field fails", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 99999 }), { minLength: 1, maxLength: 5 }), fc.nat(), (ns, pick) => {
        const original = ns.map((n) => `${n} visits`).join(", ");
        const dropped = ns[pick % ns.length];
        const output = ns.filter((n) => n !== dropped).map((n) => `${n} visitas`).join(", ");
        expect(checkTokensPreserved("summary", original, output)).not.toBeNull();
        expect(checkTokensPreserved("summary", original, ns.map((n) => `${n} visitas`).join(", "))).toBeNull();
      }),
    );
  });
});

describe("banned words in every language", () => {
  it("covers every language's forbidden list", () => {
    for (const lang of LANGS) {
      for (const p of FORBIDDEN_PHRASES[lang]) expect(ALL_BANNED_PHRASES).toContain(p.toLowerCase());
    }
  });

  const original = { title: "A Study in Adults", summary: "A study. Taking part is your choice.", whatYouDo: "You visit." };
  const clean = { title: "Un estudio en adultos", summary: "Un estudio. Participar es su elección.", whatYouDo: "Usted visita." };

  it("a clean translation passes", () => {
    expect(validateTranslatedFields(clean, original)).toBeNull();
  });

  it("property: any banned phrase, from any language, in any field and any case, fails", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_BANNED_PHRASES),
        fc.constantFrom("title", "summary", "whatYouDo") as fc.Arbitrary<"title" | "summary" | "whatYouDo">,
        fc.boolean(),
        (phrase, field, upper) => {
          const leak = upper ? phrase.toUpperCase() : phrase;
          const out = { ...clean, [field]: `${clean[field]} ${leak}` };
          expect(findBannedPhrase(out[field])).not.toBeNull();
          expect(validateTranslatedFields(out, original)).toMatch(/banned phrase/);
        },
      ),
    );
  });

  it("includes the safety.md Vietnamese phrases that lib/bedrock.ts does not list yet", () => {
    for (const p of ["bạn phù hợp", "bạn đáp ứng các tiêu chí", "được bảo đảm"]) {
      expect(ALL_BANNED_PHRASES).toContain(p);
      expect(validateTranslatedFields({ ...clean, summary: `Nghiên cứu. ${p}.` }, original)).toMatch(/banned/);
    }
  });

  it("timeCommitment is checked for banned phrases too", () => {
    expect(validateTranslatedFields({ ...clean, timeCommitment: "Usted califica en 2 visitas." }, original)).toMatch(
      /timeCommitment contains a banned phrase/,
    );
    expect(
      validateEnglishFields({ summary: "A study.", whatYouDo: "You visit.", timeCommitment: "Guaranteed 2 visits." }, ""),
    ).toMatch(/timeCommitment contains a banned phrase/);
  });

  it("an empty or missing field fails", () => {
    expect(validateTranslatedFields({ ...clean, title: "  " }, original)).toMatch(/title is empty/);
    expect(validateTranslatedFields({ summary: clean.summary, whatYouDo: clean.whatYouDo }, original)).toMatch(
      /title is empty/,
    );
  });

  it("a translated title may not gain a number", () => {
    expect(validateTranslatedFields({ ...clean, title: "Un estudio de 3 años en adultos" }, original)).toMatch(
      /gained a number/,
    );
  });
});

describe("English fields", () => {
  const source = "A Study of LY5724886 in Adults with HbA1c ≥9%. Call 617-555-0100.";
  const fields = (summary: string) => ({ summary, whatYouDo: "You visit." });
  it("accepts codes copied from the source and rejects altered or cut-off ones", () => {
    expect(validateEnglishFields(fields("LY5724886 is a study drug."), source)).toBeNull();
    expect(validateEnglishFields(fields("A1c (your average blood sugar) is checked."), source)).toBeNull();
    for (const bad of ["LY572488", "LY5724887", "LY57248869"]) {
      expect(validateEnglishFields(fields(`${bad} is a study drug.`), source)).toMatch(/code not in the study data/);
    }
  });
  it("site facility names and cities are part of the code source; invented codes are not", () => {
    const site = { name: "K2 Medical Research - Foxborough", city: "Foxborough", lat: 42.065, lon: -71.248, locationPrecision: "facility" as const };
    const detail = { ...heroDetail(), nctId: "NCT07783802", nearestSite: site, sites: [site] };
    const text = codeSourceText(detail);
    expect(text).toContain("K2 Medical Research - Foxborough");
    expect(text).toContain("Foxborough");
    expect(validateEnglishFields(fields("This study is at K2 Medical Research."), text)).toBeNull();
    // Without the site in the source, the same summary fails (the bug).
    expect(validateEnglishFields(fields("This study is at K2 Medical Research."), source)).toMatch(/"K2"/);
    expect(validateEnglishFields(fields("K2 Medical Research tests XR9999."), text)).toMatch(
      /code not in the study data: "XR9999"/,
    );
  });

  it("rejects banned words from other languages too", () => {
    expect(validateEnglishFields({ summary: "A study.", whatYouDo: "Usted califica." }, source)).toMatch(/banned/);
  });
});

describe("comparison group (usual care / placebo / none)", () => {
  const study = (title: string, briefSummary: string) => ({ title, briefSummary });

  it("detects what the registry text states", () => {
    expect(detectComparison(study("A Placebo-Controlled Study of LY5724886", "Adults with obesity."))).toBe("placebo");
    expect(detectComparison(study("A Study", "Drug X is compared with placebo."))).toBe("placebo");
    expect(detectComparison(study("A Study", "THRIVE-DM is compared to usual care."))).toBe("usual-care");
    expect(detectComparison(study("A Study", "Patients continue standard of care."))).toBe("usual-care");
    expect(detectComparison(study("A Study", "Compared with standard care."))).toBe("usual-care");
    expect(detectComparison(study("A Study", "Everyone gets the new program."))).toBe("none");
  });

  it("placebo wins when both are stated; negated mentions and criteria do not count", () => {
    expect(detectComparison(study("A Study", "Drug X or placebo, added to standard care."))).toBe("placebo");
    expect(detectComparison(study("A Study", "There is no placebo in this study."))).toBe("none");
    expect(detectComparison(study("A Study", "Everyone gets the drug; it is not compared with usual care."))).toBe("none");
    // Eligibility criteria are not part of the detection.
    expect(detectComparison({ ...heroDetail(), briefSummary: "A diabetes study." })).toBe("none");
  });

  it("swaps lib/bedrock.ts's usual-care rule for the rule that matches the registry", () => {
    const base = buildEnglishProsePrompt(heroDetail());
    expect(base.system).toContain("If the study is randomized, include 'You may be put by chance");
    for (const kind of ["placebo", "none", "usual-care"] as const) {
      const p = withComparisonRule(base, kind);
      expect(p.system).not.toContain("If the study is randomized, include");
      expect(p.system).toContain(comparisonRule(kind));
      expect(p.system).toContain("Always include 'Taking part is your choice.'");
      expect(p.user).toBe(base.user);
    }
    expect(withComparisonRule(base, "placebo").system).toContain(PLACEBO_SENTENCE.en);
  });

  const prose = (summary: string, whatYouDo = "You visit the clinic.") => ({ summary, whatYouDo });
  const PLACEBO_EN = PLACEBO_SENTENCE.en;

  it("placebo study: requires the placebo sentence and forbids usual care", () => {
    expect(checkEnglishComparison(prose(`A drug study. ${PLACEBO_EN} Taking part is your choice.`), "placebo")).toBeNull();
    expect(checkEnglishComparison(prose("A drug study. Taking part is your choice."), "placebo")).toMatch(/missing the placebo/);
    expect(
      checkEnglishComparison(prose(`${PLACEBO_EN} You may be put by chance in a group that gets usual care.`), "placebo"),
    ).toMatch(/usual\/standard care/);
  });

  it("usual-care study: forbids a placebo; none: forbids any comparison group", () => {
    expect(checkEnglishComparison(prose("You may be put by chance in a group that gets usual care."), "usual-care")).toBeNull();
    expect(checkEnglishComparison(prose(PLACEBO_EN), "usual-care")).toMatch(/placebo/);
    expect(checkEnglishComparison(prose("A study.", "You keep your usual care."), "none")).toMatch(/usual\/standard care/);
    expect(checkEnglishComparison(prose("A study.", "Some people get a placebo."), "none")).toMatch(/placebo/);
    expect(checkEnglishComparison(prose("A study with a control group."), "none")).toMatch(/comparison group/);
    expect(checkEnglishComparison(prose("A study. Taking part is your choice."), "none")).toBeNull();
  });

  it("translations: each language's placebo sentence passes (punctuation-insensitive) and is safe", () => {
    for (const lang of LANGS) {
      const sentence = PLACEBO_SENTENCE[lang];
      expect(findBannedPhrase(sentence), lang).toBeNull();
      expect(checkTranslatedComparison(prose(`Texto. ${sentence}`), "placebo", lang), lang).toBeNull();
      expect(checkTranslatedComparison(prose("Texto."), "placebo", lang), lang).toMatch(/missing the placebo/);
    }
    // Half-width punctuation in place of the Chinese full-width marks still matches.
    const zhAscii = PLACEBO_SENTENCE.zh.replace("（", "(").replace("）", ")").replace("，", ",");
    expect(checkTranslatedComparison(prose(zhAscii), "placebo", "zh")).toBeNull();
    // A translation that adds a placebo to a non-placebo study is rejected.
    expect(checkTranslatedComparison(prose("Puede recibir un placebo."), "usual-care", "es")).toMatch(/placebo/);
    expect(checkTranslatedComparison(prose("您可能会得到安慰剂。"), "none", "zh")).toMatch(/placebo/);
  });

  it("the translate prompt carries the comparison rule for the target language", () => {
    const input = { title: "T", summary: "s", whatYouDo: "w", timeCommitment: "t", staff_checks: [] };
    expect(buildTitleAndProseTranslatePrompt(input, "es", "placebo").system).toContain(PLACEBO_SENTENCE.es);
    expect(buildTitleAndProseTranslatePrompt(input, "es", "none").system).toMatch(/Do not add anything about a comparison group/);
    expect(buildTitleAndProseTranslatePrompt(input, "es", "usual-care").system).toMatch(/usual care by chance/);
  });
});

describe("translate prompt + title parsing", () => {
  it("asks for the title with exact codes and keeps the study data as JSON", () => {
    const p = buildTitleAndProseTranslatePrompt(
      { title: "A Study of LY5724886", summary: "s", whatYouDo: "w", timeCommitment: "t", staff_checks: [] },
      "es",
      "none",
    );
    expect(p.system).toContain("LY5724886");
    expect(p.system).toMatch(/title, summary, whatYouDo, timeCommitment, staff_checks/);
    expect(JSON.parse(p.user.slice(p.user.indexOf("{"))).title).toBe("A Study of LY5724886");
  });
  it("reads the title from fenced or bare JSON, and rejects junk", () => {
    expect(parseTranslatedTitle('```json\n{"title":" Un estudio "}\n```')).toBe("Un estudio");
    expect(parseTranslatedTitle('{"title": 3}')).toBeUndefined();
    expect(parseTranslatedTitle("not json")).toBeUndefined();
  });
});
