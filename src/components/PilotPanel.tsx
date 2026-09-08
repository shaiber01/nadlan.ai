import { store } from "../app/store";
import { Button, Notice } from "./primitives";

const inputsHe = ["תקציב לדוגמה של פרויקט אחד (גיליון או PDF)", "ייצוא מה-ERP: תנועות, הזמנות והתחייבויות של הפרויקט", "חוזים וחשבוניות רלוונטיים לאותו פרויקט", "דוח בקרה אחרון שהתקבל (בפורמט הקיים)", "איש קשר תפעולי אחד לבירורים"];
const measuresHe = ["איכות התיקונים המוצעים (כמה אושרו ללא שינוי)", "מאמץ הכנת הדוח לעומת התהליך הנוכחי", "מספר השאלות שנשלחו ללקוח ומה נפתר מהמסמכים", "מאמץ הבדיקה הפנימית של צוות הבקרה", "שימושיות ההתרעות המוקדמות להחלטות"];

export function PilotPanel() {
  const copy = () => {
    const text = `רשימת הכנה לפיילוט בקרה\n\nמה נדרש מהחברה:\n${inputsHe.map((x) => `• ${x}`).join("\n")}\n\nמה נמדוד בפיילוט (יעדי מדידה, לא תוצאות):\n${measuresHe.map((x) => `• ${x}`).join("\n")}`;
    navigator.clipboard?.writeText(text).then(
      () => store.toast("רשימת ההכנה הועתקה", "success"),
      () => store.toast("לא ניתן להעתיק אוטומטית; אפשר לסמן ולהעתיק ידנית", "error"),
    );
  };
  return (
    <div className="stack-lg">
      <p>הפיילוט פועל על פרויקט אחד עם הנתונים האמיתיים שלכם, לצד ה-ERP הקיים. אין צורך להחליף מערכת.</p>
      <div className="grid-2">
        <div className="card stack-sm">
          <h3>מה נדרש מכם</h3>
          <ul style={{ margin: 0, paddingInlineStart: 18 }} className="small">
            {inputsHe.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div className="card stack-sm">
          <h3>מה נמדוד</h3>
          <ul style={{ margin: 0, paddingInlineStart: 18 }} className="small">
            {measuresHe.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </div>
      <Notice tone="navy">אלה יעדי מדידה לפיילוט, לא תוצאות שנמדדו. ההדגמה מציגה נתונים סינתטיים בלבד.</Notice>
      <div className="row">
        <Button variant="primary" onClick={copy}>
          העתק רשימת הכנה
        </Button>
      </div>
    </div>
  );
}
