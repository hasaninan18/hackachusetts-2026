"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { parseAgeInput } from "@/lib/age";
import { HTML_LANG, type MessageKey, type Translate } from "@/lib/i18n";
import { quickCheck, type Answer, type Profile } from "@/lib/quickCheck";
import type { Eligibility, FitQuestion, Lang } from "@/lib/types";
import { FitResult } from "./FitResult";
import type { SimplifyState } from "./TrialPlain";

type SexChoice = "FEMALE" | "MALE" | "skip";
type HealthyChoice = "yes" | "no" | "unsure"; // answer to "Do you have the condition?"

const ANSWER_LABELS: Record<Answer, MessageKey> = {
  yes: "fit.yes",
  no: "fit.no",
  unsure: "fit.unsure",
};
const SEX_LABELS: Record<SexChoice, MessageKey> = {
  FEMALE: "fit.sexFemale",
  MALE: "fit.sexMale",
  skip: "fit.sexSkip",
};

const AGE_COMMIT_MS = 800; // pause before a typed age counts, so "70" never flashes a result for "7"
const NO_ANSWERS: Record<string, Answer> = {};

// Everything here stays in React state: nothing is sent over the network or written to storage.
// The outcome comes only from lib/quickCheck.ts, which has exactly two results and never lets
// a missing or "not sure" answer rule anyone out.
export function QuickCheck({
  lang,
  status,
  questions,
  questionsLang,
  eligibility,
  t,
}: {
  lang: Lang;
  status: SimplifyState["status"];
  questions: FitQuestion[];
  questionsLang: Lang;
  eligibility: Eligibility;
  t: Translate;
}) {
  const uid = useId();
  const [ageText, setAgeText] = useState("");
  const [committedAge, setCommittedAge] = useState("");
  const ageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sex, setSex] = useState<SexChoice | null>(null);
  const [healthy, setHealthy] = useState<HealthyChoice | null>(null);

  // Answers belong to one exact question set. If the questions differ in any way (ids or
  // wording), the old answers are dropped instead of being attached to the new questions.
  const questionSet = questions.map((q) => q.id + q.text).join("|");
  const [answerState, setAnswerState] = useState<{
    set: string;
    answers: Record<string, Answer>;
  }>({ set: questionSet, answers: {} });
  const answers = answerState.set === questionSet ? answerState.answers : NO_ANSWERS;
  const setAnswer = (id: string, value: Answer) =>
    setAnswerState((prev) => ({
      set: questionSet,
      answers: { ...(prev.set === questionSet ? prev.answers : {}), [id]: value },
    }));

  useEffect(
    () => () => {
      if (ageTimer.current) clearTimeout(ageTimer.current);
    },
    [],
  );

  const commitAge = (text: string) => {
    if (ageTimer.current) clearTimeout(ageTimer.current);
    ageTimer.current = null;
    setCommittedAge(text);
  };
  const onAgeChange = (raw: string) => {
    const text = raw.replace(/\D/g, "").slice(0, 3);
    setAgeText(text);
    if (ageTimer.current) clearTimeout(ageTimer.current);
    ageTimer.current = setTimeout(() => commitAge(text), AGE_COMMIT_MS);
  };

  const askSex = eligibility.sex !== "ALL";
  const askHealthy = eligibility.healthyVolunteers === false;

  const age = parseAgeInput(committedAge);
  const ageInvalid = committedAge !== "" && age === undefined;
  const profile: Profile = {
    age,
    sex: askSex && (sex === "FEMALE" || sex === "MALE") ? sex : undefined,
    // "No, I don't have the condition" = healthy volunteer. "Not sure" leaves it unknown.
    healthy: !askHealthy || healthy === null || healthy === "unsure" ? undefined : healthy === "no",
  };
  const result = quickCheck(profile, eligibility, questions, answers);

  // The result appears only once every radio group on screen has an answer ("Not sure" counts).
  // Age is optional and never blocks it. Model questions count once they have loaded; while
  // they load there is no result yet. With no radio groups at all, a valid age is enough.
  const groups = [
    ...(askSex ? [sex !== null] : []),
    ...(askHealthy ? [healthy !== null] : []),
    ...(status === "ready" ? questions.map((q) => answers[q.id] !== undefined) : []),
  ];
  const total = groups.length;
  const done = groups.filter(Boolean).length;
  const showResult = status !== "loading" && (total > 0 ? done === total : age !== undefined);

  // One always-present status element, updated only when the outcome or the number of reasons
  // changes (state adjusted during render, not in an effect). The trailing no-break space
  // alternates so a change in reasons alone, with the same words, is still a DOM change that
  // screen readers announce.
  const announceKey = showResult ? `${result.outcome}:${result.reasons.length}` : "";
  const [announced, setAnnounced] = useState({ key: "", text: "", flip: false });
  if (announced.key !== announceKey) {
    const text = !showResult
      ? ""
      : result.outcome === "possible-fit"
        ? `${t("fit.possibleTitle")} ${t("fit.possibleBody")}`
        : `${t("fit.askTitle")} ${t("fit.askBody")}`;
    setAnnounced({ key: announceKey, text, flip: !announced.flip });
  }

  const questionTextLang = questionsLang !== lang ? HTML_LANG[questionsLang] : undefined;
  const ageErrorId = `${uid}-age-error`;

  return (
    <section className="mt-6 border-t border-line pt-6" aria-labelledby={`${uid}-heading`}>
      <h2 id={`${uid}-heading`} className="text-xl font-semibold text-ink">
        {t("fit.heading")}
      </h2>
      <p className="mt-2 text-muted">{t("fit.intro")}</p>

      <div className="no-print mt-4 space-y-6">
        <div>
          <label htmlFor={`${uid}-age`} className="block font-medium text-ink">
            {t("fit.age")}
          </label>
          <input
            id={`${uid}-age`}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={3}
            autoComplete="off"
            value={ageText}
            onChange={(e) => onAgeChange(e.target.value)}
            onBlur={() => commitAge(ageText)}
            aria-invalid={ageInvalid || undefined}
            aria-describedby={ageInvalid ? ageErrorId : undefined}
            className="mt-2 block min-h-12 w-32 rounded-lg border border-muted bg-card px-3 text-base text-ink"
          />
          {ageInvalid && (
            <p id={ageErrorId} className="mt-2 text-ask">
              {t("fit.ageError")}
            </p>
          )}
        </div>

        {askSex && (
          <ChoiceGroup legend={t("fit.sex")}>
            {(Object.keys(SEX_LABELS) as SexChoice[]).map((value) => (
              <Pill
                key={value}
                name={`${uid}-sex`}
                value={value}
                checked={sex === value}
                onChange={() => setSex(value)}
                label={t(SEX_LABELS[value])}
              />
            ))}
          </ChoiceGroup>
        )}

        {askHealthy && (
          <ChoiceGroup legend={t("fit.healthy")}>
            {(Object.keys(ANSWER_LABELS) as HealthyChoice[]).map((value) => (
              <Pill
                key={value}
                name={`${uid}-healthy`}
                value={value}
                checked={healthy === value}
                onChange={() => setHealthy(value)}
                label={t(ANSWER_LABELS[value])}
              />
            ))}
          </ChoiceGroup>
        )}

        {status === "loading" ? (
          <div>
            <p role="status" className="text-muted">
              {t("fit.questionsLoading")}
            </p>
            {[0, 1, 2].map((i) => (
              <div key={i} className="mt-4" aria-busy="true" aria-hidden="true">
                <div className="skeleton h-4 w-5/6" />
                <div className="mt-3 flex gap-2">
                  <div className="skeleton h-12 w-20" />
                  <div className="skeleton h-12 w-20" />
                  <div className="skeleton h-12 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : questions.length === 0 ? (
          <p className="text-muted">{t("fit.noQuestions")}</p>
        ) : (
          questions.map((q, i) => (
            <ChoiceGroup key={q.id} legend={q.text} legendLang={questionTextLang}>
              {(Object.keys(ANSWER_LABELS) as Answer[]).map((value) => (
                <Pill
                  key={value}
                  name={`${uid}-q${i}`}
                  value={value}
                  checked={answers[q.id] === value}
                  onChange={() => setAnswer(q.id, value)}
                  label={t(ANSWER_LABELS[value])}
                />
              ))}
            </ChoiceGroup>
          ))
        )}
      </div>

      {/* Printed instead of the radio buttons, so the doctor sees what was chosen. */}
      <div className="print-only mt-4">
        <h3 className="text-lg font-semibold text-ink">{t("print.answers")}</h3>
        <dl className="mt-2 space-y-2">
          <PrintRow term={t("fit.age")} value={age !== undefined ? String(age) : t("print.notAnswered")} />
          {askSex && (
            <PrintRow term={t("fit.sex")} value={sex ? t(SEX_LABELS[sex]) : t("print.notAnswered")} />
          )}
          {askHealthy && (
            <PrintRow
              term={t("fit.healthy")}
              value={healthy ? t(ANSWER_LABELS[healthy]) : t("print.notAnswered")}
            />
          )}
          {questions.map((q) => (
            <PrintRow
              key={q.id}
              term={q.text}
              termLang={questionTextLang}
              value={answers[q.id] ? t(ANSWER_LABELS[answers[q.id]]) : t("print.notAnswered")}
            />
          ))}
        </dl>
      </div>

      <p role="status" aria-atomic="true" className="sr-only">
        {announced.text}
        {announced.text && announced.flip ? " " : ""}
      </p>

      <div className="mt-6">
        {showResult ? (
          <FitResult
            result={result}
            eligibility={eligibility}
            questions={questions}
            answers={answers}
            questionTextLang={questionTextLang}
            lang={lang}
            t={t}
          />
        ) : (
          <p className="no-print text-muted">
            {/* While questions load the total isn't known yet, so no count is shown. */}
            {status !== "loading" && total > 0
              ? t("fit.progress", { done, total })
              : t("fit.pending")}
          </p>
        )}
      </div>
    </section>
  );
}

function ChoiceGroup({
  legend,
  legendLang,
  children,
}: {
  legend: string;
  legendLang?: string;
  children: ReactNode;
}) {
  return (
    <fieldset>
      <legend className="font-medium text-ink" lang={legendLang}>
        {legend}
      </legend>
      <div className="mt-2 flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

function Pill({
  name,
  value,
  checked,
  onChange,
  label,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label className="inline-flex min-h-12 min-w-11 cursor-pointer items-center gap-2 rounded-full border border-line bg-card px-4 text-base text-ink has-checked:border-primary has-checked:font-semibold has-checked:ring-1 has-checked:ring-primary">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="h-5 w-5 shrink-0 accent-primary"
      />
      {label}
    </label>
  );
}

function PrintRow({ term, termLang, value }: { term: string; termLang?: string; value: string }) {
  return (
    <div>
      <dt className="font-medium text-ink" lang={termLang}>
        {term}
      </dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
