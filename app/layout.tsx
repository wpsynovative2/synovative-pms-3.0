import type { Metadata, Viewport } from "next";
import { Fredoka, JetBrains_Mono, Nunito } from "next/font/google";
import { Toaster } from "@/components/layout/toaster";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { StoreProvider } from "@/lib/store";
import "./globals.css";

/*
 * PRD §3/§20 — the reference site (synovative.vercel.app) sets its text in
 * Nunito and its headings in Fredoka. globals.css maps them to `font-sans`
 * and `font-display`.
 */
const sans = Nunito({
  variable: "--font-app-sans",
  subsets: ["latin"],
  display: "swap",
});

const display = Fredoka({
  variable: "--font-app-display",
  subsets: ["latin"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-app-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Synovative PMS",
    template: "%s · Synovative PMS",
  },
  description:
    "Project management for a digital marketing agency — projects, tasks, time tracking, expenses and reporting.",
};

export const viewport: Viewport = {
  // Same pairing as the reference site.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#5F3CA7" },
    { media: "(prefers-color-scheme: dark)", color: "#17131F" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The inline script swaps data-theme to the saved / system choice before
    // the first paint, so React must accept the DOM value on hydration.
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${sans.variable} ${display.variable} ${mono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full bg-canvas text-ink">
        <StoreProvider>
          {children}
          <Toaster />
        </StoreProvider>
      </body>
    </html>
  );
}
