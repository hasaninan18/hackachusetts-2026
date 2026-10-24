import { notFound } from "next/navigation";

// Unknown paths under /[lang] render the localized not-found page inside the [lang] layout.
// More specific routes (results, trial/[nct]) take precedence over this catch-all.
export default function CatchAll() {
  notFound();
}
