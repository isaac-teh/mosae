import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-jakarta",
});

export const metadata: Metadata = { title: "Mosaé" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#fcf9f4" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body className="bg-canvas font-sans text-ink antialiased">
        <div className="mx-auto min-h-screen w-full max-w-[430px] bg-canvas">{children}</div>
      </body>
    </html>
  );
}
