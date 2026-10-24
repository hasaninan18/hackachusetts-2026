#!/usr/bin/env node
// copy-guard: enforces .kiro/steering/safety.md on user-facing copy.
// 1) Flags forbidden phrases (EN + ES + PT + HT + ZH) in any string literal.
// 2) Flags English copy above an 8th-grade reading level (Flesch–Kincaid).
//
// Usage:
//   node tests/copy-guard.mjs <file> [<file> ...]
//   echo '{"files":["lib/i18n/en.ts"]}' | node tests/copy-guard.mjs   # hook mode (JSON on stdin)
//
// Exit code 0 = clean, 2 = violation(s) found (so a PreToolUse/Post hook can block/flag).
// Dependency-free so it runs without node_modules.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";

// ---- Forbidden phrases (keep in sync with .kiro/steering/safety.md) ----
// Matched case-insensitively as substrings of the visible copy.
const FORBIDDEN = {
  en: [
    "you are eligible", "you're eligible", "you qualify", "you're a match",
    "you have been accepted", "you meet the criteria", "guaranteed",
    "approved for this trial", "you are a match",
  ],
  es: ["usted califica", "usted es elegible", "cumple los requisitos", "califica para"],
  pt: ["você se qualifica", "você é elegível", "atende aos critérios", "voce se qualifica"],
  ht: ["ou kalifye", "ou elijib"],
  zh: ["您符合条件", "您符合资格", "您合格"],
};
const ALL_FORBIDDEN = Object.entries(FORBIDDEN).flatMap(([lang, arr]) =>
  arr.map((p) => ({ lang, phrase: p }))
);

const READING_GRADE_MAX = 8;

// ---- Flesch–Kincaid Grade Level (approx; English) ----
function countSyllables(word) {
  word = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!word) return 0;
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = word.match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}
function readingGrade(text) {
  const clean = text.replace(/\{[^}]+\}/g, "word").trim(); // treat {placeholders} as a word
  if (!clean) return 0;
  const sentences = Math.max(1, (clean.match(/[.!?]+/g) || []).length);
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  const syllables = words.reduce((s, w) => s + countSyllables(w), 0);
  const grade = 0.39 * (words.length / sentences) + 11.8 * (syllables / words.length) - 15.59;
  return Math.round(grade * 10) / 10;
}

// Flesch–Kincaid is meaningless on short UI labels (a single long word dominates),
// so only grade real sentences: >= 8 words AND ends with sentence punctuation.
const MIN_WORDS_FOR_GRADING = 8;
function isGradableSentence(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length >= MIN_WORDS_FOR_GRADING && /[.!?]/.test(text);
}

// The disclaimer is fixed verbatim by safety.md §4 — exempt from reading-grade.
const EXEMPT_EXACT = new Set([
  "TrialPath is not medical advice. The study team decides eligibility.",
]);

// Looks like a Tailwind/CSS class list or other non-prose token soup, not UI copy.
// Heuristic: no sentence punctuation AND most "words" contain css-ish chars (-, :, /, digits)
// or are known utility prefixes. Such strings are skipped for reading-grade only.
function looksLikeCss(val) {
  if (/[.!?,](\s|$)/.test(val)) return false; // real sentences have punctuation
  const tokens = val.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return false;
  const cssish = tokens.filter((t) =>
    /[:/\[\]]|-\w|^\d|^(flex|grid|inline|items|justify|gap|rounded|border|bg|text|px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|w|h|min|max|font|leading|tracking|shadow|ring|hover|focus|sm|md|lg|xl)[-:]/.test(t)
  ).length;
  return cssish / tokens.length >= 0.5;
}

// Extract user-facing string literals. For .ts dictionary files we grab the
// right-hand side of `"...": "copy"` and plain string literals in TSX.
function extractStrings(src, file) {
  const out = [];
  // double- and single-quoted literals (no template-literal parsing needed for copy)
  const re = /(["'])((?:\\.|(?!\1).)*)\1/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const val = m[2].replace(/\\"/g, '"').replace(/\\'/g, "'");
    // skip obvious non-copy: import paths, keys, css-ish, short tokens
    if (/^[\w.\-@/]+$/.test(val)) continue;      // identifiers / paths / keys
    if (val.length < 3) continue;
    out.push({ val, isCss: looksLikeCss(val) });
  }
  return out;
}

function checkFile(file) {
  const violations = [];
  if (!existsSync(file)) return violations;
  const src = readFileSync(file, "utf8");
  const strings = extractStrings(src, file);
  const isEnglish = /(^|\/)en\.ts$/.test(file) || /i18n\/en/.test(file) || !/i18n\//.test(file);

  for (const { val, isCss } of strings) {
    const lower = val.toLowerCase();
    // Forbidden-phrase check runs on EVERY string (cheap, no false positives on css).
    for (const { lang, phrase } of ALL_FORBIDDEN) {
      if (lower.includes(phrase.toLowerCase())) {
        violations.push({ file, type: "forbidden-phrase", lang, phrase, text: val });
      }
    }
    // Reading-grade only on English prose: skip css/class strings and non-sentences.
    if (isEnglish && !isCss && !EXEMPT_EXACT.has(val.trim()) && isGradableSentence(val)) {
      const grade = readingGrade(val);
      if (grade > READING_GRADE_MAX) {
        violations.push({ file, type: "reading-grade", grade, max: READING_GRADE_MAX, text: val });
      }
    }
  }
  return violations;
}

// ---- Collect files from argv or JSON stdin (hook mode) ----
function filesFromStdin() {
  // Only read stdin when it's piped (a hook pipes JSON). On an interactive TTY
  // readFileSync(0) would block forever, so skip it and fall back to a default scan.
  if (process.stdin.isTTY) return [];
  try {
    const raw = readFileSync(0, "utf8").trim();
    if (!raw) return [];
    const json = JSON.parse(raw);
    const f = json.filePath || json.file || (json.files ?? []);
    return Array.isArray(f) ? f : [f].filter(Boolean);
  } catch {
    return [];
  }
}

// Default scan targets when the hook sends no file (prevents a silent pass):
// every copy-bearing file under lib/i18n/, components/, and app/**/*.tsx.
function walk(dir, test, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = `${dir}/${name}`;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, test, acc);
    else if (test(p)) acc.push(p);
  }
  return acc;
}
function defaultScan() {
  return [
    ...walk("lib/i18n", (p) => p.endsWith(".ts")),
    ...walk("components", (p) => p.endsWith(".tsx") || p.endsWith(".ts")),
    ...walk("app", (p) => p.endsWith(".tsx")),
  ];
}

const args = process.argv.slice(2);
let files = args.length ? args : filesFromStdin();

// No file from args and none on stdin -> scan everything by default.
// Never exit 0 "clean" just because no file name was passed.
if (files.length === 0) {
  files = defaultScan();
  if (files.length === 0) {
    console.error("copy-guard: no files given and no copy files found to scan");
    process.exit(2);
  }
  console.log(`copy-guard: no file arg; scanning ${files.length} copy file(s) by default`);
}

let all = [];
for (const f of files) all = all.concat(checkFile(f));

if (all.length === 0) {
  console.log(`copy-guard: OK (${files.length} file(s) checked, no violations)`);
  process.exit(0);
}

console.error(`copy-guard: ${all.length} violation(s) found:\n`);
for (const v of all) {
  if (v.type === "forbidden-phrase") {
    console.error(`  [forbidden:${v.lang}] "${v.phrase}" in ${v.file}\n      -> ${v.text}`);
  } else {
    console.error(`  [reading-grade ${v.grade} > ${v.max}] ${v.file}\n      -> ${v.text}`);
  }
}
console.error("\nSee .kiro/steering/safety.md. Fix the copy before committing.");
process.exit(2);
