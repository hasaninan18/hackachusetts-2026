// Client-safe: imported by components/TrialPlain.tsx, so keep it free of the full trial fixtures.
import type { Lang, Simplified } from "../types";

// Hand-written stand-ins for /api/simplify output. Neither trial lists a time commitment,
// so timeCommitment says to ask rather than guessing.
const mockSimplified: Record<string, Partial<Record<Lang, Simplified>>> = {
  NCT05799222: {
    en: {
      lang: "en",
      whatItStudies:
        "This study tests whether meal replacement shakes and bars can help people lose weight and lower their blood sugar. It is for adults with overweight or obesity who have diabetes or prediabetes and a low income.",
      whatYouDo:
        "You would use meal replacements as part of a nutrition program run by Massachusetts General Hospital. The study team will check your weight and blood sugar.",
      timeCommitment: "The study does not list how many visits there are. Ask the study team.",
      questions: [
        { id: "q1", text: "Have you been told you have diabetes or prediabetes, or had high blood sugar in the last 6 months?", ruleOutIf: "no" },
        { id: "q2", text: "Do you take medicine for blood sugar other than metformin, or medicine for weight loss?", ruleOutIf: "yes" },
        { id: "q3", text: "Are you planning weight loss surgery in the next 6 months?", ruleOutIf: "yes" },
        { id: "q4", text: "Are you pregnant, breastfeeding, or thinking about getting pregnant in the next 6 months?", ruleOutIf: "yes" },
      ],
    },
    es: {
      lang: "es",
      whatItStudies:
        "Este estudio prueba si los batidos y barras que reemplazan comidas pueden ayudar a las personas a bajar de peso y a bajar el azúcar en la sangre. Es para adultos con sobrepeso u obesidad que tienen diabetes o prediabetes y bajos ingresos.",
      whatYouDo:
        "Usted usaría reemplazos de comida como parte de un programa de nutrición del Massachusetts General Hospital. El equipo del estudio revisará su peso y su azúcar en la sangre.",
      timeCommitment: "El estudio no dice cuántas visitas hay. Pregunte al equipo del estudio.",
      questions: [
        { id: "q1", text: "¿Le han dicho que tiene diabetes o prediabetes, o tuvo el azúcar alto en la sangre en los últimos 6 meses?", ruleOutIf: "no" },
        { id: "q2", text: "¿Toma medicina para el azúcar aparte de la metformina, o medicina para bajar de peso?", ruleOutIf: "yes" },
        { id: "q3", text: "¿Planea una cirugía para bajar de peso en los próximos 6 meses?", ruleOutIf: "yes" },
        { id: "q4", text: "¿Está embarazada, dando pecho o pensando en quedar embarazada en los próximos 6 meses?", ruleOutIf: "yes" },
      ],
    },
  },
  NCT06138821: {
    en: {
      lang: "en",
      whatItStudies:
        "This study looks at a liver disease linked to extra weight (called MASH). It compares a stomach-narrowing procedure done through the mouth, plus diet and exercise help, with diet and exercise help alone.",
      whatYouDo:
        "A computer picks by chance which group you join. One group gets the procedure plus diet counseling. The other gets diet counseling only. You would come back for check-ups, lab tests and scans.",
      timeCommitment: "You agree not to start a new weight loss medicine for 12 months. Ask the study team how many visits there are.",
      questions: [
        { id: "q1", text: "Have you had weight loss surgery, or surgery on your stomach or intestines? (Gallbladder or appendix removal doesn't count.)", ruleOutIf: "yes" },
        { id: "q2", text: "Do you use insulin for diabetes?", ruleOutIf: "yes" },
        { id: "q3", text: "Do you smoke now?", ruleOutIf: "yes" },
        { id: "q4", text: "Are you pregnant or breastfeeding?", ruleOutIf: "yes" },
        { id: "q5", text: "Could you travel to Brigham and Women's Hospital for regular follow-up visits?", ruleOutIf: "no" },
      ],
    },
  },
};

// Falls back to English when a fixture doesn't exist for the language; the real API translates.
export function getMockSimplified(nctId: string, lang: Lang): Simplified | undefined {
  const byLang = mockSimplified[nctId];
  return byLang?.[lang] ?? byLang?.en;
}
