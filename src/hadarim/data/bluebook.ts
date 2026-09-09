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
