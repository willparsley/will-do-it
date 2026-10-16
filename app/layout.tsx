import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { PwaRegistration } from "@/components/PwaRegistration";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Will Do It",
  description: "A calm, visual to-do app with streams, cards, and smart recurring tasks.",
  applicationName: "Will Do It",
  appleWebApp: {
    capable: true,
    title: "Will Do It",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eeeeef" },
    { media: "(prefers-color-scheme: dark)", color: "#17171a" },
  ],
};

const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-canvas text-ink">
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
        <PwaRegistration />
        <Toaster
          position="top-right"
          offset={{ top: 124, right: 16 }}
          mobileOffset={{ top: 124, right: 12 }}
          richColors
          closeButton
        />
      </body>
    </html>
  );
}
