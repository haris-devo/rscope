# next-shop example

A small Next.js App Router app that renders the same product grid two ways:

- `/products` passes each client `ProductCard` the whole CMS record: reviews, inventory, audit fields and all.
- `/products-lean` passes `LeanProductCard` only the four fields it renders.

```bash
npm install
npx next build
npx rscope        # from this directory, or: npm run dev -- examples/next-shop (from the repo root)
```

`/products` comes out at about 133 kB of RSC payload, and `/products-lean` at about 11 kB.

The repo's test fixtures are this app's build output (`npm run fixtures` at the root), and the contract workflow builds it against each supported Next.js version.
