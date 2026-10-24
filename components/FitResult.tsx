import type { Translate } from "@/lib/i18n";
import type { FitReason, FitResult as FitResultData } from "@/lib/quickCheck";
import type { Eligibility, FitQuestion } from "@/lib/types";

// Exactly two outcomes (docs/FRONTEND_PLAN.md §4). Amber, never red: "ask the team" isn't a failure.
export function FitResult({
  result,
  eligibility,
  questions,
  t,
}: {
  result: FitResultData;
  eligibility: Eligibility;
  questions: FitQuestion[];
  t: Translate;
}) {
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
            <li key={`${reason.kind}-${reason.questionId ?? i}`}>
              {reasonText(reason, eligibility, questions, t)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function reasonText(
  reason: FitReason,
  eligibility: Eligibility,
  questions: FitQuestion[],
  t: Translate,
): string {
  switch (reason.kind) {
    case "age-too-young":
      return t("fit.reason.age-too-young", { min: eligibility.minAgeYears ?? "" });
    case "age-too-old":
      return t("fit.reason.age-too-old", { max: eligibility.maxAgeYears ?? "" });
    case "sex":
      return t("fit.reason.sex", {
        sex: eligibility.sex === "FEMALE" ? t("fit.sexFemale") : t("fit.sexMale"),
      });
    case "healthy-volunteer":
      return t("fit.reason.healthy-volunteer");
    case "answer": {
      const q = questions.find((question) => question.id === reason.questionId);
      return t("fit.reason.answer", { q: q?.text ?? "" });
    }
  }
}
