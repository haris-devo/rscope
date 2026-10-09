"use client";

export function CartBadge({ count }: { count: number }) {
  return <span className="badge">Cart ({count})</span>;
}
