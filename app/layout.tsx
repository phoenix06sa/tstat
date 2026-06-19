import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tournament Tracker",
  description: "Live volleyball tournament tracker — pool standings, bracket play, scores & schedules",
  openGraph: {
    title: "Tournament Tracker",
    description: "Live volleyball tournament tracker — pool standings, bracket play, scores & schedules",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}
