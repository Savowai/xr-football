import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import SiteNav from "./components/SiteNav";
import { loadLeagues } from "./lib/xr_data";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "xR — Expected Result",
  description:
    "Expected Result modelling for Europe's top five leagues: xG-based ratings, " +
    "scoreline probabilities and the reasoning behind every prediction.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Read once here rather than in the nav component: the switcher is a client
  // component and cannot touch the filesystem itself.
  const leagues = loadLeagues();
  const season = leagues[0]?.season ?? "";

  return (
    <html lang="en">
      <body className={`${inter.variable} ${jetbrains.variable}`}>
        <header
          style={{
            position: "sticky",
            top: 0,
            zIndex: 50,
            background: "rgba(255,255,255,0.88)",
            backdropFilter: "saturate(180%) blur(12px)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div className="wrap">
            <div className="row-between" style={{ height: 56 }}>
              <Link href="/" className="row" style={{ gap: 9 }}>
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 6,
                    background: "var(--text)",
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: "-0.03em",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  xR
                </span>
                <span style={{ fontSize: 15, fontWeight: 640, letterSpacing: "-0.02em" }}>
                  Expected Result
                </span>
                {season && (
                  <span className="badge" style={{ marginLeft: 2 }}>
                    {season}
                  </span>
                )}
              </Link>

              <SiteNav leagues={leagues} />
            </div>
          </div>
        </header>

        <main style={{ paddingBottom: 64 }}>{children}</main>

        <footer
          style={{
            borderTop: "1px solid var(--border)",
            background: "var(--bg-subtle)",
            padding: "20px 0",
          }}
        >
          <div className="wrap row-between" style={{ flexWrap: "wrap", gap: 8 }}>
            <span className="small dim">
              Data via FotMob · rebuilt hourly · {season}
            </span>
            <span className="row small" style={{ gap: 14 }}>
              <Link href="/about" className="muted">
                How xR works
              </Link>
              <a
                href="https://github.com/adamsebhat/xr-football"
                target="_blank"
                rel="noopener noreferrer"
                className="muted"
              >
                GitHub
              </a>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
