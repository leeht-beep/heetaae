import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import "@/app/globals.css";

const displayFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "메루카리 한일 리셀 분석기",
  description:
    "메루카리 일본 매입가 대비 한국 재판매 가능성을 분석하는 반응형 웹 MVP",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${displayFont.variable} text-ink antialiased`}>
        {children}
      </body>
    </html>
  );
}
