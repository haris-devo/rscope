"use client";

import { useState } from "react";
import type { Product } from "@/lib/catalog";

// Receives the whole CMS record but renders four fields of it.
export function ProductCard({ product }: { product: Product }) {
  const [added, setAdded] = useState(false);
  return (
    <article className="card">
      <img src={product.image} alt="" width={240} height={300} />
      <h2>{product.name}</h2>
      <p>
        {product.price} {product.currency}
      </p>
      <button onClick={() => setAdded(true)}>{added ? "Added" : "Add to cart"}</button>
    </article>
  );
}
