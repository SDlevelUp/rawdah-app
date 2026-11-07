import { Switch } from "@/components/ui/switch";

type UdhrToggleProps = {
  isExcusePeriod: boolean;
  // Vrai quand le ‘Udhr est activé automatiquement par un jour de règles noté.
  isExcuseFromCycle?: boolean;
  onChange: (enabled: boolean) => void;
};

export function UdhrToggle({ isExcusePeriod, isExcuseFromCycle = false, onChange }: UdhrToggleProps) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[15px] font-semibold leading-5">Indisponibilité (‘Udhr)</span>
        <Switch
          checked={isExcusePeriod}
          onCheckedChange={onChange}
          aria-label="Activer l’indisponibilité légale Al-Udhr"
        />
      </div>
      <p className="mt-1.5 text-[13px] leading-5 text-(--n-muted)">
        {isExcuseFromCycle
          ? "Activé automatiquement : jour de règles noté dans ton cycle. Tu peux le désactiver pour aujourd’hui."
          : "Masque les créneaux de prière de Ma journée pour aujourd’hui."}
      </p>
    </div>
  );
}
