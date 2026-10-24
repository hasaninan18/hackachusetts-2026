import type { Lang } from "../types";
import type { Dictionary } from "./en";

// Missing keys fall back to English (see getDictionary). The scripts/check-i18n test fails
// if any language is missing a key or drops a {placeholder}.
export const dictionaries: Record<Lang, Partial<Dictionary>> = {
  en: {},
  es: {},
  pt: {},
  ht: {},
  zh: {},
  vi: {},
};
