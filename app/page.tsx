import { redirect } from "next/navigation";
import { loadLeagues, DEFAULT_LEAGUE } from "./lib/xr_data";

/**
 * There is no league-agnostic home page: every meaningful view is scoped to a
 * competition. Rather than invent a cross-league dashboard nobody asked for,
 * the root sends you to a real league page and the switcher takes it from there.
 */
export default function Home() {
  const leagues = loadLeagues();
  const target = leagues.find((l) => l.key === DEFAULT_LEAGUE) ?? leagues[0];
  redirect(target ? `/${target.key}` : `/${DEFAULT_LEAGUE}`);
}
