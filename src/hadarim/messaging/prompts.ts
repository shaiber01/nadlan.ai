import type { Participant } from "./channel";
import type { ProbeResult } from "./scheduler";

/**
 * The heartbeat's prompts (docs/heartbeat-bot-plan.md §5.2, §5.3). In a conversation the pass presents
 * what needs a decision and stops; alone (no channel) it decides nothing and records the pass.
 */

export function heartbeatPromptHe(participants: Participant[], results: ProbeResult[]): string {
  const names = participants.map((p) => p.nameHe).join(" ו");
  const found = results.filter((r) => r.work).map((r) => r.detailHe).join("; ");
  return [
    "פעימת לב. הרץ /bakara-heartbeat.",
    found ? `הבדיקה המקדימה מצאה: ${found}.` : "",
    `יש משתמשים: אתה משוחח עם ${names} בערוץ הזה.`,
    "ממצא שדורש החלטה — הצג כרטיס אחד, שאל שאלה אחת עם אפשרויות ממוספרות ועצור; את הפעימה רשום (record_heartbeat) רק אחרי שההחלטות התקבלו.",
    "כשאין מה להחליט — רשום את הפעימה עכשיו וסכם בשורה אחת בלי סימן שאלה.",
  ]
    .filter(Boolean)
    .join(" ");
}

export function heartbeatAlonePromptHe(projectId: string): string {
  return `פעימת לב לפרויקט ${projectId}: הרץ /bakara-heartbeat. אין משתמש בצד השני — עבד מסמכים, בדוק שינויים, אל תחליט ואל תתקן דבר, רשום את הפעימה וסכם בעברית.`;
}
