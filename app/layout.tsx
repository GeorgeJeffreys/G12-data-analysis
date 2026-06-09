import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "G12++ Exam Processing Suite",
  description:
    "Internal tool for processing MCQ exam results: ingest, item review, scoring, grade boundaries and export.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
