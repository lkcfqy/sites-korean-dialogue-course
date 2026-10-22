import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "韩语对话课 · 韩中对照阅读",
  description: "26周韩语对话，每句附中文翻译，按课程轻松阅读。",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
