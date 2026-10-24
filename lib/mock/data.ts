// Fixtures for building the UI before the API lands, and the fallback if it fails during the demo.
// Trial text, eligibility and contacts are copied from ClinicalTrials.gov API v2 (fetched 2026-10-24).
// Site coordinates are the real buildings (the API only gives the Boston city centroid).
// Stops, lines and wheelchair flags come from MBTA V3 /stops and /routes; walkMi is straight-line.
// Search origin for distances: ZIP 02124 (Dorchester) centroid 42.2859,-71.0750 (Census 2024 Gazetteer, lib/ma-zips.json).

import type { TrialDetail } from "../types";

const GREEN = "#00843D";
const RED = "#DA291C";

export const mockTrials: TrialDetail[] = [
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
