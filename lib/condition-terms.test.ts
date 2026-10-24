import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CONDITION_TERMS, normalizeCondition, toEnglishCondition } from "./condition-terms";

describe("toEnglishCondition — required mappings", () => {
  it.each([
    // diabetes
    ["diabetes tipo 2", "Type 2 Diabetes"],
    ["diabetes tipo 1", "Type 1 Diabetes"],
    ["dyabèt tip 2", "Type 2 Diabetes"],
    // asthma
    ["asma", "Asthma"],
    ["opresyon", "Asthma"],
    // hypertension
    ["hipertensión", "Hypertension"],
    ["presión alta", "Hypertension"],
    ["pressão alta", "Hypertension"],
    ["hipertensão", "Hypertension"],
    ["tansyon wo", "Hypertension"],
    // cancers
    ["cáncer de mama", "Breast Cancer"],
    ["câncer de mama", "Breast Cancer"],
    ["kansè tete", "Breast Cancer"],
    ["cáncer de pulmón", "Lung Cancer"],
    ["câncer de pulmão", "Lung Cancer"],
    ["kansè poumon", "Lung Cancer"],
    ["cáncer de colon", "Colon Cancer"],
    ["câncer de cólon", "Colon Cancer"],
    ["cáncer de próstata", "Prostate Cancer"],
    ["câncer de próstata", "Prostate Cancer"],
    ["kansè pwostat", "Prostate Cancer"],
    // mental health / weight
    ["depresión", "Depression"],
    ["depressão", "Depression"],
    ["depresyon", "Depression"],
    ["ansiedad", "Anxiety"],
    ["ansiedade", "Anxiety"],
    ["obesidad", "Obesity"],
    ["obesidade", "Obesity"],
    // heart / stroke
    ["enfermedad del corazón", "Heart Disease"],
    ["doença cardíaca", "Heart Disease"],
    ["maladi kè", "Heart Disease"],
    ["insuficiencia cardíaca", "Heart Failure"],
    ["insuficiência cardíaca", "Heart Failure"],
    ["derrame cerebral", "Stroke"],
    ["accidente cerebrovascular", "Stroke"],
    // lungs / infections
    ["EPOC", "COPD"],
    ["DPOC", "COPD"],
    ["VIH", "HIV"],
    ["hepatite C", "Hepatitis C"],
    ["epatit C", "Hepatitis C"],
    // blood / brain / joints / kidneys
    ["anemia de células falciformes", "Sickle Cell Disease"],
    ["anemia falciforme", "Sickle Cell Disease"],
    ["Alzheimer", "Alzheimer Disease"],
    ["enfermedad de Alzheimer", "Alzheimer Disease"],
    ["doença de Alzheimer", "Alzheimer Disease"],
    ["artritis", "Arthritis"],
    ["artrite", "Arthritis"],
    ["enfermedad renal", "Kidney Disease"],
    ["doença renal", "Kidney Disease"],
    ["maladi ren", "Kidney Disease"],
    // long COVID
    ["COVID prolongado", "Long COVID"],
    ["covid longa", "Long COVID"],
  ])("%s → %s", (input, expected) => {
    expect(toEnglishCondition(input)).toBe(expected);
  });

  it.each(CONDITION_TERMS.map(([phrase, english]) => [phrase, english]))(
    "table entry %s → %s",
    (phrase, english) => {
      expect(toEnglishCondition(phrase)).toBe(english);
    },
  );
});

describe("toEnglishCondition — case, accents and punctuation are ignored", () => {
  it.each(["Diabetes Tipo 2", "diabetes tipo 2", "DIABETES TIPO 2", "  diabetes   tipo 2  ", "diabetes-tipo-2"])(
    "%j → Type 2 Diabetes",
    (input) => {
      expect(toEnglishCondition(input)).toBe("Type 2 Diabetes");
    },
  );

  it.each([
    ["hipertension", "Hypertension"],
    ["HIPERTENSIÓN", "Hypertension"],
    ["Presion Alta", "Hypertension"],
    ["pressao alta", "Hypertension"],
    ["cancer de pulmon", "Lung Cancer"],
    ["CÁNCER DE PULMÓN.", "Lung Cancer"],
    ["depresion", "Depression"],
    ["kanse tete", "Breast Cancer"],
    ["epoc", "COPD"],
    ["vih/sida", "HIV"],
    ["Alzheimer,", "Alzheimer Disease"],
  ])("%j → %s", (input, expected) => {
    expect(toEnglishCondition(input)).toBe(expected);
  });

  it("every table entry still maps after random case changes", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CONDITION_TERMS),
        fc.array(fc.boolean(), { minLength: 64, maxLength: 64 }),
        ([phrase, english], upper) => {
          const mixed = [...phrase]
            .map((ch, i) => (upper[i % upper.length] ? ch.toUpperCase() : ch.toLowerCase()))
            .join("");
          expect(toEnglishCondition(mixed)).toBe(english);
        },
      ),
    );
  });
});

describe("toEnglishCondition — English and unknown input pass through unchanged", () => {
  it.each([
    "Type 2 Diabetes",
    "type 2 diabetes",
    "diabetes",
    "Asthma",
    "hypertension",
    "breast cancer",
    "Lung Cancer",
    "cancer",
    "Depression",
    "COPD",
    "HIV",
    "Hepatitis C",
    "Sickle Cell Disease",
    "Long COVID",
    "heart failure",
    "Alzheimer's",
  ])("English %j is unchanged", (input) => {
    expect(toEnglishCondition(input)).toBe(input);
  });

  it.each(["", "   ", "xyzzy", "migraña crónica rara", "diabetes tipo 3", "asma severa", "NCT01234567"])(
    "unknown %j is returned exactly as given",
    (input) => {
      expect(toEnglishCondition(input)).toBe(input);
    },
  );

  it("no source phrase normalizes to any English output term (English input is never rewritten)", () => {
    const englishTerms = new Set(CONDITION_TERMS.map(([, english]) => normalizeCondition(english)));
    for (const [phrase] of CONDITION_TERMS) {
      expect(englishTerms.has(normalizeCondition(phrase)), phrase).toBe(false);
    }
  });

  it("no two source phrases collide on different English terms", () => {
    const seen = new Map<string, string>();
    for (const [phrase, english] of CONDITION_TERMS) {
      const key = normalizeCondition(phrase);
      const prior = seen.get(key);
      if (prior !== undefined) expect(prior, phrase).toBe(english);
      seen.set(key, english);
    }
  });
});

describe("toEnglishCondition — properties", () => {
  it("never throws and never returns an empty string for non-empty input", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, unit: "grapheme" }), (s) => {
        const out = toEnglishCondition(s);
        expect(typeof out).toBe("string");
        expect(out.length).toBeGreaterThan(0);
      }),
    );
  });

  it("also holds for arbitrary UTF-16 (lone surrogates included)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, unit: "binary" }), (s) => {
        expect(() => toEnglishCondition(s)).not.toThrow();
        expect(toEnglishCondition(s).length).toBeGreaterThan(0);
      }),
    );
  });

  it("output is either the input unchanged or one of the English table terms", () => {
    const englishTerms = new Set(CONDITION_TERMS.map(([, english]) => english));
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.constantFrom(...CONDITION_TERMS.map(([phrase]) => phrase))),
        (s) => {
          const out = toEnglishCondition(s);
          expect(out === s || englishTerms.has(out)).toBe(true);
        },
      ),
    );
  });
});
