import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import pkg from "../../package.json";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ParliWatch — Parliamentary Transcription",
  description:
    "Time-coded transcriptions and AI summaries of parliamentary sessions",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-gray-50 min-h-screen`}>
        <header className="bg-parliament-navy text-white shadow-md">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
            <Link href="/" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
              <div className="w-8 h-8 bg-parliament-gold rounded-full flex items-center justify-center font-bold text-parliament-navy text-sm">
                PW
              </div>
              <span className="font-semibold text-lg tracking-wide">ParliWatch</span>
            </Link>
            <span className="text-gray-300 text-sm ml-1 hidden sm:inline">
              Parliamentary Transcription Platform
            </span>
            <nav className="ml-auto flex items-center gap-1">
              <Link
                href="/logs"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
              >
                Logs
              </Link>
            </nav>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
        <footer className="text-center text-gray-400 text-xs py-6 mt-8 border-t">
          ParliWatch v{pkg.version}
        </footer>
      </body>
    </html>
  );
}
