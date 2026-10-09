# How rscope works

This is the design behind rscope: how the payload is parsed, how every byte gets attributed, and why the findings use the thresholds they do. It is written for contributors, and for anyone deciding whether to trust the numbers.

## Layout

```
src/core/      Pure TypeScript, no dependencies, no Node APIs. Runs in Node and in the browser.
  flight.ts      Flight wire format → rows
  extract.ts     HTML document → payload bytes
  analyze.ts     rows → buckets, components, prop paths, repeated strings
  findings.ts    report → actionable findings
  budget.ts      route patterns, budgets, config validation
  markdown.ts    report → Markdown (PR comments, job summaries)
src/node/      The CLI: reading .next, manifests, URLs, gzip, terminal output
web/           The website: a Vite + React app that imports src/core directly
examples/      A Next.js app that produces the payloads the tests run against
test/fixtures/ Its real `next build` output, committed
```

The core never touches the file system or the network. That one constraint is why the website can run the exact analysis the CLI does, with nothing uploaded.

## 1. Getting the payload

Next.js delivers the RSC payload in two ways:

- **Inline in the HTML**, for the first load, as a series of scripts:
  ```html
  <script>self.__next_f.push([0])</script>
  <script>self.__next_f.push([1,"0:{\"P\":null,\"b\":\"...\"}\n"])</script>
  ```
  Type `1` is a chunk of the payload as a JS string. Type `3` is a base64 binary chunk. Types `0` and `2` are bootstrap and form state, and carry no payload. `extractFlight` joins the chunks into one `Uint8Array`, and also records how many bytes the scripts occupy in the document (`inlineBytes`), JS string escaping included.
- **As `text/x-component`** for client navigation and prefetch: the same stream, served for a request with the `RSC: 1` header, or written to `.next/server/app/*.rsc` at build time.

The tests check that the payload extracted from `products.html` and the `products.rsc` file give an identical breakdown.

## 2. Parsing rows

The Flight format is undocumented, so `flight.ts` follows React's own client parser (`processBinaryChunk` in `react-client/src/ReactFlightClient.js`). A payload is a stream of rows:

```
1:I[21871,["/_next/static/chunks/a.js"],"ProductCard"]    client module reference
:HL["/_next/static/css/app.css","style"]                  resource hint (empty id)
2:T1a4,<0x1a4 bytes of text>                              long string, length-prefixed, no newline
0:["$","main",null,{"children":[["$","$L1","p1",{...}]]}]  model row: plain JSON
```

After the hex id and `:` comes an optional tag. `T`, the typed-array tags (`A O o U S s L l G g M m V b`) and binary rows carry a hex byte length and a comma, then exactly that many bytes. Every other row runs to the next newline.

Two details matter for correctness:

- **Lengths are UTF-8 bytes.** A `T` row holding `héllo` is `T6,`, not `T5,`. Parsing a JS string would misread every row after the first non-ASCII character, so the parser works on bytes.
- **Ids can repeat.** A streamed value (an async iterable, for example) is written as several rows sharing one id: `7:X`, `7:{...}`, `7:C`. Anything keyed only by id loses rows. The analyzer tracks visited rows by identity, not by id.

## 3. Attributing bytes

The analyzer credits every byte of the payload to exactly one bucket:

| Bucket | Bytes |
|---|---|
| `clientProps` | Data in the props of your client components |
| `frameworkProps` | Data in the props of Next.js's own router, metadata and boundary components |
| `serverTree` | Element framing, host elements and their props, text, router state |
| `modules` | `I` rows, plus the chunk-path and export-name rows they reference |
| `hints` | `H` rows |
| `other` | Debug and error rows, stream markers, anything unreachable |

**The invariant: the buckets add up to the payload's byte length.** Every test that analyzes a payload asserts it. So does the contract test against each Next.js release, and I checked it against production sites while building rscope. Stating the invariant is what makes the breakdown trustworthy. A report that adds up to 98% of the payload would leave you guessing about the rest.

### The walk

1. **Module rows first.** Each `I` row becomes a `ClientModule`. React 19 writes `[id, chunks, name, async?]`; React 18 writes `{id, chunks, name}`. Both are handled. Chunk paths and export names may themselves be references (`"$2"`) to string rows, which are credited to `modules`.
2. **Then the tree, from row `0`.** Elements are arrays: `["$", type, key, props, ...devInfo]`.
   - The framing (`["$",`, commas, brackets), `type` and `key` go to `serverTree`.
   - If `type` is a reference (`"$L1"`) to an `I` row, the element is a **client component instance**. Each prop except `children` is credited to that component, under its prop path. `children` is rendered output passing through the component, not data it consumes, so it is walked as tree.
   - Otherwise the element is a host element, a fragment or a Suspense boundary, and its props are tree.
3. **References pull rows in.** A string like `"$5"`, `"$5:props:title"`, `"$@5"` (promise), `"$Q5"` (Map) or `"$L5"` (lazy) points at row 5. When the walk meets one, the referenced rows are credited to the same place as the reference, so an outlined object passed as a prop counts as that prop. Strings like `"$Sreact.fragment"`, `"$undefined"` or `"$D2026-…"` (a Date) are not references. React writes row ids in lowercase hex, which is how `$D` stays distinguishable from a row id.
4. **First reference wins.** React sends a shared object once and references it from every other use, so the analyzer credits a row once, to whatever reaches it first. The numbers describe what was actually sent.
5. **Sweep.** Rows the tree doesn't reach (data only the client router reads, say) are walked as roots afterwards, then whatever is left is `other`.

Byte sizes are computed structurally rather than by re-serializing at every level: a string's JSON-escaped UTF-8 length, digits for numbers, and one byte per bracket, colon and comma. This is exact, because parsed JSON re-encodes to the same length, apart from escape differences that the row-overhead term absorbs. It is also linear in the payload size.

### Prop paths

While crediting a prop, the walk records bytes per path, up to four levels: `product`, `product.reviews`, `product.reviews[].body`. Array items aggregate under `[]`. That is how the report can say that, of `ProductCard`'s 126.9 kB, 59.5 kB is `product.reviews`, and 36 kB of that is review bodies.

### Naming components

From a `.next` directory, rscope reads each route's `*_client-reference-manifest.js`. It evaluates the file in an empty `vm` context, because it is a script, not JSON. The manifest maps module ids to source files. Turbopack writes `[project]/components/card.tsx`, while webpack writes absolute paths, which rscope makes relative to the project. Next.js internals are recognized by their path under `next/dist/{client/components,lib/framework,lib/metadata}`. Without a manifest (URL and file targets), a small allowlist of internal export names, and the `parallelRouterKey` prop of the layout router, serve instead. `next/link` and `next/image` are deliberately not internals: their props are yours.

## 4. Findings

Findings are rules over the finished report, with thresholds chosen to stay quiet on healthy pages:

| Rule | Fires when | Why that threshold |
|---|---|---|
| `heavy-props` | A component's props are ≥ 10 kB and ≥ 10% of the payload | Below that, trimming props is rarely worth a code change. Warning at ≥ 25%. |
| `repeated-strings` | Equal strings of 64+ characters waste ≥ 5 kB | React dedupes repeated *objects*, not equal strings. Repeated copies are pure waste. |
| `module-references` | Module rows are ≥ 20 kB and ≥ 20% of the payload | Seen in the wild on pages with many client components that each list their chunks. |
| `large-payload` | Payload ≥ 128 kB | The Pages Router's `largePageDataBytes` default, which the App Router dropped. |
| `inline-share` | Inline payload ≥ 20 kB and ≥ 50% of the HTML | Context more than a problem, so it's informational. |

Each finding names the component and its biggest fields, and says what to do. "Your payload is big" is not a finding anyone can act on.

## 5. Testing

- **Unit tests** use hand-written payloads, one per row type and edge case: byte-length `T` rows with multi-byte text, repeated ids, the React 18 module format, reference parsing (`$D` vs `$d`), and children excluded from props.
- **Fixture tests** run against the committed output of a real `next build` of `examples/next-shop`, regenerated by `npm run fixtures`.
- **CLI tests** call `main()` in-process: exit codes, JSON, config files, Markdown summaries and error messages.
- **The contract workflow** rebuilds the example with Next.js 14, 15 and 16 (Turbopack and webpack), `latest` and `canary`, weekly. It checks the invariant, the source mapping and the attribution. A wire-format change shows up there first.

## Non-goals

- **JavaScript bundle size.** `@next/bundle-analyzer` covers it. rscope is about the data a page ships, which bundle analyzers don't see.
- **Dynamic routes from the build directory.** They have no prerendered output to read. Analyze them by URL.
- **Guessing which props are unused.** That needs the component's source and a type-aware analysis. rscope tells you what each field costs, so you can decide.
