import type { ReactNode } from "react";
import type { MessageKey, Translate } from "@/lib/i18n";
import type { Answer, FitReason, FitResult as FitResultData } from "@/lib/quickCheck";
import type { Eligibility, FitQuestion, Lang } from "@/lib/types";

const ANSWER_KEYS = { yes: "fit.yes", no: "fit.no", unsure: "fit.unsure" } as const;

// "ask-team" whose only reason is missing study info: the person's answers didn't rule
// anything out, so "Some answers may rule you out" would be wrong. safety.md §1 allows
// "Not sure ... the study team can tell you" for this.
function onlyMissingInfo(result: FitResultData): boolean {
  return (
    result.outcome === "ask-team" &&
    result.reasons.length > 0 &&
    result.reasons.every((reason) => reason.kind === "insufficient-info")
  );
}

// Title and body for a result, shared with QuickCheck's live-region announcement so the
// screen-reader text always matches what is on screen.
export function fitHeadingKeys(result: FitResultData): { title: MessageKey; body: MessageKey } {
  if (result.outcome === "possible-fit") return { title: "fit.possibleTitle", body: "fit.possibleBody" };
  if (onlyMissingInfo(result)) return { title: "fit.unsureTitle", body: "fit.reason.insufficient-info" };
  return { title: "fit.askTitle", body: "fit.askBody" };
}

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
  const { title, body } = fitHeadingKeys(result);
  if (result.outcome === "possible-fit") {
    return (
      <div className="border-l-4 border-fit bg-fit-bg p-4 text-fit">
        <h3 className="text-lg font-semibold">{t(title)}</h3>
        <p className="mt-1">{t(body)}</p>
      </div>
    );
  }

  return (
    <div className="border-l-4 border-ask bg-ask-bg p-4 text-ask">
      <h3 className="text-lg font-semibold">{t(title)}</h3>
      <p className="mt-1">{t(body)}</p>
      {/* With only missing study info, the body already is that reason; don't repeat it. */}
      {result.reasons.length > 0 && !onlyMissingInfo(result) && (
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
    case "insufficient-info":
      return t("fit.reason.insufficient-info");
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
