import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AERPO Command Center",
  description: "ERP optimization telemetry and ledger scorecard.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
