import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { APP_CONFIG } from "@/config/app";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: APP_CONFIG.name,
    template: `%s · ${APP_CONFIG.name}`,
  },
  description: APP_CONFIG.description,
};

export const viewport: Viewport = {
  // Necessário para que env(safe-area-inset-*) funcione em aparelhos com recorte.
  viewportFit: "cover",
  themeColor: "#f5f6f9",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
