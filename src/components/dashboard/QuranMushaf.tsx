import { ChevronLeft, ChevronRight, Loader2, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MushafChapter } from "@/components/dashboard/quranMushafData";

// Mushaf de Médine en 604 pages (15 lignes), rendu en texte avec la police
// KFGQPC Uthmanic Hafs et les couleurs du tajwid.
// - Mise en page : mots et numéros de ligne de l'API Quran.com.
// - Tajwid : texte « uthmani_tajweed » de Quran.com, où chaque passage
//   coloré porte le nom de sa règle (ghunnah, madda_obligatory, qalaqah…).
//   Les couleurs sont choisies par règle, regroupées comme la légende du
//   mushaf Tajweed de Dar Al-Maarifah (capture fournie par Sarah).

const QURAN_API = "https://api.quran.com/api/v4";
const UTHMANIC_FONT =
  "https://verses.quran.foundation/fonts/quran/hafs/uthmanic_hafs/UthmanicHafs1Ver18.woff2";
export const MUSHAF_PAGES = 604;
// Largeur à laquelle chaque page est mise en forme, une seule fois. Le zoom
// agrandit ou réduit ensuite le livre entier comme une image (transform),
// sans jamais recalculer le texte.
const PAGE_LAYOUT_WIDTH = 440;

// Sourates qui commencent à la ligne 2 de leur page : basmala en ligne 1,
// en-tête sur la dernière ligne de la page précédente. Liste tirée des
// données Quran.com (vérifiée le 2026-11-28 sur les 114 sourates).
const HEADER_ON_PREVIOUS_PAGE = new Set([
  4, 10, 22, 23, 24, 26, 27, 32, 33, 37, 38, 45, 47, 53, 60, 64, 65, 80, 82, 86, 91,
]);

// Règle (classe Quran.com) → groupe de couleur.
const TAJWEED_GROUP: Record<string, "madd" | "ghunnah" | "qalqalah" | "silent"> = {
  madda_normal: "madd",
  madda_permissible: "madd",
  madda_necessary: "madd",
  madda_obligatory: "madd",
  ghunnah: "ghunnah",
  ikhafa: "ghunnah",
  ikhafa_shafawi: "ghunnah",
  iqlab: "ghunnah",
  qalaqah: "qalqalah",
  slnt: "silent",
  ham_wasl: "silent",
  laam_shamsiyah: "silent",
  idgham_ghunnah: "silent",
  idgham_wo_ghunnah: "silent",
  idgham_shafawi: "silent",
  idgham_mutajanisayn: "silent",
  idgham_mutaqaribayn: "silent",
};

const arabicNumber = new Intl.NumberFormat("ar-EG");

type Segment = { text: string; group?: string };

type MushafWord = {
  id: number;
  line: number;
  verseKey: string;
  isEnd: boolean;
  verseNumber: number;
  segments: Segment[];
};

type MushafPage = {
  page: number;
  words: MushafWord[];
  surahStarts: { surah: number; line: number }[];
  juz: number;
  surah: number;
};

type ApiVerse = {
  verse_key: string;
  verse_number: number;
  juz_number: number;
  words: { id: number; text_uthmani: string; line_number: number; char_type_name: string }[];
};

// Découpe le texte tajwid d'un verset en mots, chacun en segments colorés.
// Les signes ۞ et ۩ isolés (hors des mots de la mise en page) sont retirés.
function tajweedWords(tagged: string): Segment[][] {
  // Les règles peuvent être imbriquées (une lettre muette dans un madd…) :
  // chaque passage prend la couleur de la règle la plus intérieure.
  const segments: Segment[] = [];
  const stack: { tag: string; className: string }[] = [];
  const pattern = /<(\/?)(tajweed|span)([^>]*)>|([^<]+)/g;
  for (const match of tagged.matchAll(pattern)) {
    if (match[2]) {
      if (match[1]) stack.pop();
      else stack.push({ tag: match[2], className: /class=([a-z_]+)/.exec(match[3])?.[1] ?? "" });
      continue;
    }
    if (stack.some((entry) => entry.tag === "span" && entry.className === "end")) {
      segments.push({ text: " # " }); // numéro de verset : un mot à part
      continue;
    }
    let group: string | undefined;
    for (let index = stack.length - 1; index >= 0 && !group; index -= 1) {
      group = TAJWEED_GROUP[stack[index].className];
    }
    segments.push({ text: match[4], group });
  }
  const words: Segment[][] = [[]];
  for (const segment of segments) {
    for (const part of segment.text.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        if (words[words.length - 1].length) words.push([]);
      } else {
        words[words.length - 1].push({ text: part, group: segment.group });
      }
    }
  }
  return words
    .filter((word) => word.length)
    .filter((word) => !/^[۞۩]+$/.test(word.map((segment) => segment.text).join("")));
}

const pageCache = new Map<number, Promise<MushafPage>>();

function fetchMushafPage(page: number): Promise<MushafPage> {
  const cached = pageCache.get(page);
  if (cached) return cached;
  const request = Promise.all([
    fetch(
      `${QURAN_API}/verses/by_page/${page}?words=true&word_fields=text_uthmani,line_number&per_page=all`,
    ).then((response) => {
      if (!response.ok) throw new Error("Impossible de charger cette page du mushaf.");
      return response.json() as Promise<{ verses: ApiVerse[] }>;
    }),
    fetch(`${QURAN_API}/quran/verses/uthmani_tajweed?page_number=${page}`)
      .then((response) =>
        response.ok
          ? (response.json() as Promise<{
              verses: { verse_key: string; text_uthmani_tajweed: string }[];
            }>)
          : { verses: [] },
      )
      .catch(() => ({ verses: [] })),
  ]).then(([layout, tajweed]) => {
    const taggedByVerse = new Map(
      tajweed.verses.map((verse) => [verse.verse_key, verse.text_uthmani_tajweed]),
    );
    const words: MushafWord[] = [];
    const surahStarts: MushafPage["surahStarts"] = [];
    for (const verse of layout.verses) {
      const surah = Number(verse.verse_key.split(":")[0]);
      if (verse.verse_number === 1 && verse.words[0]) {
        surahStarts.push({ surah, line: verse.words[0].line_number });
      }
      const tagged = taggedByVerse.get(verse.verse_key);
      const colored = tagged ? tajweedWords(tagged) : [];
      // Si le découpage ne correspond pas mot pour mot (2 versets sur 6 236),
      // le verset s'affiche sans couleurs plutôt que mal coloré.
      const useColors = colored.length === verse.words.length;
      verse.words.forEach((word, index) => {
        const isEnd = word.char_type_name === "end";
        words.push({
          id: word.id,
          line: word.line_number,
          verseKey: verse.verse_key,
          isEnd,
          verseNumber: verse.verse_number,
          segments: isEnd ? [] : useColors ? colored[index] : [{ text: word.text_uthmani }],
        });
      });
    }
    return {
      page,
      words,
      surahStarts,
      juz: layout.verses[0]?.juz_number ?? 0,
      surah: Number(layout.verses[0]?.verse_key.split(":")[0] ?? 0),
    };
  });
  request.catch(() => pageCache.delete(page));
  pageCache.set(page, request);
  return request;
}

let fontRequest: Promise<void> | null = null;
function loadUthmanicFont(): Promise<void> {
  fontRequest ??= new FontFace("KFGQPC Uthmanic Hafs", `url(${UTHMANIC_FONT})`, {
    display: "block",
  })
    .load()
    .then((face) => {
      document.fonts.add(face);
    });
  fontRequest.catch(() => {
    fontRequest = null;
  });
  return fontRequest;
}

function MushafPageView({
  page,
  chapters,
  basmala,
  highlightedVerse,
  onVerseSelect,
  side,
  compact,
}: {
  page: number;
  chapters: MushafChapter[];
  basmala: string;
  highlightedVerse: string | null;
  onVerseSelect: (verseKey: string) => void;
  // Double page : page de droite (impaire) ou de gauche, pour la reliure.
  side: "right" | "left" | "single";
  // Petit écran : marges et cadre réduits pour laisser plus de place au texte.
  compact: boolean;
}) {
  const [data, setData] = useState<MushafPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [hoveredVerse, setHoveredVerse] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    Promise.all([fetchMushafPage(page), loadUthmanicFont()])
      .then(([pageData]) => {
        if (active) setData(pageData);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [page]);

  // Lignes 1 à 15 : mots, en-tête de sourate ou basmala.
  const lines = useMemo(() => {
    if (!data) return [];
    const byLine = new Map<number, MushafWord[]>();
    for (const word of data.words) {
      const list = byLine.get(word.line) ?? [];
      list.push(word);
      byLine.set(word.line, list);
    }
    const special = new Map<number, { kind: "header" | "basmala"; surah: number }>();
    for (const start of data.surahStarts) {
      if (start.surah !== 1 && start.surah !== 9) {
        special.set(start.line - 1, { kind: "basmala", surah: start.surah });
        special.set(start.line - 2, { kind: "header", surah: start.surah });
      } else {
        special.set(start.line - 1, { kind: "header", surah: start.surah });
      }
    }
    // En-tête de la sourate qui commence en haut de la page suivante.
    const nextSurah = chapters.find(
      (chapter) => chapter.startPage === page + 1 && HEADER_ON_PREVIOUS_PAGE.has(chapter.id),
    );
    if (nextSurah) special.set(15, { kind: "header", surah: nextSurah.id });
    const lastLine = page <= 2 ? Math.max(8, ...byLine.keys()) : 15;
    return Array.from({ length: lastLine }, (_, index) => {
      const number = index + 1;
      return { number, words: byLine.get(number) ?? [], special: special.get(number) };
    });
  }, [chapters, data, page]);

  // Taille du texte : la ligne la plus longue tient dans la largeur de la
  // page, sans étirer les lettres (seuls les espaces entre mots varient).
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const container = linesRef.current;
    if (!body || !container || !data) return;
    const measure = () => {
      const width = body.clientWidth;
      if (!width) return;
      const probe = 32;
      // On garde la taille appliquée pour la remettre après la mesure
      // (React ne la réécrit pas si elle ne change pas).
      const applied = container.style.fontSize;
      container.style.fontSize = `${probe}px`;
      let widest = 0;
      for (const line of container.querySelectorAll<HTMLElement>("[data-words]")) {
        let lineWidth = 0;
        for (const word of line.children) {
          // offsetWidth : largeur avant zoom (le transform ne la change pas).
          lineWidth += (word as HTMLElement).offsetWidth;
        }
        // Espace minimal entre les mots.
        lineWidth += (line.children.length - 1) * probe * 0.18;
        widest = Math.max(widest, lineWidth);
      }
      container.style.fontSize = applied;
      if (widest) setFontSize(Math.max(6, Math.floor((probe * width) / widest)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [data, lines]);

  const chapterName = (surah: number) =>
    chapters.find((chapter) => chapter.id === surah)?.nameArabic ?? "";

  return (
    <div className="n-mushaf-page" data-side={side} data-compact={compact || undefined}>
      <div className="n-mushaf-frame">
        {data && (
          <div className="n-mushaf-running" dir="rtl" lang="ar">
            <span>الجزء {arabicNumber.format(data.juz)}</span>
            <span>سورة {chapterName(data.surah)}</span>
          </div>
        )}
        <div className="n-mushaf-body" ref={bodyRef}>
          {!data && !failed && (
            <p className="n-mushaf-status" role="status">
              <Loader2 className="size-4 animate-spin" /> Chargement de la page {page}…
            </p>
          )}
          {failed && (
            <p className="n-mushaf-status" role="alert">
              Impossible de charger la page {page}. Vérifie ta connexion.
            </p>
          )}
          {data && (
            <div
              ref={linesRef}
              className="n-mushaf-lines"
              data-opening={page <= 2 || undefined}
              style={fontSize ? { fontSize } : undefined}
              dir="rtl"
              lang="ar"
              onMouseLeave={() => setHoveredVerse(null)}
            >
              {lines.map((line) => {
                if (line.special?.kind === "header") {
                  return (
                    <div key={line.number} className="n-mushaf-header">
                      <span className="n-mushaf-band">سورة {chapterName(line.special.surah)}</span>
                    </div>
                  );
                }
                if (line.special?.kind === "basmala") {
                  return (
                    <div key={line.number} className="n-mushaf-basmala">
                      <span>{basmala}</span>
                    </div>
                  );
                }
                if (!line.words.length) return <div key={line.number} className="n-mushaf-line" />;
                return (
                  <div key={line.number} className="n-mushaf-line" data-words>
                    {line.words.map((word) => (
                      <span
                        key={word.id}
                        className={word.isEnd ? "n-mushaf-word n-mushaf-ayah" : "n-mushaf-word"}
                        data-active={word.verseKey === highlightedVerse || undefined}
                        data-hover={
                          (word.verseKey === hoveredVerse && word.verseKey !== highlightedVerse) ||
                          undefined
                        }
                        onMouseEnter={() => setHoveredVerse(word.verseKey)}
                        onClick={() => onVerseSelect(word.verseKey)}
                        role="button"
                        tabIndex={word.isEnd ? 0 : -1}
                        aria-label={word.isEnd ? `Écouter le verset ${word.verseKey}` : undefined}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onVerseSelect(word.verseKey);
                          }
                        }}
                      >
                        {word.isEnd
                          ? arabicNumber.format(word.verseNumber)
                          : word.segments.map((segment, index) =>
                              segment.group ? (
                                <span key={index} data-tajweed={segment.group}>
                                  {segment.text}
                                </span>
                              ) : (
                                segment.text
                              ),
                            )}
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <p className="n-mushaf-number" lang="ar">
          {arabicNumber.format(page)}
        </p>
      </div>
    </div>
  );
}

const LEGEND: { group: string; label: string }[] = [
  { group: "madd", label: "Madd (allongement)" },
  { group: "ghunnah", label: "Ghunna, ikhfa, iqlab (nasalisation)" },
  { group: "qalqalah", label: "Qalqala" },
  { group: "silent", label: "Lettres non prononcées, idgham" },
];

export function QuranMushaf({
  page,
  onPageChange,
  chapters,
  basmala,
  highlightedVerse,
  onVerseSelect,
  showTajweed,
  isActive,
}: {
  page: number;
  onPageChange: (page: number) => void;
  chapters: MushafChapter[];
  basmala: string;
  highlightedVerse: string | null;
  onVerseSelect: (verseKey: string) => void;
  showTajweed: boolean;
  isActive: boolean;
}) {
  // Zoom du mushaf seul (le lecteur ne bouge pas) : null = pleine largeur,
  // sinon l'échelle choisie avec − / +.
  const [zoom, setZoom] = useState<number | null>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [bookHeight, setBookHeight] = useState(0);
  // Saisie en cours dans le champ « Page » (null : affiche la page courante).
  const [pageDraft, setPageDraft] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(entry.contentRect.width));
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // Hauteur du livre mis en forme, avant zoom (le transform ne la change pas).
  useEffect(() => {
    const book = bookRef.current;
    if (!book) return;
    const observer = new ResizeObserver(() => setBookHeight(book.offsetHeight));
    observer.observe(book);
    return () => observer.disconnect();
  }, []);

  // Double page (livre ouvert) sur grand écran.
  const isWide = availableWidth >= 820;
  // Double page : la page impaire à droite, la paire à gauche.
  const spreadStart = isWide ? (page % 2 === 1 ? page : page - 1) : page;
  const visiblePages = isWide
    ? [spreadStart, spreadStart + 1].filter((item) => item >= 1 && item <= MUSHAF_PAGES)
    : [page];
  const step = isWide ? 2 : 1;
  const goTo = (target: number) =>
    onPageChange(Math.min(MUSHAF_PAGES, Math.max(1, Math.round(target))));
  const goNext = () => goTo((isWide ? spreadStart : page) + step);
  const goPrevious = () => goTo((isWide ? spreadStart : page) - step);

  // Sens de lecture arabe : flèche gauche = page suivante.
  const navRef = useRef({ goNext, goPrevious });
  useEffect(() => {
    navRef.current = { goNext, goPrevious };
  });
  useEffect(() => {
    if (!isActive) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        navRef.current.goNext();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        navRef.current.goPrevious();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isActive]);

  const currentChapter = [...chapters].reverse().find((chapter) => chapter.startPage <= page);

  // Par défaut, le livre prend toute la largeur disponible (choix de
  // Sarah) ; on peut ensuite réduire ou agrandir avec − / +.
  const bookWidth = PAGE_LAYOUT_WIDTH * visiblePages.length;
  const fitScale = availableWidth ? Math.max(0.3, Math.min(availableWidth / bookWidth, 2.5)) : 1;
  const scale = zoom ?? fitScale;
  const changeZoom = (factor: number) =>
    setZoom(Math.min(2.5, Math.max(0.3, Number((scale * factor).toFixed(3)))));

  return (
    <div className={`n-mushaf ${showTajweed ? "" : "n-mushaf-plain"}`} ref={rootRef}>
      <div className="n-mushaf-nav">
        <button
          type="button"
          className="n-mushaf-next n-btn n-btn-ghost px-3! py-2! text-sm!"
          onClick={goNext}
          disabled={visiblePages[visiblePages.length - 1] >= MUSHAF_PAGES}
        >
          <ChevronLeft className="size-4" /> Page suivante
        </button>
        <div className="n-mushaf-goto flex flex-wrap items-center justify-center gap-2">
          <label className="flex items-center gap-1.5 text-[13px] font-semibold">
            Page
            <input
              type="number"
              min={1}
              max={MUSHAF_PAGES}
              value={pageDraft ?? String(page)}
              onChange={(event) => setPageDraft(event.target.value)}
              onBlur={() => {
                const value = Number(pageDraft);
                if (pageDraft !== null && value >= 1 && value <= MUSHAF_PAGES) goTo(value);
                setPageDraft(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
              }}
              className="n-input h-9! w-20 text-center tabular-nums"
              aria-label="Aller à la page"
            />
            <span className="font-normal text-(--n-muted)">/ {MUSHAF_PAGES}</span>
          </label>
          <select
            className="n-select h-9!"
            value={currentChapter?.id ?? ""}
            onChange={(event) => {
              const chapter = chapters.find((item) => item.id === Number(event.target.value));
              if (chapter) goTo(chapter.startPage);
            }}
            aria-label="Aller à une sourate"
            disabled={!chapters.length}
          >
            {chapters.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {chapter.id}. {chapter.nameSimple}
                {chapter.nameFrench ? ` (${chapter.nameFrench})` : ""} - {chapter.nameArabic}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="n-mushaf-prev n-btn n-btn-ghost px-3! py-2! text-sm!"
          onClick={goPrevious}
          disabled={visiblePages[0] <= 1}
        >
          Page précédente <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="n-mushaf-zoom" role="group" aria-label="Zoom du mushaf">
        <button
          type="button"
          className="n-icon-btn"
          onClick={() => changeZoom(1 / 1.15)}
          disabled={scale <= 0.3}
          aria-label="Dézoomer"
        >
          <ZoomOut className="size-4" />
        </button>
        <span className="min-w-12 text-center text-[13px] tabular-nums text-(--n-muted)">
          {Math.round(scale * 100)} %
        </span>
        <button
          type="button"
          className="n-icon-btn"
          onClick={() => changeZoom(1.15)}
          disabled={scale >= 2.5}
          aria-label="Zoomer"
        >
          <ZoomIn className="size-4" />
        </button>
        <button
          type="button"
          className="n-btn n-btn-ghost px-3! py-1.5! text-[13px]!"
          onClick={() => setZoom(null)}
          disabled={zoom === null}
        >
          <Maximize2 className="size-3.5" /> Pleine largeur
        </button>
      </div>

      {/* Livre mis en forme à taille fixe puis mis à l'échelle : le cadre
          extérieur prend la taille zoomée, le contenu ne bouge pas. */}
      <div className="n-mushaf-viewport">
        <div
          className="n-mushaf-scaled"
          style={{ width: bookWidth * scale, height: bookHeight ? bookHeight * scale : undefined }}
        >
          <div
            ref={bookRef}
            className="n-mushaf-spread"
            dir="rtl"
            data-double={visiblePages.length === 2 || undefined}
            style={{ width: bookWidth, transform: `scale(${scale})` }}
          >
            {visiblePages.map((item, index) => (
              <MushafPageView
                key={item}
                side={visiblePages.length === 2 ? (index === 0 ? "right" : "left") : "single"}
                compact={availableWidth > 0 && availableWidth < 640}
                page={item}
                chapters={chapters}
                basmala={basmala}
                highlightedVerse={highlightedVerse}
                onVerseSelect={onVerseSelect}
              />
            ))}
          </div>
        </div>
      </div>

      {showTajweed && (
        <ul className="n-mushaf-legend" aria-label="Couleurs du tajwid">
          {LEGEND.map((item) => (
            <li key={item.group}>
              <span className="n-mushaf-legend-dot" data-tajweed={item.group} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
