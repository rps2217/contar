import type {Metadata} from 'next';
import {Geist, Geist_Mono} from 'next/font/google';
import './globals.css';
import {Toaster} from "@/components/ui/toaster";

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'StockCounter Pro',
  description: 'Contabiliza existencias en tu farmacia',
  manifest: '/manifest.json', // Add manifest link to metadata
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
       <head>
        {/* Add theme color for PWA integration */}
        <meta name="theme-color" content="#14b8a6" />
        {/* Link to manifest - Can also be done via Metadata API */}
        {/* <link rel="manifest" href="/manifest.json" /> */}
        {/* Add placeholder icons for Apple devices */}
        <link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
        <Toaster />
        </body>
    </html>
  );
}
