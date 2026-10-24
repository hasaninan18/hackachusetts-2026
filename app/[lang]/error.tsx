"use client"; // Error boundaries must be Client Components

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { getDictionary, isLang, translator } from "@/lib/i18n";

// Catches unexpected errors in any page under [lang] (the layout above stays on screen).
// Next 16 passes `retry`, which re-fetches and re-renders the segment (error.md).
export default function LangError({ error, retry }: { error: unknown; retry: () => void }) {
  const params = useParams<{ lang?: string }>();
  const raw = params?.lang;
  const lang = raw && isLang(raw) ? raw : "en";
  const t = translator(getDictionary(lang));

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div>
      <h1 className="text-2xl font-bold leading-tight text-ink">{t("page.error")}</h1>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="inline-flex min-h-12 items-center justify-center rounded-lg bg-primary px-5 text-base font-medium text-white hover:bg-primary-hover"
        >
          {t("results.retry")}
        </button>
        <Link
          href={`/${lang}`}
          className="inline-flex min-h-12 items-center justify-center rounded-lg border border-line bg-card px-5 text-base font-medium text-ink"
        >
          {t("nav.newSearch")}
        </Link>
      </div>
    </div>
  );
}
