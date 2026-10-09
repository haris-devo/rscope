# Changelog

## 0.1.0 (2026-10-09)

First release.

- Parses the React Flight wire format (React 18 and 19) from App Router HTML documents, `.rsc` files and live URLs.
- Credits every byte of the payload to client component props, the server-rendered tree, Next.js internals, module references, hints or other. The totals add up to the payload size.
- Breaks client component props down by field path, across all instances, with source file names from the build's client reference manifests.
- Finds repeated strings, heavy props, module-reference overhead and oversized payloads.
- Per-route budgets for the raw payload, gzipped payload, document and client props, with `*`/`**` route patterns. Exits with 1 when a route is over budget.
- Terminal, JSON and Markdown output, a GitHub Action with job summaries and annotations, and an in-browser analyzer at https://haris-devo.github.io/rscope/.
- Tested against Next.js 14, 15 and 16, with Turbopack and webpack.
