import type { ReactNode } from "react";
import { CartBadge } from "@/components/cart-badge";
import "./globals.css";

export const metadata = { title: "rscope example shop" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header>
          <a href="/">Example shop</a>
          <CartBadge count={0} />
        </header>
        {children}
      </body>
    </html>
  );
}
