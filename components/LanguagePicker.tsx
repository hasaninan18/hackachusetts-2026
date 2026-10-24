"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId } from "react";
import { LANG_NAMES } from "@/lib/i18n";
import { LANGS, type Lang } from "@/lib/types";

export function LanguagePicker({ lang, label }: { lang: Lang; label: string }) {
  const id = useId();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function change(next: Lang) {
    // Swap only the first path segment so /es/trial/NCT… becomes /pt/trial/NCT… and the query survives.
    const rest = pathname.split("/").slice(2).join("/");
    const query = searchParams.toString();
    router.push(`/${next}${rest ? `/${rest}` : ""}${query ? `?${query}` : ""}`);
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <span aria-hidden="true" className="text-muted">
        🌐
      </span>
      <select
        id={id}
        value={lang}
        onChange={(e) => change(e.target.value as Lang)}
        className="min-h-11 rounded-md border border-line bg-card px-2 text-base text-ink"
      >
        {LANGS.map((l) => (
          <option key={l} value={l} lang={l}>
            {LANG_NAMES[l]}
          </option>
        ))}
      </select>
    </div>
  );
}
