import type { Metadata } from "next";
import { Source_Serif_4 } from "next/font/google";
import "./globals.css";

// Serif moderno e leggibile a schermo (vibe "Claude"), self-hosted da Next.
const serif = Source_Serif_4({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-serif",
});

// Neutro: il gate è condiviso da tutti gli scenari. Dopo il login page.tsx
// aggiorna titolo della scheda e lingua del documento in base allo scenario.
export const metadata: Metadata = {
  title: "AI-Based Decision Making",
  description: "AI-Based Decision Making",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={serif.variable}>
      <body>{children}</body>
    </html>
  );
}
