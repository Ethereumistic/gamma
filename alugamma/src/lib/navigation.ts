import { FileStack, LayoutDashboard, ScissorsLineDashed, UserRound, Layers } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
};

export const systemItems: NavItem[] = [
  {
    title: "Workspace",
    url: "/",
    icon: LayoutDashboard,
  },
  {
    title: "Organizations",
    url: "/organization",
    icon: UserRound,
  },
  {
    title: "Projects",
    url: "/project",
    icon: FileStack,
  },
];

export const toolItems: NavItem[] = [
  {
    title: "Sheets",
    url: "/sheet-metal",
    icon: ScissorsLineDashed,
  },
  {
    title: "Nesting",
    url: "/nesting",
    icon: Layers,
  },
  {
    title: "CNC",
    url: "/cnc-pipeline",
    icon: LayoutDashboard,
  },
];
