import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getDictionary, translator } from "../lib/i18n";
import { ResultsCount } from "./ResultsCount";

const t = translator(getDictionary("en"));

function render(props: { shown: number; total: number; truncated?: boolean }) {
  return renderToStaticMarkup(<ResultsCount cond="flu" mi={25} t={t} {...props} />);
}

/** The text inside the role="status" region (the whole component is that region). */
function statusText(html: string): string {
  const m = html.match(/^<span role="status"[^>]*>([\s\S]*)<\/span>$/);
  expect(m, html).not.toBeNull();
  return m![1].replace(/<[^>]+>/g, "");
}

describe("ResultsCount", () => {
  it("gives the exact count when the whole list is shown", () => {
    expect(statusText(render({ shown: 70, total: 70 }))).toBe(
      "70 studies for &quot;flu&quot; within 25 miles",
    );
  });

  it("says the list is the closest ones, inside the status region", () => {
    const text = statusText(render({ shown: 200, total: 977 }));
    expect(text).toContain("977 studies for");
    expect(text).toContain("Showing the 200 closest.");
  });

  it("never claims an exact total or 'the closest' when the search was cut short", () => {
    const text = statusText(render({ shown: 200, total: 1609, truncated: true }));
    expect(text).toContain("At least 1609 studies for");
    expect(text).toContain("Showing 200 nearby.");
    expect(text).not.toContain("closest");
    expect(text).not.toMatch(/^1609 studies/);
  });

  it("says 'at least' even when every found study is listed but the search was cut short", () => {
    const text = statusText(render({ shown: 150, total: 150, truncated: true }));
    expect(text).toBe("At least 150 studies for &quot;flu&quot; within 25 miles");
  });
});
