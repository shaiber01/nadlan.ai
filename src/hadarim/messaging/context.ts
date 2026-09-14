import type { ChannelId, Participant } from "./channel";

/**
 * The channel context appended to the agent's system prompt on a conversation's first turn
 * (docs/heartbeat-bot-plan.md §7.2): who is in the conversation, how messages are prefixed, how to write
 * for a chat channel, and how writes are attributed. Claude Code snapshots the system prompt for the
 * conversation, so the relay passes this only when it creates one.
 */

export const CHANNEL_NAME_HE: Record<ChannelId, string> = {
  console: "מסוף טקסט (חזרה)",
  vonage: "וואטסאפ",
  twilio: "וואטסאפ",
  telegram: "טלגרם",
};

export function channelContextHe(participants: Participant[], channel: ChannelId): string {
  const who = participants.map((p) => `${p.nameHe} (${p.roleHe}; מזהה לכלים: ${p.personId})`).join(", ");
  return [
    `אתה משוחח דרך ${CHANNEL_NAME_HE[channel]} עם: ${who}.`,
    "כל הודעה נכנסת מתחילה בשם השולח ונקודתיים; כשכמה הודעות מגיעות יחד, כל אחת בשורה משלה.",
    "כתיבה למסד הנתונים מיוחסת למי ששלח את ההודעה שהחליט (המזהה שלו ב-byId), אלא אם אמר במפורש שמישהו אחר החליט.",
    "כללי הערוץ: הודעות קצרות; טקסט פשוט בלבד — בלי טבלאות, בלי כותרות, בלי קוד, בלי קישורים ארוכים; הדגשה רק בכוכבית אחת מכל צד (*כך*); שאלה אחת בכל הודעה, האפשרויות כרשימה ממוספרת ולכל אפשרות מה יקרה אם תיבחר; הודעה שדורשת תשובה מסתיימת בשאלה; המשתמש עונה במספר או בטקסט חופשי.",
    "כלי השאלות (AskUserQuestion) אינו זמין בערוץ הזה — אל תנסה להשתמש בו; שאל בטקסט.",
    "כשאין מה לשאול, סיים בשורת סיכום אחת בלי סימן שאלה.",
  ].join(" ");
}
