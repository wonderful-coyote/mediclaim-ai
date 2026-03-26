import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Script from "next/script";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MediClaim AI | Interswitch Enyata 2026",
  description: "AI-Powered Medical Claim Auditing and Fintech Disbursement",
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
      suppressHydrationWarning // Add this to the html tag too for extra safety
    >
      <head>
        <Script
          src="https://newwebpay.interswitchng.com/inline-checkout.js"
          strategy="beforeInteractive"
        />
      </head>
      {/* ADD suppressHydrationWarning HERE 👇 */}
      <body
        className="min-h-full flex flex-col bg-slate-50"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}