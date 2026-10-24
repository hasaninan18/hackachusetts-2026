import { NextResponse, type NextRequest } from "next/server";
import { LANGS, type Lang } from "./lib/types";

// Sends language-less URLs (e.g. "/") to /<lang>/..., picking from Accept-Language.
function pickLang(header: string | null): Lang {
  if (!header) return "en";
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, q] = part.trim().split(";q=");
      return { base: tag.toLowerCase().split("-")[0], q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { base } of ranked) {
    if ((LANGS as readonly string[]).includes(base)) return base as Lang;
  }
  return "en";
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasLang = LANGS.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
  if (hasLang) return;

  const url = request.nextUrl.clone();
  url.pathname = `/${pickLang(request.headers.get("accept-language"))}${pathname === "/" ? "" : pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Skip API routes, Next internals and files with an extension (favicon, images).
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
