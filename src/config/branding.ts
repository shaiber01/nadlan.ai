/**
 * Branding and naming. Change the product name, source-system name, or customer here.
 * All values are plain strings used by the UI; no visual assets are required.
 */
export const branding = {
  /** Product working name shown in the shell and messages. */
  productName: "בקרה",
  /** Short tagline under the name in the shell. */
  tagline: "בקרת תקציב לחברות ביצוע",
  /** Name of the simulated source system (the customer's existing ERP). */
  sourceSystemName: "זיו",
  /** How the simulated ERP pane labels itself. */
  sourceSystemLabel: "זיו — סביבת הדגמה",
  /** Persistent, discreet badge text. */
  demoBadge: "סביבת הדגמה · נתונים סינתטיים",
  /** Delivery note attached to simulated messages. */
  simulatedDeliveryNote: "ההודעה מוצגת בתוך ההדגמה בלבד",
  /** Provider (service) team name used in role labels and audit entries. */
  providerTeamName: "צוות הבקרה",
  /** Sender name for simulated emails. */
  emailSender: "בקרה · דוחות",
  emailSenderAddress: "reports@bakara-demo.example",
  whatsappSenderName: "בקרה",
} as const;

export type Branding = typeof branding;
