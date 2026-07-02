import type { Metadata } from "next";
import { Lexend } from "next/font/google";

import "./globals.css";

const lexend = Lexend({
  subsets: ["latin"],
  variable: "--font-lexend",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://app.dinterweb.com"),
  title: "Strategic Roadmap & Capacity Manager",
  description:
    "Gestiona clientes, roadmap de estrategia y capacidad operativa.",
  icons: {
    icon: "/dinterweb.png",
    shortcut: "/dinterweb.png",
    apple: "/dinterweb.png",
  },
  openGraph: {
    title: "Strategic Roadmap & Capacity Manager",
    description:
      "Gestiona clientes, roadmap de estrategia y capacidad operativa.",
    url: "https://app.dinterweb.com",
    siteName: "Dinterweb",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Dinterweb",
      },
    ],
    locale: "es_CO",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Strategic Roadmap & Capacity Manager",
    description:
      "Gestiona clientes, roadmap de estrategia y capacidad operativa.",
    images: ["/opengraph-image"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={lexend.variable}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
