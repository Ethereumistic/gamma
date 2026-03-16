import { ConvexReactClient } from "convex/react";

const convexUrl = import.meta.env.VITE_CONVEX_URL;

if (!convexUrl) {
  throw new Error("Missing VITE_CONVEX_URL in your environment.");
}

export const convex = new ConvexReactClient(convexUrl);
export const convexSiteUrl = import.meta.env.VITE_CONVEX_SITE_URL ?? "";
