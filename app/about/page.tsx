import { redirect } from "next/navigation";

/**
 * The methodology write-up moved to /philosophy, where it is named after what it
 * actually is and is reachable from the main navigation rather than a single
 * footer link. This route stays behind as a permanent redirect because it was
 * the published address for a full season and is linked from the repository
 * README and from the site's own older builds.
 */
export const dynamic = "force-static";

export default function AboutPage() {
  redirect("/philosophy");
}
