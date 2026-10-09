export default function Home() {
  return (
    <main>
      <h1>rscope example shop</h1>
      <p>Two versions of the same product grid. Run rscope against both and compare.</p>
      <ul>
        <li><a href="/products">/products</a> passes the whole CMS record to each client card.</li>
        <li><a href="/products-lean">/products-lean</a> passes only the four fields the card renders.</li>
      </ul>
    </main>
  );
}
