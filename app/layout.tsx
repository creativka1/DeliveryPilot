import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "DeliveryPilot — Receiving, coordinated.",
  description:
    "Turn entrance activity into a clear receiving workflow. Camera evidence, suggested matches, and human-confirmed receipts.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
