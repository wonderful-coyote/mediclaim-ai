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
  title: "MediClaim AI",
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
      suppressHydrationWarning
    >
      <head>
        <Script
          src="https://newwebpay.interswitchng.com/inline-checkout.js"
          strategy="beforeInteractive"
        />
      </head>
      <body
        className="min-h-full flex flex-col bg-slate-50 relative"
        suppressHydrationWarning
      >
        {children}

        {/* 🌟 FLOATING HAMBURGER MENU (Pitch Navigation) */}
        <div className="fixed bottom-8 right-8 z-50">
          <details className="group relative">
            <summary className="list-none cursor-pointer w-14 h-14 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-2xl hover:bg-indigo-700 transition-all active:scale-95 marker:hidden">
              {/* Hamburger Icon (Shows when closed) */}
              <svg className="w-6 h-6 group-open:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path>
              </svg>
              {/* Close Icon (Shows when open) */}
              <svg className="w-6 h-6 hidden group-open:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </summary>
            
            {/* Menu Dropdown */}
            <div className="absolute bottom-[110%] right-0 mb-2 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-3 flex flex-col gap-1.5 w-52 origin-bottom-right">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest px-2 pb-2 border-b border-slate-800 mb-1">
                Demo Hub
              </p>
              
              <a href="/" target="_blank" rel="noopener noreferrer" className="flex items-center px-3 py-2.5 text-xs font-black uppercase tracking-widest text-slate-300 hover:text-white hover:bg-slate-800 rounded-xl transition-colors">
                 👨‍⚕️ Provider EHR
              </a>
              <a href="/patient" target="_blank" rel="noopener noreferrer" className="flex items-center px-3 py-2.5 text-xs font-black uppercase tracking-widest text-emerald-400 hover:text-white hover:bg-emerald-900/30 rounded-xl transition-colors">
                 📱 Patient Portal
              </a>
              <a href="/hmo" target="_blank" rel="noopener noreferrer" className="flex items-center px-3 py-2.5 text-xs font-black uppercase tracking-widest text-indigo-400 hover:text-white hover:bg-indigo-900/30 rounded-xl transition-colors">
                 🏢 HMO Admin
              </a>
              <a href="/cfo" target="_blank" rel="noopener noreferrer" className="flex items-center px-3 py-2.5 text-xs font-black uppercase tracking-widest text-amber-400 hover:text-white hover:bg-amber-900/30 rounded-xl transition-colors">
                 📈 Hospital CFO
              </a>
            </div>
          </details>
        </div>


        <style dangerouslySetInnerHTML={{__html: `
          details > summary::-webkit-details-marker {
            display: none;
          }
        `}} />
      </body>
    </html>
  );
}