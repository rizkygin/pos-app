
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { RegisterServiceWorker } from "@/components/register-service-worker";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://ulunpesan.com"),
  title: "Ulun Pesan",
  description: "Believe with the local",
  appleWebApp: {
    title: "Ulun Pesan",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icons/icon-512x512.png",
    apple: "/icons/apple-touch-icon.png",
  },
  openGraph: {
    title: "Ulun Pesan",
    description: "Believe with the local",
    url: "https://ulunpesan.com",
    siteName: "Ulun Pesan",
    images: ["/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Ulun Pesan",
    description: "Believe with the local",
    images: ["/og-image.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <RegisterServiceWorker />
        {children}
      </body>
    </html>
  );
}
