"use client";

import { useState } from "react";

export type CardProduct = { name: string; price: number; currency: string; image: string };

export function LeanProductCard({ product }: { product: CardProduct }) {
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
