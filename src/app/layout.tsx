import type { Metadata } from "next";
import { Lexend } from "next/font/google";

import "./globals.css";

const lexend = Lexend({
  subsets: ["latin"],
  variable: "--font-lexend",
});

export const metadata: Metadata = {
  title: "Strategic Roadmap & Capacity Manager",
  description:
    "Gestiona clientes, roadmap de estrategia y capacidad operativa.",
  icons: {
    icon: "/dinterweb.png",
    shortcut: "/dinterweb.png",
    apple: "/dinterweb.png",
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
