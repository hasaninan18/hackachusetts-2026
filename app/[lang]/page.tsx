import { notFound } from "next/navigation";
import { SearchForm } from "@/components/SearchForm";
import { getDictionary, isLang, translator } from "@/lib/i18n";

export default async function SearchPage({ params }: PageProps<"/[lang]">) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  const dict = getDictionary(lang);
  const t = translator(dict);

  return (
    <div>
      <h1 className="text-2xl font-bold leading-tight text-ink">{t("search.heading")}</h1>
      <p className="mt-2 text-muted">{t("app.tagline")}</p>
      <div className="mt-6">
        <SearchForm lang={lang} dict={dict} />
      </div>
    </div>
  );
}
