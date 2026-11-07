import { ChevronRight } from "lucide-react";
import { mySpaceItems, type DashboardView } from "./dashboardNavigation";

type MySpaceViewProps = {
  hasUnreadNotes: boolean;
  onNavigate: (view: DashboardView) => void;
};

// Page « Mon espace » (mobile) : raccourcis vers les modules hors de la barre du bas.
export function MySpaceView({ hasUnreadNotes, onNavigate }: MySpaceViewProps) {
  return (
    <section id="dashboard-space" className="scroll-mt-24 space-y-5">
      <div className="n-page-head px-1">
        <div>
          <span className="n-label">Tous tes modules</span>
          <h1 className="n-page-title">Mon espace</h1>
        </div>
      </div>

      <ul className="n-space-list" aria-label="Modules de Rawdah">
        {mySpaceItems.map(({ label, view, icon: Icon, description }) => (
          <li key={view}>
            <button type="button" onClick={() => onNavigate(view)} className="n-space-item">
              <span className="n-space-icon" aria-hidden="true">
                <Icon className="size-5" strokeWidth={1.7} />
              </span>
              <span className="min-w-0 flex-1 text-left">
                <span className="block text-[16px] font-semibold leading-5">{label}</span>
                <span className="mt-0.5 block text-[13px] leading-5 text-(--n-muted)">
                  {description}
                </span>
              </span>
              {view === "notes" && hasUnreadNotes && (
                <span className="n-unread" role="status" aria-label="Nouvelle note non consultée" />
              )}
              <ChevronRight className="size-4.5 shrink-0 text-(--n-muted)" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
