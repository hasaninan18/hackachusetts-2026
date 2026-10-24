import React from "react";
import type { Translate } from "@/lib/i18n";
import type { StudyOutcomes } from "../lib/outcomes";
import { parseOutcomes } from "../lib/outcomes";

export function StudyResults({ nctId, outcomes, t }: {
  nctId: string;
  outcomes?: StudyOutcomes;
  t: Translate;
}) {
  const result = parseOutcomes(outcomes, nctId);
  const source = `https://clinicaltrials.gov/study/${encodeURIComponent(nctId)}?tab=results`;
  return (
    <section className="mt-6 border-t border-line pt-6" aria-labelledby="study-results-heading">
      <h2 id="study-results-heading" className="text-xl font-semibold text-ink">{t("outcomes.heading")}</h2>
      <p className="mt-2 text-sm text-muted">{t("outcomes.caution")}</p>
      {result.status === "available" ? (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-muted">{t("outcomes.sourceNote")}</p>
          <p>{t("outcomes.posted", { date: result.postedOn })}</p>
          {result.summary && <p lang="en" className="break-words">{result.summary}</p>}
          {result.measures.map((measure, i) => (
            <div key={i} className="space-y-2">
              <h3 lang="en" className="font-semibold break-words">{measure.title}</h3>
              <p><span className="font-medium">{t("outcomes.time")} </span><span lang="en">{measure.timeFrame}</span></p>
              <p><span className="font-medium">{t("outcomes.statistic")} </span><span lang="en">{measure.statistic}</span></p>
              <ul className="space-y-3">
                {measure.groups.map((group, j) => (
                  <li key={j} className="border-l-2 border-line pl-3 break-words">
                    <p lang="en" className="font-medium">{group.name}</p>
                    <p>{t("outcomes.people", { n: group.participants })}</p>
                    <p lang="en">{group.value} {group.unit}</p>
                    {group.uncertainty && <p lang="en" className="text-sm">{group.uncertainty}</p>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {result.limitations && (
            <div>
              <h3 className="font-semibold">{t("outcomes.limits")}</h3>
              <p lang="en" className="break-words">{result.limitations}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <p>{t(result.status === "not_posted" ? "outcomes.notPosted" :
            result.status === "unavailable" ? "outcomes.unavailable" : "outcomes.notChecked")}</p>
          {result.status === "not_posted" && <p className="mt-1 text-sm text-muted">{t("outcomes.checked", { date: result.checkedOn })}</p>}
        </div>
      )}
      <a href={source} target="_blank" rel="noopener noreferrer"
        className="mt-3 inline-flex min-h-11 items-center text-primary underline">
        {t("outcomes.source")}
      </a>
      <p className="print-only break-words text-sm">{source}</p>
    </section>
  );
}
