import type { ChannelId, Participant } from "./channel";

/**
 * The channel context appended to the agent's system prompt on a conversation's first turn
 * (docs/heartbeat-bot-plan.md §7.2): who is in the conversation, how messages are prefixed, how to write
 * for a chat channel, how writes are attributed, and where the live report is. Claude Code snapshots the
 * system prompt for the conversation, so the relay keys the conversation by `contextKey` and starts a new
 * one when the context changes.
 */

export const CHANNEL_NAME_HE: Record<ChannelId, string> = {
  console: "מסוף טקסט (חזרה)",
  vonage: "וואטסאפ",
  twilio: "וואטסאפ",
  telegram: "טלגרם",
};

/** The live, read-only report page of this deployment (override with MONITOR_REPORT_URL). */
export const DEFAULT_REPORT_URL = "https://shaiber01.github.io/nadlan.ai/report.html";

export interface ContextOptions {
  /** The live report's URL; on a phone the link is the report, a Word file is not. */
  reportUrl?: string | null;
}

export function channelContextHe(participants: Participant[], channel: ChannelId, opts: ContextOptions = {}): string {
  const who = participants.map((p) => `${p.nameHe} (${p.roleHe}; מזהה לכלים: ${p.personId})`).join(", ");
  return [
    `אתה משוחח דרך ${CHANNEL_NAME_HE[channel]} עם: ${who}.`,
    "כל הודעה נכנסת מתחילה בשם השולח ונקודתיים; כשכמה הודעות מגיעות יחד, כל אחת בשורה משלה.",
    "כתיבה למסד הנתונים מיוחסת למי ששלח את ההודעה שהחליט (המזהה שלו ב-byId), אלא אם אמר במפורש שמישהו אחר החליט.",
    "כללי הערוץ: הודעות קצרות; טקסט פשוט בלבד — בלי טבלאות, בלי כותרות, בלי קוד, בלי קישורים ארוכים; הדגשה רק בכוכבית אחת מכל צד (*כך*); שאלה אחת בכל הודעה, האפשרויות כרשימה ממוספרת ולכל אפשרות מה יקרה אם תיבחר; הודעה שדורשת תשובה מסתיימת בשאלה; המשתמש עונה במספר או בטקסט חופשי.",
    "כלי השאלות (AskUserQuestion) אינו זמין בערוץ הזה — אל תנסה להשתמש בו; שאל בטקסט.",
    "כשאין מה לשאול, סיים בשורת סיכום אחת בלי סימן שאלה.",
    opts.reportUrl ? `הדוח החי של הפרויקט (הצפייה בלבד) נמצא בקישור ${opts.reportUrl} — כשמבקשים את הדוח, שלח את הקישור הזה עם שורת התמצית; קובץ Word או Excel אינו שימושי בערוץ הזה, אל תציע אותו ואל תכתוב נתיב קובץ.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** A short, stable key of a context text (djb2), so a conversation knows which context its session carries. */
export function contextKeyOf(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `ctx-${h.toString(16).padStart(8, "0")}-${text.length}`;
}
