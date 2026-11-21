import type { ReactNode } from "react";
import localFont from "next/font/local";
import "./globals.css";
import { TopNav } from "@/components/TopNav";
import { ConfirmProvider, ToastProvider } from "@/components/Toasts";
import { CommandPalette } from "@/components/CommandPalette";

// fontes ficam no projeto (app/fonts) (não do Google na hora do build) — o build funciona offline e em qualquer nuvem
const sora = localFont({
  src: [
    { path: "./fonts/sora-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/sora-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/sora-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/sora-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./fonts/sora-latin-800-normal.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-sora",
  display: "swap",
});
const display = localFont({
  src: [
    { path: "./fonts/bricolage-grotesque-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./fonts/bricolage-grotesque-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "./fonts/bricolage-grotesque-latin-800-normal.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-display-src",
  display: "swap",
});

export const metadata = {
  title: { default: "CB Studio", template: "%s · CB Studio" },
  description: "Estúdio de vídeo IA da G2 Educação",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${sora.variable} ${display.variable}`}>
      <body>
        <ToastProvider>
          <ConfirmProvider>
            <div className="shell2">
              <TopNav />
              <main className="main2">{children}</main>
            </div>
            <CommandPalette />
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
