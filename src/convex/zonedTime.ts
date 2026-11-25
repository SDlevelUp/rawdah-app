// Calcul d'instants UTC à partir d'heures locales, sans dépendance.

// Les serveurs Convex tournent en UTC : une heure « 14:42 » doit être lue
// dans le fuseau de l'utilisatrice, pas avec setHours() du serveur.
export const ADHKAR_TIME_ZONE = "Europe/Paris";

export function zonedParts(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(timestamp));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

// Décalage du fuseau par rapport à UTC à cet instant (ms), heure d'été comprise.
function timeZoneOffset(timestamp: number, timeZone: string) {
  const p = zonedParts(timestamp, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(timestamp / 1000) * 1000;
}

// Instant UTC correspondant à une date et une heure locales dans un fuseau.
export function zonedTimeToUtc(
  day: { year: number; month: number; day: number },
  hours: number,
  minutes: number,
  timeZone: string,
) {
  const guess = Date.UTC(day.year, day.month - 1, day.day, hours, minutes);
  const first = guess - timeZoneOffset(guess, timeZone);
  return guess - timeZoneOffset(first, timeZone);
}

// Début et fin (exclue) d'un jour local, en instants UTC.
export function localDayWindow(
  day: { year: number; month: number; day: number },
  timeZone: string,
) {
  return {
    start: zonedTimeToUtc(day, 0, 0, timeZone),
    end: zonedTimeToUtc({ ...day, day: day.day + 1 }, 0, 0, timeZone),
  };
}
