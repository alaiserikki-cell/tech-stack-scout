import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-16 text-center">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-muted">That page or company does not exist.</p>
      <Link href="/watchlist" className="mt-4 inline-block text-sm">
        Back to the watchlist
      </Link>
    </div>
  );
}
