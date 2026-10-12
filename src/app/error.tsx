"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import Link from "next/link";

/** Shown instead of a crash if something fails while a page renders (for example the database waking up). */
export default function Error({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <h1 className="font-display text-2xl font-bold tracking-tight text-ink">This page didn&apos;t load.</h1>
      <p className="mt-2 text-sm text-muted">Usually the database is waking up after a quiet period; it takes a few seconds. Your data is safe.</p>
      <div className="mt-6 flex justify-center gap-3">
        <button onClick={() => retry()} className="rounded-xl bg-btn px-4 py-2.5 text-sm font-semibold text-btn-fg">
          Try again
        </button>
        <Link href="/" className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink no-underline">
          Home
        </Link>
      </div>
      {error.digest && <p className="mt-6 text-xs text-faint">Reference: {error.digest}</p>}
    </div>
  );
}
