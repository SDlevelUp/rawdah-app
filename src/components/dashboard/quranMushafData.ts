// Données du mode Mushaf (Quran.com) partagées entre le lecteur et le mushaf.

const QURAN_API = "https://api.quran.com/api/v4";

export type MushafChapter = { id: number; nameArabic: string; startPage: number };

let chaptersRequest: Promise<MushafChapter[]> | null = null;
export function fetchMushafChapters(): Promise<MushafChapter[]> {
  chaptersRequest ??= fetch(`${QURAN_API}/chapters?language=fr`)
    .then((response) => {
      if (!response.ok) throw new Error("Impossible de charger la liste des sourates.");
      return response.json() as Promise<{
        chapters: { id: number; name_arabic: string; pages: number[] }[];
      }>;
    })
    .then(({ chapters }) =>
      chapters.map((chapter) => ({
        id: chapter.id,
        nameArabic: chapter.name_arabic,
        startPage: chapter.pages[0],
      })),
    );
  chaptersRequest.catch(() => {
    chaptersRequest = null;
  });
  return chaptersRequest;
}

// Page de chaque verset d'une sourate (pour tourner la page pendant l'écoute).
const versePagesCache = new Map<number, Promise<Map<number, number>>>();
export function fetchVersePages(surah: number): Promise<Map<number, number>> {
  const cached = versePagesCache.get(surah);
  if (cached) return cached;
  const request = fetch(
    `${QURAN_API}/verses/by_chapter/${surah}?per_page=all&fields=page_number&words=false`,
  )
    .then((response) => {
      if (!response.ok) throw new Error("Pages des versets indisponibles.");
      return response.json() as Promise<{ verses: { verse_number: number; page_number: number }[] }>;
    })
    .then(({ verses }) => new Map(verses.map((verse) => [verse.verse_number, verse.page_number])));
  request.catch(() => versePagesCache.delete(surah));
  versePagesCache.set(surah, request);
  return request;
}
