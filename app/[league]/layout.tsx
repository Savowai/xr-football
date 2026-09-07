import { notFound } from "next/navigation";
import { loadLeagues } from "../lib/xr_data";

/**
 * Every league route is statically generated from the leagues.json index, so
 * adding a competition to scripts/config.py puts it on the site with no
 * frontend change. An unknown key 404s rather than rendering an empty shell.
 */
export function generateStaticParams() {
  return loadLeagues().map((l) => ({ league: l.key }));
}

export default async function LeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ league: string }>;
}) {
  const { league } = await params;
  if (!loadLeagues().some((l) => l.key === league)) notFound();
  return <>{children}</>;
}
