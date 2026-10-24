// Fixtures for building the UI before the API lands, and the fallback if it fails during the demo.
// Trial text, eligibility and contacts are copied from ClinicalTrials.gov API v2 (fetched 2026-10-24).
// Site coordinates are the real buildings (the API only gives the Boston city centroid).
// Stops, lines and wheelchair flags come from MBTA V3 /stops and /routes; walkMi is straight-line.
// Search origin for distances: ZIP 02124 (Dorchester) centroid 42.2859,-71.0750 (Census 2024 Gazetteer, lib/ma-zips.json).

import type { TrialDetail } from "../types";

const GREEN = "#00843D";
const RED = "#DA291C";
const BUS = "#FFC72C";
const SILVER = "#7C878E";

export const mockTrials: TrialDetail[] = [
  // HERO (docs/DEMO_DATA.md): THRIVE-DM at Boston Medical Center. Record re-fetched from
  // ClinicalTrials.gov v2 on 2026-10-24 (NA phase, 18+ with no maximum, ALL sexes, no healthy
  // volunteers). Site uses the DEMO_DATA "Use" coordinates for BMC. Stops re-checked against
  // MBTA V3 on 2026-10-24: the two closest bus stops plus the closest Silver Line stop, as in
  // DEMO_DATA's "Bus at the door; Silver Line 0.2 mi" story (other bus stops at 0.08-0.12 mi
  // are left out). walkMi is straight-line miles from the BMC point.
  {
    nctId: "NCT07043426",
    title:
      "Improving Diabetes Care With Strategies For Addressing Health-Related Social Needs and Community Partnerships",
    conditions: ["Diabetes Mellitus, Type 2"],
    phase: null,
    nearestSite: {
      name: "Boston Medical Center",
      city: "Boston",
      zip: "02118",
      lat: 42.335,
      lon: -71.0728,
      locationPrecision: "facility",
    },
    distanceMi: 3.39,
    briefSummary:
      "The goal of this study is to develop, implement, and evaluate a patient-centered triage and referral model designed to improve health outcomes for individuals with uncontrolled type 2 diabetes mellitus (T2DM) and unmet health-related social needs. The intervention builds on the existing THRIVE infrastructure at Boston Medical Center (BMC), which includes screening for social needs and a resource referral guide. It integrates medical and social care by embedding a data-driven triage tool within the EPIC electronic health record system, engaging community health workers trained in population health, and initiating closed-loop EPIC integrated referrals to community-based organizations.\n\nThis study will use a hybrid type 3 effectiveness-implementation trial design to evaluate the implementation of the THRIVE-DM intervention at the clinic level. Preliminary effectiveness will be assessed by comparing THRIVE-DM to usual care in its ability to increase patient connections to community-based organizations and improve clinical outcomes. Using a stratified randomization approach, the investigators will compare referral closure rates, receipt of social services, hemoglobin A1C levels, and patterns of health service utilization between patients enrolled in THRIVE-DM and those receiving standard care",
    eligibility: {
      minAgeYears: 18,
      maxAgeYears: null,
      sex: "ALL",
      healthyVolunteers: false,
      criteriaText:
        "Inclusion Criteria:\n\n* Diagnosis: Must have a diagnosis of Type 2 Diabetes Mellitus (T2DM), confirmed by a current diagnosis in the medical record or at least two billing codes in the last two years, or an HbA1c level ≥6.5% in the last two years.\n* Uncontrolled T2DM: Must have an HbA1c ≥9% at the time of screening.\n* Health-Related Social Needs: Must have been screened for health related social needs (HRSNs) during a General Internal Medicine (GIM) visit in the last 3 months and screened positive for at least one HRSN.\n\nExclusion Criteria:\n\n* Patients enrolled in Complex Care Management (CCM).\n* Patients receiving hospice care.\n* Patients who are deceased\n* Patients with Type 1 Diabetes Mellitus (T1DM).",
    },
    sites: [
      {
        name: "Boston Medical Center",
        city: "Boston",
        zip: "02118",
        lat: 42.335,
        lon: -71.0728,
        locationPrecision: "facility",
      },
    ],
    contacts: [
      { name: "Michael Fischer, MD", phone: "617-414-7288", email: "Michael.Fischer@bmc.org" },
      { name: "Uma Khemraj, MS", phone: "617-414-7288", email: "Uma.Khemraj@bmc.org" },
    ],
    stops: [
      {
        id: "5089",
        name: "91 E Concord St",
        routeType: 3,
        lines: [
          { name: "Bus CT3", color: BUS },
          { name: "Bus 8", color: BUS },
          { name: "Bus 10", color: BUS },
          { name: "Bus 171", color: BUS },
        ],
        wheelchair: true,
        walkMi: 0.047,
      },
      {
        id: "10014",
        name: "Albany St opp Boston Medical",
        routeType: 3,
        lines: [
          { name: "Bus CT3", color: BUS },
          { name: "Bus 8", color: BUS },
          { name: "Bus 10", color: BUS },
          { name: "Bus 47", color: BUS },
        ],
        wheelchair: true,
        walkMi: 0.063,
      },
      {
        id: "1787",
        name: "Washington St @ Worcester St",
        routeType: 3,
        lines: [
          { name: "Silver Line SL4", color: SILVER },
          { name: "Silver Line SL5", color: SILVER },
          { name: "Bus 8", color: BUS },
          { name: "Bus 15", color: BUS },
        ],
        wheelchair: true,
        walkMi: 0.222,
      },
    ],
  },
  {
    nctId: "NCT06138821",
    title:
      "Effect of Endoscopic Sleeve Gastroplasty in Patients With Obesity and MASH: A Randomized Controlled Trial",
    conditions: ["Obesity", "MASH", "Diabetes Mellitus, Type 2"],
    phase: null,
    nearestSite: {
      name: "Brigham and Women's Hospital",
      city: "Boston",
      zip: "02115",
      lat: 42.3359,
      lon: -71.1065,
      locationPrecision: "facility",
    },
    distanceMi: 3.81,
    briefSummary:
      "Metabolic dysfunction-associated steatotic liver disease (MASLD) is the most common chronic liver disease globally. While weight loss through lifestyle modification is the standard treatment, most patients regain weight limiting ultimate improvement in liver disease. [...] In this study, the investigators will compare ESG + lifestyle modification versus lifestyle modification alone in treating histologic MASH. The study will randomize patients to one of two different treatment options: ESG + lifestyle modification or lifestyle modification alone.",
    eligibility: {
      minAgeYears: 18,
      maxAgeYears: null,
      sex: "ALL",
      healthyVolunteers: false,
      criteriaText:
        "Inclusion Criteria:\n\n1. Age ≥ 18 (male or female)\n2. BMI ≥30 kg/m2 or ≥27 kg/m2 with at least one obesity-related comorbidity\n3. Self-reported stable weight (no weight change >5%) for 6 months prior to the first study visit\n[...]\n\nExclusion Criteria:\n\n1. Known history of other chronic liver diseases (viral hepatitis, autoimmune hepatitis, drug-induced hepatitis, and genetic)\n4. Prior bariatric surgery\n15. Insulin-dependent diabetes (either type 1 or type 2) or a significant likelihood of requiring insulin treatment in the following 12 months or HgbA1C ≥ 12%\n19. Patients who are pregnant or breastfeeding\n21. Active smoking\n[...]",
    },
    sites: [
      {
        name: "Brigham and Women's Hospital",
        city: "Boston",
        zip: "02115",
        lat: 42.3359,
        lon: -71.1065,
        locationPrecision: "facility",
      },
    ],
    contacts: [
      { name: "Michele B. Ryan, MS", phone: "617-525-8266", email: "mryan@bwh.harvard.edu" },
    ],
    stops: [
      {
        id: "place-brmnl",
        name: "Brigham Circle",
        routeType: 0,
        lines: [{ name: "Green Line E", color: GREEN }],
        wheelchair: true,
        walkMi: 0.15,
      },
      {
        id: "place-fenwd",
        name: "Fenwood Road",
        routeType: 0,
        lines: [{ name: "Green Line E", color: GREEN }],
        wheelchair: false,
        walkMi: 0.16,
      },
    ],
  },
  {
    nctId: "NCT05799222",
    title:
      "Medically Intensive Nutrition Therapy Program for Obesity and Diabetes in a Low-income Population",
    conditions: ["Overweight", "PreDiabetes", "Diabetes Type 2", "Obesity"],
    phase: null,
    nearestSite: {
      name: "Massachusetts General Hospital",
      city: "Boston",
      zip: "02114",
      lat: 42.3626,
      lon: -71.0686,
      locationPrecision: "facility",
    },
    distanceMi: 5.31,
    briefSummary:
      "This study is being done to better understand whether meal replacements can be an effective tool for weight loss and treatment of elevated blood sugars in people with obesity/overweight and diabetes/pre-diabetes who have a low income.",
    eligibility: {
      minAgeYears: 18,
      maxAgeYears: 65,
      sex: "ALL",
      healthyVolunteers: false,
      criteriaText:
        "Inclusion Criteria:\n\n* Age 18-65\n* Body mass index (BMI) greater than or equal to 27 kg/m^2\n* HgA1C greater than or equal to 5.7 percent or fasting glucose greater than or equal to 100mg/dL within the previous 6 months\n* Low-income as defined by having a family income at or below 400 percent of the federal poverty level guidelines for 2022\n\nExclusion Criteria:\n\n* Current use of antihyperglycemic agents (other than metformin) or approved anti- obesity medications or plans to start such regimens over the 3 months post-study enrollment\n* HbA1c greater than or equal to 10 percent\n* Plans to pursue bariatric surgery over the 6 months post-study enrollment\n* Weight loss of greater than 5 kg within the previous 3 months\n* Current active eating disorder, with the exception of binge eating disorder\n* Severe active psychiatric disease or significant cognitive impairment deemed by investigator likely to impede adherence to piloted intervention\n* Active illicit substance abuse\n* Pregnant, breastfeeding, or considering pregnancy within the next 6 months\n* Current participation in another clinical research trial deemed by investigator to conflict with current study",
    },
    sites: [
      {
        name: "Massachusetts General Hospital",
        city: "Boston",
        zip: "02114",
        lat: 42.3626,
        lon: -71.0686,
        locationPrecision: "facility",
      },
    ],
    contacts: [
      { name: "Chika V Anekwe, MD", phone: "617-726-4400", email: "canekwe@mgh.harvard.edu" },
    ],
    stops: [
      {
        id: "place-chmnl",
        name: "Charles/MGH",
        routeType: 1,
        lines: [{ name: "Red Line", color: RED }],
        wheelchair: true,
        walkMi: 0.14,
      },
      {
        id: "place-spmnl",
        name: "Science Park/West End",
        routeType: 0,
        lines: [
          { name: "Green Line D", color: GREEN },
          { name: "Green Line E", color: GREEN },
        ],
        wheelchair: true,
        walkMi: 0.28,
      },
    ],
  },
];

export function getMockTrial(nctId: string): TrialDetail | undefined {
  return mockTrials.find((t) => t.nctId === nctId);
}
