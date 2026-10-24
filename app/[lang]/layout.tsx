import type { Metadata } from "next";
import { Noto_Sans, Noto_Sans_SC } from "next/font/google";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { LanguagePicker } from "@/components/LanguagePicker";
import { getDictionary, HTML_LANG, isLang, translator } from "@/lib/i18n";
import { LANGS } from "@/lib/types";
import "../globals.css";

const noto = Noto_Sans({
  variable: "--font-noto",
  subsets: ["latin", "latin-ext", "vietnamese"],
  display: "swap",
});

// Large CJK font: not preloaded, so only Chinese pages download the glyphs they use.
const notoSc = Noto_Sans_SC({
  variable: "--font-noto-sc",
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "TrialPath MA",
  description: "Find a recruiting clinical study in Massachusetts, in plain language, and how to get there by the T.",
};

export async function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

export default async function RootLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const t = translator(getDictionary(lang));

  return (
    <html lang={HTML_LANG[lang]} className={`${noto.variable} ${notoSc.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:bg-card focus:px-4 focus:py-2"
        >
          {t("skip")}
        </a>
        <header className="no-print border-b border-line bg-card">
          <div className="mx-auto flex max-w-[640px] items-center justify-between gap-4 px-4 py-3">
            <a href={`/${lang}`} className="text-lg font-bold text-ink no-underline">
              {t("app.name")}
            </a>
            <Suspense fallback={<div className="h-11 w-36" />}>
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
