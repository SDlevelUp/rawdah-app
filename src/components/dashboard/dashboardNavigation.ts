import {
  BookOpen,
  CalendarClock,
  GraduationCap,
  HandHeart,
  LayoutGrid,
  Moon,
  StickyNote,
  Settings,
  Sun,
  type LucideIcon,
} from "lucide-react";

export type DashboardView =
  | "overview"
  | "adhkar"
  | "salah"
  | "quran"
  | "science"
  | "periods"
  | "notes"
  | "settings"
  | "space";

export type DashboardNavigationGroup = "daily" | "practice" | "resources" | "settings";

// Groupes du menu ordinateur (sitemap de novembre 2026).
export const dashboardNavigationGroups: {
  id: DashboardNavigationGroup;
  label: string;
}[] = [
  { id: "daily", label: "Mon quotidien" },
  { id: "practice", label: "Ma pratique" },
  { id: "resources", label: "Mes ressources" },
  { id: "settings", label: "Paramètres" },
];

export type DashboardNavigationItem = {
  label: string;
  view: DashboardView;
  targetId: string;
  icon: LucideIcon;
  group: DashboardNavigationGroup;
  // Phrase courte affichée sur la page « Mon espace » (mobile).
  description: string;
};

export const dashboardNavigation: DashboardNavigationItem[] = [
  {
    label: "Aujourd’hui",
    view: "overview",
    targetId: "dashboard-home",
    icon: Sun,
    group: "daily",
    description: "Prochaine prière et raccourcis",
  },
  {
    label: "Ma journée",
    view: "salah",
    targetId: "dashboard-salah",
    icon: CalendarClock,
    group: "daily",
    description: "Planning du jour et de la semaine",
  },
  {
    label: "Coran",
    view: "quran",
    targetId: "dashboard-quran",
    icon: BookOpen,
    group: "practice",
    description: "Lecture, reprise et audio",
  },
  {
    label: "Adhkar",
    view: "adhkar",
    targetId: "dashboard-routine",
    icon: HandHeart,
    group: "practice",
    description: "Invocations du matin et du soir",
  },
  {
    label: "Mon cycle",
    view: "periods",
    targetId: "dashboard-status",
    icon: Moon,
    group: "practice",
    description: "Calendrier, ‘Udhr et qada",
  },
  {
    label: "Science bénéfique",
    view: "science",
    targetId: "dashboard-science",
    icon: GraduationCap,
    group: "resources",
    description: "Cours, livres et apprentissages",
  },
  {
    label: "Mes notes",
    view: "notes",
    targetId: "dashboard-notes",
    icon: StickyNote,
    group: "resources",
    description: "Créer, classer et archiver",
  },
  {
    label: "Paramètres",
    view: "settings",
    targetId: "dashboard-settings",
    icon: Settings,
    group: "settings",
    description: "Prière, rappels et affichage",
  },
];

// Barre du bas sur téléphone : quatre entrées, la dernière ouvre « Mon espace ».
export const mobileTabViews: DashboardView[] = ["overview", "salah", "quran"];

export const mySpaceTab = {
  label: "Mon espace",
  view: "space" as const,
  targetId: "dashboard-space",
  icon: LayoutGrid,
};

// Modules rangés dans « Mon espace » : tout ce qui n'est pas dans la barre du bas.
export const mySpaceItems = dashboardNavigation.filter(
  (item) => !mobileTabViews.includes(item.view),
);
