import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";
import { EntitlementsProvider } from "@/contexts/EntitlementsContext";
import Navbar from "@/components/Navbar";
import MobileTabBar from "@/components/MobileTabBar";
import EmailVerificationGate from "@/components/EmailVerificationGate";
import Tutorial from "@/components/Tutorial";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MYCLOSET",
  description: "Your personal wardrobe, styled.",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "mycloset" },
};

// viewportFit: "cover" lets content draw under the iPhone notch/Dynamic Island so the
// env(safe-area-inset-*) CSS variables (see globals.css) become available to opt into.
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
      {/* suppressHydrationWarning: browser extensions add their own classes/attributes to <body>
          before React loads (e.g. "ud-body-normal"), which React reports as a hydration mismatch.
          This only ignores attribute differences on <body> itself, not anything inside it. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <AuthProvider>
          <EntitlementsProvider>
            {/* #tut-stage: the page content the tutorial keeps its text clear of (components/Tutorial.tsx). */}
            <div id="tut-stage">
              <Navbar />
              <EmailVerificationGate>{children}</EmailVerificationGate>
            </div>
            <MobileTabBar />
            <Tutorial />
          </EntitlementsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
