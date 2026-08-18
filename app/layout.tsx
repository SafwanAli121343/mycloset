import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import Navbar from "@/components/Navbar";
import MobileTabBar from "@/components/MobileTabBar";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MYCLOSET",
  description: "Your personal wardrobe, styled.",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "mycloset" },
};

// viewportFit: "cover" lets content draw under the iPhone notch/Dynamic Island so the
// env(safe-area-inset-*) CSS variables (see globals.css) become available to opt into —
// the Capacitor iOS shell also insets natively via contentInset in capacitor.config.ts,
// so most screens don't need to think about this at all.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <link rel="preload" as="image" href="/loading-tee.png" />
      </head>
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <Navbar />
          {children}
          <MobileTabBar />
        </AuthProvider>
      </body>
    </html>
  );
}
