"use client";

export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print inline-flex min-h-12 items-center justify-center rounded-lg border border-line bg-card px-5 text-base font-medium text-ink"
    >
      {label}
    </button>
  );
}
