import type { Metadata } from "next";
import { Source_Serif_4 } from "next/font/google";
import "./globals.css";

// Serif moderno e leggibile a schermo (vibe "Claude"), self-hosted da Next.
const serif = Source_Serif_4({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-serif",
});

export const metadata: Metadata = {
  title: "AI-Based Decision Making — IUSS Pavia",
  description: "Evento di Orientamento · IUSS Pavia",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={serif.variable}>
      <body>{children}</body>
    </html>
  );
}
