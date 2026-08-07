
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

const SITE_NAME = "Ulun Pesan";
const DESCRIPTION =
  "Ulun Pesan — aplikasi kasir (POS) dan pemesanan online untuk usaha lokal. Kelola penjualan, stok, faktur, dan langganan pelanggan dalam satu aplikasi, lengkap dengan pengantaran kurir.";

export const metadata: Metadata = {
  metadataBase: new URL("https://ulunpesan.com"),
  title: {
    default: `${SITE_NAME} — Aplikasi Kasir & Pemesanan Online untuk Usaha Lokal`,
    template: `%s | ${SITE_NAME}`,
  },
  description: DESCRIPTION,
  keywords: [
    "aplikasi kasir",
    "point of sale",
    "POS UMKM",
    "pemesanan online",
    "kasir online",
    "manajemen stok",
    "Ulun Pesan",
  ],
  alternates: {
    canonical: "/",
  },
  appleWebApp: {
    title: SITE_NAME,
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icons/icon-512x512.png",
    apple: "/icons/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    locale: "id_ID",
    title: `${SITE_NAME} — Aplikasi Kasir & Pemesanan Online untuk Usaha Lokal`,
    description: DESCRIPTION,
    url: "https://ulunpesan.com",
    siteName: SITE_NAME,
    images: ["/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: DESCRIPTION,
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
      lang="id"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        {/* Organization + WebSite JSON-LD: lets Google render a richer result
            (logo, sitelinks searchbox) instead of a plain blue link. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "Organization",
                  name: "Ulun Pesan",
                  url: "https://ulunpesan.com",
                  logo: "https://ulunpesan.com/icons/icon-512x512.png",
                  // Claims the Instagram account as an official profile of this org.
                  sameAs: ["https://www.instagram.com/ulunpesan"],
                },
                {
                  "@type": "WebSite",
                  name: "Ulun Pesan",
                  url: "https://ulunpesan.com",
                  inLanguage: "id-ID",
                },
              ],
            }),
          }}
        />
        <RegisterServiceWorker />
        {children}
      </body>
    </html>
  );
}
