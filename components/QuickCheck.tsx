"use client";

import { useId, useState, type ReactNode } from "react";
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
  const [sex, setSex] = useState<SexChoice | null>(null);
  const [healthy, setHealthy] = useState<HealthyChoice | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});

  const askSex = eligibility.sex !== "ALL";
  const askHealthy = eligibility.healthyVolunteers === false;

  const age = parseAge(ageText);
  const profile: Profile = {
    age,
    sex: askSex && (sex === "FEMALE" || sex === "MALE") ? sex : undefined,
    // "No, I don't have the condition" = healthy volunteer. "Not sure" leaves it unknown.
    healthy: !askHealthy || healthy === null || healthy === "unsure" ? undefined : healthy === "no",
  };
  const result = quickCheck(profile, eligibility, questions, answers);
  const hasAnswered =
    age !== undefined ||
    (askSex && sex !== null) ||
    (askHealthy && healthy !== null) ||
    questions.some((q) => answers[q.id] !== undefined);

  const questionTextLang = questionsLang !== lang ? HTML_LANG[questionsLang] : undefined;

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
            type="number"
            inputMode="numeric"
            min={0}
            max={120}
            step={1}
            autoComplete="off"
            value={ageText}
            onChange={(e) => setAgeText(e.target.value)}
            className="mt-2 block min-h-12 w-32 rounded-lg border border-line bg-card px-3 text-base text-ink"
          />
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
          <div aria-busy="true">
            <p role="status" className="text-muted">
              {t("fit.questionsLoading")}
            </p>
            {[0, 1, 2].map((i) => (
              <div key={i} className="mt-4" aria-hidden="true">
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
                  onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: value }))}
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

      <div className="mt-6" aria-live="polite">
        {hasAnswered ? (
          <FitResult result={result} eligibility={eligibility} questions={questions} t={t} />
        ) : (
          <p className="no-print text-muted">{t("fit.pending")}</p>
        )}
      </div>
    </section>
  );
}

// Empty, partial or out-of-range input counts as "not answered", never as a mismatch.
function parseAge(text: string): number | undefined {
  if (text.trim() === "") return undefined;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 && n <= 120 ? n : undefined;
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
