import { PanelLeft, Plus } from "lucide-react";
import {
  dashboardNavigation,
  dashboardNavigationGroups,
  mobileTabViews,
  mySpaceItems,
  mySpaceTab,
  type DashboardView,
} from "./dashboardNavigation";

type DashboardSidebarProps = {
  activeView: DashboardView;
  hasUnreadNotes: boolean;
  isCollapsed: boolean;
  onNavigate: (view: DashboardView) => void;
  onCollapse: () => void;
};

const mobileTabs = mobileTabViews.map(
  (view) => dashboardNavigation.find((item) => item.view === view)!,
);

export function DashboardSidebar({
  activeView,
  hasUnreadNotes,
  isCollapsed,
  onNavigate,
  onCollapse,
}: DashboardSidebarProps) {
  // « Mon espace » reste allumé quand on consulte un module rangé dedans.
  const isMySpaceActive =
    activeView === "space" || mySpaceItems.some((item) => item.view === activeView);
  const MySpaceIcon = mySpaceTab.icon;

  return (
    <>
      <aside
        className={`n-side fixed inset-y-0 left-0 z-40 hidden flex-col transition-[width] duration-300 ease-in-out lg:flex ${
          isCollapsed ? "w-18" : "w-65"
        }`}
        data-collapsed={isCollapsed}
      >
        <button
          type="button"
          onClick={() => onNavigate("overview")}
          className="n-side-logo"
          aria-label="Rawdah, aujourd’hui"
          data-tip={isCollapsed ? "Rawdah" : undefined}
        >
          <span className="n-display text-[20px]">{isCollapsed ? "R" : "Rawdah"}</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate("notes")}
          className="n-side-add"
          aria-label="Nouvelle note"
          data-tip={isCollapsed ? "Nouvelle note" : undefined}
        >
          <Plus className="size-4.5 shrink-0" strokeWidth={2.2} />
          {!isCollapsed && <span>Nouvelle note</span>}
        </button>

        <nav aria-label="Navigation principale" className="n-side-nav">
          {dashboardNavigationGroups.map((group, groupIndex) => {
            const items = dashboardNavigation.filter((item) => item.group === group.id);
            // Le groupe Paramètres n'a qu'une entrée : pas besoin de titre au-dessus.
            const showsHeading = !isCollapsed && items.length > 1;
            return (
              <div key={group.id}>
                {isCollapsed || !showsHeading
                  ? groupIndex > 0 && <span className="n-side-sep" aria-hidden="true" />
                  : <p className="n-side-heading">{group.label}</p>}
                {items.map(({ label, view, icon: Icon }) => (
                  <button
                    key={view}
                    type="button"
                    onClick={() => onNavigate(view)}
                    aria-current={activeView === view ? "page" : undefined}
                    aria-label={isCollapsed ? label : undefined}
                    data-tip={isCollapsed ? label : undefined}
                    className="n-side-item"
                  >
                    <Icon className="size-4.5 shrink-0" strokeWidth={1.7} />
                    {!isCollapsed && <span className="truncate">{label}</span>}
                    {view === "notes" && hasUnreadNotes && (
                      <span className="n-side-dot" role="status" aria-label="Nouvelle note non consultée" />
                    )}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="n-side-foot">
          <button
            type="button"
            onClick={onCollapse}
            aria-label={isCollapsed ? "Ouvrir le menu" : "Fermer le menu"}
            data-tip={isCollapsed ? "Ouvrir le menu" : undefined}
            className="n-side-item"
          >
            <PanelLeft className="size-4.5 shrink-0" strokeWidth={1.7} />
            {!isCollapsed && <span>Fermer le menu</span>}
          </button>
        </div>
      </aside>

      {/* Mobile : quatre entrées fixes, libellés toujours visibles. */}
      <nav aria-label="Navigation principale" className="n-tabbar lg:hidden">
        {mobileTabs.map(({ label, view, icon: Icon }) => (
          <button
            key={view}
            type="button"
            onClick={() => onNavigate(view)}
            aria-current={activeView === view ? "page" : undefined}
            className="n-tab"
          >
            <Icon className="size-5 shrink-0" strokeWidth={1.8} />
            <span>{label}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => onNavigate("space")}
          aria-current={isMySpaceActive ? "page" : undefined}
          className="n-tab"
        >
          <MySpaceIcon className="size-5 shrink-0" strokeWidth={1.8} />
          <span>{mySpaceTab.label}</span>
          {hasUnreadNotes && activeView !== "notes" && (
            <span className="n-unread" role="status" aria-label="Nouvelle note non consultée" />
          )}
        </button>
      </nav>
    </>
  );
}
