import Link from "next/link";

/**
 * Branded 404 (wave 2). Monochrome, no ornament beyond the BASALT MARK: the
 * same 24x24 three-column geometry as the header LogoMark, drawn quiet in
 * muted-foreground. One honest sentence, two plain-text CTAs (the key one in
 * the electric-yellow accent — yellow on chrome is reserved for CTAs, so the
 * link uses --primary-text). Rendered inside the root layout, so the title
 * falls back to the site default; not-found.tsx takes no metadata export.
 */
export default function NotFound() {
  return (
    <section className="flex min-h-[60vh] flex-col items-center justify-center py-12 text-center">
      {/* BASALT MARK — canonical geometry (design-basalt-v1 §2), decorative */}
      <svg
        aria-hidden="true"
        width="44"
        height="44"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeLinejoin="miter"
        className="text-muted-foreground"
      >
        {/* three basalt columns, descending heights, shared flat baseline */}
        <path strokeWidth="1.7" d="M4.3 3.7 L6.5 2.5 L8.7 3.7 L8.7 21.5 L4.3 21.5 Z" />
        <path strokeWidth="1.7" d="M9.8 10.7 L12 9.5 L14.2 10.7 L14.2 21.5 L9.8 21.5 Z" />
        <path strokeWidth="1.7" d="M15.3 15.7 L17.5 14.5 L19.7 15.7 L19.7 21.5 L15.3 21.5 Z" />
      </svg>

      <h1 className="mt-6 font-display text-6xl font-semibold tracking-tight text-foreground">
        404
      </h1>
      <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
        Page not found
      </p>

      <p className="mt-5 max-w-md text-sm leading-6 text-muted-foreground">
        Nothing is served at this address. If you followed a basket link, check
        the full pubkey — or start again from the basket list.
      </p>

      <div className="mt-7 flex items-center gap-6">
        <Link
          href="/explore"
          className="font-mono text-xs uppercase tracking-wide text-primary-text underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Explore baskets →
        </Link>
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-wide text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Back to home
        </Link>
      </div>
    </section>
  );
}
