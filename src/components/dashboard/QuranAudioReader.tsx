import {
  readQuranResumePosition,
  saveQuranResumePosition,
  type QuranResumePosition,
} from "@/components/dashboard/quranPlaybackResume";
import {
  BookOpen,
  Loader2,
  Pause,
  Play,
  Repeat2,
  ChevronsLeft,
  ChevronsRight,
  Search,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { QuranMushaf } from "@/components/dashboard/QuranMushaf";
import {
  fetchMushafChapters,
  fetchVersePages,
  type MushafChapter,
} from "@/components/dashboard/quranMushafData";

// Mode d'affichage de la page Coran, mémorisé sur l'appareil.
const VIEW_MODE_KEY = "rawdah-quran-view-mode";
function readViewMode(): "lecture" | "mushaf" {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === "mushaf" ? "mushaf" : "lecture";
  } catch {
    return "lecture";
  }
}

// Les navigateurs (Safari sur iPhone en premier) bloquent un son lancé après
// un chargement, hors du geste de l'utilisatrice. Jouer un son silencieux
// très court pendant le clic autorise ensuite la lecture du verset.
let silentAudioUrl: string | null = null;
function unlockAudioPlayback() {
  try {
    if (!silentAudioUrl) {
      const samples = 400;
      const wav = new DataView(new ArrayBuffer(44 + samples));
      const text = (offset: number, value: string) =>
        [...value].forEach((char, i) => wav.setUint8(offset + i, char.charCodeAt(0)));
      text(0, "RIFF");
      wav.setUint32(4, 36 + samples, true);
      text(8, "WAVE");
      text(12, "fmt ");
      wav.setUint32(16, 16, true);
      wav.setUint16(20, 1, true); // PCM
      wav.setUint16(22, 1, true); // mono
      wav.setUint32(24, 8000, true);
      wav.setUint32(28, 8000, true);
      wav.setUint16(32, 1, true);
      wav.setUint16(34, 8, true);
      text(36, "data");
      wav.setUint32(40, samples, true);
      for (let i = 0; i < samples; i++) wav.setUint8(44 + i, 128); // silence
      silentAudioUrl = URL.createObjectURL(new Blob([wav.buffer], { type: "audio/wav" }));
    }
    void new Audio(silentAudioUrl).play().catch(() => undefined);
  } catch {
    // Sans ce déblocage, le lecteur reste placé sur le verset : un appui suffit.
  }
}

const QDC_API = "https://api.quran.com/api/v4";
const CHAPTER_AUDIO_API = "https://api.qurancdn.com/api/qdc/audio/reciters";
const MP3QURAN_TIMING_API = "https://www.mp3quran.net/api/v3/ayat_timing";
const MP3QURAN_AUDIO = "https://cdn.mp3quran.net/audio/";
const AUDIO_CDN = "https://verses.quran.com/";
const ALQURAN_API = "https://api.alquran.cloud/v1";

type Surah = {
  number: number;
  name: string;
  englishName: string;
  numberOfAyahs: number;
  revelationType?: string;
};

type Reciter = {
  identifier: string;
  englishName: string;
  name: string;
  // Sourate entière + minutage : Quran.com (numéro de récitation) ou
  // mp3quran.net (numéro de lecture et dossier audio).
  source: "quran.com" | "mp3quran";
  sourceId: string;
  folder?: string;
  // Numéro de la lecture verset par verset chez Quran.com, utilisée en
  // secours si le fichier de la sourate entière ne répond pas.
  verseRecitation?: string;
};

// Récitateurs choisis par Sarah (2026-11-28), tous en sourate entière avec
// minutage (écoute écran verrouillé). Yasser Al-Dosari par défaut.
const RECITERS: Reciter[] = [
  { identifier: "qdc-97", englishName: "Yasser Al-Dosari", name: "Yasser Al-Dosari", source: "quran.com", sourceId: "97" },
  { identifier: "mp3-30", englishName: "Saad Al-Ghamdi", name: "Saad Al-Ghamdi", source: "mp3quran", sourceId: "30", folder: "saad-ghamdi/r1/" },
  { identifier: "qdc-5", englishName: "Hani Ar-Rifai", name: "Hani Ar-Rifai", source: "quran.com", sourceId: "5", verseRecitation: "5" },
  { identifier: "qdc-6", englishName: "Mahmoud Khalil Al-Husary", name: "Mahmoud Khalil Al-Husary", source: "quran.com", sourceId: "6", verseRecitation: "6" },
  { identifier: "qdc-2", englishName: "Abdul Basit Abdus Samad (Murattal)", name: "Abdul Basit Abdus Samad (Murattal)", source: "quran.com", sourceId: "2", verseRecitation: "2" },
  { identifier: "mp3-133", englishName: "Maher Al-Muaiqly (Mujawwad)", name: "Maher Al-Muaiqly (Mujawwad)", source: "mp3quran", sourceId: "133", folder: "maher-muaiqly/r3/" },
  { identifier: "qdc-3", englishName: "Abdul Rahman Al-Sudais", name: "Abdul Rahman Al-Sudais", source: "quran.com", sourceId: "3", verseRecitation: "3" },
  { identifier: "qdc-10", englishName: "Saud Al-Shuraim", name: "Saud Al-Shuraim", source: "quran.com", sourceId: "10", verseRecitation: "10" },
  { identifier: "qdc-4", englishName: "Abu Bakr Al-Shatri", name: "Abu Bakr Al-Shatri", source: "quran.com", sourceId: "4", verseRecitation: "4" },
];
const DEFAULT_RECITER = "qdc-97"; // Yasser Al-Dosari

type Ayah = {
  numberInSurah: number;
  text: string;
  audio: string;
};

// Fichier de la sourate entière et minutage de chaque verset (en ms).
// Un seul son continu : c'est ce qui permet d'écouter écran verrouillé.
type ChapterAudio = {
  url: string;
  timings: { verse: number; from: number; to: number }[];
};

type SurahAudio = Surah & { ayahs: Ayah[]; chapter: ChapterAudio | null };

type TranslitAyah = { numberInSurah: number; text: string };

type QuranJson = {
  sourates: {
    position: number;
    nom: string;
    nom_phonetique: string;
    englishNameTranslation: string;
    revelation: string;
    versets: {
      position: number;
      text: string;
      position_ds_sourate: number;
      text_arabe: string;
    }[];
  }[];
};

export type QuranPlaybackProgress = {
  surah: string;
  startAyah: number;
  lastCompletedAyah: number;
  reciter: string;
};

type QdcAudioFile = {
  verse_key: string;
  url: string;
};

function surahsFromJson(json: QuranJson): Surah[] {
  return json.sourates.map((s) => ({
    number: s.position,
    name: s.nom,
    englishName: s.nom_phonetique,
    numberOfAyahs: s.versets.length,
    revelationType: s.revelation === "mecquoise" ? "Meccan" : "Medinan",
  }));
}

// Liste des versets de la sourate ; `audio` n'est rempli qu'en lecture
// verset par verset (secours).
function buildSurahAudio(
  surah: Surah,
  files: QdcAudioFile[],
  chapter: ChapterAudio | null,
): SurahAudio {
  const audioByVerse = new Map(
    files.map((f) => [Number(f.verse_key.split(":")[1]), `${AUDIO_CDN}${f.url}`]),
  );
  const ayahs: Ayah[] = Array.from({ length: surah.numberOfAyahs }, (_, index) => ({
    numberInSurah: index + 1,
    text: "",
    audio: audioByVerse.get(index + 1) ?? "",
  }));
  return { ...surah, ayahs, chapter };
}

// Audio d'une sourate pour un récitateur : sourate entière avec minutage,
// sinon lecture verset par verset chez Quran.com quand elle existe.
async function loadSurahAudio(
  surah: Surah,
  reciter: Reciter,
  signal: AbortSignal,
): Promise<SurahAudio> {
  const chapter = await fetchChapterAudio(reciter, surah.number, signal);
  if (chapter && chapter.timings.length === surah.numberOfAyahs) {
    return buildSurahAudio(surah, [], chapter);
  }
  if (reciter.verseRecitation) {
    const verseFiles = await fetchQdc<{ audio_files: QdcAudioFile[] }>(
      `${QDC_API}/quran/recitations/${reciter.verseRecitation}?chapter_number=${surah.number}`,
      signal,
    );
    return buildSurahAudio(surah, verseFiles.audio_files, null);
  }
  throw new Error("Cette récitation est indisponible pour le moment. Réessaie plus tard ou choisis un autre récitateur.");
}

type QdcChapterFile = {
  audio_url?: string;
  verse_timings?: { verse_key: string; timestamp_from: number; timestamp_to: number }[];
};

// Fichier de la sourate entière avec son minutage. Null si indisponible :
// le lecteur repasse alors en lecture verset par verset.
async function fetchChapterAudio(
  reciter: Reciter,
  chapter: number,
  signal: AbortSignal,
): Promise<ChapterAudio | null> {
  if (reciter.source === "mp3quran") return fetchMp3QuranChapter(reciter, chapter, signal);
  try {
    const data = await fetchQdc<{ audio_files: QdcChapterFile[] }>(
      `${CHAPTER_AUDIO_API}/${reciter.sourceId}/audio_files?chapter=${chapter}&segments=true`,
      signal,
    );
    const file = data.audio_files[0];
    if (!file?.audio_url || !file.verse_timings?.length) return null;
    const timings = file.verse_timings
      .map((t) => ({
        verse: Number(t.verse_key.split(":")[1]),
        from: t.timestamp_from,
        to: t.timestamp_to,
      }))
      .sort((a, b) => a.verse - b.verse);
    return { url: file.audio_url, timings };
  } catch (cause) {
    if (signal.aborted) throw cause;
    return null;
  }
}

// mp3quran.net : fichier `<dossier>/<001>.mp3` et minutage par verset (ms).
// Le premier verset démarre au début du fichier, pour garder l'ouverture
// (isti'adha, basmala) que le minutage place avant.
async function fetchMp3QuranChapter(
  reciter: Reciter,
  chapter: number,
  signal: AbortSignal,
): Promise<ChapterAudio | null> {
  if (!reciter.folder) return null;
  try {
    const data = await fetchQdc<{ ayah: number; start_time: number; end_time: number }[]>(
      `${MP3QURAN_TIMING_API}?surah=${chapter}&read=${reciter.sourceId}`,
      signal,
    );
    const timings = data
      .filter((item) => item.ayah >= 1)
      .map((item) => ({ verse: item.ayah, from: item.start_time, to: item.end_time }))
      .sort((a, b) => a.verse - b.verse);
    if (!timings.length) return null;
    timings[0] = { ...timings[0], from: 0 };
    return {
      url: `${MP3QURAN_AUDIO}${reciter.folder}${String(chapter).padStart(3, "0")}.mp3`,
      timings,
    };
  } catch (cause) {
    if (signal.aborted) throw cause;
    return null;
  }
}

async function fetchQdc<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Le service de lecture est indisponible.");
  return (await response.json()) as T;
}

async function fetchTransliteration(
  surahNumber: number,
  signal: AbortSignal,
): Promise<TranslitAyah[]> {
  try {
    const response = await fetch(
      `${ALQURAN_API}/surah/${surahNumber}/en.transliteration`,
      { signal },
    );
    if (!response.ok) return [];
    const result = (await response.json()) as {
      code: number;
      data: { ayahs: { numberInSurah: number; text: string }[] };
    };
    if (result.code !== 200) return [];
    return result.data.ayahs;
  } catch {
    return [];
  }
}

export function QuranAudioReader({
  isSavingProgress,
  onSaveProgress,
  resumePosition = null,
  isActive = true,
  onOpen,
  followAyah = true,
}: {
  isSavingProgress: boolean;
  onSaveProgress: (progress: QuranPlaybackProgress) => Promise<boolean>;
  resumePosition?: QuranResumePosition | null;
  // Faux quand on est sur une autre page : le lecteur reste monté pour que
  // l'écoute continue, et seule la mini-fenêtre est affichée.
  isActive?: boolean;
  onOpen?: () => void;
  // Faux pendant la saisie d'une note : l'audio continue mais la page ne
  // défile plus. Au retour à vrai, la page revient sur le verset en cours.
  followAyah?: boolean;
}) {
  const [surahs, setSurahs] = useState<Surah[]>([]);
  const reciters = RECITERS;
  const [basmala, setBasmala] = useState("");
  const [selectedSurah, setSelectedSurah] = useState(1);
  const [selectedReciter, setSelectedReciter] = useState(DEFAULT_RECITER);
  const [surahData, setSurahData] = useState<SurahAudio | null>(null);
  const [quranJsonData, setQuranJsonData] = useState<QuranJson | null>(null);
  const [translitAyahs, setTranslitAyahs] = useState<TranslitAyah[]>([]);
  const [startAyah, setStartAyah] = useState(1);
  const [endAyah, setEndAyah] = useState(1);
  const [currentAyah, setCurrentAyah] = useState(1);
  const [repeatCount, setRepeatCount] = useState(1);
  const [showTransliteration, setShowTransliteration] = useState(true);
  const [showTranslation, setShowTranslation] = useState(true);
  const [repeatNumber, setRepeatNumber] = useState(1);
  const [lastCompletedAyah, setLastCompletedAyah] = useState(0);
  const [isProgressSaved, setIsProgressSaved] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [endBehavior, setEndBehavior] = useState<"stop" | "next" | "repeat">("stop");
  const [showMiniOptions, setShowMiniOptions] = useState(false);
  // Lecture à relancer une fois la nouvelle sourate (ou le récitateur) chargé.
  const autoplayAfterLoadRef = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [surahQuery, setSurahQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const pendingResumeRef = useRef<QuranResumePosition | null>(null);
  const appliedResumeRef = useRef<string | null>(null);
  // Demande de reprise déjà appliquée : elle ne doit plus jamais revenir
  // (sinon changer de sourate ou de récitateur la réappliquerait).
  const consumedResumeRef = useRef<QuranResumePosition | null>(null);
  const hasInteractedRef = useRef(false);
  // Dernière écoute enregistrée sur l'appareil, lue une fois à l'ouverture
  // (avant que la nouvelle session ne l'écrase), pour le bouton « Reprendre ».
  const [savedPosition, setSavedPosition] = useState(readQuranResumePosition);
  // Reprise demandée dans le lecteur (bouton « Reprendre », clic sur un
  // verset du mushaf). `over` : la demande d'« Aujourd'hui » en cours à ce
  // moment-là ; une nouvelle demande d'« Aujourd'hui » repasse devant.
  const [localResume, setLocalResume] = useState<{
    position: QuranResumePosition;
    over: QuranResumePosition | null;
  } | null>(null);
  const playAfterResumeRef = useRef(false);
  const resumeTarget =
    localResume && localResume.over === resumePosition ? localResume.position : resumePosition;
  // Mode Mushaf : page affichée, sourates (noms et pages), page de chaque
  // verset de la sourate en cours, couleurs du tajwid.
  const [viewMode, setViewMode] = useState(readViewMode);
  const [showTajweed, setShowTajweed] = useState(true);
  const [mushafPage, setMushafPage] = useState(1);
  const [mushafFollow, setMushafFollow] = useState(true);
  const [mushafChapters, setMushafChapters] = useState<MushafChapter[]>([]);
  const [versePages, setVersePages] = useState<{ surah: number; pages: Map<number, number> } | null>(null);
  const selectedSurahData = surahs.find(
    (surah) => surah.number === selectedSurah,
  );
  const selectedReciterData = reciters.find(
    (reciter) => reciter.identifier === selectedReciter,
  );

  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;
    // Texte du Coran ; l'audio de la sourate est chargé ensuite par l'effet
    // qui suit (sourate et récitateur choisis).
    fetch("https://raw.githubusercontent.com/mehdi-stark/Coran-Quran/master/quran.json", { signal })
      .then(async (quranResponse) => {
        if (!quranResponse.ok) throw new Error("Impossible de charger le texte du Coran.");
        const quranJson = await quranResponse.json() as QuranJson;
        setQuranJsonData(quranJson);
        setSurahs(surahsFromJson(quranJson));
        setBasmala(quranJson.sourates[0].versets[0].text_arabe.replace(/^\uFEFF/, "").trim());
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Impossible de joindre le service de lecture.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!reciters.length || !reciters.some((reciter) => reciter.identifier === selectedReciter))
      return;
    const surah = surahs.find((s) => s.number === selectedSurah);
    const reciter = reciters.find((item) => item.identifier === selectedReciter);
    if (!surah || !reciter) return;
    const controller = new AbortController();
    const signal = controller.signal;
    setIsLoading(true);
    setError(null);
    // L'élément audio reste le même : on coupe le verset en cours pendant
    // le chargement de la nouvelle sourate ou du nouveau récitateur.
    audioRef.current?.pause();
    setIsPlaying(false);
    setLastCompletedAyah(0);
    setIsProgressSaved(false);
    Promise.all([
      loadSurahAudio(surah, reciter, signal),
      fetchTransliteration(selectedSurah, signal),
    ])
      .then(([audioData, translit]) => {
        setSurahData(audioData);
        setTranslitAyahs(translit);
        const pendingResume = pendingResumeRef.current;
        if (
          pendingResume &&
          pendingResume.surahNumber === audioData.number &&
          pendingResume.reciterIdentifier === selectedReciter
        ) {
          const ayah = Math.min(
            Math.max(pendingResume.ayah, 1),
            audioData.numberOfAyahs,
          );
          setStartAyah(ayah);
          setEndAyah(
            Math.min(Math.max(pendingResume.endAyah, ayah), audioData.numberOfAyahs),
          );
          setCurrentAyah(ayah);
          pendingResumeRef.current = null;
          appliedResumeRef.current = `${audioData.number}:${ayah}:${selectedReciter}`;
          hasInteractedRef.current = true;
        } else {
          setStartAyah(1);
          setEndAyah(audioData.numberOfAyahs);
          setCurrentAyah(1);
        }
        setRepeatNumber(1);
        if (autoplayAfterLoadRef.current) {
          autoplayAfterLoadRef.current = false;
          hasInteractedRef.current = true;
          setIsPlaying(true);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Impossible de charger cette sourate.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [selectedReciter, selectedSurah, reciters, surahs]);

  useEffect(() => {
    const resumePosition = resumeTarget;
    if (!resumePosition || !surahs.length || !reciters.length) return;
    if (consumedResumeRef.current === resumePosition) return;
    const normalizedSurahName = resumePosition.surah
      .toLocaleLowerCase("en")
      .replace(/[^a-z0-9]/g, "");
    const surah = surahs.find(
      (item) =>
        item.number === resumePosition.surahNumber ||
        item.englishName.toLocaleLowerCase("en").replace(/[^a-z0-9]/g, "") ===
          normalizedSurahName,
    );
    if (!surah) return;

    const requestedReciter = reciters.find(
      (item) =>
        item.identifier === resumePosition.reciterIdentifier ||
        (resumePosition.reciter !== "" &&
          item.englishName.toLocaleLowerCase("en") ===
            resumePosition.reciter.toLocaleLowerCase("en")),
    );
    const reciterIdentifier = requestedReciter?.identifier ?? selectedReciter;
    const resumeKey = `${surah.number}:${resumePosition.ayah}:${reciterIdentifier}`;
    if (appliedResumeRef.current === resumeKey) return;

    const target: QuranResumePosition = {
      ...resumePosition,
      surahNumber: surah.number,
      surah: surah.englishName,
      endAyah: Math.min(resumePosition.endAyah, surah.numberOfAyahs),
      reciterIdentifier,
      reciter:
        requestedReciter?.englishName ??
        reciters.find((item) => item.identifier === reciterIdentifier)
          ?.englishName ??
        resumePosition.reciter,
    };
    pendingResumeRef.current = target;
    hasInteractedRef.current = true;
    consumedResumeRef.current = resumePosition;

    const loadedSurah = surahData;
    if (
      loadedSurah?.number === surah.number &&
      selectedReciter === reciterIdentifier
    ) {
      const ayah = Math.min(
        Math.max(target.ayah, 1),
        loadedSurah.numberOfAyahs,
      );
      setStartAyah(ayah);
      setEndAyah(
        Math.min(Math.max(target.endAyah, ayah), loadedSurah.numberOfAyahs),
      );
      setCurrentAyah(ayah);
      pendingResumeRef.current = null;
      appliedResumeRef.current = resumeKey;
      if (playAfterResumeRef.current) {
        playAfterResumeRef.current = false;
        setRepeatNumber(1);
        setIsPlaying(true);
      }
    } else {
      // La lecture repart une fois la sourate (ou le récitateur) chargée.
      autoplayAfterLoadRef.current = playAfterResumeRef.current;
      playAfterResumeRef.current = false;
      setSelectedSurah(surah.number);
      setSelectedReciter(reciterIdentifier);
    }
  }, [reciters, resumeTarget, selectedReciter, surahData, surahs]);

  const resumeSavedPosition = () => {
    if (!savedPosition) return;
    unlockAudioPlayback();
    playAfterResumeRef.current = true;
    appliedResumeRef.current = null;
    setLocalResume({ position: { ...savedPosition }, over: resumePosition });
    setSavedPosition(null);
  };

  const changeViewMode = (mode: "lecture" | "mushaf") => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // Stockage indisponible : le mode n'est pas mémorisé.
    }
  };

  useEffect(() => {
    if (viewMode !== "mushaf" || mushafChapters.length) return;
    let active = true;
    fetchMushafChapters()
      .then((chapters) => {
        if (active) setMushafChapters(chapters);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [viewMode, mushafChapters.length]);

  useEffect(() => {
    if (viewMode !== "mushaf") return;
    let active = true;
    fetchVersePages(selectedSurah)
      .then((pages) => {
        if (active) setVersePages({ surah: selectedSurah, pages });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [viewMode, selectedSurah]);

  useEffect(() => {
    if (
      !hasInteractedRef.current ||
      !surahData ||
      surahData.number !== selectedSurah ||
      !selectedSurahData ||
      !selectedReciterData
    ) {
      return;
    }
    saveQuranResumePosition({
      surahNumber: selectedSurah,
      surah: selectedSurahData.englishName,
      ayah: currentAyah,
      endAyah,
      reciterIdentifier: selectedReciter,
      reciter: selectedReciterData.englishName,
    });
  }, [
    currentAyah,
    endAyah,
    isPlaying,
    selectedReciter,
    selectedReciterData,
    selectedSurah,
    selectedSurahData,
    surahData,
  ]);

  const activeAyah = surahData?.ayahs.find(
    (ayah) => ayah.numberInSurah === currentAyah,
  );
  const chapter = surahData?.chapter ?? null;
  // Source : la sourate entière quand son minutage existe (écoute écran
  // verrouillé possible), sinon le fichier du verset en cours.
  const audioSource = chapter ? chapter.url : activeAyah?.audio;
  const timingOf = (ayahNumber: number) =>
    chapter?.timings.find((timing) => timing.verse === ayahNumber);

  // Un seul élément <audio> pour toute l'écoute, dont on change la source.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !audioSource) return;
    if (audio.getAttribute("src") !== audioSource) audio.setAttribute("src", audioSource);
  }, [audioSource]);

  // Sourate entière : quand un verset est choisi (clic, reprise, boutons), on
  // saute à son début dans le fichier. Pendant l'écoute normale, le son est
  // déjà dans le bon verset et rien ne bouge.
  useEffect(() => {
    const audio = audioRef.current;
    const timing = chapter?.timings.find((item) => item.verse === currentAyah);
    if (!audio || !timing) return;
    const position = audio.currentTime * 1000;
    if (position < timing.from - 250 || position >= timing.to) {
      audio.currentTime = timing.from / 1000;
    }
  }, [chapter, currentAyah]);

  // Valeurs à jour pour les événements audio, qui peuvent arriver plusieurs
  // fois avant le rendu suivant.
  const currentAyahRef = useRef(currentAyah);
  const repeatNumberRef = useRef(repeatNumber);
  useEffect(() => {
    currentAyahRef.current = currentAyah;
  }, [currentAyah]);
  useEffect(() => {
    repeatNumberRef.current = repeatNumber;
  }, [repeatNumber]);
  const setAyah = (ayahNumber: number) => {
    currentAyahRef.current = ayahNumber;
    setCurrentAyah(ayahNumber);
  };

  useEffect(() => {
    if (!isPlaying || isLoading) return;
    const audio = audioRef.current;
    if (!audio) return;
    // Sourate entière : après un arrêt en fin de plage, le son est au début
    // du verset suivant. On le replace au début du verset affiché.
    const timing = surahData?.chapter?.timings.find((item) => item.verse === currentAyah);
    if (timing) {
      const position = audio.currentTime * 1000;
      if (position < timing.from - 250 || position >= timing.to) {
        audio.currentTime = timing.from / 1000;
      }
    }
    void audio.play().catch(() => setIsPlaying(false));
  }, [currentAyah, isLoading, isPlaying, surahData]);

  // Place tout de suite la lecture au début d'un verset, dans le même
  // élément audio (saut dans la sourate entière, ou fichier du verset).
  const playAyahNow = (ayahNumber: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const timing = timingOf(ayahNumber);
    if (chapter && timing) {
      if (audio.getAttribute("src") !== chapter.url) audio.setAttribute("src", chapter.url);
      audio.currentTime = timing.from / 1000;
    } else {
      const url = surahData?.ayahs.find((ayah) => ayah.numberInSurah === ayahNumber)?.audio;
      if (!url) return;
      if (audio.getAttribute("src") !== url) audio.setAttribute("src", url);
      else audio.currentTime = 0;
    }
    if (audio.paused) void audio.play().catch(() => setIsPlaying(false));
  };
  const showsBasmala = selectedSurah !== 1 && selectedSurah !== 9 && !!basmala;
  const jsonVerses = quranJsonData?.sourates[selectedSurah - 1]?.versets;
  const ayahArabic = (ayah: Ayah) => {
    const fromJson = jsonVerses?.find(
      (verse) => verse.position_ds_sourate === ayah.numberInSurah,
    )?.text_arabe;
    if (fromJson) return fromJson;
    const raw = ayah.text.replace(/^\uFEFF/, "").trim();
    return ayah.numberInSurah === 1 && showsBasmala && raw.startsWith(basmala)
      ? raw.slice(basmala.length).trim()
      : raw;
  };
  const normalizedQuery = surahQuery
    .trim()
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f'’-]/g, "");
  const visibleSurahs = normalizedQuery
    ? surahs.filter(
        (surah) =>
          String(surah.number) === normalizedQuery ||
          surah.englishName
            .toLocaleLowerCase("en")
            .replace(/['’-]/g, "")
            .includes(normalizedQuery) ||
          surah.name.includes(surahQuery.trim()),
      )
    : surahs;

  // Suivi du verset en cours : seulement si l'utilisatrice regarde les
  // versets. Si elle a fait défiler la page (vers la carte de note, par
  // exemple), le verset précédent n'est plus à l'écran et on ne la ramène
  // pas en haut ; le suivi reprend dès qu'elle revient sur les versets.
  // Quand la carte de note se referme, on revient toujours au verset.
  const followedAyahRef = useRef(currentAyah);
  const previousFollowRef = useRef(followAyah);
  const previousActiveRef = useRef(isActive);
  useEffect(() => {
    const previousAyah = followedAyahRef.current;
    const followResumed = followAyah && !previousFollowRef.current;
    const pageReopened = isActive && !previousActiveRef.current;
    followedAyahRef.current = currentAyah;
    previousFollowRef.current = followAyah;
    previousActiveRef.current = isActive;
    if (!isActive || !followAyah) return;

    // Retour sur la page Coran pendant une écoute : on se place sur le verset
    // en cours, après le défilement vers le haut de la page fait par la
    // navigation.
    if (pageReopened) {
      if (!hasStarted) return;
      window.setTimeout(() => {
        document
          .getElementById(`quran-ayah-${currentAyahRef.current}`)
          ?.scrollIntoView({ block: "center" });
      }, 350);
      return;
    }
    if (!isPlaying) return;

    if (!followResumed) {
      const previous = document.getElementById(`quran-ayah-${previousAyah}`);
      if (previous) {
        const rect = previous.getBoundingClientRect();
        const isOnScreen = rect.bottom > 0 && rect.top < window.innerHeight;
        if (!isOnScreen) return;
      }
    }
    document
      .getElementById(`quran-ayah-${currentAyah}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [currentAyah, isActive, isPlaying, followAyah, hasStarted]);

  // Téléphone déverrouillé (ou onglet rouvert) pendant une écoute : les
  // versets ont avancé sans que la page suive. On se place sur le verset en
  // cours.
  const followStateRef = useRef({ isActive, followAyah, hasStarted });
  useEffect(() => {
    followStateRef.current = { isActive, followAyah, hasStarted };
  });
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      const state = followStateRef.current;
      if (!state.isActive || !state.followAyah || !state.hasStarted) return;
      document
        .getElementById(`quran-ayah-${currentAyahRef.current}`)
        ?.scrollIntoView({ block: "center" });
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);
  // Fin du verset en cours (fin du fichier, ou fin de son minutage dans la
  // sourate entière) : répétition, verset suivant ou fin de la plage.
  const handleVerseEnd = () => {
    const ayah = currentAyahRef.current;
    if (repeatCount === 0 || repeatNumberRef.current < repeatCount) {
      repeatNumberRef.current += 1;
      setRepeatNumber(repeatNumberRef.current);
      playAyahNow(ayah);
      return;
    }

    setLastCompletedAyah(ayah);
    setIsProgressSaved(false);
    repeatNumberRef.current = 1;
    setRepeatNumber(1);
    if (ayah < endAyah) {
      // Sourate entière : le son continue tout seul sur le verset suivant.
      if (!chapter || audioRef.current?.paused) playAyahNow(ayah + 1);
      setAyah(ayah + 1);
    } else if (endBehavior === "repeat") {
      playAyahNow(startAyah);
      setAyah(startAyah);
    } else if (endBehavior === "next" && selectedSurah < 114) {
      goToSurah(selectedSurah + 1);
    } else {
      audioRef.current?.pause();
      setIsPlaying(false);
    }
  };

  // Sourate entière : repère la fin du verset en cours d'après le minutage.
  // Vérifié à chaque « timeupdate » de l'audio (aussi écran verrouillé) et
  // toutes les 100 ms quand la page est visible, pour couper net.
  const checkChapterProgress = () => {
    const audio = audioRef.current;
    if (!audio || !chapter || audio.paused || isLoading) return;
    const timing = timingOf(currentAyahRef.current);
    if (timing && audio.currentTime * 1000 >= timing.to) handleVerseEnd();
  };
  const checkChapterProgressRef = useRef(checkChapterProgress);
  useEffect(() => {
    checkChapterProgressRef.current = checkChapterProgress;
  });
  useEffect(() => {
    if (!isPlaying || !chapter) return;
    const interval = window.setInterval(() => checkChapterProgressRef.current(), 100);
    return () => window.clearInterval(interval);
  }, [chapter, isPlaying]);

  function goToSurah(surahNumber: number) {
    if (surahNumber < 1 || surahNumber > 114) return;
    autoplayAfterLoadRef.current = isPlaying || hasStarted;
    hasInteractedRef.current = true;
    setSelectedSurah(surahNumber);
  }

  const updateRangeStart = (value: number) => {
    hasInteractedRef.current = true;
    setStartAyah(value);
    setCurrentAyah(value);
    setLastCompletedAyah(0);
    setIsProgressSaved(false);
    if (value > endAyah) setEndAyah(value);
  };

  const updateRangeEnd = (value: number) => {
    setEndAyah(value);
    setLastCompletedAyah(0);
    setIsProgressSaved(false);
    if (value < startAyah) {
      setStartAyah(value);
      setCurrentAyah(value);
    }
  };

  const goToAyah = (ayah: number) => {
    const total = surahData?.numberOfAyahs ?? 1;
    const target = Math.min(Math.max(ayah, 1), total);
    hasInteractedRef.current = true;
    setRepeatNumber(1);
    setCurrentAyah(target);
    if (target > endAyah) setEndAyah(target);
    if (target < startAyah) setStartAyah(target);
  };

  const togglePlayback = () => {
    if (isPlaying) {
      audioRef.current?.pause();
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
    }
  };

  const stopPlayback = () => {
    audioRef.current?.pause();
    setIsPlaying(false);
    setHasStarted(false);
  };

  const playFromAyah = (ayah: number) => {
    updateRangeStart(ayah);
    setRepeatNumber(1);
    setIsPlaying(true);
  };

  // Mushaf : la page suit le verset écouté, sauf si l'utilisatrice a tourné
  // les pages elle-même (le suivi reprend au prochain lancement ou clic).
  const playingVersePage =
    versePages?.surah === selectedSurah ? versePages.pages.get(currentAyah) : undefined;
  const displayedMushafPage = mushafFollow && playingVersePage ? playingVersePage : mushafPage;
  const changeMushafPage = (page: number) => {
    setMushafPage(page);
    setMushafFollow(false);
  };

  // Clic sur un verset du mushaf : lecture à partir de ce verset, même s'il
  // est dans une autre sourate.
  const playVerse = (verseKey: string) => {
    const [surahNumber, ayah] = verseKey.split(":").map(Number);
    if (!surahNumber || !ayah) return;
    unlockAudioPlayback();
    setMushafFollow(true);
    if (surahNumber === selectedSurah && surahData?.number === surahNumber && !isLoading) {
      playFromAyah(ayah);
      return;
    }
    const surah = surahs.find((item) => item.number === surahNumber);
    if (!surah) return;
    playAfterResumeRef.current = true;
    appliedResumeRef.current = null;
    setLocalResume({
      position: {
        surahNumber,
        surah: surah.englishName,
        ayah,
        endAyah: surah.numberOfAyahs,
        reciterIdentifier: selectedReciter,
        reciter: selectedReciterData?.englishName ?? "",
      },
      over: resumePosition,
    });
  };

  // Commandes de l'écran verrouillé et des écouteurs (Media Session).
  const totalAyahs = surahData?.numberOfAyahs ?? 0;
  const surahTitle = selectedSurahData?.englishName;
  const reciterName = selectedReciterData?.englishName ?? "";
  useEffect(() => {
    if (!("mediaSession" in navigator) || !hasStarted || !surahTitle) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `${surahTitle} - verset ${currentAyah}`,
      artist: reciterName,
      album: "Rawdah",
      artwork: [{ src: "/logo.svg", sizes: "any", type: "image/svg+xml" }],
    });
  }, [currentAyah, hasStarted, reciterName, surahTitle]);

  // Rebranchés à chaque rendu pour toujours viser le verset en cours.
  useEffect(() => {
    if (!("mediaSession" in navigator) || !hasStarted) return;
    const session = navigator.mediaSession;
    const skipTo = (ayah: number) => {
      if (ayah < 1 || ayah > totalAyahs) return;
      hasInteractedRef.current = true;
      repeatNumberRef.current = 1;
      setRepeatNumber(1);
      playAyahNow(ayah);
      setAyah(ayah);
      if (ayah > endAyah) setEndAyah(ayah);
      if (ayah < startAyah) setStartAyah(ayah);
    };
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => void audioRef.current?.play()],
      ["pause", () => audioRef.current?.pause()],
      ["nexttrack", () => skipTo(currentAyah + 1)],
      ["previoustrack", () => skipTo(currentAyah - 1)],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Action non prise en charge par ce navigateur.
      }
    }
  });

  const reciterSelect = (
    <label className="grid gap-1 text-[13px] font-semibold">
      Récitateur
      <select
        value={selectedReciter}
        onChange={(event) => {
          const reciter = reciters.find((item) => item.identifier === event.target.value);
          // Reprise au même verset avec la nouvelle voix.
          if (reciter && selectedSurahData && surahData?.number === selectedSurah) {
            pendingResumeRef.current = {
              surahNumber: selectedSurah,
              surah: selectedSurahData.englishName,
              ayah: currentAyah,
              endAyah,
              reciterIdentifier: reciter.identifier,
              reciter: reciter.englishName,
            };
          }
          if (isPlaying) unlockAudioPlayback();
          autoplayAfterLoadRef.current = isPlaying;
          setSelectedReciter(event.target.value);
        }}
        disabled={!reciters.length}
        className="n-select"
      >
        {reciters.map((reciter) => (
          <option key={reciter.identifier} value={reciter.identifier}>
            {reciter.englishName}
          </option>
        ))}
      </select>
      {surahData && !surahData.chapter && (
        <span className="text-[12px] font-normal text-(--n-muted)">
          Lecture verset par verset pour le moment : l'écoute peut s'arrêter écran verrouillé.
        </span>
      )}
    </label>
  );
  const repeatSelect = (
    <label className="grid gap-1 text-[13px] font-semibold">
      Répéter chaque verset
      <select
        value={repeatCount}
        onChange={(event) => setRepeatCount(Number(event.target.value))}
        className="n-select"
      >
        <option value={1}>1 fois</option>
        <option value={2}>2 fois</option>
        <option value={3}>3 fois</option>
        <option value={4}>4 fois</option>
        <option value={5}>5 fois</option>
        <option value={0}>En boucle</option>
      </select>
    </label>
  );
  const endSelect = (
    <label className="grid gap-1 text-[13px] font-semibold">
      À la fin de la sourate
      <select
        value={endBehavior}
        onChange={(event) =>
          setEndBehavior(event.target.value as "stop" | "next" | "repeat")
        }
        className="n-select"
      >
        <option value="stop">Arrêter</option>
        <option value="next">Sourate suivante</option>
        <option value="repeat">Recommencer</option>
      </select>
    </label>
  );

  const showResumeCard =
    savedPosition !== null &&
    !resumePosition &&
    !hasStarted &&
    !isLoading &&
    surahs.length > 0 &&
    reciters.length > 0;

  return (
    <>
    {showResumeCard && (
      <div
        className="n-card n-card-tint mb-4 flex flex-wrap items-center justify-between gap-3"
        hidden={!isActive}
      >
        <div className="min-w-0">
          <span className="n-label">Reprendre l’écoute</span>
          <p className="mt-1 text-[17px] font-semibold">
            {savedPosition.surah} - verset {savedPosition.ayah}
          </p>
          {savedPosition.reciter && (
            <p className="text-[13px] text-(--n-muted)">{savedPosition.reciter}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={resumeSavedPosition}
            className="n-btn n-btn-sage px-4! py-2.5! text-sm!"
          >
            <Play className="size-4" />
            Reprendre
          </button>
          <button
            type="button"
            onClick={() => setSavedPosition(null)}
            className="n-btn n-btn-ghost px-3! py-2.5! text-sm!"
            aria-label="Masquer"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    )}
    <div className="n-quran" data-mode={viewMode} hidden={!isActive}>
      <aside className="n-card n-quran-aside p-4!" aria-label="Choix de la sourate">
        <label className="relative block">
          <span className="sr-only">Rechercher une sourate</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-(--n-muted)"
            aria-hidden="true"
          />
          <input
            value={surahQuery}
            onChange={(event) => setSurahQuery(event.target.value)}
            placeholder="Rechercher une sourate…"
            className="n-input pl-9!"
          />
        </label>
        <div className="n-surah-list">
          {visibleSurahs.map((surah) => (
            <button
              key={surah.number}
              type="button"
              onClick={() => {
                hasInteractedRef.current = true;
                setIsPlaying(false);
                setSelectedSurah(surah.number);
              }}
              aria-current={surah.number === selectedSurah}
              className="n-surah-item"
            >
              <span className="n-surah-num">
                    <span className="relative">{surah.number}</span>
              </span>
              <span className="min-w-0">
                <span className="block truncate font-semibold">{surah.englishName}</span>
                <span className="block text-[13px] text-(--n-muted)">
                  {surah.numberOfAyahs} versets
                </span>
              </span>
              <span className="n-surah-name-ar" lang="ar">
                {surah.name.replace(/^سُورَةُ\s*/, "")}
              </span>
            </button>
          ))}
          {surahs.length > 0 && visibleSurahs.length === 0 && (
            <p className="p-2 text-sm text-(--n-muted)">Aucune sourate trouvée.</p>
          )}
        </div>
      </aside>

      <div className="min-w-0">
        <div className="n-card n-card-tint flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="n-label">
              Sourate {selectedSurah}
              {selectedSurahData?.revelationType
                ? ` - ${selectedSurahData.revelationType.toLowerCase() === "meccan" ? "mecquoise" : "médinoise"}`
                : ""}
            </span>
            <h2 className="n-display mt-2 text-[28px] leading-tight">
              {selectedSurahData?.englishName ?? "…"}
            </h2>
            <p className="text-[15px] text-(--n-muted)">
              {selectedSurahData ? `${selectedSurahData.numberOfAyahs} versets` : ""}
            </p>
          </div>
          <p className="n-surah-name-ar text-[40px]! leading-none" lang="ar">
            {selectedSurahData?.name.replace(/^سُورَةُ\s*/, "")}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="flex gap-1.5" role="group" aria-label="Mode d'affichage">
            <button
              type="button"
              className="n-toggle"
              aria-pressed={viewMode === "lecture"}
              onClick={() => changeViewMode("lecture")}
            >
              Mode lecture
            </button>
            <button
              type="button"
              className="n-toggle"
              aria-pressed={viewMode === "mushaf"}
              onClick={() => changeViewMode("mushaf")}
            >
              Mode Mushaf
            </button>
          </div>
          <span className="mx-1 h-5 w-px bg-(--n-line)" aria-hidden="true" />
          {viewMode === "lecture" ? (
            <>
              <button
                type="button"
                className="n-toggle"
                aria-pressed={showTransliteration}
                onClick={() => setShowTransliteration((value) => !value)}
              >
                Phonétique
              </button>
              <button
                type="button"
                className="n-toggle"
                aria-pressed={showTranslation}
                onClick={() => setShowTranslation((value) => !value)}
              >
                Traduction française
              </button>
            </>
          ) : (
            <button
              type="button"
              className="n-toggle"
              aria-pressed={showTajweed}
              onClick={() => setShowTajweed((value) => !value)}
            >
              Couleurs du tajwid
            </button>
          )}
        </div>

        {error && (
          <p role="alert" className="n-chip mt-4">
            {error}
          </p>
        )}

        {viewMode === "mushaf" ? (
          <div className="mt-4">
            <QuranMushaf
              page={displayedMushafPage}
              onPageChange={changeMushafPage}
              chapters={mushafChapters}
              basmala={basmala}
              highlightedVerse={hasStarted ? `${selectedSurah}:${currentAyah}` : null}
              onVerseSelect={playVerse}
              showTajweed={showTajweed}
              isActive={isActive}
            />
          </div>
        ) : (
        <div className="n-card mt-4 px-3! py-2! sm:px-5!">
          {isLoading ? (
            <p className="flex items-center gap-2 p-4 text-[15px] text-(--n-muted)" role="status">
              <Loader2 className="size-4 animate-spin" /> Chargement de la sourate…
            </p>
          ) : (
            <>
              {showsBasmala && (
                <p className="n-arabic py-6 text-center! text-[28px]" lang="ar">
                  {basmala}
                </p>
              )}
              {surahData?.ayahs.map((ayah) => (
                <button
                  key={ayah.numberInSurah}
                  id={`quran-ayah-${ayah.numberInSurah}`}
                  type="button"
                  className="n-ayah"
                  data-active={ayah.numberInSurah === currentAyah}
                  onClick={() => playFromAyah(ayah.numberInSurah)}
                  aria-label={`Écouter à partir du verset ${ayah.numberInSurah}`}
                >
                  <span className="n-ayah-arabic block" lang="ar">
                    {ayahArabic(ayah)}
                    <span className="n-ayah-num">{ayah.numberInSurah}</span>
                  </span>
                  {showTransliteration && (
                    <span className="n-ayah-translit block">
                      {translitAyahs.find(
                        (item) => item.numberInSurah === ayah.numberInSurah,
                      )?.text ?? "Phonétique non disponible."}
                    </span>
                  )}
                  {showTranslation && (
                    <span className="n-ayah-translation block">
                      {jsonVerses?.find(
                        (verse) => verse.position_ds_sourate === ayah.numberInSurah,
                      )?.text ?? "Traduction non disponible."}
                    </span>
                  )}
                </button>
              ))}
            </>
          )}
        </div>
        )}

        {/* Toujours monté (masqué pendant un chargement) : l'élément audio
            doit rester le même pour que l'écoute continue écran verrouillé. */}
        <div className="n-player" hidden={!activeAyah || isLoading}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
              <span className="font-semibold">
                {selectedSurahData?.englishName} - verset {currentAyah}
                <span className="font-normal text-(--n-muted)"> / {endAyah}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-(--n-muted)">
                <Repeat2 className="size-4" />
                {repeatCount === 0 ? "En boucle" : `${repeatNumber}/${repeatCount}`}
              </span>
            </div>
            <audio
              ref={audioRef}
              controls
              preload="none"
              className="n-player-audio mt-1 w-full"
              onPlay={() => {
                hasInteractedRef.current = true;
                setMushafFollow(true);
                setHasStarted(true);
                setIsPlaying(true);
              }}
              onPause={(event) => {
                if (!event.currentTarget.ended) setIsPlaying(false);
              }}
              onTimeUpdate={() => checkChapterProgressRef.current()}
              onEnded={handleVerseEnd}
            >
              Ton navigateur ne peut pas lire cet audio.
            </audio>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <details className="text-sm">
                <summary className="cursor-pointer font-semibold text-(--n-muted)">
                  Options d’écoute
                </summary>
                <div className="mt-3 flex flex-wrap gap-3">
                  {reciterSelect}
                  <label className="grid gap-1 text-[13px] font-semibold">
                    Jusqu’au verset
                    <select
                      value={endAyah}
                      onChange={(event) => updateRangeEnd(Number(event.target.value))}
                      disabled={!surahData}
                      className="n-select"
                    >
                      {Array.from(
                        { length: selectedSurahData?.numberOfAyahs ?? 0 },
                        (_, index) => index + 1,
                      ).map((ayah) => (
                        <option key={ayah} value={ayah}>
                          Verset {ayah}
                        </option>
                      ))}
                    </select>
                  </label>
                  {repeatSelect}
                  {endSelect}
                </div>
              </details>
              <button
                type="button"
                disabled={!lastCompletedAyah || isSavingProgress || isProgressSaved}
                onClick={async () => {
                  const saved = await onSaveProgress({
                    surah: selectedSurahData?.englishName ?? `Sourate ${selectedSurah}`,
                    startAyah,
                    lastCompletedAyah,
                    reciter: selectedReciterData?.englishName ?? selectedReciter,
                  });
                  setIsProgressSaved(saved);
                }}
                className="n-btn n-btn-sage px-3! py-1.5! text-[13px]! disabled:opacity-50"
              >
                {isSavingProgress ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <BookOpen className="size-4" />
                )}
                {isSavingProgress
                  ? "Enregistrement…"
                  : isProgressSaved
                    ? "Progression enregistrée"
                    : "Enregistrer ma progression"}
              </button>
            </div>
          </div>
        <p className="mt-3 text-[13px] leading-5 text-(--n-muted)">
          Audio : Quran.com et mp3quran.net.{" "}
          {viewMode === "mushaf"
            ? "Texte du mushaf de Médine : Quran.com (police KFGQPC Uthmanic Hafs). Touche un verset pour l’écouter à partir de là."
            : "Touche un verset pour l’écouter à partir de là."}
        </p>
      </div>
    </div>

    {!isActive && hasStarted && activeAyah && (
      <div className="n-mini-player" role="region" aria-label="Lecture du Coran en cours">
        {showMiniOptions && (
          <div className="n-mini-options">
            {repeatSelect}
            {endSelect}
            {reciterSelect}
          </div>
        )}
        <div className="n-mini-row">
        <button type="button" className="n-mini-info" onClick={onOpen}>
          <span className="n-surah-num">
            <span className="relative">{selectedSurah}</span>
          </span>
          <span className="min-w-0 text-left">
            <span className="block truncate font-semibold">
              {selectedSurahData?.englishName}
            </span>
            <span className="block text-[13px] text-(--n-muted)">
              Verset {currentAyah} / {surahData?.numberOfAyahs}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center">
          <button
            type="button"
            className="n-icon-btn n-mini-wide"
            onClick={() => goToSurah(selectedSurah - 1)}
            disabled={selectedSurah <= 1 || isLoading}
            aria-label="Sourate précédente"
          >
            <ChevronsLeft className="size-4" />
          </button>
          <button
            type="button"
            className="n-icon-btn"
            onClick={() => goToAyah(currentAyah - 1)}
            disabled={currentAyah <= 1}
            aria-label="Verset précédent"
          >
            <SkipBack className="size-4" />
          </button>
          <button
            type="button"
            className="n-mini-play"
            onClick={togglePlayback}
            aria-label={isPlaying ? "Pause" : "Reprendre la lecture"}
          >
            {isPlaying ? <Pause className="size-5" /> : <Play className="size-5" />}
          </button>
          <button
            type="button"
            className="n-icon-btn"
            onClick={() => goToAyah(currentAyah + 1)}
            disabled={currentAyah >= (surahData?.numberOfAyahs ?? 1)}
            aria-label="Verset suivant"
          >
            <SkipForward className="size-4" />
          </button>
          <button
            type="button"
            className="n-icon-btn n-mini-wide"
            onClick={() => goToSurah(selectedSurah + 1)}
            disabled={selectedSurah >= 114 || isLoading}
            aria-label="Sourate suivante"
          >
            <ChevronsRight className="size-4" />
          </button>
          <button
            type="button"
            className="n-icon-btn"
            aria-pressed={showMiniOptions}
            onClick={() => setShowMiniOptions((value) => !value)}
            aria-label="Réglages de lecture"
          >
            <SlidersHorizontal className="size-4" />
          </button>
          <button
            type="button"
            className="n-icon-btn"
            onClick={stopPlayback}
            aria-label="Arrêter et fermer le lecteur"
          >
            <X className="size-4" />
          </button>
        </div>
        </div>
        <span className="n-mini-progress" aria-hidden="true">
          <span
            style={{
              width: `${(currentAyah / (surahData?.numberOfAyahs ?? 1)) * 100}%`,
            }}
          />
        </span>
      </div>
    )}
    </>
  );
}
