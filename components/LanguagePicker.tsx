"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { HTML_LANG, LANG_NAMES } from "@/lib/i18n";
import { LANGS, type Lang } from "@/lib/types";

export function LanguagePicker({ lang, label }: { lang: Lang; label: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Swap only the first path segment so /es/trial/NCT… becomes /pt/trial/NCT… and the query survives.
  const rest = pathname.split("/").slice(2).join("/");
  const query = searchParams.toString();
  const hrefFor = (next: Lang) =>
    `/${next}${rest ? `/${rest}` : ""}${query ? `?${query}` : ""}`;

  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-x-1 gap-y-0">
        {LANGS.map((l) => {
          const current = l === lang;
          return (
            <li key={l}>
              <Link
                href={hrefFor(l)}
                lang={HTML_LANG[l]}
                hrefLang={HTML_LANG[l]}
                aria-current={current ? "true" : undefined}
                className={`inline-flex min-h-11 items-center px-2 text-base text-ink ${
                  current ? "font-bold underline" : "no-underline hover:underline"
                }`}
              >
                {LANG_NAMES[l]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
