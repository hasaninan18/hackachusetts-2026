"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { getDictionary, isLang, translator } from "@/lib/i18n";

export default function NotFound() {
  const params = useParams<{ lang?: string }>();
  const raw = params?.lang;
  const lang = raw && isLang(raw) ? raw : "en";
  const t = translator(getDictionary(lang));

  return (
    <div>
      <h1 className="text-2xl font-bold leading-tight text-ink">{t("page.notFound")}</h1>
      <p className="mt-4">
        <Link
          href={`/${lang}`}
          className="inline-flex min-h-12 items-center font-semibold text-primary underline"
        >
          {t("nav.newSearch")}
        </Link>
      </p>
    </div>
  );
}
