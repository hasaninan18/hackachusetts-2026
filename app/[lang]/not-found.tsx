import Link from "next/link";

export default function NotFound() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-ink">404</h1>
      <p className="mt-4">
        <Link href="/" className="font-semibold text-primary underline">
          TrialPath MA
        </Link>
      </p>
    </div>
  );
}
