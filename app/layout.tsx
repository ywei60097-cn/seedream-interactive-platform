import type { Metadata } from "next";
import "./globals.css";
import "./editor.css";
export const metadata: Metadata = { title: "豆包画梦工作室 — 智能画板", description: "基于豆包画梦 5.0 Pro 的智能图片编辑画板。", icons: { icon: "/favicon.svg" } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="zh-CN"><body>{children}</body></html>; }
