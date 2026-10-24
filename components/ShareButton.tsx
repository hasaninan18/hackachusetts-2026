"use client";

import { useState } from "react";
import { shareUrl } from "@/lib/share";

type Status = { kind: "idle" } | { kind: "copied" } | { kind: "manual"; url: string };

// Shares only the trial page link (lib/share.ts): never the search, location or answers.
// Order: the device's share sheet, then copy to clipboard, then show the link to copy by hand.
export function ShareButton({
  title,
  text,
  label,
  copiedLabel,
  manualLabel,
}: {
  title: string;
  text: string;
  label: string;
  copiedLabel: string;
  manualLabel: string;
}) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function share() {
    const url = shareUrl(window.location.href);
    const data = { title, text, url };
    if (typeof navigator.share === "function" && (!navigator.canShare || navigator.canShare(data))) {
      try {
        await navigator.share(data);
        setStatus({ kind: "idle" });
        return;
      } catch (err) {
        // Closing the share sheet is a choice, not an error.
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Anything else (blocked, unsupported target): fall back to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setStatus({ kind: "copied" });
    } catch {
      setStatus({ kind: "manual", url });
    }
  }

  return (
    <div className="no-print">
      <button
        type="button"
        onClick={share}
        className="inline-flex min-h-12 items-center justify-center rounded-lg border border-line bg-card px-5 text-base font-medium text-ink"
      >
        {label}
      </button>
      {/* Always mounted so screen readers announce the change. */}
      <p role="status" className={status.kind === "idle" ? "sr-only" : "mt-2 text-sm text-ink"}>
        {status.kind === "copied" ? copiedLabel : status.kind === "manual" ? manualLabel : ""}
      </p>
      {status.kind === "manual" && (
        <p className="mt-1 break-all text-sm">
          <a href={status.url} className="text-primary underline">
            {status.url}
          </a>
        </p>
      )}
    </div>
  );
}
