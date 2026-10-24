import { LANGS, type Lang } from "../types";
import { en, type Dictionary, type MessageKey } from "./en";
import { dictionaries } from "./dictionaries";

export type { Dictionary, MessageKey };

export const LANG_NAMES: Record<Lang, string> = {
  en: "English",
  es: "Español",
  pt: "Português",
  ht: "Kreyòl ayisyen",
  zh: "中文",
  vi: "Tiếng Việt",
};

// BCP 47 tags for <html lang>. Chinese is Simplified (zh-Hans); Boston's Chinese-speaking
// community reads both, so revisit if the team switches to Traditional.
export const HTML_LANG: Record<Lang, string> = {
  en: "en",
  es: "es",
  pt: "pt",
  ht: "ht",
  zh: "zh-Hans",
  vi: "vi",
};

export function isLang(value: string): value is Lang {
  return (LANGS as readonly string[]).includes(value);
}

export function getDictionary(lang: Lang): Dictionary {
  return { ...en, ...dictionaries[lang] };
}

export function format(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function translator(dict: Dictionary): Translate {
  return (key, vars) => format(dict[key], vars);
}
