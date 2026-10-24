import type { ReactNode } from "react";
import type { Translate } from "@/lib/i18n";
import type { Answer, FitReason, FitResult as FitResultData } from "@/lib/quickCheck";
import type { Eligibility, FitQuestion, Lang } from "@/lib/types";

const ANSWER_KEYS = { yes: "fit.yes", no: "fit.no", unsure: "fit.unsure" } as const;

interface ReasonContext {
  eligibility: Eligibility;
  questions: FitQuestion[];
  answers: Record<string, Answer>;
  questionTextLang?: string;
  lang: Lang;
  t: Translate;
}

// Exactly two outcomes (docs/FRONTEND_PLAN.md §4). Amber, never red: "ask the team" isn't a failure.
// Not a live region: QuickCheck owns the single status element that announces outcome changes.
export function FitResult({ result, ...ctx }: { result: FitResultData } & ReasonContext) {
  const { t } = ctx;
  if (result.outcome === "possible-fit") {
    return (
      <div className="border-l-4 border-fit bg-fit-bg p-4 text-fit">
        <h3 className="text-lg font-semibold">{t("fit.possibleTitle")}</h3>
        <p className="mt-1">{t("fit.possibleBody")}</p>
      </div>
    );
  }

  return (
    <div className="border-l-4 border-ask bg-ask-bg p-4 text-ask">
      <h3 className="text-lg font-semibold">{t("fit.askTitle")}</h3>
      <p className="mt-1">{t("fit.askBody")}</p>
      {result.reasons.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5">
          {result.reasons.map((reason, i) => (
            <li key={`${reason.kind}-${reason.questionId ?? i}`}>{reasonText(reason, ctx)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function reasonText(reason: FitReason, ctx: ReasonContext): ReactNode {
  const { eligibility, questions, answers, questionTextLang, lang, t } = ctx;
  switch (reason.kind) {
    case "age-too-young":
      return t("fit.reason.age-too-young", { min: eligibility.minAgeYears ?? "" });
    case "age-too-old":
      return t("fit.reason.age-too-old", { max: eligibility.maxAgeYears ?? "" });
    case "sex": {
      const sex = t(eligibility.sex === "FEMALE" ? "fit.sexFemale" : "fit.sexMale");
      return t("fit.reason.sex", { sex: sex.toLocaleLowerCase(lang) });
    }
    case "healthy-volunteer":
      return t("fit.reason.healthy-volunteer");
    case "answer": {
      const q = questions.find((question) => question.id === reason.questionId);
      if (!q) return null;
      const answer = answers[q.id];
      // {q} has no value here, so t() leaves it in place. The model-written question is then
      // rendered in its own element with its own lang, not merged into the UI-language string.
      const template = t("fit.reason.answer", { a: answer ? t(ANSWER_KEYS[answer]) : "" });
      const question = <span lang={questionTextLang}>{q.text}</span>;
      const at = template.indexOf("{q}");
      if (at === -1) {
        return (
          <>
            {template} {question}
          </>
        );
      }
      return (
        <>
          {template.slice(0, at)}
          {question}
          {template.slice(at + "{q}".length)}
        </>
      );
    }
  }
}
