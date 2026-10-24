import type { Contact } from "@/lib/types";
import type { Translate } from "@/lib/i18n";
import { telHref } from "@/lib/phone";
import { PrintButton } from "./PrintButton";

const LINK_CLASS =
  "inline-flex min-h-12 items-center rounded-lg border border-primary px-4 text-base font-medium text-primary break-all";

export function ContactCard({
  nctId,
  contacts,
  t,
  printLabel,
}: {
  nctId: string;
  contacts: Contact[];
  t: Translate;
  printLabel: string;
}) {
  const usable = contacts
    .map((c) => ({
      name: c.name?.trim(),
      phone: c.phone?.trim(),
      email: c.email?.trim(),
    }))
    .filter((c) => c.phone || c.email)
    .slice(0, 3);

  return (
    <section className="mt-6 border-t border-line pt-6">
      <h2 className="text-xl font-semibold text-ink">{t("contact.heading")}</h2>

      {usable.length === 0 ? (
        <div className="mt-3 space-y-3">
          <p className="text-ink">{t("contact.none")}</p>
          <a
            href={`https://clinicaltrials.gov/study/${encodeURIComponent(nctId)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={LINK_CLASS}
          >
            clinicaltrials.gov/study/{nctId}
          </a>
        </div>
      ) : (
        <ul className="mt-3 space-y-4">
          {usable.map((c, i) => {
            const href = c.phone ? telHref(c.phone) : null;
            return (
              <li key={i} className="flex flex-col items-start gap-2">
                {c.name && <p className="font-bold text-ink">{c.name}</p>}
                {c.phone &&
                  (href ? (
                    <a href={href} className={LINK_CLASS}>
                      {t("contact.call", { phone: c.phone })}
                    </a>
                  ) : (
                    <p className="text-ink">{c.phone}</p>
                  ))}
                {c.email && (
                  <a href={`mailto:${c.email}`} className={LINK_CLASS}>
                    {t("contact.email", { email: c.email })}
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 font-medium text-ink">{t("contact.tip", { nct: nctId })}</p>

      <div className="mt-4">
        <PrintButton label={printLabel} />
      </div>
    </section>
  );
}
