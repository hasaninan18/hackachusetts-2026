import type { Metadata } from "next";
import "@fontsource-variable/noto-sans";
import "@fontsource-variable/noto-sans-sc";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LanguagePicker } from "@/components/LanguagePicker";
import { getDictionary, HTML_LANG, isLang, translator } from "@/lib/i18n";
import { LANGS } from "@/lib/types";
import "../globals.css";

export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  const { lang } = await params;
  const l = isLang(lang) ? lang : "en";
  const t = translator(getDictionary(l));
  return {
    title: { default: "TrialPath MA", template: "%s · TrialPath MA" },
    description: t("meta.description"),
  };
}

export async function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

export default async function RootLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const t = translator(getDictionary(lang));

  return (
    <html lang={HTML_LANG[lang]}>
      <body className="min-h-dvh font-sans antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:bg-card focus:px-4 focus:py-2"
        >
          {t("skip")}
        </a>
        <header className="no-print border-b border-line bg-card">
          <div className="mx-auto max-w-[640px] px-4 py-2">
            <a
              href={`/${lang}`}
              className="inline-flex min-h-11 items-center text-lg font-bold text-ink no-underline"
            >
              {t("app.name")}
            </a>
            <Suspense fallback={<div className="h-11" />}>
              <LanguagePicker lang={lang} label={t("lang.label")} />
            </Suspense>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-[640px] px-4 py-6">
          {children}
        </main>
        <footer className="mx-auto max-w-[640px] border-t border-line px-4 py-6 text-sm text-muted">
          {t("disclaimer")}
        </footer>
      </body>
    </html>
  );
}
