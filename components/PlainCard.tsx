import { HTML_LANG, type Translate } from "@/lib/i18n";
import type { Lang } from "@/lib/types";
import type { SimplifyState } from "./TrialPlain";

// Plain-language summary from /api/simplify. Everything is rendered as text nodes (React escapes
// it), never as HTML, because the content comes from a model.
export function PlainCard({
  state,
  lang,
  briefSummary,
  t,
}: {
  state: SimplifyState;
  lang: Lang;
  briefSummary: string;
  t: Translate;
}) {
  // Always mounted (same position in the tree for every state) so screen readers hear the
  // text change from "loading" to empty or "unavailable" instead of a region appearing.
  const status =
    state.status === "loading"
      ? t("trial.plainLoading")
      : state.status === "failed"
        ? t("trial.plainUnavailable")
        : "";

  return (
    <>
      <p role="status" className="sr-only">
        {status}
      </p>
      <PlainBody state={state} lang={lang} briefSummary={briefSummary} t={t} />
    </>
  );
}

function PlainBody({
  state,
  lang,
  briefSummary,
  t,
}: {
  state: SimplifyState;
  lang: Lang;
  briefSummary: string;
  t: Translate;
}) {
  if (state.status === "loading") {
    return (
      <section className="mt-6 border-t border-line pt-6" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className={i > 0 ? "mt-6" : undefined} aria-hidden="true">
            <div className="skeleton h-6 w-1/2" />
            <div className="skeleton mt-3 h-4 w-full" />
            <div className="skeleton mt-2 h-4 w-11/12" />
            <div className="skeleton mt-2 h-4 w-3/4" />
          </div>
        ))}
      </section>
    );
  }

  if (state.status === "failed") {
    return (
      <section className="mt-6 border-t border-line pt-6">
        <h2 className="text-xl font-semibold text-ink">{t("trial.what")}</h2>
        <p className="mt-2 text-sm text-muted">
          {t("trial.plainUnavailable")}
        </p>
        <p className="mt-3 whitespace-pre-line text-ink" lang="en">
          {briefSummary}
        </p>
      </section>
    );
  }

  const { data } = state;
  // The mock and the API can fall back to English when a translation is missing.
  const contentLang = data.lang !== lang ? HTML_LANG[data.lang] : undefined;
  const sections = [
    { key: "what", heading: t("trial.what"), body: data.whatItStudies },
    { key: "do", heading: t("trial.do"), body: data.whatYouDo },
    { key: "time", heading: t("trial.time"), body: data.timeCommitment },
  ];

  return (
    <section className="mt-6 border-t border-line pt-6">
      {sections.map((s, i) => (
        <div key={s.key} className={i > 0 ? "mt-6" : undefined}>
          <h2 className="text-xl font-semibold text-ink">{s.heading}</h2>
          <p className="mt-2 whitespace-pre-line text-ink" lang={contentLang}>
            {s.body}
          </p>
        </div>
      ))}
    </section>
  );
}
