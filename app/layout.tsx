import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const baseUrl = new URL("https://erengun.dev");
const socialImage = new URL("/og.png", baseUrl).toString();

export const metadata: Metadata = {
  metadataBase: baseUrl,
  title: "Eren Gün — ErenOS",
  description:
    "Creative software developer building mobile products, autonomous systems and open-source tools. T3 100 Yükselen Yıldız, CodinGame world #9 and TEKNOFEST award winner.",
  icons: {
    icon: "/eren-gun.jpg",
    shortcut: "/eren-gun.jpg",
  },
  openGraph: {
    title: "Eren Gün — Software Is My Favorite Material",
    description: "Creative developer · Open-source builder · Competitive coder",
    type: "website",
    url: baseUrl,
    images: [{ url: socialImage, width: 1672, height: 941, alt: "Eren Gün — Software Is My Favorite Material" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Eren Gün — Software Is My Favorite Material",
    description: "Creative developer · Open-source builder · Competitive coder",
    images: [socialImage],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
