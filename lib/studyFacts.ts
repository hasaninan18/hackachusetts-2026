import type { StudyArm, StudyDate, StudyFacts } from "./types";

// Turns a ClinicalTrials.gov API v2 study (the object with `protocolSection`) into StudyFacts.
// Pure and defensive: every field may be missing in real records. Needs these API fields:
// StatusModule, SponsorCollaboratorsModule, DesignModule, ArmsInterventionsModule, OutcomesModule.

type Json = Record<string, unknown>;

const ARM_TYPES = new Set([
  "EXPERIMENTAL",
  "ACTIVE_COMPARATOR",
  "PLACEBO_COMPARATOR",
  "SHAM_COMPARATOR",
  "NO_INTERVENTION",
  "OTHER",
]);
const MASKING = new Set(["NONE", "SINGLE", "DOUBLE", "TRIPLE", "QUADRUPLE"]);
const STUDY_TYPES = new Set(["INTERVENTIONAL", "OBSERVATIONAL", "EXPANDED_ACCESS"]);

const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function date(v: unknown): StudyDate | null {
  const d = obj(v);
  const value = str(d.date);
  if (!value || !/^\d{4}-\d{2}(-\d{2})?$/.test(value)) return null;
  return { date: value, estimated: d.type !== "ACTUAL" };
}

export function extractStudyFacts(study: unknown): StudyFacts {
  const p = obj(obj(study).protocolSection);
  const status = obj(p.statusModule);
  const design = obj(p.designModule);
  const designInfo = obj(design.designInfo);
  const armsMod = obj(p.armsInterventionsModule);
  const outcomes = obj(p.outcomesModule);
  const sponsors = obj(p.sponsorCollaboratorsModule);

  const studyType = str(design.studyType);
  const allocation = str(designInfo.allocation);
  const masking = str(obj(designInfo.maskingInfo).masking);

  const arms: StudyArm[] = arr(armsMod.armGroups).flatMap((g) => {
    const a = obj(g);
    const label = str(a.label);
    if (!label) return [];
    const type = str(a.type);
    return [
      {
        label,
        type: type && ARM_TYPES.has(type) ? (type as StudyArm["type"]) : null,
        description: str(a.description) ?? "",
      },
    ];
  });

  const interventions = arr(armsMod.interventions).map(obj);
  const interventionNames = interventions.flatMap((iv) => {
    const name = str(iv.name);
    if (!name) return [];
    const type = str(iv.type);
    return [type ? `${sentenceCase(type)}: ${name}` : name];
  });

  const hasPlacebo =
    arms.some((a) => a.type === "PLACEBO_COMPARATOR") ||
    interventions.some((iv) => /placebo/i.test(str(iv.name) ?? ""));

  const enrollment = obj(design.enrollmentInfo);
  const count = typeof enrollment.count === "number" && enrollment.count > 0 ? enrollment.count : null;

  return {
    studyType: studyType && STUDY_TYPES.has(studyType) ? (studyType as StudyFacts["studyType"]) : null,
    randomized: allocation === "RANDOMIZED" ? true : allocation === "NON_RANDOMIZED" ? false : null,
    masking: masking && MASKING.has(masking) ? (masking as StudyFacts["masking"]) : null,
    hasPlacebo,
    arms,
    interventions: interventionNames,
    primaryOutcomes: arr(outcomes.primaryOutcomes).flatMap((o) => {
      const measure = str(obj(o).measure);
      return measure ? [{ measure, timeFrame: str(obj(o).timeFrame) ?? "" }] : [];
    }),
    secondaryOutcomeCount: arr(outcomes.secondaryOutcomes).length,
    enrollment: count ? { count, estimated: enrollment.type !== "ACTUAL" } : null,
    start: date(status.startDateStruct),
    completion: date(status.completionDateStruct) ?? date(status.primaryCompletionDateStruct),
    lastUpdated: str(obj(status.lastUpdatePostDateStruct).date),
    sponsor: str(obj(sponsors.leadSponsor).name),
    collaborators: arr(sponsors.collaborators).flatMap((c) => {
      const name = str(obj(c).name);
      return name ? [{ name, industry: obj(c).class === "INDUSTRY" }] : [];
    }),
  };
}

// "DIETARY_SUPPLEMENT" → "Dietary supplement"
function sentenceCase(enumValue: string): string {
  const words = enumValue.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
