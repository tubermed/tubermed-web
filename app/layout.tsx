import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.tubermed.com"),
  title: {
    default: "TuberMed - ИИ медицински скрайб за български лекари",
    template: "%s · TuberMed",
  },
  description:
    "TuberMed записва консултацията и я превръща в готов, структуриран амбулаторен лист на български. Вие преглеждате и одобрявате. GDPR-съвместим, данните се съхраняват в ЕС.",
  applicationName: "TuberMed",
  icons: {
    icon: [
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    locale: "bg_BG",
    siteName: "TuberMed",
    url: "https://www.tubermed.com",
    title: "TuberMed - ИИ медицински скрайб за български лекари",
    description:
      "От разговор до амбулаторен лист за секунди. GDPR-съвместим, данните се съхраняват в ЕС. Лекарят остава автор.",
    images: [
      {
        url: "/brand/og-image.png",
        alt: "TuberMed - ИИ медицински скрайб: от разговор до амбулаторен лист",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "TuberMed - ИИ медицински скрайб за български лекари",
    description:
      "От разговор до амбулаторен лист за секунди. GDPR-съвместим, данните се съхраняват в ЕС. Лекарят остава автор.",
    images: ["/brand/og-image.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="bg" className={`${inter.variable} ${jetbrains.variable}`}>
      <body>{children}</body>
    </html>
  );
}
