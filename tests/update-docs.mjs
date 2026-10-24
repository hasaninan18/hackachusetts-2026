#!/usr/bin/env node
// update-docs (manual hook): appends a dated entry to KIRO_LOG.md and refreshes
// the README "How we used Kiro" section from the log's one-line summaries.
//
// Usage: node tests/update-docs.mjs ["note to append"]
// Dependency-free.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const root = process.cwd();
const logPath = `${root}/KIRO_LOG.md`;
const readmePath = `${root}/README.md`;

const note = process.argv.slice(2).join(" ").trim() || "update-docs hook run";
const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");

// 1) Append a dated entry under the "## Kiro tools / Crew / Powers" section (or at end).
if (existsSync(logPath)) {
  let log = readFileSync(logPath, "utf8");
  const entry = `- [${stamp} UTC] docs — ${note}\n`;
  const marker = "## Kiro tools / Crew / Powers";
  if (log.includes(marker)) {
    log = log.replace(marker, `${marker}\n${entry}`);
  } else {
    log = log.trimEnd() + "\n" + entry;
  }
  writeFileSync(logPath, log);
  console.log(`update-docs: appended entry to KIRO_LOG.md`);
} else {
  console.error("update-docs: KIRO_LOG.md not found");
}

// 2) Refresh README "How we used Kiro" from the log's bullet lines.
if (existsSync(logPath) && existsSync(readmePath)) {
  const log = readFileSync(logPath, "utf8");
  const bullets = log
    .split("\n")
    .filter((l) => l.trim().startsWith("- ["))
    .slice(0, 20)
    .join("\n");
  let readme = readFileSync(readmePath, "utf8");
  const start = "## How we used Kiro";
  const block = `${start}\nHighlights pulled from \`KIRO_LOG.md\` (full log in repo):\n\n${bullets}\n`;
  if (readme.includes(start)) {
    // replace from the heading to the next "## " or the disclaimer quote
    const re = new RegExp(`## How we used Kiro[\\s\\S]*?(?=\\n## |\\n> )`, "m");
    readme = readme.replace(re, block + "\n");
  } else {
    readme = readme.trimEnd() + "\n\n" + block + "\n";
  }
  writeFileSync(readmePath, readme);
  console.log("update-docs: refreshed README 'How we used Kiro' section");
} else {
  console.error("update-docs: README.md or KIRO_LOG.md not found");
}
