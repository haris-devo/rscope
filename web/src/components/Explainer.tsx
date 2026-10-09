export function Explainer() {
  return (
    <section className="explainer" aria-labelledby="why-title">
      <h2 id="why-title" className="section-title">
        Why payloads quietly grow
      </h2>
      <ol className="points">
        <li>
          <span className="point-number mono">01</span>
          <h3>Props are payload</h3>
          <p>
            A client component can't fetch what it was given on the server, so React serializes its props into the RSC
            payload. Pass a whole database row to a card that shows a name and a price, and the page carries the whole row,
            once per card.
          </p>
        </li>
        <li>
          <span className="point-number mono">02</span>
          <h3>Nothing warns you</h3>
          <p>
            The Pages Router warned when page data passed 128 kB. The App Router has no such warning. Gzip hides repeated
            data on the wire, but the browser still parses every byte before the page is interactive.
          </p>
        </li>
        <li>
          <span className="point-number mono">03</span>
          <h3>rscope reads the wire format</h3>
          <p>
            It parses React's Flight rows, follows the references between them and credits every byte to a component, a
            prop path or the server tree. The totals add up to the exact payload size, so you can trust the breakdown.
          </p>
        </li>
      </ol>
    </section>
  );
}
