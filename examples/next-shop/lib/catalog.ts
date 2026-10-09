// A fake CMS response. Like most real ones, it carries far more than a product card renders.
export type Review = { id: string; author: string; rating: number; body: string; createdAt: string };

export type Product = {
  id: string;
  sku: string;
  slug: string;
  name: string;
  price: number;
  currency: string;
  image: string;
  description: string;
  specs: Record<string, string>;
  reviews: Review[];
  inventory: { warehouse: string; quantity: number; updatedAt: string }[];
  audit: { createdBy: string; updatedBy: string; createdAt: string; updatedAt: string; revision: number };
};

const adjectives = ["Linen", "Merino", "Canvas", "Cotton", "Wool", "Denim", "Suede", "Cashmere"];
const nouns = ["Overshirt", "Sweater", "Tote", "Chinos", "Jacket", "Cap", "Scarf", "Sneakers"];
const lorem =
  "Cut from a midweight fabric that softens with every wash, it layers easily and keeps its shape through the seasons. ";

export function getCatalog(count = 48): Product[] {
  return Array.from({ length: count }, (_, i) => {
    const name = `${adjectives[i % adjectives.length]} ${nouns[(i * 3) % nouns.length]}`;
    return {
      id: `prod_${String(i + 1).padStart(4, "0")}`,
      sku: `SKU-${1000 + i}`,
      slug: name.toLowerCase().replace(/\s+/g, "-") + `-${i + 1}`,
      name,
      price: 29 + ((i * 7) % 120),
      currency: "EUR",
      image: `https://picsum.photos/seed/${i + 1}/480/600`,
      description: lorem.repeat(6),
      specs: { material: adjectives[i % adjectives.length], fit: "Regular", origin: "Portugal", care: "Machine wash 30°C" },
      reviews: Array.from({ length: 5 }, (_, r) => ({
        id: `rev_${i}_${r}`,
        author: `Customer ${r + 1}`,
        rating: 3 + ((i + r) % 3),
        body: "Fits true to size and the colour is exactly as pictured. Would buy again. ".repeat(2),
        createdAt: "2026-09-01T10:00:00.000Z",
      })),
      inventory: ["Berlin", "Copenhagen", "London"].map((warehouse, w) => ({
        warehouse,
        quantity: (i * (w + 3)) % 40,
        updatedAt: "2026-10-01T08:30:00.000Z",
      })),
      audit: {
        createdBy: "importer@shop.example",
        updatedBy: "editor@shop.example",
        createdAt: "2025-01-15T09:00:00.000Z",
        updatedAt: "2026-10-01T08:30:00.000Z",
        revision: 12 + i,
      },
    };
  });
}
