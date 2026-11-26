// Date hégirienne en français, indépendante du navigateur.
// Certains navigateurs n'ont pas les noms des mois hégiriens en français et
// affichent le mois grégorien à la place (« 17 juin 1448 »). On ne leur
// demande donc que les nombres, et le nom du mois vient de cette liste.
// Noms repris de la base Unicode CLDR (locale fr, calendrier islamique).
const HIJRI_MONTHS_FR = [
  "mouharram",
  "safar",
  "rabia al awal",
  "rabia ath-thani",
  "joumada al oula",
  "joumada ath-thania",
  "rajab",
  "chaabane",
  "ramadan",
  "chawwal",
  "dhou al qi’da",
  "dhou al-hijja",
] as const;

const hijriNumbers = (() => {
  try {
    return new Intl.DateTimeFormat("fr-FR-u-ca-islamic-nu-latn", {
      day: "numeric",
      month: "numeric",
      year: "numeric",
    });
  } catch {
    return null;
  }
})();

// Exemple : « 17 joumada ath-thania 1448 ». Null si le calendrier est absent.
export function formatHijriDate(date: Date | number): string | null {
  if (!hijriNumbers) return null;
  const parts = hijriNumbers.formatToParts(date);
  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value);
  const day = value("day");
  const month = value("month");
  const year = value("year");
  const monthName = HIJRI_MONTHS_FR[month - 1];
  if (!day || !year || !monthName) return null;
  return `${day} ${monthName} ${year}`;
}
