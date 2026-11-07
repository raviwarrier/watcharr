import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toast } from "@/components/ui/toast";
import { SiteNav } from "@/components/site-nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Watcharr",
  description: "Watch books and authors. Get told when the ebook or audiobook is out.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Sets the theme class before first paint, so the page never flashes the wrong theme. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var m=localStorage.getItem('theme');var d=m==='system'?window.matchMedia('(prefers-color-scheme: dark)').matches:m!=='light';document.documentElement.classList.toggle('dark',d);document.documentElement.classList.toggle('light',!d);}catch(e){}})();`,
          }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        <Toast />
        <SiteNav />
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
