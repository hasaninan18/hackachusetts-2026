import type { Line } from "@/lib/types";

// White pill with a colour swatch. Text is never placed on the line colour (contrast fails AA
// for Orange and Silver).
export function LineChip({ line }: { line: Line }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-0.5 text-sm text-ink">
      <span
        aria-hidden="true"
        className="inline-block h-3 w-3 shrink-0 rounded-[3px]"
        style={{ backgroundColor: line.color }}
      />
      {line.name}
    </span>
  );
}
