/**
 * The chapters of the Interministerial Specification for building works ("המפרט הכללי הבין-משרדי", the Blue Book):
 * the national standard construction budgets and bills of quantities are organised by. Reference data, not
 * scenario data — a project's sections say which chapters they cover (`HSection.chapters`, the first is the
 * primary), and BOQ lines carry their chapter. The list holds the commonly used chapters; add to it as needed.
 */
export const BLUE_BOOK_CHAPTERS: Record<string, string> = {
  "00": "מוקדמות",
  "01": "עבודות עפר",
  "02": "עבודות בטון יצוק באתר",
  "03": "מוצרי בטון טרום",
  "04": "עבודות בנייה",
  "05": "עבודות איטום",
  "06": "נגרות אומן ומסגרות פלדה",
  "07": "מתקני תברואה",
  "08": "מתקני חשמל",
  "09": "עבודות טיח",
  "10": "עבודות ריצוף וחיפוי",
  "11": "עבודות צביעה",
  "12": "עבודות אלומיניום",
  "13": "עבודות בטון דרוך",
  "14": "עבודות אבן",
  "15": "מתקני מיזוג אוויר",
  "16": "מתקני הרמה",
  "19": "מסגרות חרש",
  "22": "רכיבים מתועשים בבניין",
  "23": "כלונסאות קדוחים",
  "24": "הריסות ופירוקים",
  "34": "מערכות גילוי וכיבוי אש",
  "40": "פיתוח האתר",
  "41": "גינון והשקיה",
  "51": "סלילת כבישים ורחבות",
  "57": "קווי מים, ביוב ותיעול",
};

export function chapterNameHe(code: string): string {
  return BLUE_BOOK_CHAPTERS[code] ?? `פרק ${code}`;
}

/** "02 — עבודות בטון יצוק באתר" */
export function chapterLabelHe(code: string): string {
  return `${code} — ${chapterNameHe(code)}`;
}

/**
 * Trade terms of each chapter: the words a record's description uses when it describes work of that
 * chapter. Reference data like the chapter list itself — nothing here names a project, a section, a
 * supplier or a record. A term with a space is matched against the whole text; a single word is matched
 * against a word of the text (Hebrew one-letter prefixes and plural endings allowed). Add terms as needed;
 * a term that fits several chapters should be listed under each, so it decides nothing on its own.
 */
export const CHAPTER_TERMS: Record<string, string[]> = {
  "00": ["מוקדמות", "מנוף", "מלגזה", "מכולה", "גידור", "שמירה", "אבטחה", "שילוט", "בטיחות", "ניקיון", "פסולת", "התארגנות"],
  "01": ["עפר", "חפירה", "חציבה", "מילוי", "קרקע", "ביסוס", "דיפון", "יישור", "הידוק", "כלונסאות", "כלונס", "קידוח"],
  "02": ["בטון", "יציקה", "טפסות", "זיון", "ברזל", "רשתות", "שלד", "דיפון קירות"],
  "03": ["טרום", "טרומי", "אלמנטים טרומיים"],
  "04": ["בנייה", "בניה", "בלוקים", "בלוק", "איטונג", "מחיצות בנייה"],
  "05": ["איטום", "ביטומן", "יריעות"],
  "06": ["נגרות", "מסגרות", "מעקות", "דלתות"],
  "07": ["תברואה", "אינסטלציה", "צנרת", "סניטרי", "סניטריים", "דודים"],
  "08": ["חשמל", "תקשורת", "הארקה", "הארקות", "לוחות חשמל", "כבלים"],
  "09": ["טיח", "שפכטל"],
  "10": ["ריצוף", "חיפוי", "קרמיקה", "אריחים"],
  "11": ["צבע", "צביעה", "סיד"],
  "12": ["אלומיניום", "ויטרינות", "תריסים", "חלונות"],
  "13": ["דרוך", "דריכה"],
  "14": ["אבן", "שיש"],
  "15": ["מיזוג", "מזגנים", "מפוחים"],
  "16": ["מעלית", "מעליות"],
  "19": ["מסגרות חרש"],
  "22": ["גבס", "מחיצות גבס", "מתועשים"],
  "23": ["כלונסאות", "כלונס", "קידוח", "ביסוס"],
  "24": ["הריסה", "הריסות", "פירוק", "פירוקים"],
  "34": ["ספרינקלרים", "מתזים", "גילוי אש", "כיבוי אש", "גילוי וכיבוי"],
  "40": ["פיתוח", "קירות תומכים", "תומכים"],
  "41": ["גינון", "השקיה", "נטיעה"],
  "51": ["סלילה", "אספלט", "כביש", "כבישים", "רחבות", "מדרכות"],
  "57": ["ביוב", "ניקוז", "תיעול"],
};

/** Words a description shares with every text, carrying no trade meaning. */
const STOP_WORDS = new Set(["עבודות", "עבודה", "מתקני", "מתקן", "מערכות", "מערכת", "אספקת", "אספקה", "שירותי", "שירות", "חשבון", "חשבונית", "חלקי", "סופי", "מקדמה", "הזמנת", "הזמנה", "מסגרת", "השכרת", "השכרה", "תוספת", "נוספות", "נוספים", "בניין", "קומה", "קומות", "חודש", "חודשים", "יחידות", "כולל", "לפי", "עבור", "מס"]);

const PREFIXES = ["ו", "ה", "ב", "ל", "מ", "ש", "כ", "וה", "וב", "ול", "ומ", "כש", "לה", "מה", "שה"];
const SUFFIXES = ["ים", "ות", "יים", "י", "ה"];

/** The forms a term takes in a text: itself, its plural, and the plural of its singular stem. */
function termForms(term: string): string[] {
  const stems = term.endsWith("ה") ? [term, term.slice(0, -1)] : [term];
  const forms = new Set<string>([term]);
  for (const stem of stems) {
    forms.add(stem);
    for (const s of SUFFIXES) forms.add(stem + s);
  }
  return [...forms];
}

/** Every inflected form of every single-word term → the term itself. Built once. */
const FORM_TO_TERM = new Map<string, string>();
/** Term → the chapters that use it (a term of several chapters decides nothing on its own). */
const TERM_CHAPTERS = new Map<string, string[]>();
/** The multi-word terms, matched against the whole text. */
const PHRASE_TERMS: { term: string; chapter: string }[] = [];
for (const [chapter, terms] of Object.entries(CHAPTER_TERMS)) {
  for (const term of terms) {
    TERM_CHAPTERS.set(term, [...(TERM_CHAPTERS.get(term) ?? []), chapter]);
    if (term.includes(" ")) PHRASE_TERMS.push({ term, chapter });
    else for (const form of termForms(term)) if (!FORM_TO_TERM.has(form)) FORM_TO_TERM.set(form, term);
  }
}

/** A word with any of the Hebrew one- and two-letter prefixes removed, the word itself included. */
function wordStems(word: string): string[] {
  const out = [word];
  for (const p of PREFIXES) if (word.length > p.length + 2 && word.startsWith(p)) out.push(word.slice(p.length));
  return out;
}

const wordsCache = new Map<string, string[]>();

/** Words of a Hebrew text, without punctuation, digits and the words that carry no trade meaning. */
export function contentWords(text: string): string[] {
  const hit = wordsCache.get(text);
  if (hit) return hit;
  const words = text
    .replace(/[0-9()״"׳'.,\-–—:;/\\[\]]+/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));
  if (wordsCache.size > 5000) wordsCache.clear();
  wordsCache.set(text, words);
  return words;
}

/** A word of the text is the term, the term in the plural, or either with a Hebrew prefix. */
export function wordMatches(word: string, term: string): boolean {
  const forms = new Set(termForms(term));
  return wordStems(word).some((stem) => forms.has(stem));
}

/** True when the text uses the term: a phrase anywhere in it, a single word as a word of it. */
export function textUsesTerm(text: string, term: string): boolean {
  if (term.includes(" ")) return text.includes(term);
  return contentWords(text).some((w) => wordMatches(w, term));
}

const chaptersCache = new Map<string, { chapter: string; terms: string[] }[]>();

/** The chapters a free text speaks of, each with the terms that matched — [] when it speaks of none. */
export function chapterTermsIn(text: string): { chapter: string; terms: string[] }[] {
  const hit = chaptersCache.get(text);
  if (hit) return hit;
  const byChapter = new Map<string, Set<string>>();
  const add = (chapter: string, term: string) => byChapter.set(chapter, (byChapter.get(chapter) ?? new Set()).add(term));
  for (const word of contentWords(text)) {
    for (const stem of wordStems(word)) {
      const term = FORM_TO_TERM.get(stem);
      if (term) for (const chapter of TERM_CHAPTERS.get(term)!) add(chapter, term);
    }
  }
  for (const { term, chapter } of PHRASE_TERMS) if (text.includes(term)) add(chapter, term);
  const out = [...byChapter.entries()].map(([chapter, terms]) => ({ chapter, terms: [...terms] })).sort((a, b) => (a.chapter < b.chapter ? -1 : 1));
  if (chaptersCache.size > 5000) chaptersCache.clear();
  chaptersCache.set(text, out);
  return out;
}
