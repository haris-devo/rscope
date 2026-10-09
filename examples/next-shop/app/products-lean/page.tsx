import { LeanProductCard } from "@/components/lean-product-card";
import { getCatalog } from "@/lib/catalog";

export default function LeanProductsPage() {
  const products = getCatalog();
  return (
    <main>
      <h1>All products</h1>
      <div className="grid">
        {products.map(({ id, name, price, currency, image }) => (
          <LeanProductCard key={id} product={{ name, price, currency, image }} />
        ))}
      </div>
    </main>
  );
}
