import type { Metadata, Viewport } from "next"
import { Inter } from "next/font/google"
import "./globals.css"

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" })

export const metadata: Metadata = {
  title: "Delivery Zone Generator | Free GeoJSON Editor & Polygon Split Tool",
  description:
    "Create delivery zones with our free GeoJSON editor. Generate drive-time isochrones, split polygons, and export delivery areas. Perfect for restaurants, logistics, and delivery services.",
  keywords: [
    "delivery zone generator",
    "geojson editor",
    "delivery area mapping tool",
    "isochrone delivery zones",
    "polygon split tool",
    "delivery radius map",
    "service area creator",
    "zone mapping software",
    "free delivery zone tool",
    "restaurant delivery area",
  ],
  authors: [{ name: "GeoJSON Zones" }],
  openGraph: {
    title: "Delivery Zone Generator | Free GeoJSON Editor",
    description:
      "Create and manage delivery zones with drive-time rings, polygon splitting, and GeoJSON export.",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Delivery Zone Generator | Free GeoJSON Editor",
    description:
      "Create and manage delivery zones with drive-time rings, polygon splitting, and GeoJSON export.",
  },
  robots: {
    index: true,
    follow: true,
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0a",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "Delivery Zone Generator",
              description:
                "Free tool to create delivery zones, generate drive-time isochrones, and export GeoJSON",
              applicationCategory: "BusinessApplication",
              operatingSystem: "Any",
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
              },
              featureList: [
                "Draw delivery zones on map",
                "Generate drive-time rings",
                "Split polygons with cut line",
                "Export to GeoJSON format",
                "Import existing GeoJSON",
              ],
            }),
          }}
        />
      </head>
      <body className="bg-background font-sans antialiased">{children}</body>
    </html>
  )
}
