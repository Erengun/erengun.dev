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
    title: "Eren Gün — Creative Software Developer",
    description:
      "Award-winning software developer, open-source builder and competitive coder. Selected for T3 Vakfı's 100 Yükselen Yıldız, CodinGame world #9 and TEKNOFEST award winner.",
    icons: {
      icon: "/eren-gun.jpg",
      shortcut: "/eren-gun.jpg",
    },
    openGraph: {
      title: "Eren Gün — I Build The Unlikely",
      description: "Award-winning software developer · Open-source builder · Competitive coder",
      type: "website",
      url: baseUrl,
      images: [{ url: socialImage, width: 1672, height: 941, alt: "Eren Gün — I Build The Unlikely" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Eren Gün — I Build The Unlikely",
      description: "Award-winning software developer · Open-source builder · Competitive coder",
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
