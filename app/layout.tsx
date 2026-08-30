import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MTA Real-Time Train Board",
  description: "Live NYC subway arrivals from MTA GTFS-Realtime feeds",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
