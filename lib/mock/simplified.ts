// Client-safe: imported by components/TrialPlain.tsx, so keep it free of the full trial fixtures.
import type { Lang, Simplified } from "../types";

// Hand-written stand-ins for /api/simplify output. None of these trials lists a time
// commitment, so timeCommitment says to ask rather than guessing.
const mockSimplified: Record<string, Partial<Record<Lang, Simplified>>> = {
  // HERO (docs/DEMO_DATA.md). Written to the DEMO_DATA prompt rules: randomized, so it says
  // "usual care" and "your choice"; one fact per question; A1c defined and "Not sure" natural;
  // the age check comes from the structured age field, so there is no age question here;
  // Complex Care Management and "deceased" are staff checks, not questions. Spanish (usted)
  // is translated from the English so both ask the same questions.
  NCT07043426: {
    en: {
      lang: "en",
      whatItStudies:
        "This study is for adults who get primary care at Boston Medical Center. They have type 2 diabetes that is not well controlled. They also have needs like food, housing, or paying bills. It tests a new way to connect people with help in the community. You may be put by chance in a group that gets usual care. Taking part is your choice.",
      whatYouDo:
        "A computer picks by chance which group you join. In one group, a community health worker helps you find local services. These can help with food, housing, or bills. Some people also get a patient navigator, a helper who follows up with them. The other group keeps getting usual care from the clinic. The study team will compare A1c levels and health care visits between the groups.",
      timeCommitment: "The study does not list how many visits there are. Ask the study team.",
      questions: [
        { id: "q1", text: "Do you see a primary care doctor at Boston Medical Center?", ruleOutIf: "no" },
        { id: "q2", text: "Has a doctor told you that you have type 2 diabetes?", ruleOutIf: "no" },
        { id: "q3", text: "Is your A1c (your average blood sugar over about 3 months) 9% or higher?", ruleOutIf: "no" },
        { id: "q4", text: "In the last 3 months, did your clinic ask about needs like food, housing, or bills?", ruleOutIf: "no" },
        { id: "q5", text: "When they asked, did you say you needed help with at least one of these?", ruleOutIf: "no" },
        { id: "q6", text: "Are you getting hospice care (comfort care near the end of life)?", ruleOutIf: "yes" },
      ],
    },
    es: {
      lang: "es",
      whatItStudies:
        "Este estudio es para adultos que reciben atención primaria en el Boston Medical Center. Tienen diabetes tipo 2 que no está bien controlada. También tienen necesidades como comida, vivienda o el pago de cuentas. Prueba una nueva forma de conectar a las personas con ayuda en la comunidad. Es posible que, por azar, le toque un grupo que recibe la atención habitual. Participar es su decisión.",
      whatYouDo:
        "Una computadora elige al azar a qué grupo entra usted. En un grupo, un trabajador de salud comunitario le ayuda a encontrar servicios locales. Estos servicios pueden ayudar con comida, vivienda o cuentas. Algunas personas también reciben un navegador de pacientes, una persona que les da seguimiento. El otro grupo sigue recibiendo la atención habitual de la clínica. El equipo del estudio comparará los niveles de A1c y las visitas médicas entre los grupos.",
      timeCommitment: "El estudio no dice cuántas visitas hay. Pregunte al equipo del estudio.",
      questions: [
        { id: "q1", text: "¿Tiene un médico de atención primaria en el Boston Medical Center?", ruleOutIf: "no" },
        { id: "q2", text: "¿Un médico le ha dicho que tiene diabetes tipo 2?", ruleOutIf: "no" },
        { id: "q3", text: "¿Su A1c (su promedio de azúcar en la sangre de unos 3 meses) es de 9% o más?", ruleOutIf: "no" },
        { id: "q4", text: "En los últimos 3 meses, ¿su clínica le preguntó por necesidades como comida, vivienda o cuentas?", ruleOutIf: "no" },
        { id: "q5", text: "Cuando le preguntaron, ¿dijo que necesitaba ayuda con al menos una de esas cosas?", ruleOutIf: "no" },
        { id: "q6", text: "¿Recibe cuidados de hospicio (cuidados de confort al final de la vida)?", ruleOutIf: "yes" },
      ],
    },
  },
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
