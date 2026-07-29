import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "TikTranslate",
  description: "TikTok 达人视频翻译 + AI 分析工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${ibmPlexSans.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* react-scan 必须在 React 挂载前就执行才能拦截到渲染，所以用 beforeInteractive 策略；
            直接写原生 <script> 会被 Next 的 no-sync-scripts 规则拦下（它会阻塞首屏解析）。
            仅在开发环境注入，生产构建不会带上这段。 */}
        {process.env.NODE_ENV === "development" && (
          <Script
            src="https://unpkg.com/react-scan/dist/auto.global.js"
            strategy="beforeInteractive"
            crossOrigin="anonymous"
          />
        )}
        {children}
      </body>
    </html>
  );
}
