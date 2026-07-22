import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = new URL(`${protocol}://${host}`);
  const socialImage = new URL("/og.png", baseUrl).toString();

  return {
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
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
