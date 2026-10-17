import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://datafix-ai-hackathon.candyzebra32.chatgpt.site"),
  title: "DataFix AI — Autonomous data repair",
  description: "Generate, execute, and validate dataset-specific repairs in an isolated sandbox.",
  openGraph: {
    title: "DataFix AI",
    description: "Messy data in. Trusted data out.",
    images: [{ url: "/og.png", width: 1734, height: 909, alt: "DataFix AI turns messy data into trusted data" }],
  },
  twitter: { card: "summary_large_image", title: "DataFix AI", description: "Messy data in. Trusted data out.", images: ["/og.png"] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
