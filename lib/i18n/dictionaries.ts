import type { Lang } from "../types";
import type { Dictionary } from "./en";
import { en } from "./en";
import { es } from "./es";
import { pt } from "./pt";
import { ht } from "./ht";
import { zh } from "./zh";
import { vi } from "./vi";

export const dictionaries: Record<Lang, Dictionary> = { en, es, pt, ht, zh, vi };
