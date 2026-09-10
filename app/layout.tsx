import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { StoreProvider } from "@/lib/store";
import "./globals.css";

/*
 * PRD §3/§20 — the reference site's exact font is still to be confirmed.
 * Inter is the stand-in; swapping it is a one-line change here because every
 * surface reads the `--font-app-sans` token defined in globals.css.
 */
const sans = Inter({
  variable: "--font-app-sans",
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
  themeColor: "#17131F",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-base text-ink">
        <StoreProvider>{children}</StoreProvider>
      </body>
    </html>
  );
}
