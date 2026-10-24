// The trial page's server component renders translated content BEFORE the first paint for
// non-English pages, and falls back to the English registry text (with the existing note) when
// the simplify service fails or runs past the simplify budget. The service is mocked: no
// network, no Bedrock. Heavy, unrelated sections (transit, contacts, results) are stubbed.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDictionary } from "@/lib/i18n";
import { getMockTrial } from "@/lib/mock/data";
import type { SimplifyServiceResult } from "@/lib/simplify-service";
import { SERVER_TOTAL_BUDGET_MS } from "@/lib/simplify-budget";

const mocks = vi.hoisted(() => ({
  simplifyTrial: vi.fn(),
  getTrial: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/root-params", () => ({ lang: async () => "es" }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/data", () => ({
  wantsMocks: (m?: string | string[]) => m === "1",
  getTrial: mocks.getTrial,
}));
vi.mock("@/lib/simplify-service", () => ({ simplifyTrial: mocks.simplifyTrial }));
vi.mock("@/components/GettingThere", () => ({ GettingThere: () => null }));
vi.mock("@/components/ContactCard", () => ({ ContactCard: () => null }));
vi.mock("@/components/StudyResults", () => ({ StudyResults: () => null }));

import TrialPage from "./page";

const NCT = "NCT07043426";
const hero = { ...getMockTrial(NCT)!, outcomes: { status: "not-checked" } };

const TRANSLATED_TITLE = "Programa THRIVE-DM para la diabetes tipo 2 en Boston Medical Center";
// Short sentences: copy-guard grades every string in app/**/*.tsx, tests included.
const TRANSLATED_SUMMARY = "Es un estudio sobre la diabetes tipo 2. Usted decide si quiere estar en él.";

function okBody(): SimplifyServiceResult {
  return {
    ok: true,
    body: {
      lang: "es",
      title: TRANSLATED_TITLE,
      summary: TRANSLATED_SUMMARY,
      whatItStudies: TRANSLATED_SUMMARY,
      whatYouDo: "Usted recibe llamadas del equipo del estudio.",
      timeCommitment: "Unos 6 meses.",
      staff_checks: [],
      questions: [],
      checklistReason: "unsupported-study",
    },
  };
}

// React escapes text, e.g. "'" becomes "&#x27;".
const escape = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");

type AsyncComponent = (props: unknown) => Promise<ReactElement>;

/** The page is <Suspense><Trial/></Suspense>; await the async Trial body and render it. */
function renderTrial(lang: string, searchParams: Record<string, string> = {}): Promise<string> {
  const props = {
    params: Promise.resolve({ lang, nct: NCT }),
    searchParams: Promise.resolve(searchParams),
  };
  const suspense = TrialPage(props as Parameters<typeof TrialPage>[0]) as ReactElement<{
    children: ReactElement<unknown, AsyncComponent>;
  }>;
  const trial = suspense.props.children;
  return trial.type(trial.props).then((tree) => renderToStaticMarkup(tree));
}

beforeEach(() => {
  mocks.getTrial.mockResolvedValue(hero);
  mocks.simplifyTrial.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("trial page, non-English: translated before render", () => {
  it("renders the translated title, the muted English title, and the labeled translated summary", async () => {
    mocks.simplifyTrial.mockResolvedValue(okBody());
    const html = await renderTrial("es");
    const es = getDictionary("es");

    expect(mocks.simplifyTrial).toHaveBeenCalledWith(NCT, "es");
    // Heading is the translated title (no lang="en" on it).
    expect(html).toMatch(new RegExp(`<h1 class="[^"]*">${escape(TRANSLATED_TITLE)}</h1>`));
    // The original English title, small and muted, right under it.
    expect(html).toContain(`<p class="mt-1 text-sm text-muted"><span class="sr-only">${escape(es["trial.auto.originalTitle"])} </span><span lang="en">${escape(hero.title)}</span></p>`);
    // The translated summary with its "Resumen automático" label.
    expect(html).toContain(escape(TRANSLATED_SUMMARY));
    expect(html).toContain("Resumen automático");
    // The toggle reveals the registry's own English summary.
    expect(html).toContain("<details");
    expect(html).toContain("Ver texto original en inglés");
    expect(html).toContain(`<p class="mt-2 whitespace-pre-line text-ink" lang="en">${escape(hero.briefSummary)}</p>`);
    // No loading skeleton and no English-fallback note: it is already translated.
    expect(html).not.toContain('aria-busy="true"');
    expect(html).not.toContain(escape(es["trial.plainUnavailable"]));
    // No checklist questions: the cautious "Not sure yet" path, never a possible fit.
    expect(html).not.toContain(escape(es["fit.possibleTitle"]));
  });

  it("falls back to the English title and summary with the existing note on timeout", async () => {
    vi.useFakeTimers();
    mocks.simplifyTrial.mockReturnValue(new Promise(() => {})); // never answers
    const pending = renderTrial("es");
    await vi.advanceTimersByTimeAsync(SERVER_TOTAL_BUDGET_MS);
    const html = await pending;
    const es = getDictionary("es");

    expect(html).toMatch(new RegExp(`<h1 class="[^"]*" lang="en">${escape(hero.title)}</h1>`));
    expect(html).toContain(escape(es["trial.plainUnavailable"]));
    expect(html).toContain(escape(hero.briefSummary));
    expect(html).not.toContain("Resumen automático");
    expect(html).not.toContain(TRANSLATED_TITLE);
  });

  it("falls back to English when the service fails", async () => {
    mocks.simplifyTrial.mockResolvedValue({ ok: false, status: 503, error: "x" });
    const html = await renderTrial("es");
    expect(html).toMatch(new RegExp(`<h1 class="[^"]*" lang="en">${escape(hero.title)}</h1>`));
    expect(html).toContain(escape(getDictionary("es")["trial.plainUnavailable"]));
  });
});

describe("trial page, English and mock: unchanged", () => {
  it("English renders the registry title and leaves the summary to the client fetch", async () => {
    const html = await renderTrial("en");
    expect(mocks.simplifyTrial).not.toHaveBeenCalled();
    expect(html).toMatch(new RegExp(`<h1 class="[^"]*">${escape(hero.title)}</h1>`));
    expect(html).toContain('aria-busy="true"'); // client loading state, as before
    expect(html).not.toContain("Automatic summary");
  });

  it("mock mode never calls the service", async () => {
    await renderTrial("es", { mock: "1" });
    expect(mocks.simplifyTrial).not.toHaveBeenCalled();
  });
});
