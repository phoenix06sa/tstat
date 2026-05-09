import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Skyline 14 Black — Lone Star Regionals",
  description: "Live tournament tracker for Austin Skyline 14 Black at 2026 Lone Star Regionals",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
