import { ProductCard } from "@/components/product-card";
import { getCatalog } from "@/lib/catalog";

export default function ProductsPage() {
  const products = getCatalog();
  return (
    <main>
      <h1>All products</h1>
      <div className="grid">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </main>
  );
}
