/**
 * Suggested 8–10 minute guided tour (Section 11). A presentation convenience only:
 * every scenario stays independently available in the gallery.
 */
export interface TourSegment {
  scenarioId: string;
  /** "load" replaces state with the scenario fixture; "continue" keeps the current state when its precondition holds. */
  mode: "load" | "continue";
  approxSeconds: number;
  presenterHe: string;
  takeawayHe: string;
}

export const tourSegments: TourSegment[] = [
  { scenarioId: "S04", mode: "load", approxSeconds: 75, presenterHe: "הריצו את תרחיש 4, בדקו את המקורות ואשרו את תיקון הכמות", takeawayHe: "200 ← 20 טון; סכום החשבונית ללא שינוי" },
  { scenarioId: "S06", mode: "continue", approxSeconds: 110, presenterHe: "הריצו את תרחיש 6 על אותה רכישה מאומתת: פתחו את ההתרעה ב-WhatsApp ואשרו מחיר עתידי 3,300 ₪", takeawayHe: "ההתרעה מגיעה לפני דוח חדש; 6,000 ₪ בפועל ו-144,000 ₪ השפעה עתידית; הדרים 6,250,000 ₪" },
  { scenarioId: "S07", mode: "continue", approxSeconds: 45, presenterHe: "שאלו מה השתנה מאז הדוח האחרון", takeawayHe: "+150,000 ₪ מול 31/08, עם ראיות" },
  { scenarioId: "S01", mode: "continue", approxSeconds: 60, presenterHe: "הפיקו ומסרו את דוח ה-Excel השבועי", takeawayHe: "הדוח וההודעה מציגים 6,250,000 ₪, לא 6,106,000 ₪" },
  { scenarioId: "S05", mode: "load", approxSeconds: 75, presenterHe: "הריצו את תרחיש 5, ענו לשאלת ה-WhatsApp, אשרו את החלוקה ושמרו במפורש את כלל השימוש החוזר", takeawayHe: "שאלה מרוכזת אחת, שני פרויקטים מתעדכנים, סך החברה ללא שינוי" },
  { scenarioId: "S15", mode: "continue", approxSeconds: 40, presenterHe: "הריצו את תרחיש 15 ופתחו את ההנחיה המאושרת", takeawayHe: "מעבר גלוי לתקופת החיוב הבאה; השימוש הראשון אינו דורש שאלה ללקוח" },
  { scenarioId: "S02", mode: "load", approxSeconds: 60, presenterHe: "הריצו את תרחיש 2 ועדכנו את מחיר הבטון בטיוטה", takeawayHe: "ערך לפני תחילת הבנייה" },
];

export const tourIntroHe = "הנה חברה עם כמה פרויקטים פעילים. נתחיל מתנועה שנקלטה בזיו, נראה איך היא נבדקת, איך מתקבל מידע שחסר, ואיך הכול מגיע לדוח ולתחזית.";
export const tourOutroHe = "זה היה המסלול המוצע. כל שאר התרחישים זמינים בגלריה, ואפשר לנסות את זה על פרויקט שלכם.";
