import { NextResponse, type NextRequest } from "next/server";
import { LANGS, type Lang } from "./lib/types";

// Sends language-less URLs (e.g. "/") to /<lang>/..., picking from Accept-Language.
function pickLang(header: string | null): Lang {
  if (!header) return "en";
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? Number(qParam.trim().slice(2)) : 1;
      return { base: tag.trim().toLowerCase().split("-")[0], q: Number.isFinite(q) ? q : 0 };
    })
    .filter((l) => l.q > 0) // q=0 means "not acceptable"
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
  matcher: ["/((?!api/|api$|_next/|.*\\..*).*)"],
};
