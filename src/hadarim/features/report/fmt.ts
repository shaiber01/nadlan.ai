export const nis = (v: number) => `${v.toLocaleString("he-IL")} ₪`;
export const num = (v: number) => v.toLocaleString("he-IL");
export const dateHe = (iso: string) => iso.slice(0, 10).split("-").reverse().map((p, i) => (i < 2 ? String(Number(p)) : p)).join(".");
export const timeHe = (clock: string) => clock.slice(11, 16);
