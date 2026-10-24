import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDictionary } from "../lib/i18n";
import type { TitleTranslation } from "../lib/translate-titles-client";
import type { Lang, TrialSummary } from "../lib/types";
import { ResultsList, englishNoteVisible } from "./ResultsList";
import { TrialListItem } from "./TrialListItem";

const TRIALS: TrialSummary[] = [
  {
    nctId: "NCT07351045",
    title: "A Study of Enicepatide (RO7795068) in Obesity",
    conditions: ["Obesity", "Overweight", "Third"],
    phase: "Phase 3",
    nearestSite: { name: "MGH", city: "Boston", lat: 42.36, lon: -71.07, locationPrecision: "facility" },
    distanceMi: 2.3,
  },
  {
    nctId: "NCT07392190",
    title: "A Study of Eloralintide (LY3841136)",
    conditions: [],
    phase: null,
    nearestSite: { name: "BMC", city: "Boston", lat: 42.33, lon: -71.07, locationPrecision: "facility" },
    distanceMi: 3.1,
  },
];
const search = { cond: "obesidad", lat: 42.3, lon: -71.06, radius: 10 };

function renderList(lang: Lang) {
  return renderToStaticMarkup(
    <ResultsList trials={TRIALS} lang={lang} dict={getDictionary(lang)} search={search} mock={false} />,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("ResultsList renders the English list without waiting for translations", () => {
  it.each(["es", "pt", "ht", "zh", "vi"] as const)("%s: first render is the full English list + note", (lang) => {
    const fetchSpy = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchSpy);
    const html = renderList(lang);
    for (const t of TRIALS) expect(html).toContain(t.title.replace(/[()]/g, (c) => c));
    expect(html).toContain(getDictionary(lang)["results.englishNote"]);
    expect(html).not.toContain(getDictionary(lang)["results.machineTranslated"]);
    // Server/first render never calls the API (effects run only in the browser).
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("en: no note, no label", () => {
    const html = renderList("en");
    expect(html).not.toContain(getDictionary("en")["results.englishNote"]);
    expect(html).not.toContain("Machine translation");
  });

  it("englishNoteVisible: shown while any study is still English, hidden when all are translated", () => {
    const one = new Map<string, TitleTranslation>([["NCT07351045", { title: "x", conditions: ["y", "z"] }]]);
    const all = new Map(one).set("NCT07392190", { title: "w", conditions: [] });
    expect(englishNoteVisible("es", TRIALS, new Map())).toBe(true);
    expect(englishNoteVisible("es", TRIALS, one)).toBe(true);
    expect(englishNoteVisible("es", TRIALS, all)).toBe(false);
    expect(englishNoteVisible("en", TRIALS, new Map())).toBe(false);
  });
});

describe("TrialListItem with a translation", () => {
  const render = (lang: Lang, translation?: TitleTranslation) =>
    renderToStaticMarkup(
      <TrialListItem trial={TRIALS[0]} lang={lang} dict={getDictionary(lang)} search={search} mock={false} translation={translation} />,
    );

  it("shows the translated title, then the English original (lang=en, muted), and the label", () => {
    const html = render("es", { title: "Un estudio de enicepatida (RO7795068) en la obesidad", conditions: ["Obesidad", "Sobrepeso"] });
    const translated = html.indexOf("Un estudio de enicepatida");
    const original = html.indexOf("A Study of Enicepatide");
    expect(translated).toBeGreaterThan(-1);
    expect(original).toBeGreaterThan(translated);
    expect(html).toMatch(/<span lang="en" class="[^"]*text-muted[^"]*">.*A Study of Enicepatide/);
    expect(html).toContain("Traducción automática");
    expect(html).toContain("Obesidad · Sobrepeso");
    expect(html).not.toContain("Obesity · Overweight");
  });

  it("without a translation it is the English item, tagged lang=en", () => {
    const html = render("zh");
    expect(html).toContain('<h2 lang="en"');
    expect(html).toContain("Obesity · Overweight");
    expect(html).not.toContain("Third");
    expect(html).not.toContain("机器翻译");
  });

  it("each language has its own label", () => {
    const labels: Record<string, string> = {
      es: "Traducción automática",
      pt: "Tradução automática",
      ht: "Tradiksyon otomatik",
      zh: "机器翻译",
      vi: "Bản dịch máy",
    };
    for (const [lang, label] of Object.entries(labels)) {
      expect(render(lang as Lang, { title: "T", conditions: ["c", "d"] })).toContain(label);
    }
  });
});
