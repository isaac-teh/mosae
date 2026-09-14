import type { Metadata, Viewport } from "next";
import { Fraunces, Newsreader, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jakarta",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
});

// Brand wordmark face, matching the Mosaé marketing site.
const fraunces = Fraunces({ subsets: ["latin"], weight: ["600"], variable: "--font-fraunces" });

export const metadata: Metadata = { title: "Mosaé" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#fcf9f4" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} ${newsreader.variable} ${fraunces.variable}`}>
      <body className="bg-canvas font-sans text-ink antialiased">
        <div className="mx-auto min-h-screen w-full max-w-[430px] bg-canvas">{children}</div>
      </body>
    </html>
  );
}
