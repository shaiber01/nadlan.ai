# Construction Budget Control AI Service — Interactive Demo Build Brief

Version 1.1 · Reviewed standalone implementation handoff · 8 September 2026

This revision preserves the sixteen scenarios and the confirmed scope. It clarifies automatic monitoring, proactive alert delivery, financial state transitions, source history, and replay behavior. All numerical examples remain synthetic.

## 1. Your assignment

Build a polished, working, interactive application demo of an AI-enabled budget-control service for Israeli construction companies. This document is the complete brief. You will not be able to ask its author follow-up questions. Make ordinary implementation decisions yourself using the defaults below, and implement all sixteen scenarios.

The prospect should be able to use the demo like an application: inspect projects, open documents, change inputs, review corrections, answer a simulated WhatsApp question, see the simulated ERP update, ask questions, and receive a weekly report. Scenario descriptions alone are insufficient. Each scenario must operate on shared application data and visibly change the appropriate screens.

The demo has two equally important modes:

1. **Free exploration:** the visitor can navigate and interact without following a presentation.
2. **Guided scenarios:** a presenter or visitor can start, replay, and step through scripted examples.

The interface must be **Hebrew, right to left**. This specification is in English for the implementing agent. All visible product text, scenario instructions, labels, notifications, validation messages, explanations, and programmed assistant replies must be in Hebrew. Technical identifiers, email addresses, filenames, Excel, WhatsApp, and ERP product names may remain in their natural direction.

Use deterministic, programmed behavior. **No live AI, API key, production ERP connection, real message delivery, or backend is required.** Structure the code so a real AI provider or integration could be added later, without making that extension part of the required build.

The purpose is to make a construction-company manager want to try a pilot with real company data. Show the work being completed and the decisions being improved. Do not present fictional results as measured customer outcomes.

### Confirmed choices and practical defaults

| Topic | Requirement or default |
| --- | --- |
| Product interface | Hebrew, RTL |
| Handoff language | English |
| Experience | Free exploration plus scripted, replayable scenarios |
| Intelligence | Deterministic rules, supported intent handling, programmed dialogue |
| Potential future extension | Replaceable AI adapter; optional later |
| Product working name | בקרה; make the name easy to configure |
| Customer | אופק דמו — חברת ביצוע פיקטיבית |
| Main source system | זיו — סביבת הדגמה |
| Main audience | Owners/managers of contractors and developer-contractors |
| Default device | Desktop, comfortable at 1366–1440 px; usable on tablet and mobile |
| Money | Israeli shekels, before VAT throughout |
| Demo time | Fixed simulated clock, starting 07/09/2026 at 09:00, Asia/Jerusalem |
| Report | Weekly Excel attachment, in the customer's chosen layout and delivery channel |
| Delivery channels | In-app simulations of email and WhatsApp |
| Runtime | Standalone frontend; local persistence; resettable seed data |
| Branding | Configurable name and simple typographic mark; do not imitate an official ERP interface |
| Scope | All sixteen scenarios below are required |

Display a discreet, persistent badge: **סביבת הדגמה · נתונים סינתטיים**. Inside the source-system pane, say **זיו — סביבת הדגמה**. A small delivery note should make clear that messages are simulated. Avoid repeated disclaimers that interrupt the flow.

### How to use this brief

Sections 2–4 define the product, experience, and financial meaning. Sections 5–7 define the data and state. Section 8 specifies the sixteen scenarios. Sections 9–10 define behavior shared by those scenarios. Sections 11–15 cover the walkthrough, Hebrew copy, implementation, and acceptance.

Treat the financial definitions and executable state transitions as authoritative. Example numbers are expected outputs for their stated fixtures, not literal strings to display regardless of state. Where a guided instruction offers a “check” button, the normal application still analyzes saved/received data automatically. No missing implementation detail requires a question to the author.

## 2. Product background and business logic

### 2.1 What the service does

The service performs construction budget control: comparing plan with actual incurred costs, understanding the cost of each budget item, tracking remaining obligations and work, identifying current and expected overruns, and maintaining an estimate of the project's total cost at completion.

Its output is an ongoing operational service:

- Prepare and import an initial budget from the company's spreadsheet.
- Check whether assumptions are sensible, with supporting evidence.
- Continuously examine newly available records and supporting documents.
- Classify expenses, match invoices to contracts and budget items, fix unit errors, reconcile cumulative accounts, and connect related records.
- Ask a human when information really is missing.
- Have the provider's own team review proposed changes and reports.
- Apply approved corrections back to the existing ERP.
- Maintain an evidence-backed forecast of total project cost.
- Deliver useful reports in the customer's preferred format, potentially weekly instead of quarterly.
- Answer questions using the relevant current data or a selected report snapshot.

The existing ERP remains the operational system of record. The service is an additional layer that completes preparation, reconciliation, review, and reporting work around it.

### 2.2 The problem and existing spending

Ziv and Priority already have budget-control capabilities. Do not claim that they lack reporting, alerts, commitments, or budget modules. The proposed opportunity is that those capabilities depend on the quality and completeness of the information entered into them.

In the target workflow described by the founders, internal employees or external consultants/technicians spend days preparing a report: cleaning data, correcting coding, entering the initial budget, linking documents, and obtaining explanations from management. Some prospective customers currently receive reports only quarterly. This is a description of the target segment, not a claim about every construction company or every ERP implementation.

Preliminary customer conversations suggest external-service spending of roughly:

- ₪60,000 per year for a small project.
- ₪80,000–₪120,000 per year for larger projects.
- About ₪300,000 per year for a company with five small projects.

These are **founder-reported discovery inputs**, not validated market averages or the product's proposed prices. Some quotes include initial setup as well as recurring work. Keep this information in implementation background; the customer application does not need a pricing or savings calculator.

Access to initial pilot customers is an advantage: the founders intend to work with one or two companies willing to share their real data. The demo must make the pilot concrete, but should not imply that such pilots have already proven the results.

### 2.3 Why AI is useful here

The intended advantage is the ability to cross-reference many existing sources and reuse approved context: invoice lines, delivery notes, contracts, prior coding decisions, past clarifications, quantities, and budget assumptions.

A technician may ask a manager something already answered in a contract. The service should first look for that answer, show the relevant clause, and avoid an unnecessary interruption. By contrast, actual work remaining on site, an undocumented verbal change, or a reason for a delivery discrepancy may require a person.

Show the difference clearly:

- **Resolvable from evidence:** determine a cost code, read whether freight is included, reconcile an invoice with a delivery note.
- **Requires client knowledge:** establish how equipment was split across sites, whether a high price will apply to future purchases, or whether a delay extends the entire site's operating period.

### 2.4 Two distinct human roles

**Provider review team:** checks the service's proposed corrections, exceptions, and forecast changes before they are applied or sent to the customer. This is part of the initial service, not an optional detail to hide.

**Customer contact:** supplies genuinely missing operational facts. Initially, unresolved questions are consolidated for one responsible contact after internal review. Later, a question may be routed to the relevant procurement or site manager.

Do not make every event message the CEO. Do not make a customer reply automatically approve unrelated accounting or forecast changes. A reply becomes supporting evidence; the appropriate review step still exists.

The longer-term aspiration is for repeated, approved patterns to reduce both internal review effort and unnecessary customer questions. The demo can demonstrate reuse of one approved rule. It must not invent measured accuracy improvements, time savings, or autonomous learning.

The construction-company manager is not being hired to operate the provider's review queue. Keep internal actions in the provider view. In a guided presentation, the role switch lets the visitor see both sides; label the transition **כך צוות הבקרה מטפל בנושא** so the prospect understands who performs the work.

### 2.5 What the prospect should remember

1. “I keep my existing ERP, but someone is continuously making the data usable.”
2. “I receive a report in the format I want, more often.”
3. “The system finds what it can in my documents before asking me.”
4. “I can see a future cost problem while there is still time to act.”
5. “I can inspect the sources, changes, assumptions, and human approvals.”

## 3. Experience and screen design

### 3.1 Application shell

Use a restrained financial-operations aesthetic: warm white backgrounds, dark navy text, teal primary actions, amber for conditional risk, red for confirmed urgent exceptions, and green only where the meaning is actually favorable. Use a Hebrew-capable font such as a locally available Heebo, Assistant, or a suitable system fallback. Do not make the interface depend on downloading fonts.

The RTL navigation belongs on the right. Keep numerical tables readable and align comparable monetary values consistently. Use bidi isolation for document IDs, currency figures, email addresses, and mixed Hebrew/English text. Format amounts using the Hebrew-Israeli locale and ₪; dates use dd/mm/yyyy.

Use clear hierarchy, generous but practical spacing, evidence drawers, compact timelines, and informative empty states. A polished operational dashboard is the primary experience; a marketing landing page is unnecessary.

### 3.2 Required destinations

These may be separate routes or carefully organized tabs, but all must be accessible:

| Hebrew destination | Required content and interactions |
| --- | --- |
| תמונת מצב | Active portfolio, project cards, approved forecast, current costs, open issues, report status |
| פרויקטים | Select a project; distinguish active projects from a draft budget |
| תקציב וביצוע | Cost-code table with plan, incurred cost, net commitments, remaining forecast, EAC, variance |
| תנועות ובדיקות | Incoming records, findings, proposed corrections, internal review, applied changes |
| מסמכים | Searchable synthetic invoices, contracts, delivery notes, quotes, and approved replies |
| שאלות ותשובות | Consolidated client questions and simulated WhatsApp conversation |
| דוחות | Immutable report archive, layout/channel preferences, generate and deliver report |
| שאל את הבקרה | Conversational questions with scope, calculations, and clickable evidence |
| ידע מאושר | Approved, scoped rules with origin, validity, and previous applications |
| תרחישי הדגמה | All sixteen scenarios, start/replay controls, guided walkthrough |

Provide a compact role switch between **מנהל החברה** and **צוות הבקרה**. This is a presentation affordance, not a production authentication system. The manager view prioritizes decisions, reports, and questions. The review view exposes proposals, source comparisons, and approval controls.

### 3.3 Important screen details

**Overview:** show approved budget, incurred costs, accepted EAC, and EAC variance. Put conditional risks and opportunities in a separate clearly labeled panel. Include a “מה השתנה?” view. Do not add the same risk to both accepted EAC and a total “exposure” metric.

**Automatic monitoring:** show **המידע נבדק עם כל עדכון**, the last received-record time, and a short activity feed of actual demo events. Saving an ERP record or receiving a document starts analysis automatically; a presenter must not have to press “analyze” for every record. External alerts appear in the simulated message channel after provider review, before a report is generated.

**Budget table:** allow expanding a cost code to inspect its invoices, commitments, forecast basis, payment information, and change history. Show paid amounts as additional information, never as a component added to incurred costs.

**Record drawer:** show original source, current ERP values, proposed values, reason, sources, and review status. Make **אשר תיקון** and **דחה הצעה** functional. Applied records must appear in the simulated ERP pane.

**Document drawer:** open to the exact line or clause cited. Provide the surrounding source text. Do not show a fabricated “source” label with nothing behind it.

**Messages:** provide a WhatsApp-like conversation within the application, with the requested clarification, suggested replies, editable text, validation, received response, and the next review step. Provide a similar in-app email inbox/outbox for report delivery.

**Report archive:** distinguish the selected report's date and frozen values from current analysis. A report never silently changes when a new correction is made.

**Presenter controls:** start/restart a scenario, next hint, hide guidance, switch to free exploration, reset all data, and advance the simulated clock by one week. All control labels must be Hebrew.

### 3.4 Free exploration must mean real interaction

At minimum allow the visitor to:

- Switch projects and cost codes and open every referenced source.
- Filter records by status, cost code, project, and supplier.
- Edit a draft steel purchase's quantity and unit price in a bounded, validated form.
- Compare alternative future steel prices.
- Enter a custom valid allocation reply in the WhatsApp flow.
- Approve or reject a proposed correction.
- Accept a forecast change after reviewing its assumptions.
- Change the preferred report layout and delivery channel.
- Generate a report, open the delivered attachment, and inspect a previous report.
- Ask supported questions in free text, not only by clicking suggestions.
- Inspect and replay any scenario independently.

You do not need to implement arbitrary production accounting or unrestricted document ingestion. Make the supported interaction boundaries visible with examples and helpful validation.

### 3.5 Default first visit and navigation

Open on the company overview in the manager view, with HAD selected for the detail pane. Show the active-portfolio cards, the previous HAD report, and two findings derived from the baseline: the conditional future steel-price risk and the missing equipment allocation evidence. Neither finding changes the ledger or implies a message has already been delivered. The manager sees **בבדיקת צוות הבקרה** until an alert/question is approved.

Provide three visible entry actions: **נסה הדגמה מודרכת**, **חקור את הנתונים**, and **הצג תרחישים**. The application must be understandable before the user opens a scenario gallery.

Use one shared message center, including report deliveries, proactive alerts, and clarification threads; distinguish them by purpose. Role and selected project persist during navigation. Scenario/tour controls are presentation controls, separate from ordinary customer tasks.

## 4. Financial semantics: use these definitions everywhere

### 4.1 Core calculation

All amounts below are before VAT, in whole ILS for readability. In code, prefer integer agorot or an exact decimal-money utility. Convert the seed consistently at ingestion.

| Symbol | Hebrew label | Definition |
| --- | --- | --- |
| B | תקציב מאושר | Approved cost budget for the cost code |
| A | עלות שנצברה | Recognized incurred cost: posted invoice costs plus approved accrued work not yet invoiced |
| C | התחייבויות שנותרו | Remaining, net committed work; excludes work already counted in A |
| R | יתרת עבודה ללא התחייבות | Forecast cost of remaining work not already in A or C |
| EAC | תחזית עלות לסיום | A + C + R |
| V | חריגה צפויה מהתקציב | EAC − B; positive means over budget |
| P | שולם | Cash paid against recognized invoices; shown separately |

Do not compute the expected project cost as budget minus paid amounts. Do not add a full contract value on top of invoiced costs. Do not count approved unbilled work in both A and C.

For a fixed-price contract in this simplified model:

~~~text
remaining commitment = approved contract value
                     − recognized contract invoices
                     − recognized unbilled contract work
~~~

Guard against negative remaining commitments: a contract overrun must become an explicit exception or approved additional commitment, not a hidden negative number.

Payments are not new project costs. In the subcontract example, ₪200,000 invoiced, ₪150,000 paid, and ₪800,000 of work remaining means:

~~~text
recognized unpaid invoices = 200,000 − 150,000 = 50,000
remaining expected contract cash payment = 50,000 + 800,000 = 850,000
contract EAC = 200,000 + 800,000 = 1,000,000
~~~

The demo omits VAT, retention, financing, and foreign currency. State **לפני מע״מ** near financial summaries. This keeps the payment answer specific to the simplified contract shown.

Add a tooltip to **תחזית עלות לסיום**: **העלות הכוללת הצפויה של הפרויקט, כולל העלות שכבר נצברה.** If showing **עלות שנותרה להשלמה**, that is C + R, a different number.

For cash questions after accruals exist, remaining payment includes recognized but unbilled work as well:

~~~text
remaining expected contract cash payment
  = unpaid recognized contract invoices
  + recognized unbilled contract work
  + remaining net contract commitment
  = current contract EAC − payments allocated to that contract
~~~

Only include R if answering for a scope that includes that uncommitted work. After S10, CT-H-WATER's remaining payment is 20,000 unpaid invoices + 80,000 unbilled work + 170,000 remaining commitment = ₪270,000. The entire H50 cost code also includes ₪50,000 outside that contract, so its expected remaining cash outlay is ₪320,000. Never confuse a contract with its broader cost code.

### 4.2 Separate facts, corrections, risks, and decisions

1. **Data correction:** changes incorrect ERP data. Moving an invoice between cost codes does not create project savings.
2. **Accepted forecast:** the currently reviewed expectation of remaining costs.
3. **Conditional risk:** a calculation that depends on an unresolved assumption. Display it separately until accepted.
4. **Opportunity:** a potential future improvement requiring confirmation. It is not cash already saved.
5. **Budget revision:** an explicit, versioned approval action. Do not automatically increase the approved budget to make an overrun disappear.
6. **Draft-budget revision:** permissible before approval; retain the earlier draft for comparison.
7. **Customer revenue or recovery:** separate from cost EAC. An unapproved claim must not reduce expected construction cost.

Use precise labels: **סיכון מותנה**, **תחזית מאושרת**, **הצעה לעדכון**, **תיקון נתון**, **הזדמנות לבדיקה**.

For V < 0, use **תחזית נמוכה מהתקציב** or **חיסכון צפוי**, not realized savings. B − A is an unspent budget balance, not a saving or a measure of construction progress. This seed does not contain a full time-phased earned-value model; do not infer schedule performance from a simple actual-versus-total-budget comparison.

### 4.3 Quantity and price

Purchased quantity, delivered quantity, installed quantity, planned quantity, and remaining required quantity are different fields. Do not infer site completion from the existence of an invoice.

For the steel example, all 20 purchased tons are documented as delivered and count toward the 500-ton procurement plan. Remaining procurement is 480 tons. A faulty raw ERP quantity of 200 must not silently overwrite the verified plan or generate a misleading forecast before reconciliation.

For concrete, excess delivered quantity may reflect an approved design change, return, measurement issue, or true overuse. The demo asks for context before interpreting it.

### 4.4 Comparisons and snapshots

A report contains a frozen financial snapshot, evidence references, accepted assumptions, open issues, and its timestamp. A current view is derived from current state.

Every “change since last report” answer must name the comparison report. The main project's last report is ₪6,100,000; the clean current baseline is ₪6,106,000; the confirmed high-steel-price forecast is ₪6,250,000. These imply different deltas:

- Current baseline versus last report: +₪6,000.
- Confirmed future-price change versus current baseline: +₪144,000.
- Confirmed future-price state versus last report: +₪150,000.

Never substitute one delta for another.

Resolve “last report” dynamically: in current-data mode, use the most recently delivered report for that project. Before any new delivery, this is 31/08. Immediately after delivering a new report with no further changes, the current-versus-last-report difference is zero. In report mode, “what changed?” compares the selected report with the preceding delivered report. Also allow explicitly selecting 31/08. A draft generated but not delivered does not become “last delivered report.”

### 4.5 Scope must not overlap

The main project buys steel and concrete directly. CT-H-FRAME covers structural labor and installation only; its price excludes steel and concrete supplied by the company. Otherwise H10/H20 and H30 could double count the same material.

H40 covers construction equipment. H70's rental component is temporary site-office/facility rental, not that equipment. H50's additional uncommitted ₪50,000 is outside the original waterproofing contract; S13's new ₪80,000 scope is outside both existing portions. H60 excludes those structural, waterproofing, and site-overhead scopes.

The project budgets are deliberately simplified demonstration scopes, not estimates of full market-priced residential developments. Do not derive apartment profitability or construction cost per apartment from these numbers.

### 4.6 How incurred cost consumes remaining work

Every posted cost must identify whether it fulfills a committed work item, fulfills an uncommitted forecast item, or represents additional scope. Give forecast items stable work-item IDs; do not update a cost code's R by simply subtracting every new invoice amount.

| Event | A | C | R | Effect on EAC |
| --- | --- | --- | --- | --- |
| Invoice for work already committed at the recognized amount | Increase | Decrease for the same matched work | Unchanged | Unchanged |
| Approved unbilled work within a commitment | Increase accrual component | Decrease | Unchanged | Unchanged |
| Invoice replacing an existing accrual | Replace accrual with invoice | No second decrease | Unchanged | Unchanged if amounts match |
| Purchase fulfills previously uncommitted forecast work | Increase by actual cost | No open amount for the fulfilled portion | Remove the forecast value of that same work | Actual cost minus its removed forecast value |
| Signed order for forecast work not yet performed | No incurred cost yet | Add committed cost | Remove forecast value of the ordered work | Committed cost minus removed forecast value |
| Additional scope absent from existing forecasts | Increase A or C, according to status | As applicable | Do not consume unrelated work | Increase by the genuinely additional amount |
| Reclassification of an existing invoice | Move allocations | Only change if a specific commitment link is corrected | Do not consume future work again | Company total unchanged |

For the steel purchase, the 20 tons previously represented ₪60,000 of future forecast. They now cost ₪66,000, creating the ₪6,000 realized price variance. Once INV-H-STEEL-001 is matched to PO-H-STEEL-001, that order has no remaining commitment. Do not add its full ₪66,000 again into C.

For S15, the fulfilled September equipment work has forecast values of HAD ₪40,000 and PAR ₪20,000. Remove those planned work-item values once, independently of the actual allocation. A custom actual 30,000/30,000 split therefore improves HAD EAC by ₪10,000 and worsens PAR EAC by ₪10,000; it does not automatically change future months.

## 5. Canonical synthetic seed

Everything in this section is fictional. Prices are demonstration inputs, not present-day market guidance. No external research, customer information, live exchange rates, or real supplier contacts are needed.

Use the following JSON as the canonical baseline. Derive totals; do not independently hardcode a second set of dashboard totals. IDs are stable across the application.

~~~json
{
  "seedVersion": "construction-demo-v1.1",
  "clock": "2026-09-07T09:00:00+03:00",
  "timezone": "Asia/Jerusalem",
  "currency": "ILS",
  "amountsInThisSeed": "whole_ils_before_vat",
  "company": {
    "id": "DEMO",
    "name": "אופק דמו",
    "description": "חברת ביצוע פיקטיבית"
  },
  "contacts": [
    {"id": "CEO", "name": "איתן ברק", "role": "מנהל החברה", "email": "eitan@ofek-demo.example"},
    {"id": "OPS", "name": "מאיה לוי", "role": "מנהלת תפעול", "email": "maya@ofek-demo.example"},
    {"id": "BUYER", "name": "נועם רז", "role": "מנהל רכש", "email": "noam@ofek-demo.example"},
    {"id": "REVIEWER", "name": "נועה", "role": "צוות הבקרה", "email": "review@bakara-demo.example"}
  ],
  "projects": [
    {"id": "HAD", "name": "מגורי הדרים", "status": "active", "city": "כפר סבא", "start": "2026-03-01", "plannedFinish": "2027-02-28"},
    {"id": "PAR", "name": "מתחם הפארק", "status": "active", "city": "רעננה"},
    {"id": "GAN", "name": "גני השקד", "status": "active", "city": "הוד השרון"},
    {"id": "YAM", "name": "מרכז הים", "status": "active", "city": "הרצליה"},
    {"id": "NOF", "name": "נוף הגבעה", "status": "draft", "city": "כפר סבא"}
  ],
  "budgetLines": [
    {"id": "H10", "projectId": "HAD", "name": "ברזל", "budget": 1500000, "incurred": 66000, "remainingCommitment": 0, "remainingUncommitted": 1440000, "paid": 0, "plannedQuantity": 500, "verifiedPurchasedQuantity": 20, "unit": "טון", "budgetUnitPrice": 3000},
    {"id": "H20", "projectId": "HAD", "name": "בטון", "budget": 1000000, "incurred": 400000, "remainingCommitment": 200000, "remainingUncommitted": 400000, "paid": 320000, "plannedQuantity": 2500, "unit": "מ״ק", "budgetUnitPrice": 400},
    {"id": "H30", "projectId": "HAD", "name": "קבלן שלד", "budget": 1000000, "incurred": 200000, "remainingCommitment": 800000, "remainingUncommitted": 0, "paid": 150000},
    {"id": "H40", "projectId": "HAD", "name": "ציוד", "budget": 600000, "incurred": 240000, "remainingCommitment": 180000, "remainingUncommitted": 180000, "paid": 200000},
    {"id": "H50", "projectId": "HAD", "name": "איטום", "budget": 400000, "incurred": 100000, "remainingCommitment": 250000, "remainingUncommitted": 50000, "paid": 80000},
    {"id": "H60", "projectId": "HAD", "name": "עבודות גמר", "budget": 1000000, "incurred": 300000, "remainingCommitment": 300000, "remainingUncommitted": 400000, "paid": 250000},
    {"id": "H70", "projectId": "HAD", "name": "תקורות אתר", "budget": 600000, "incurred": 300000, "remainingCommitment": 100000, "remainingUncommitted": 200000, "paid": 250000},
    {"id": "P10", "projectId": "PAR", "name": "ברזל", "budget": 600000, "incurred": 58000, "remainingCommitment": 0, "remainingUncommitted": 540000, "paid": 58000, "plannedQuantity": 200, "verifiedPurchasedQuantity": 20, "unit": "טון", "budgetUnitPrice": 3000},
    {"id": "P40", "projectId": "PAR", "name": "ציוד", "budget": 400000, "incurred": 120000, "remainingCommitment": 120000, "remainingUncommitted": 160000, "paid": 100000},
    {"id": "P60", "projectId": "PAR", "name": "יתר עבודות הפרויקט", "budget": 3000000, "incurred": 900000, "remainingCommitment": 1100000, "remainingUncommitted": 1000000, "paid": 700000},
    {"id": "G60", "projectId": "GAN", "name": "עבודות הפרויקט", "budget": 3000000, "incurred": 1000000, "remainingCommitment": 1200000, "remainingUncommitted": 800000, "paid": 800000},
    {"id": "Y60", "projectId": "YAM", "name": "עבודות הפרויקט", "budget": 2000000, "incurred": 500000, "remainingCommitment": 700000, "remainingUncommitted": 800000, "paid": 450000}
  ],
  "draftBudgetLines": [
    {"id": "N20", "projectId": "NOF", "name": "בטון", "quantity": 1000, "unit": "מ״ק", "draftUnitPrice": 300, "draftAmount": 300000},
    {"id": "N60", "projectId": "NOF", "name": "יתר עבודות הפרויקט", "draftAmount": 4700000}
  ],
  "reportPreferences": {
    "format": "xlsx",
    "layout": "management_summary",
    "channel": "email",
    "recipientId": "CEO",
    "frequency": "weekly",
    "weekday": "monday",
    "hour": "09:00"
  }
}
~~~

### 5.1 Baseline totals to assert

| Project | Approved budget | Incurred A | Net commitments C | Remaining uncommitted R | EAC | Paid | EAC − budget |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| HAD | 6,100,000 | 1,606,000 | 1,830,000 | 2,670,000 | 6,106,000 | 1,250,000 | +6,000 |
| PAR | 4,000,000 | 1,078,000 | 1,220,000 | 1,700,000 | 3,998,000 | 858,000 | −2,000 |
| GAN | 3,000,000 | 1,000,000 | 1,200,000 | 800,000 | 3,000,000 | 800,000 | 0 |
| YAM | 2,000,000 | 500,000 | 700,000 | 800,000 | 2,000,000 | 450,000 | 0 |
| Active portfolio | 15,100,000 | 4,184,000 | 4,950,000 | 5,970,000 | 15,104,000 | 3,358,000 | +4,000 |

NOF has a **draft** total of ₪5,000,000, no incurred cost, and no approved project budget. Exclude it from the active portfolio totals. Its card must say **טיוטת תקציב**.

### 5.2 Build the incurred-cost ledger without double counting

The budget-line values above are an initial checksum. Create these underlying transactions and derive A from them. Opening balances are explicitly labeled historical summaries; do not pretend each is a single supplier invoice.

| Transaction ID | Cost line | Amount | Nature and source |
| --- | --- | ---: | --- |
| TX-H-STEEL | H10 | 66,000 | Invoice INV-H-STEEL-001 |
| OPEN-H20 | H20 | 360,000 | Verified opening balance through 31/08 |
| TX-H-SLAB | H20 | 40,000 | Invoice INV-H-CONC-001, 100 m³ × 400 |
| TX-H-FRAME | H30 | 200,000 | Invoice INV-H-FRAME-001 |
| OPEN-H40 | H40 | 180,000 | Verified opening balance |
| TX-EQ-SHARED | H40 initially | 60,000 | Invoice INV-EQ-001; one invoice with allocation rows |
| TX-H-WATER | H50 | 100,000 | Invoice INV-H-WATER-001 |
| OPEN-H60 | H60 | 300,000 | Verified opening balance |
| OPEN-H70 | H70 | 300,000 | Six months of recognized site overhead |
| TX-P-STEEL | P10 | 58,000 | Invoice INV-P-STEEL-001 |
| OPEN-P40 | P40 | 120,000 | Verified opening balance |
| OPEN-P60 | P60 | 900,000 | Verified opening balance |
| OPEN-G60 | G60 | 1,000,000 | Verified opening balance |
| OPEN-Y60 | Y60 | 500,000 | Verified opening balance |

Implement each opening balance as an inspectable synthetic source with project, cost code, date, amount, and the Hebrew explanation: **יתרת פתיחה מאומתת לצורכי ההדגמה; פירוט תנועות היסטוריות אינו נכלל בדמו.**

Payment allocation: of H40's ₪200,000 paid, assign ₪180,000 to OPEN-H40 and **₪20,000 to TX-EQ-SHARED**. The shared invoice therefore has ₪40,000 unpaid. When that invoice is reallocated, distribute its existing payment proportionally across its allocation rows; do not create a new payment. With a 40,000/20,000 cost split, its payment splits ₪13,333.33/₪6,666.67. Use exact agorot and assign the rounding remainder deterministically to the last allocation. This changes each project's paid allocation, while preserving total company cash paid.

Allocate other paid totals from the seed to their corresponding invoice/opening records. All baseline incurred amounts are invoiced; approved unbilled accruals first appear in scenario S10.

Use these exact payment allocations: OPEN-H20 320,000; TX-H-SLAB 0; TX-H-FRAME 150,000; OPEN-H40 180,000; TX-EQ-SHARED 20,000; TX-H-WATER 80,000; OPEN-H60 250,000; OPEN-H70 250,000; TX-P-STEEL 58,000; OPEN-P40 100,000; OPEN-P60 700,000; OPEN-G60 800,000; OPEN-Y60 450,000; TX-H-STEEL 0. Each is a cumulative synthetic payment allocation, not a new payment triggered by opening the demo.

Payments and reconciliation status belong in linked payment/ledger records, not in mutable supplier-invoice text. Render the payment annotations shown in Section 6 as a clearly separate **תשלומים לפי הרישומים** panel.

### 5.3 Commitments, remaining forecasts, and prior report

Create inspectable synthetic commitment/forecast sources:

| ID | Line | Content |
| --- | --- | --- |
| FC-H-STEEL | H10 | 480 tons not yet contracted, assumed at 3,000/ton; future price not confirmed |
| PO-H-CONC-REMAIN | H20 | 500 m³ of future concrete committed at 400/m³ = 200,000 |
| FC-H-CONC | H20 | 1,000 additional m³ uncommitted at 400/m³ = 400,000 |
| CT-H-FRAME | H30 | Fixed contract 1,000,000; incurred 200,000; remaining 800,000 |
| CT-H-EQ-REMAIN | H40 | Remaining project-specific equipment commitments 180,000 |
| FC-H-EQ | H40 | Remaining uncommitted equipment forecast 180,000 |
| CT-H-WATER | H50 | Fixed contract 350,000; incurred 100,000; remaining 250,000 |
| FC-H-WATER | H50 | Separate uncommitted waterproofing work 50,000 |
| CT-H-FINISH | H60 | Contract 600,000; incurred 300,000; remaining 300,000 |
| FC-H-FINISH | H60 | Uncommitted finishing work 400,000 |
| CT-H-SITE-REMAIN | H70 | Remaining committed overhead 100,000 |
| FC-H-SITE | H70 | Remaining uncommitted overhead 200,000 |
| FC-P-STEEL | P10 | 180 tons uncommitted at 3,000/ton = 540,000 |
| CT-P-EQ-REMAIN | P40 | Remaining commitments 120,000 |
| FC-P-EQ | P40 | Remaining uncommitted equipment forecast 160,000 |
| BAL-P60 | P60 | Incurred 900,000; remaining commitments 1,100,000; remaining uncommitted 1,000,000 |
| BAL-G60 | G60 | Incurred 1,000,000; remaining commitments 1,200,000; remaining uncommitted 800,000 |
| BAL-Y60 | Y60 | Incurred 500,000; remaining commitments 700,000; remaining uncommitted 800,000 |

Generate the previous report **RPT-HAD-2026-08-31** by cloning the baseline HAD budget lines and replacing only H10 with A=0, C=0, R=1,500,000, paid=0, purchased quantity=0. HAD's prior EAC is ₪6,100,000, A=₪1,540,000, C=₪1,830,000, R=₪2,730,000.

Freeze a corresponding prior ledger and source set, not just those totals. Exclude the September steel invoice, order, delivery note, and later messages. Use a prior steel forecast version of 500 tons at 3,000. The prior report must never answer that its zero steel cost came from the later ₪66,000 invoice. In S09, the historical overlay replaces the prior subcontract certificate with A=220,000, C=780,000, paid=220,000 in both the starting ledger and that fixture's prior snapshot.

Generate a current baseline report **RPT-HAD-2026-09-07** only when requested or when a scenario explicitly seeds it. Do not pre-label every future simulation as an already delivered customer report.

### 5.4 Required lookup data and work-item links

Give every transaction a stable supplier ID. Use these fictional suppliers consistently in filters, matching, and rules:

| Supplier ID | Hebrew name | Associated records |
| --- | --- | --- |
| SUP-STEEL-A | ספק ברזל א׳ | HAD steel invoice/order/delivery |
| SUP-STEEL-B | ספק ברזל ב׳ | PAR steel purchase and the new HAD quote |
| SUP-CONCRETE | ספק בטון דמו | HAD concrete invoices, freight, and matching credits |
| SUP-FRAME | קבלן שלד דמו | CT-H-FRAME and its certificates |
| SUP-EQUIPMENT | ספק ציוד דמו | EQ-FRAMEWORK-01 and INV-EQ-001/002 |
| SUP-WATER | קבלן איטום דמו | CT-H-WATER, certificates, and changes |

Opening balances can have supplier null and display **יתרת פתיחה**, without pretending to identify one supplier. Use separate fictional bidder IDs for the four NOF quotes; no real supplier contacts are required.

Explicit links:

- TX-H-STEEL → PO-H-STEEL-001 → work item H-STEEL-FIRST-20; that order is fully fulfilled in the baseline.
- FC-H-STEEL → H-STEEL-REMAINING, 480 tons. Split the item into committed/uncommitted portions when an order is introduced.
- TX-H-FRAME and both cumulative-certificate fixtures → CT-H-FRAME.
- TX-H-WATER and CERT-H-WATER-080 → CT-H-WATER. CO-H-WATER-080 gets a distinct additional-scope item.
- OPEN-H60 → CT-H-FINISH for its recognized 300,000.
- H40's R=180,000 consists of H-EQ-SEP=40,000 and H-EQ-LATER=140,000.
- P40's R=160,000 consists of P-EQ-SEP=20,000 and P-EQ-LATER=140,000.
- INV-EQ-002 fulfills H-EQ-SEP and P-EQ-SEP. Its framework does not itself guarantee those future monthly purchases; the separate existing equipment commitments remain in C.

### 5.5 Data coverage and safe aggregation

HAD has detailed cost-code coverage for this demo scope. PAR has separate steel/equipment lines and one aggregate for all other work. GAN and YAM have project totals only; their aggregate lines may contain steel, concrete, or subcontract costs whose breakdown is not available.

Store coverage metadata and consult it when answering or ranking by category. A company-wide steel query can report **₪124,000 in the two projects with available steel detail** (66,000 + 58,000), but cannot claim that this is the full company's steel spend. Say:

> בפרויקטים שבהם קיים פירוט ברזל נצברו 124,000 ₪: 66,000 ₪ בהדרים ו-58,000 ₪ בפארק. בגני השקד ובמרכז הים יש בדמו נתונים מצרפיים בלבד, ולכן זה אינו סך הברזל המלא של החברה.

Overall project and portfolio totals are complete within the defined synthetic scope. A missing category breakdown is unknown, not zero. Derive available-detail answers dynamically after user edits.

## 6. Synthetic source documents

Create real in-app document objects, with title, ID, date, kind, project references, and ordered text/line anchors. Render them as readable document pages in a drawer or modal. HTML document rendering is sufficient; actual OCR and a PDF pipeline are unnecessary.

All clauses and examples below are newly written fictional demo material. Use them directly. Prices and wording are simplified for the scenarios.

### 6.1 Baseline documents

| Document / date | Anchors and literal Hebrew content |
| --- | --- |
| BUD-HAD-V1 · 01/03/2026 | h10: ברזל לזיון, 500 טון, 3,000 ₪ לטון, סה״כ 1,500,000 ₪. h20: בטון, 2,500 מ״ק, 400 ₪ למ״ק, סה״כ 1,000,000 ₪. h70: תקורות אתר, 12 חודשים, 50,000 ₪ לחודש. Render the remaining cost lines from the seed. |
| INV-H-STEEL-001 · 07/09/2026 | header: ספק ברזל א׳; פרויקט מגורי הדרים. line1: ברזל לזיון, דגם הדגמה R500, 20 טון × 3,300 ₪ = 66,000 ₪ לפני מע״מ. terms: המחיר כולל הובלה לאתר; תשלום שוטף + 60; ללא התחייבות לרכישות נוספות. |
| DN-H-STEEL-001 · 07/09/2026 | line1: סופקו 20 טון ברזל להזמנה PO-H-STEEL-001, אתר מגורי הדרים. receipt: התקבל באתר; תעודת הדגמה מאושרת. |
| PO-H-STEEL-001 · 04/09/2026 | line1: הזמנה חד-פעמית: 20 טון ברזל R500 במחיר 3,300 ₪ לטון, כולל הובלה. scope: הזמנה זו אינה קובעת את מחיר יתרת הברזל בפרויקט. |
| INV-H-CONC-001 · 28/08/2026 | line1: יציקת תקרה A: 100 מ״ק בטון C30 × 400 ₪ = 40,000 ₪. |
| PLAN-SLAB-A · 20/08/2026 | quantity: כמות מתוכננת ליציקת תקרה A: 100 מ״ק. status: אין במסמך זה אישור לשינוי הכמות. |
| CT-H-CONC · 01/03/2026 | price: מחיר הדגמה לבטון C30: 400 ₪ למ״ק. freight: המחיר כולל הובלה לאתר מגורי הדרים; אין לחייב הובלה בנפרד ללא תוספת הסכם מאושרת. scope: שאיבה ושירותים מיוחדים ייבדקו בנפרד; אינם כלולים בהשוואת מחיר הבטון בדמו. |
| CT-H-FRAME · 01/03/2026 | value: עבודות שלד לפי תכולה מוסכמת, סך חוזה 1,000,000 ₪. scope: עבודה והרכבה בלבד; ברזל ובטון מסופקים בנפרד על ידי החברה ואינם כלולים במחיר החוזה. billing: חשבונות הקבלן מוצגים במצטבר. סכום החשבון לתקופה הוא הסכום המצטבר המאושר בניכוי המצטבר שאושר קודם. |
| INV-H-FRAME-001 · 25/08/2026 | line1: חשבון עבודות שלד מאושר בסך 200,000 ₪. payment: התקבל תשלום 150,000 ₪; יתרה בחשבון זה 50,000 ₪. |
| EQ-FRAMEWORK-01 · 01/08/2026 | scope: מסגרת השכרת ציוד לאתרים מגורי הדרים ומתחם הפארק. billing: חשבונית חודשית משותפת; שיוך העלות לכל אתר מחייב פירוט שימוש או אישור תפעול. validity: בתוקף עד 31/12/2026. |
| INV-EQ-001 · 31/08/2026 | line1: השכרת ציוד לחודש אוגוסט במסגרת EQ-FRAMEWORK-01, סה״כ 60,000 ₪. allocation: החשבונית אינה כוללת פירוט עלות לפי אתר. payment: שולמו 20,000 ₪; נותרו 40,000 ₪ לתשלום. |
| CT-H-WATER · 01/03/2026 | value: עבודות איטום בתכולה מוסכמת, סך חוזה 350,000 ₪. scope: עבודה נוספת מחייבת הוראת שינוי; חשבונות ואישורי ביצוע יקושרו לחוזה. |
| INV-H-WATER-001 · 25/08/2026 | line1: עבודות איטום בתכולת החוזה, 100,000 ₪. payment: שולמו 80,000 ₪. |
| PLAN-H-SITE · 01/03/2026 | duration: תקופת האתר המתוכננת 01/03/2026–28/02/2027, 12 חודשים. monthly: עלות חודשית תלויה במשך: צוות אתר 20,000 ₪, שכירות משרדי ומתקני אתר 15,000 ₪, אבטחה 10,000 ₪, שירותים 5,000 ₪; סה״כ 50,000 ₪. The six recognized months come from OPEN-H70, not from this original planning document. |
| INV-P-STEEL-001 · 02/09/2026 | line1: ספק ברזל ב׳; מתחם הפארק; 20 טון ברזל R500 × 2,900 ₪ = 58,000 ₪. terms: המחיר כולל הובלה לרעננה; שוטף + 60; ההזמנה המסוימת נפרעה. limitation: המחיר מתייחס להזמנה זו; זמינות ומחיר להזמנה עתידית דורשים הצעה חדשה. |
| BUD-NOF-DRAFT-V1 · 07/09/2026 | concrete: תקציב טיוטה לבטון C30: 1,000 מ״ק × 300 ₪ = 300,000 ₪. other: יתר העבודות 4,700,000 ₪. status: טיוטה שטרם אושרה. |
| QUOTE-NOF-A · 03/09/2026 | price: הצעת הדגמה לבטון C30, 1,000 מ״ק, 380 ₪ למ״ק כולל הובלה לכפר סבא, ללא שאיבה, שוטף + 60. valid: בתוקף עד 30/09/2026. |
| QUOTE-NOF-B · 04/09/2026 | price: הצעת הדגמה לבטון C30, 1,000 מ״ק, 390 ₪ למ״ק כולל הובלה לכפר סבא, ללא שאיבה, שוטף + 60. valid: בתוקף עד 30/09/2026. |
| QUOTE-NOF-C · 05/09/2026 | price: הצעת הדגמה לבטון C30, 1,000 מ״ק, 400 ₪ למ״ק כולל הובלה לכפר סבא, ללא שאיבה, שוטף + 60. valid: בתוקף עד 30/09/2026. |
| QUOTE-NOF-X · 03/09/2026 | price: הצעת הדגמה לבטון C20, 310 ₪ למ״ק, איסוף עצמי ותשלום מראש. exclusion: הצעה זו אינה מקבילה למפרט ולתנאים של תקציב C30. |

Opening balances and forecast sources from Section 5 must also open in the document viewer. Generate their text from their values, so they cannot disagree with their own record.

The English field prefixes/instructions in these source tables are implementation metadata; do not print them inside the Hebrew source body. A supplier document contains its commercial text. Payment status, matching status, and demo-fixture explanations appear as application annotations outside that immutable source.

### 6.2 Documents introduced by scenarios

These are scenario-only fixtures unless a scenario is active. Do not load every adverse event into the clean baseline.

| Document | Literal Hebrew source content |
| --- | --- |
| ADD-H-FRAME-100 | תוספת מוסכמת לחוזה השלד: 100,000 ₪ עבור תכולה נוספת. סכום החוזה המעודכן 1,100,000 ₪. התוספת טרם חויבה בחשבונית. |
| CERT-H-FRAME-PREV | חשבון קודם: מצטבר מאושר 220,000 ₪. הסכום הוכר ושולם במלואו. |
| CERT-H-FRAME-CURRENT | חשבון נוכחי: מצטבר מאושר 300,000 ₪. מצטבר קודם 220,000 ₪. לתשלום בגין התקופה: 80,000 ₪. |
| CERT-H-WATER-080 | אישור ביצוע: בוצעו ואושרו עבודות איטום נוספות בסך 80,000 ₪ מתוך תכולת חוזה CT-H-WATER. טרם הוצאה חשבונית. אין זו תוספת לחוזה. |
| INV-H-WATER-080 | חשבונית 80,000 ₪ בגין אותן עבודות שאושרו ב-CERT-H-WATER-080; יש לקזז את הרישום הזמני של עבודה שבוצעה וטרם חויבה. |
| DN-H-SLAB-120 | סופקו ליציקת תקרה A סך 120 מ״ק. במועד התעודה אין מסמך החזרה או הוראת שינוי מצורפת. |
| INV-H-SLAB-120 | חשבונית לאספקת בטון, יציקת תקרה A: 120 מ״ק × 400 ₪ = 48,000 ₪. |
| INV-H-FREIGHT-002 | חיוב נוסף בגין הובלת בטון לאתר מגורי הדרים: 2,000 ₪. מופנה לאספקה לפי CT-H-CONC. |
| CREDIT-H-FREIGHT-002 | זיכוי מאושר בסך 2,000 ₪ כנגד INV-H-FREIGHT-002; סיבה: ההובלה כלולה במחיר לפי החוזה. |
| ADD-H-FREIGHT-VALID | תוספת מאושרת חלופית לתרחיש: אספקה מיוחדת מחוץ לתנאי ההסכם תחויב ב-2,000 ₪ נוספים. יש לבדוק התאמה לאספקה המסוימת. |
| CO-H-WATER-080 | הוראת שינוי שנחתמה על ידי החברה וקבלן האיטום: תוספת איטום שאינה בתכולת החוזה המקורי או בתחזית העבודה הנוספת הקיימת, בעלות מוסכמת 80,000 ₪. העבודה טרם בוצעה. דרישת החזר מלקוח הקצה בסך 80,000 ₪ הוגשה אך טרם אושרה. |
| SCHEDULE-H-14 | עדכון מאושר לאחר בירור: משך האתר הכולל מתארך מ-12 ל-14 חודשים; סיום חדש 30/04/2027. צוות האתר, השכירות, האבטחה והשירותים נדרשים לשני החודשים הנוספים. |
| INV-EQ-002 | חשבונית ספטמבר: EQ-FRAMEWORK-01, אותה תכולת ציוד ואותם שני אתרים, סה״כ 60,000 ₪. טרם שולמה. |
| QUOTE-H-STEEL-3100 | הצעת הדגמה חדשה: 480 טון ברזל R500 למגורי הדרים, 3,100 ₪ לטון כולל הובלה, שוטף + 60, זמינות לפי תוכנית האספקה, בתוקף עד 30/09/2026. זו הצעה בלבד; טרם הוצאה הזמנה. |
| PO-H-STEEL-LOCKED-200 | הזמנה חתומה לאספקה עתידית: 200 טון ברזל R500 למגורי הדרים במחיר קבוע של 3,000 ₪ לטון, כולל הובלה; סה״כ 600,000 ₪. הכמות טרם סופקה וטרם חויבה. |
| CT-NOF-CONC-300 | הסכם הדגמה תקף: 1,000 מ״ק בטון C30 במחיר 300 ₪ למ״ק, כולל הובלה לכפר סבא וללא שאיבה, שוטף + 60, לתכולת טיוטת נוף הגבעה. |
| DN-H-STEEL-018 | התקבלו באתר 18 מתוך 20 הטון שבהזמנה PO-H-STEEL-001. יתרת האספקה טרם אושרה בתעודה זו. |

Represent document versions or alternative fixtures explicitly. Never rewrite a supplier's original invoice or erase the original certificate in order to make a correction look supported.

Default scenario documents receive the scenario clock date at their arrival, with immutable created/received timestamps. CERT-H-FRAME-PREV is historical, dated 25/08. INV-EQ-002 is dated 30/09 and received 01/10; S15 moves to that next billing period explicitly. Alternative documents are visible to analysis only after their branch introduces them. A source from an unchosen branch must not answer the question in the primary branch.

For S11, load an alternative scenario world in which INV-H-SLAB-120 is the sole supplier invoice for the slab and TX-H-SLAB contains a mistaken ERP amount of 40,000. Do not load INV-H-CONC-001 as another active invoice in that scenario. The 100 m³ quantity remains in PLAN-SLAB-A as the planned quantity. Correcting the ERP to the actual 48,000 invoice is then supported, without pretending to amend a vendor invoice or pay for two invoices.

In S11's prior report, the slab's 40,000 came from the earlier ERP entry with its source invoice still missing. Preserve that qualification in the snapshot. The newly received 48,000 invoice must not appear as evidence available at the prior report date.

## 7. State, scenario isolation, and audit behavior

### 7.1 One domain state

Use one normalized state for projects, transactions, allocations, commitments, forecast versions, source documents, findings, proposals, messages, approvals, approved rules, and report snapshots. All dashboards, chat answers, source panes, and exports derive from that state.

The seed's numeric summaries are initialization checks, not an independent mutable ledger. After initialization, selectors compute the cost table from transactions, net commitments, and accepted forecast components.

A suitable conceptual structure is:

~~~typescript
type DemoState = {
  seedVersion: string;
  clock: string;
  revision: number;
  activeScenarioId: string | null;
  projects: Project[];
  budgetVersions: BudgetVersion[];
  sourceDocuments: SourceDocument[];
  erpRecords: ErpRecord[];
  transactions: Transaction[];
  commitments: Commitment[];
  forecasts: ForecastVersion[];
  findings: Finding[];
  proposals: ChangeProposal[];
  conversations: Conversation[];
  approvedRules: ApprovedRule[];
  auditEvents: AuditEvent[];
  reportSnapshots: ReportSnapshot[];
  reportPreferences: ReportPreferences;
  deliveries: SimulatedDelivery[];
  alerts: Alert[];
  coverage: DataCoverage[];
};

type ChangeProposal = {
  id: string;
  kind: "erp_correction" | "accrual" | "commitment" |
        "forecast" | "draft_budget";
  targetIds: string[];
  before: unknown;
  after: unknown;
  reasonHe: string;
  evidence: Array<{ documentId: string; anchorId: string; version: number }>;
  status: "needs_clarification" | "pending_review" |
          "approved" | "applied" | "apply_failed" |
          "rejected" | "superseded";
  createdAtRevision: number;
  reviewedBy?: string;
};
~~~

Adapt the type design as needed, but preserve these distinctions.

### 7.2 Review and application

Incoming records become analyzed findings. A finding can become:

- A supported correction ready for provider review.
- A question draft because evidence is insufficient.
- A conditional risk requiring a forecast assumption decision.
- A dismissed finding after an explanation is supported.

Apply a correction only after the demo's internal review action. Record source references, previous values, new values, reviewer, simulated timestamp, and reason.

Client replies are immutable evidence messages. A proposal generated from a reply still appears in the review queue. For a supported low-risk repeated pattern, the demo can show fewer investigation steps, but do not silently bypass the explicitly modeled review policy.

ERP corrections and forecast decisions are different operations. A forecast update need not fabricate an invoice or payment in the ERP.

### 7.3 Raw versus reviewed data

Use these explicit layers:

| Layer | Meaning and update rule |
| --- | --- |
| Source documents | Immutable invoice, contract, delivery, and reply versions |
| ERP records | The currently observed, sometimes incorrect, posted values |
| Normalized transactions | A deterministic projection of those posted monetary values and allocations; never an independently edited second ledger |
| Accepted remaining-cost assumptions | Reviewed commitments/forecast bases, with current net remaining balances derived from their matched transactions |
| Proposed changes | Before/after candidates; no effect on posted values until successful application |
| Reports | Frozen, reviewed snapshots with their source versions and stated open assumptions |

An incoming external ERP save can change observed A before the provider reviews it. That is distinct from a service-proposed correction. Mark affected current values **טרם הושלמה הבדיקה**; do not call the provisional current EAC an approved report. The incorrect starting allocations in S03 and amounts in S09/S11 are observable posted data, not hypothetical corrections already applied.

After an approved mock write succeeds, update the ERP record and its normalized projection atomically, then recalculate dependent views. Failed writes leave both unchanged. Rejected proposals never mutate posted data.

A unit mismatch can leave the recorded invoice amount valid. Keep raw quantity separate from verified procurement quantity. Do not recalculate all remaining project quantities from an untrusted raw field before reconciliation.

### 7.4 Scenario fixtures

Every scenario has a named starting fixture. Most clone the canonical baseline and apply a small overlay. S15 deliberately starts after S05's completed allocation, and S16 deliberately starts after S06's confirmed high-price forecast.

Keep a saved free-exploration workspace separate from the active scenario/tour session. Starting a scenario visibly says **נטען מצב פתיחה לתרחיש**. **חזרה למרחב החופשי** restores the saved workspace. Within a scenario, **הסתר הדרכה** leaves its current state intact and permits free navigation. This avoids silently discarding the visitor's experiments.

Do not accidentally apply all independent fixture overlays to the same ledger. Expected numbers in Section 8 assume only the named fixture. A guided sequence may deliberately carry state forward, but its steps must use current selectors rather than independent-scenario hardcoded totals.

Use stable event IDs and prevent duplicate application. Double-clicking an approval, replaying an analysis, refreshing the browser, or advancing the clock twice must not book an invoice or send the same scheduled report twice.

### 7.5 Audit and corrections after reports

The history drawer should read like:

> 07/09/2026 09:12 · נועה, צוות הבקרה · כמות בחשבונית INV-H-STEEL-001 תוקנה מ-200 ל-20 טון. סכום החשבונית נשאר 66,000 ₪. מקור: חשבונית ותעודת משלוח.

A newly applied correction marks relevant report views **קיימים עדכונים מאז הדוח**. Existing reports stay frozen; a newly generated report gets a new ID/version. A “reverse correction” action, if provided, creates another audit entry instead of deleting history.

### 7.6 Event processing, outbound alerts, and failures

Saving/receiving an eligible record automatically schedules analysis for that record version and re-evaluates dependent findings. Analysis may create proposals and draft alerts/questions; it does not itself apply financial changes or release customer messages.

The initial provider-review policy has three separate gates:

1. Review an outgoing question or early alert before its simulated release.
2. Review a proposed ERP/forecast change before applying it.
3. Review a report before delivery.

After the relevant review click, complete the local operation automatically. The customer should see the result without operating the provider workflow.

Use a shared alert lifecycle: draft → pending review → delivered → acknowledged/resolved/superseded. A finding and its alert share an ID link; accepting its forecast must remove the same amount from the open conditional-risk pool. Do not resend the same finding on every scan.

For S06, the provider can release an early WhatsApp alert to CEO and a linked pricing clarification to OPS, or combine them for OPS if selected. These are different purposes, not two copies of the same question. Alert text shows the conditional nature, the ₪6,000 actual premium, and the ₪144,000 additional exposure. **פתח את החישוב** opens the calculation drawer; **בדוק את הנחת המחיר** opens the question thread. A subsequent accepted assumption creates a concise update in the same thread.

Implement one retry branch in S03: **הדמה כשל בעדכון** makes the next mock ERP write fail. Show **העדכון לא הושלם; הנתונים בזיו לא שונו** and **נסה שוב**. Keep the approved proposal and its failure record. Retrying applies it once and records success. This is a local deterministic failure, not a real network integration.

Use idempotency keys based on session, entity ID/version, and operation. Do not discard history when an updated source supersedes an old proposal. If an asynchronous result belongs to a previous scenario session, discard it; it must not modify the new scenario after reset.

### 7.7 Fixture and event contract

Implement each scenario as data: starting fixture, active project, source-event payloads, supported branches, expected-state predicates, and guidance steps. Clicking **הבא** only advances guidance; completion is determined by domain state, such as a successfully applied correction or a delivered report.

| Scenario | Starting overlay and active project | Primary event / end condition |
| --- | --- | --- |
| S01 | Baseline; HAD | Generate, approve, deliver; frozen snapshot and valid attachment exist |
| S02 | Baseline NOF draft | Sample-budget intake; revise draft price to 390 |
| S03 | Steel allocated to H60; HAD | Save/re-receive that record; correction applied to H10 |
| S04 | Raw steel quantity 200, unit price 330; HAD | Save record; source-supported quantity correction applied |
| S05 | Shared invoice allocated only to HAD | Missing-allocation finding; validated reply applied to both sites |
| S06 | Baseline verified steel quantity; HAD | Price-risk analysis; selected future assumption reviewed |
| S07 | Baseline, or current tour state; HAD | Answer supported question using selected scope and evidence |
| S08 | Baseline; HAD | Receive signed additional-scope contract; C +100,000 |
| S09 | Replace historical frame invoice/payment with 220,000; HAD | Receive erroneous cumulative posting; incremental amount corrected to 80,000 |
| S10 | Baseline; HAD | Receive approved unbilled certificate; recognize and optionally match invoice |
| S11 | Alternative slab source 48,000 with raw ERP amount 40,000; HAD | Reconcile quantity and amount; apply supported posting correction |
| S12 | Baseline plus unpaid freight posting 2,000; HAD | Contract exception check; apply received credit |
| S13 | Baseline; HAD | Receive approved additional cost scope; C +80,000; recovery stays separate |
| S14 | Baseline; HAD | Proposed duration 14 months; approve applicable continuing costs |
| S15 | Completed S05 with explicitly approved default rule | Receive September invoice on 01/10; reuse rule and consume matched September forecasts |
| S16 | Completed S06 primary 3,300 assumption; HAD | Historical comparison, then new quote; accept 3,100 assumption |

All fixtures start at the canonical clock except S15, which uses 01/10/2026 09:00 Asia/Jerusalem for the later invoice. Loading a fixture or moving to a named tour scene does not backfill scheduled reports. The explicit **התקדם שבוע** action exercises report scheduling. A date change alone does not invent monthly invoices or recognize new overhead.

For S15 and S16 launched independently, generate their prerequisite replies, review events, and forecast/rule versions as clearly seeded history. In a continuing tour, reuse the actual session history instead. If a visitor chose an alternative split or price, either derive the continuing scene from it or visibly load the named default fixture; never show hardcoded default outcomes on an incompatible state.

The gallery may initialize analysis when a scenario loads, but scenario-only source events must stay unavailable until their trigger. Starting S04 must not expose a future credit, future quote, or reply that resolves its question before the user reaches it.

## 8. Required scenarios

All sixteen scenarios belong to one equally accessible gallery. Use the Hebrew titles below. Each scenario must include an actual trigger, inspectable evidence, a meaningful user action, a visible result, and a restart path.

The values stated in each scenario are testable fixture expectations. When the user changes supported inputs, calculate the new result from the state instead of forcing these example values.

### S01 — דוח בקרה שבועי בפורמט שהחברה רוצה

**Purpose.** Show the concrete deliverable: a useful weekly budget-control report in the customer's preferred format, delivered through the channel they choose. Do not assume that the company wants the same format it receives today.

**Starting fixture and evidence.** Canonical baseline, last report RPT-HAD-2026-08-31, current HAD EAC ₪6,106,000. Use the existing project ledger, source documents, and accepted forecast assumptions.

**Trigger and interaction.**

1. Open **דוחות** and select **מגורי הדרים**.
2. Choose **Excel**, then one of **סיכום להנהלה** or **פירוט לפי סעיפי תקציב**. The on-screen preview changes the emphasis/columns.
3. Choose **מייל** or **WhatsApp**, recipient איתן ברק, and **בכל יום שני**.
4. Click **הפק דוח עכשיו**. Show preparation, internal review, then **אשר והעבר ללקוח** in the provider role.
5. Open the delivered message in the simulated email or WhatsApp view.
6. Open/download its Excel attachment and open the corresponding in-app report.
7. Click **התקדם שבוע**. The simulated weekly schedule produces the next due report for review and delivery without asking the visitor to rebuild it manually.

**Hebrew customer message.**

> איתן, דוח הבקרה השבועי של מגורי הדרים מוכן. תחזית העלות לסיום היא 6,106,000 ₪, לעומת תקציב של 6,100,000 ₪. מצורף קובץ Excel בפורמט שבחרת. אפשר לפתוח את הדוח ולשאול עליו שאלות.

Generate the amounts and project name from the delivered snapshot. If the guided tour reaches this step after S06, the message must say ₪6,250,000 instead.

**Visible result and state changes.** Save report ID, timestamp, source revision, frozen values, review approval, chosen layout, and one simulated delivery record. The dashboard shows the latest report date. The Excel attachment has a valid .xlsx file format; a lightweight workbook with a title or even an otherwise empty sheet is acceptable. A richly populated workbook is not required. If you populate it, its values must match the frozen report, not the current mutable state.

**Branches and validation.** Switching channels creates a genuinely different in-app delivery surface. Changing layout changes the preview and stored preference. With unresolved material issues, show them as open questions or conditional risks in the report; never label an unresolved proposal as applied. Duplicate clicks do not create duplicate scheduled deliveries.

**Acceptance.** Both delivery channels work, the attachment opens/downloads, the weekly clock creates a later report, and the earlier report remains unchanged after subsequent edits. Restart returns to the baseline archive.

### S02 — בדיקת הנחות התקציב לפני תחילת העבודה

**Purpose.** Demonstrate value before spending starts: identify an implausible initial price assumption and show its potential effect on the draft budget.

**Starting fixture and evidence.** NOF draft concrete quantity 1,000 m³ at ₪300/m³, draft concrete total ₪300,000 and full draft budget ₪5,000,000. Open BUD-NOF-DRAFT-V1 and the three comparable fictional quotes at ₪380, ₪390, and ₪400. The cheaper QUOTE-NOF-X concerns a different specification and terms.

**Trigger and interaction.**

1. Open NOF's **טיוטת תקציב**. Offer **טען תקציב לדוגמה**: show a two-row spreadsheet preview from N20/N60, map quantity/unit/unit-price/amount, then **קלוט טיוטה בזיו — הדגמה**. Update the existing draft version, without appending duplicate rows. This is a preset sample import, not arbitrary Excel parsing. Analysis starts automatically on intake or on a saved assumption change; **הצג בדיקת הנחות** opens its result.
2. Show a flagged concrete row and a comparison drawer with specification, location, date/validity, quantity, delivery inclusion, pumping exclusion, and payment terms.
3. Show QUOTE-NOF-X as **לא נכלל בהשוואה — מפרט ותנאים שונים**.
4. Allow a revised draft unit price, default ₪390, and show the recalculated total.
5. Click **עדכן טיוטה** after reviewing the comparison.

**Hebrew explanation.**

> מחיר הבטון בטיוטה הוא 300 ₪ למ״ק. בשלוש הצעות ההדגמה המתאימות למפרט ולתנאים מופיעים 380–400 ₪ למ״ק. בכמות של 1,000 מ״ק, הפער האפשרי הוא 80,000–100,000 ₪. כדאי לאמת את ההנחה לפני אישור התקציב.

**Visible result and calculations.**

- Low gap: (380 − 300) × 1,000 = ₪80,000.
- High gap: (400 − 300) × 1,000 = ₪100,000.
- Chosen ₪390: concrete draft becomes ₪390,000; total draft becomes ₪5,090,000.
- Preserve V1 and create a new draft version. No active-project budget, incurred cost, payment, or portfolio total changes.

**Branches and validation.** Provide **יש הסכם תקף במחיר 300 ₪** as an alternative reply. Introduce CT-NOF-CONC-300, check its specification and terms, then let the reviewer retain the original assumption with an explanation. A claim without a supporting record remains an open question. Reject nonpositive quantities or prices. If the simulated clock passes quote validity, show that a new price decision needs refreshed evidence; do not silently undo a previously accepted draft.

**Acceptance.** The comparison is source-backed, incompatible quotes are excluded, custom draft prices recalculate, and an assumption check never silently changes an approved budget. Restart restores draft V1.

### S03 — חשבונית שנרשמה בסעיף הלא נכון

**Purpose.** Show evidence-based coding and a correction that is actually written back to the simulated ERP.

**Starting fixture and evidence.** Clone baseline, then assign TX-H-STEEL to H60 instead of H10. The invoice still totals ₪66,000 and its payment remains zero. Its description, delivery note, purchase order, and BUD-HAD-V1 identify steel.

Before correction, H10 has A=0 and EAC ₪1,440,000; H60 has A=₪366,000 and EAC ₪1,066,000. HAD's total EAC remains ₪6,106,000.

**Trigger and interaction.**

1. In the simulated ERP, open the invoice under **עבודות גמר**.
2. Save or re-receive the record; the automatic check produces the finding. **הצג בדיקה** opens the result and does not initiate a required manual scan.
3. Show the proposed code **ברזל**, with the matched invoice line and budget item.
4. Click the source links, then **אשר תיקון** in the review view.
5. Return to the simulated ERP and the budget table.

**Hebrew explanation.**

> החשבונית מתארת 20 טון ברזל לזיון, אך נרשמה בסעיף עבודות גמר. החשבונית, ההזמנה ותעודת המשלוח תואמות לסעיף ברזל. מוצע לשנות את הסיווג בלבד; סכום החשבונית לא משתנה.

**Visible result and state changes.** TX-H-STEEL moves to H10. H10 incurred cost returns to ₪66,000, EAC ₪1,506,000. H60 incurred cost returns to ₪300,000, EAC ₪1,000,000. Project and company totals, payment totals, and original invoice text do not change. Add an audit entry with before/after cost codes and evidence.

**Branches and validation.** A rejection leaves the ERP untouched and records the reason. If a user selects another code manually, require an explanation and keep the proposal visible for review. A vague ERP description alone must not trigger a client question when the invoice/order still clearly identify steel. The ambiguous branch must actually omit decisive descriptions from all available sources and have no matching approved rule before it asks for clarification. Include the failed-write/retry behavior in Section 7.6.

**Acceptance.** Both cost-code drilldowns update from the same transaction, the ERP pane reflects the new code, and there is no “₪66,000 saved” metric. Restart restores the misclassification, not a second copy of the invoice.

### S04 — כמות או יחידת מידה שגויה בקליטה

**Purpose.** Show continuous reconciliation of a newly entered record against its sources.

**Starting fixture and evidence.** Baseline with the correct steel cost code, but the raw ERP invoice row says **200 tons**, unit price **₪330**, total **₪66,000**. The original invoice, delivery note, and purchase order all say **20 tons at ₪3,300**.

**Trigger and interaction.**

1. Open the ERP entry form and show the erroneous quantity.
2. Click **שמור תנועה**. Analysis begins automatically.
3. Show three aligned source rows: ERP, invoice, delivery note.
4. Propose quantity 200 → 20 and unit price 330 → 3,300.
5. Review and apply the correction.

**Hebrew explanation.**

> נמצאה אי-התאמה בכמות: בזיו נרשמו 200 טון, ובחשבונית ובתעודת המשלוח מופיעים 20 טון. סכום החשבונית, 66,000 ₪, תואם ל-20 טון במחיר 3,300 ₪ לטון. מוצע לתקן את הכמות ואת המחיר ליחידה.

**Visible result and calculations.** Correct the two fields in the simulated ERP, retain ₪66,000 incurred cost, and show 20 verified purchased tons against a 500-ton plan. Purchased quantity is 4% of plan. EAC stays ₪6,106,000 in this scenario; a separate S06 analysis considers future prices.

**Branches and validation.** Include **הדגם אספקה חלקית**: introduce DN-H-STEEL-018 as the active delivery source, with 18 tons received against 20 purchased. This is a possible partial delivery, not proof that the invoice is wrong. Check for another delivery note before asking whether the remaining 2 tons are due or a credit is expected. Suggested replies: **2 טון נוספים בדרך** and **נדרש בירור מול הספק**. Keep purchased quantity 20, delivered quantity 18, outstanding delivery 2, and new procurement still required 480. Do not count those 2 tons again as a new purchase or reduce the invoice to 18 tons without evidence. The unresolved reply leaves a delivery issue open.

For editable demo purchases, distinguish raw ERP fields from the synthetic source values. Editing a draft fixture can generate new clearly synthetic source documents; editing only the ERP row must preserve existing sources so a discrepancy can be demonstrated.

**Acceptance.** Source-backed correction, unchanged monetary total, visible before/after audit, and a working unresolved branch. Restart returns to the 200-ton raw entry.

### S05 — בירור מרוכז ב-WhatsApp ועדכון השיוך בזיו

**Purpose.** Show a question that really requires client context, with a complete loop from detection to reply, internal review, and ERP correction.

**Starting fixture and evidence.** Baseline TX-EQ-SHARED is a single ₪60,000 invoice allocated entirely to HAD/H40. EQ-FRAMEWORK-01 permits use at HAD and PAR, but neither it nor INV-EQ-001 provides the actual split. The invoice already has ₪20,000 paid.

**Trigger and interaction.**

1. Detect missing allocation evidence.
2. The provider reviews the unresolved question and adds it to **שאלות מרוכזות למאיה**.
3. Click **שלח בירור מרוכז** to create an in-app WhatsApp conversation.
4. The visitor replies using a suggested response or editable text.
5. Show a parsed allocation proposal and the supporting reply.
6. The provider reviews and applies the correction to the one invoice's allocation rows.

**Exact question and primary reply.**

> מאיה, ריכזנו שאלה אחת שלא נפתרה מהמסמכים: חשבונית ציוד INV-EQ-001 בסך 60,000 ₪ נרשמה כולה למגורי הדרים, אך המסגרת כוללת גם את מתחם הפארק. איך לחלק את העלות בין האתרים?

Primary reply:

> 40,000 ₪ למגורי הדרים ו-20,000 ₪ למתחם הפארק.

**Visible result and calculations.**

- HAD equipment incurred: 240,000 − 20,000 = ₪220,000.
- PAR equipment incurred: 120,000 + 20,000 = ₪140,000.
- HAD EAC: ₪6,086,000; PAR EAC: ₪4,018,000.
- Active portfolio EAC remains ₪15,104,000.
- Allocate the existing ₪20,000 payment as ₪13,333.33 HAD / ₪6,666.67 PAR. Company paid remains ₪3,358,000.
- HAD paid becomes ₪1,243,333.33; PAR paid becomes ₪864,666.67.

Do not clone the invoice into two full invoices. Preserve the original vendor amount, its total payment, and a pair of allocation rows.

**Branches and validation.** Accept other valid splits, such as 30,000/30,000. Support comma-separated or plain numbers and common project-name aliases. A 45,000/20,000 reply produces **החלוקה מסתכמת ב-65,000 ₪, אך סכום החשבונית הוא 60,000 ₪. צריך לתקן את החלוקה לפני העדכון.** Ambiguous free text requests a clearer split. **אין לי עדיין פירוט** keeps the question open and changes nothing.

After approval offer **שמור כלל לשימוש חוזר** with scope, validity, and explicit confirmation that this split is intended for matching future monthly charges. That optional approved rule is used in S15.

**Acceptance.** The customer reply is visible evidence, totals reconcile, both projects update, no real message is sent, and an invalid reply cannot alter the ledger. Restart restores the original allocation.

### S06 — התרעה מוקדמת: רכישה קטנה חושפת סיכון גדול

**Purpose.** Show the central forward-looking moment: a small purchase can reveal a material future overrun before most of the money is spent.

**Starting fixture and evidence.** Clean baseline after the steel quantity is verified. Budget: 500 tons × ₪3,000 = ₪1,500,000. Purchased: 20 tons × ₪3,300 = ₪66,000. Remaining: 480 tons, uncommitted, currently forecast at ₪3,000 = ₪1,440,000. The purchase order does not establish the future price.

**Trigger and interaction.**

1. After the verified purchase arrives, analysis automatically produces the risk card. **הצג השפעה על יתרת הפרויקט** opens its calculation.
2. Expand actual premium, remaining quantity, and conditional future premium. The provider reviews **התרעה מוקדמת** and releases it to the simulated WhatsApp channel, while no new report has been generated.
3. Open the delivered alert and its linked pricing clarification. Ask whether the new price is expected to apply to the remainder.
4. Select or enter a supported price assumption.
5. Review **הצעה לעדכון תחזית**, then approve it.

**Hebrew alert.**

> נרכשו רק 20 מתוך 500 טון, במחיר גבוה ב-300 ₪ לטון מהתקציב. החריגה ברכישה שכבר בוצעה היא 6,000 ₪. אם גם 480 הטון שנותרו יירכשו ב-3,300 ₪ לטון, תתווסף חריגה של 144,000 ₪. החריגה הכוללת בסעיף תהיה 150,000 ₪.

**Clarification and replies.**

> האם 3,300 ₪ לטון צפוי להיות המחיר גם ליתרת הרכישות, או שמדובר בהזמנה חריגה?

- **זה המחיר הצפוי גם בהמשך** → candidate future price ₪3,300.
- **זו רכישה חד-פעמית; היתרה צפויה ב-3,000 ₪** → retain baseline future assumption.
- **יש הערכה חדשה של 3,150 ₪ לטון** → candidate future price ₪3,150.
- **עדיין לא ידוע** → keep conditional risk open, accepted forecast unchanged.

Record the response, respondent, and assumption status. Treat a manager's estimate as an estimate, not a signed supplier contract.

**Visible result and calculations.**

| Accepted future price | Remaining steel forecast | Steel EAC | Steel EAC − budget | HAD EAC |
| --- | ---: | ---: | ---: | ---: |
| 3,000 | 1,440,000 | 1,506,000 | +6,000 | 6,106,000 |
| 3,150 | 1,512,000 | 1,578,000 | +78,000 | 6,178,000 |
| 3,300 | 1,584,000 | 1,650,000 | +150,000 | 6,250,000 |

The high-price branch increases the accepted forecast by ₪144,000 from baseline. The total variance versus the steel budget is ₪150,000. Before approval, display ₪6,250,000 only as a conditional scenario, alongside accepted EAC ₪6,106,000.

**Branches and validation.** A future-price slider or input, default range ₪2,800–₪3,600, must drive the same calculation. A user may choose a lower future price, but it stays a forecast assumption rather than a signed commitment. Reject invalid or negative values.

Include **חלק מהכמות כבר מוזמן במחיר קבוע**: introduce PO-H-STEEL-LOCKED-200. After review, 200 remaining tons at 3,000 become C=600,000 and are removed from the corresponding uncommitted forecast. The other 280 tons remain exposed. Before changing their price, R=840,000 and steel EAC remains 1,506,000. At an accepted 3,300 for those 280 tons, R=924,000, steel EAC=1,590,000, and HAD EAC=6,190,000. Additional future exposure is 84,000, not 144,000; total steel variance is 90,000. Update the existing finding/thread rather than leaving the superseded 144,000 alert active.

**Acceptance.** The application distinguishes ₪6,000 already incurred from ₪144,000 conditional future exposure, asks for missing context, and updates forecasts only through the modeled decision. Restart restores the baseline assumption.

### S07 — שאלות בשפה טבעית עם תשובות ומקורות

**Purpose.** Let a manager ask useful questions without finding and interpreting a report table.

**Starting fixture and evidence.** Canonical baseline by default, or the current guided-tour state. Select **נתונים עדכניים** or a named report. Every answer uses that scope and links to its records and calculation.

**Trigger and interaction.** Open **שאל את הבקרה**, click a suggested question or type a supported variation. The answer contains a direct response, a short breakdown, and **מקורות** links. Follow-up questions retain project/cost-code context unless the user changes it.

**Required example questions and baseline answers.**

| Hebrew question | Meaning and answer logic |
| --- | --- |
| כמה הוצאנו על ברזל בהדרים? | ₪66,000 incurred; 20 tons at ₪3,300; ₪0 paid on this invoice. Clearly label the default meaning of “הוצאנו”. |
| כמה שילמנו בפועל על הברזל? | ₪0 in HAD baseline; distinguish from the ₪66,000 recognized invoice. |
| כמה צפוי לעלות הברזל בסוף? | Baseline ₪1,506,000 = 66,000 + 1,440,000. After S06 high-price approval, ₪1,650,000. |
| איפה החריגה הכי גדולה בפרויקט? | Rank accepted EAC variance by cost code. H10 is +₪6,000 at baseline; +₪150,000 after the high-price branch. Show conditional risks separately. |
| מה השתנה מאז הדוח האחרון? | Before a new delivery, compare with RPT-HAD-2026-08-31: baseline +₪6,000; after high-price approval +₪150,000. After a new report is delivered, resolve “last report” again as specified in Section 4.4. |
| כמה נשאר לשלם לקבלן השלד? | Baseline ₪850,000 under the simplified contract: ₪50,000 invoiced unpaid + ₪800,000 future contract work. |
| כמה התחייבויות עוד פתוחות בהדרים? | Baseline C=₪1,830,000, excluding incurred costs and uncommitted forecast. Derive from current state after changes. |
| כמה ברזל הוצאנו בכל החברה? | Baseline known-detail subtotal ₪124,000; explicitly state missing category detail in GAN/YAM as in Section 5.5. |
| על סמך מה תיקנתם את הכמות? | Open the applicable correction, original and corrected quantities, invoice, delivery note, and review event. If no correction has occurred in this fixture, say so. |

**Example answer after S06.**

> תחזית עלות הברזל במגורי הדרים היא 1,650,000 ₪: 66,000 ₪ שכבר נצברו ועוד 1,584,000 ₪ עבור 480 טון שנותרו, לפי ההנחה שאושרה של 3,300 ₪ לטון. זו חריגה צפויה של 150,000 ₪ מהתקציב. מקורות: חשבונית הברזל, תקציב הפרויקט ואישור הנחת המחיר.

**Visible result and state changes.** Store the conversation and scope. Answering a question does not mutate a ledger or approve a proposal. A suggested follow-up action may navigate to the relevant review screen.

**Branches and validation.** Unsupported input gets a useful Hebrew fallback with supported examples. An ambiguous project reference prompts a project choice. If the selected report predates a correction, answer from that snapshot and offer **הצג נתונים עדכניים**. Do not provide fabricated site progress, prices, or missing documents.

**Acceptance.** Editing a relevant input changes the answer, source links open, old report answers remain stable, and questions work through text entry. Restart clears scenario dialogue without deleting other fixtures' source definitions.

### S08 — התחייבויות חושפות חריגה לפני הגעת החשבוניות

**Purpose.** Show why looking only at booked invoices misses a cost problem.

**Starting fixture and evidence.** Baseline H30: budget ₪1,000,000, incurred ₪200,000, remaining commitment ₪800,000. Introduce signed ADD-H-FRAME-100 for additional work of ₪100,000, not yet invoiced.

**Trigger and interaction.**

1. Click **קלוט תוספת להסכם**.
2. Open the signed addendum and the current contract.
3. Show the proposed contract total and recalculated net commitment.
4. Review and apply **עדכן התחייבות**.
5. Inspect the project forecast and unchanged invoice/payment amounts.

**Hebrew explanation.**

> עד כה נצברו 200,000 ₪ בלבד, אבל לאחר התוספת החתומה נותרו התחייבויות של 900,000 ₪. העלות הידועה לפי ההסכמים היא כבר 1,100,000 ₪ — לפחות 100,000 ₪ מעל תקציב הסעיף, עוד לפני חשבוניות נוספות.

**Visible result and calculations.** Contract total becomes ₪1,100,000; C=1,100,000−200,000=₪900,000. H30 EAC=₪1,100,000. HAD EAC becomes ₪6,206,000. Incurred costs and cash paid do not change.

**Branches and validation.** An **טיוטה שטרם נחתמה** alternative creates a conditional commitment risk and leaves accepted C at ₪800,000. A signed addendum is applied once; subsequent invoices for its work transfer cost from C to A without adding the same contract amount again.

**Acceptance.** The alert is visible before a new invoice, the contract drilldown reconciles gross value with incurred and remaining portions, and the approved budget stays ₪1,000,000. Restart removes the scenario addendum.

### S09 — חשבון מצטבר שנקלט שוב במלואו

**Purpose.** Demonstrate reconciliation of a subcontractor's cumulative certificate and prevention of a duplicate period charge.

**Starting fixture and evidence.** This is an independent H30 fixture. Replace baseline TX-H-FRAME with a prior recognized and paid certificate of ₪220,000, supported by CERT-H-FRAME-PREV. The contract remains ₪1,000,000, with ₪780,000 remaining before the new certificate.

Introduce CERT-H-FRAME-CURRENT: cumulative approved ₪300,000, prior cumulative ₪220,000, current increment ₪80,000. Its raw ERP entry incorrectly treats the entire ₪300,000 as new period cost.

**Trigger and interaction.**

1. Open **חשבון קבלן חדש לבדיקה**.
2. Compare the previous certificate, current cumulative certificate, and ERP entry.
3. Show **מצטבר** versus **לתקופה** explicitly.
4. Review the proposed period amount ₪80,000 and approve the correction.

**Hebrew explanation.**

> בחשבון הנוכחי אושר מצטבר של 300,000 ₪, אך 220,000 ₪ כבר הוכרו בחשבון הקודם. התוספת לתקופה היא 80,000 ₪. קליטה של 300,000 ₪ נוספים תחזור על 220,000 ₪ שכבר נרשמו.

**Visible result and calculations.**

| State | H30 incurred | H30 remaining commitment | H30 EAC | Amount unpaid for the new period |
| --- | ---: | ---: | ---: | ---: |
| Before new certificate | 220,000 | 780,000 | 1,000,000 | 0 |
| Erroneous raw posting | 520,000 | 480,000 | 1,000,000 | 300,000 |
| Corrected posting | 300,000 | 700,000 | 1,000,000 | 80,000 |

The fixed contract total means EAC stays ₪1,000,000 throughout; HAD's EAC stays ₪6,106,000. The issue is duplicate recognized period cost and potential duplicate billing/payment, not a newly created ₪220,000 project-budget saving. No payment is actually made.

The original certificate continues to display its cumulative ₪300,000. The corrected ERP posting records only the incremental ₪80,000 and links to the prior certificate.

**Branches and validation.** If the user chooses **אין חשבון קודם מקושר**, first search the available prior certificate and ledger; propose the missing link if they match. Ask a person only in a separate branch that actually removes the historical evidence from the active fixture. Do not ask for a document already available in the app. A previously processed certificate number produces **החשבון כבר נקלט** rather than another transaction. A rejected proposal leaves the raw entry flagged.

**Acceptance.** Prior and current certificates are inspectable, incremental math is correct, the net commitment reconciles, and no double credit or phantom saving appears. Restart reconstructs this fixture rather than combining it with the baseline ₪200,000 certificate.

### S10 — חיסכון מדומה: עבודה בוצעה והחשבונית עוד לא הגיעה

**Purpose.** Show that missing invoices can make incurred costs look artificially low, and that recognizing work must not count an existing commitment twice.

**Starting fixture and evidence.** Baseline H50: B=₪400,000, A=₪100,000, C=₪250,000, R=₪50,000, EAC=₪400,000. Introduce CERT-H-WATER-080, approving ₪80,000 of completed work **within the existing ₪350,000 contract**, not an additional scope.

**Trigger and interaction.**

1. Click **קלוט אישור ביצוע ללא חשבונית**.
2. Show the approved certificate and its match to CT-H-WATER.
3. Propose recognition as **עבודה שבוצעה וטרם חויבה**.
4. The reviewer approves the accrual.
5. Optionally click **הדמה הגעת החשבונית** to receive INV-H-WATER-080.

**Hebrew explanation.**

> נרשמו עד כה חשבוניות בסך 100,000 ₪, אבל יש גם עבודה מאושרת בסך 80,000 ₪ שטרם חויבה. לכן העלות שנצברה היא 180,000 ₪. העבודה כבר נכללה בהתחייבות החוזית, ולכן תחזית העלות הכוללת אינה גדלה.

**Visible result and calculations.**

- Invoice component of A remains ₪100,000.
- Unbilled accrued component becomes ₪80,000.
- Total A becomes ₪180,000.
- C decreases from ₪250,000 to ₪170,000.
- R remains ₪50,000.
- EAC remains ₪400,000; HAD remains ₪6,106,000.
- Paid remains ₪80,000 for this cost code.

When the matching invoice arrives, replace the ₪80,000 accrual component with the ₪80,000 invoice component through a linked reversal/match. A stays ₪180,000 and C stays ₪170,000. Do not recognize another ₪80,000 of cost.

**Branches and validation.** If the certificate is not yet approved, show **נדרש אישור ביצוע** and leave the cost proposal pending. If it refers to genuinely additional scope, direct the user to a change-order flow like S13 rather than silently consuming the original contract balance.

**Acceptance.** The breakdown distinguishes invoices from unbilled work, the later invoice is matched without duplication, and “budget minus invoices” is never labeled realized savings. Restart removes the accrual and scenario invoice.

### S11 — חריגת כמות גם כשהמחיר ליחידה תקין

**Purpose.** Show that normal prices can hide excessive quantities.

**Starting fixture and evidence.** Use the alternative S11 world defined in Section 6.2. PLAN-SLAB-A plans 100 m³. The sole supplier invoice INV-H-SLAB-120 bills 120 m³ × ₪400 = ₪48,000, supported by DN-H-SLAB-120, while the ERP has mistakenly retained 100 m³/₪40,000. The baseline INV-H-CONC-001 is not an active source in this fixture. All other H20 components remain unchanged.

**Trigger and interaction.**

1. Click **קלוט אספקת בטון לתקרה A**.
2. Show planned quantity 100, documented delivery 120, and unchanged unit price 400.
3. Create two findings: a document-supported ERP amount/quantity correction and a question about why the supplied quantity exceeded plan. The supported monetary correction can be reviewed without waiting for the operational explanation.
4. Choose a reply, inspect the resulting cost proposal, then approve the appropriate treatment.

**Question and primary reply.**

> לתקרה A תוכננו 100 מ״ק וסופקו 120 מ״ק. האם הכמות הנוספת נדרשה לאותה יציקה, הוחזרה לספק, או שייכת לתכולה אחרת?

Primary reply:

> כל 120 המ״ק שימשו לאותה יציקה. אין החזרה ואין שינוי מאושר בתכולה.

**Visible result and calculations.** After review, correct the slab ERP posting from ₪40,000 to the existing invoice's ₪48,000, retaining its before/after audit. Additional recognized cost is 20 × 400 = ₪8,000. H20 A becomes ₪408,000; C remains ₪200,000; R remains ₪400,000; EAC becomes ₪1,008,000. HAD EAC becomes ₪6,114,000. The source invoice itself is unchanged, even if the cause of excess quantity is still under investigation.

The primary fixture assumes the extra quantity was consumed in the already planned slab and does not reduce the remaining planned concrete work. Show a local quantity variance of 20%, not an unsupported 20% extrapolation across the entire project.

**Branches and validation.**

- **20 מ״ק הוחזרו** → require a return/credit record before reducing recognized cost; hold the financial adjustment pending that evidence.
- **הכמות שייכת לתוספת תכנון** → open a change classification and budget/forecast review, retaining the original budget until approved.
- **עדיין בבדיקה** → maintain an open issue; do not claim waste.

**Acceptance.** Quantity and price effects are separate, the system asks for missing site facts, only one slab invoice contributes cost, and the known variance is not extrapolated without a basis. Restart restores S11's raw ERP entry of 100 m³/40,000 alongside its active source invoice of 120 m³/48,000.

### S12 — חיוב שאינו תואם את תנאי החוזה

**Purpose.** Show how reading the actual contract avoids an unnecessary management question and identifies a disputable charge.

**Starting fixture and evidence.** Baseline plus a posted extra freight charge INV-H-FREIGHT-002 of ₪2,000 in H20. Before resolution, H20 A=₪402,000, EAC=₪1,002,000; HAD EAC=₪6,108,000. The extra charge is unpaid. CT-H-CONC explicitly includes ordinary freight.

**Trigger and interaction.**

1. The extra freight posting automatically creates a finding; click **הצג בדיקת חיוב הובלה** to inspect it.
2. Show the invoice line next to the exact contract clause.
3. Mark the charge **חיוב לבירור מול הספק** and create a suggested credit request in the in-app task view.
4. Click **הדמה קבלת זיכוי** to introduce CREDIT-H-FREIGHT-002.
5. Review the linked credit and apply it to the simulated ERP.

**Hebrew explanation.**

> חויבו 2,000 ₪ בנפרד עבור הובלה. לפי סעיף ההובלה בחוזה, הובלה רגילה לאתר כלולה במחיר. לא נמצאה תוספת מאושרת לחיוב הזה. מוצע לברר את החיוב ולבקש זיכוי.

**Visible result and calculations.** Merely detecting the issue does not delete the invoice or its payable. After receipt and approval of the matching credit, post a linked −₪2,000 cost adjustment. H20 A returns to ₪400,000; HAD EAC returns to ₪6,106,000. Original invoice and credit are both inspectable.

Show **זיכוי שאושר: 2,000 ₪**, not “cash received” or an executed supplier payment.

**Branches and validation.** The alternative **קיימת תוספת מאושרת לאספקה מיוחדת** introduces ADD-H-FREIGHT-VALID, checks that its scope matches this delivery, then allows the reviewer to close the flag while retaining the ₪2,000 cost. If the supplier has not answered, leave the credit opportunity pending and EAC at ₪6,108,000.

**Acceptance.** The contract actually supports the finding, supplier evidence controls the correction, and disputed amounts are not removed prematurely. Restart restores the posted extra charge without a credit.

### S13 — הוראת שינוי שלא נכנסה לתחזית

**Purpose.** Show an approved cost addition being incorporated before the report, while separating customer recovery from construction cost.

**Starting fixture and evidence.** Baseline H50 EAC ₪400,000. Introduce CO-H-WATER-080: an additional waterproofing scope agreed by the company and its subcontractor at ₪80,000, not yet performed, with a separate end-customer recovery request of ₪80,000 still pending.

**Trigger and interaction.**

1. Click **קלוט הוראת שינוי**.
2. Show the original contract scope, the added scope, its approval, and the pending customer claim.
3. Present a proposal to add a cost commitment and update EAC.
4. Review and apply.

**Hebrew explanation.**

> אושרה תוספת עבודה בעלות 80,000 ₪ שטרם נכללה בתחזית. צריך להוסיף אותה לעלות הצפויה. דרישת ההחזר מהלקוח עדיין ממתינה לאישור, ולכן מוצגת בנפרד ואינה מקטינה את תחזית העלות.

**Visible result and calculations.** Add an additional commitment of ₪80,000; H50 C rises from ₪250,000 to ₪330,000. A remains ₪100,000 and R ₪50,000. H50 EAC becomes ₪480,000; HAD EAC becomes ₪6,186,000. B stays ₪400,000. A separate revenue/recovery record shows ₪80,000 **ממתין לאישור**.

**Branches and validation.** If the end customer later approves recovery, update that recovery status independently. Cost EAC remains ₪480,000. If the company has approved the scope internally but has not committed to a supplier, a reviewed estimate belongs in R: C=250,000 and R=130,000 give the same 480,000 EAC. If the work itself is only proposed and unapproved, keep it conditional. Prevent the same change order from appearing in both C and R.

**Acceptance.** The forecast changes before invoicing, cost and revenue stay separate, and approval of a recovery cannot conceal the cost overrun. Restart removes the change and claim.

### S14 — עיכוב בלוח הזמנים מגדיל את עלויות האתר

**Purpose.** Demonstrate the cost impact of a longer construction period, beyond invoice-level checks.

**Starting fixture and evidence.** Baseline H70: 12 months × ₪50,000 = ₪600,000. Six months incurred ₪300,000, C=₪100,000, R=₪200,000. PLAN-H-SITE contains the monthly cost breakdown. Introduce a possible two-month delay.

**Trigger and interaction.**

1. Click **עדכן משך פרויקט** and enter 14 months.
2. Ask whether the change extends the entire site's operating period and which monthly costs continue.
3. Choose the primary confirmation, creating SCHEDULE-H-14.
4. Review the itemized forecast impact and approve it.

**Question and primary reply.**

> האם העיכוב מאריך את פעילות האתר בשני חודשים מלאים, והאם צוות האתר, השכירות, האבטחה והשירותים יידרשו לכל התקופה הנוספת?

> כן. האתר יפעל עד 30/04/2027, וכל העלויות האלה יימשכו בשני החודשים הנוספים.

**Visible result and calculations.** Monthly cost is 20,000 + 15,000 + 10,000 + 5,000 = ₪50,000. Two additional months add ₪100,000 to R. H70 R becomes ₪300,000 and EAC ₪700,000. HAD EAC becomes ₪6,206,000. The accepted completion date moves from 28/02/2027 to 30/04/2027. No new invoice or payment is invented.

Retain the original planned finish as baseline; store the accepted forecast finish separately. For custom whole-month durations/components, generate a distinct proposal and exact Hebrew confirmation from the chosen values. SCHEDULE-H-14 is evidence only for the primary 14-month, all-components case; it cannot support a custom 13-month scenario. Compute end dates by calendar months from the start, not by adding a fixed number of days.

**Branches and validation.** If only an intermediate milestone slips, retain the overall site duration and do not automatically add two months of overhead. Allow selecting which cost components extend; recompute from the selected components and duration. If the extension remains uncertain, display a conditional range, not an accepted date/cost.

**Acceptance.** The date, duration, included components, and forecast agree, while the original budget stays unchanged. Restart restores the 12-month plan.

### S15 — שימוש בידע שאושר כדי לצמצם בירורים חוזרים

**Purpose.** Show a credible mechanism for reducing repeated questions over time.

**Starting fixture and evidence.** Start from S05's completed 40,000/20,000 allocation, including the approved client instruction to use that split for matching monthly charges under EQ-FRAMEWORK-01. HAD H40 A=₪220,000 and R=₪180,000; PAR P40 A=₪140,000 and R=₪160,000.

Create RULE-EQ-01 with:

- Company DEMO only.
- Supplier and exact framework EQ-FRAMEWORK-01.
- Projects HAD/H40 and PAR/P40 only.
- Monthly charge for the same stated equipment/service.
- Ratio 2/3 HAD, 1/3 PAR.
- Validity through 31/12/2026.
- Source: the explicit approved reply from OPS and provider review.
- A condition requiring review if the contract, project set, scope, or operational arrangement changes.

Introduce INV-EQ-002 dated 30/09 and received on the scenario clock of 01/10, for the next billing month's ₪60,000. It is unpaid and fulfills the already planned September work items H-EQ-SEP/P-EQ-SEP.

**Trigger and interaction.**

1. Click **קלוט חשבונית החודש הבא**.
2. Show matching against the approved rule and its original evidence.
3. Present the proposed 40,000/20,000 split without generating a new client question.
4. The provider reviews and applies it.
5. Inspect the original decision and this first reuse in the rule's history. Label them separately; creating a rule from an earlier decision is not itself a previous automated application.

**Hebrew explanation.**

> נמצאה הנחיה מאושרת לאותה מסגרת ולאותם אתרים: שני שלישים למגורי הדרים ושליש למתחם הפארק. החשבונית החדשה תואמת לתנאי הכלל. מוצע להשתמש בחלוקה המאושרת, ללא בירור נוסף עם מאיה.

**Visible result and calculations.**

- HAD H40: A rises 220,000 → 260,000; R falls 180,000 → 140,000.
- PAR P40: A rises 140,000 → 160,000; R falls 160,000 → 140,000.
- C and paid amounts stay unchanged.
- HAD EAC remains ₪6,086,000; PAR EAC remains ₪4,018,000.

The R reductions matter: this invoice consumes already forecast future work. It is not an unplanned extra ₪60,000.

Show an event-based result such as **בחשבונית זו נעשה שימוש בהנחיה קודמת; לא נשלחה שאלה נוספת**. Do not show invented “90% automation” or measured productivity gains.

**Branches and validation.** Buttons **מסגרת אחרת**, **אתר נוסף**, and **כלל שפג תוקפו** must prevent automatic reuse and create a new review/question. The expired-rule branch uses a rule ending before the invoice service period. A custom actual allocation must total ₪60,000, while the fulfilled forecast items remain HAD 40,000/PAR 20,000. For an actual 30,000/30,000 split, HAD EAC becomes ₪6,076,000 and PAR ₪4,028,000; company EAC is unchanged. Changed assumptions for later months require their own forecast decision.

**Acceptance.** Reuse is scoped, explained, inspectable, and reversible through a new rule version. It cannot leak a rule to another company or an unrelated contract. Restart restores the state before the new month's invoice.

### S16 — הזדמנות רכש מתוך השוואה בין פרויקטים

**Purpose.** Show useful cross-project intelligence without presenting an old purchase price as a guaranteed available offer.

**Starting fixture and evidence.** Start from S06's approved ₪3,300 future steel price: HAD steel A=₪66,000, R=₪1,584,000, EAC=₪1,650,000; HAD EAC=₪6,250,000. PAR bought the same demo grade at ₪2,900, supported by INV-P-STEEL-001.

**Trigger and interaction.**

1. Click **השווה רכישות בפרויקטים**.
2. Compare specification, date, quantity, delivery, site location, and payment terms.
3. Display the older PAR price as a reason to seek a fresh quote.
4. Click **הדמה קבלת הצעה חדשה** to introduce QUOTE-H-STEEL-3100.
5. Review the new quote and click **עדכן את התחזית לפי ההצעה**.

**Hebrew opportunity text.**

> במתחם הפארק נרכש ברזל מאותו מפרט ב-2,900 ₪ לטון. זו רכישה קודמת, ולכן המחיר והזמינות ליתרת הדרים דורשים בדיקה. מול הנחת התחזית של 3,300 ₪, פער של 400 ₪ על 480 טון משקף הזדמנות אפשרית של 192,000 ₪.

**Visible result and calculations.**

- Historical indicative opportunity: (3,300 − 2,900) × 480 = ₪192,000.
- Merely finding that price does not change accepted EAC.
- New valid quote: ₪3,100 × 480 = ₪1,488,000 future cost.
- Revised steel EAC: 66,000 + 1,488,000 = ₪1,554,000.
- Revised HAD EAC: ₪6,154,000.
- Forecast improvement versus the ₪3,300 state: ₪96,000.
- Steel still exceeds its original budget by ₪54,000.

The quote remains a forecast basis, not a signed purchase order: keep this amount in R until a real commitment is explicitly modeled. Show **שיפור בתחזית**, not an executed purchase or cash savings.

**Branches and validation.** A quote excluding freight must add the known freight component before comparison or be marked incomparable if unknown. An expired or mismatched quote cannot become an accepted basis without renewed evidence. Later expiration marks a previously accepted estimate as needing revalidation; it does not retroactively erase its history or silently revert the forecast. **לא נמצאה הצעה מתאימה** leaves the original forecast unchanged.

**Acceptance.** Users can inspect why the two purchases are comparable, see uncertainty, and observe a reviewed forecast improvement that retains the remaining overrun. Restart restores the high-price starting fixture.

## 9. Deterministic intelligence and conversation implementation

### 9.1 Program the behavior, not just the animation

The application should feel responsive because it actually evaluates its synthetic data. It does not need a language model to create that impression.

Use:

- Rule-based document comparisons.
- Explicit scenario event handlers.
- Deterministic supported-intent matching.
- Parameterized Hebrew response templates.
- Domain selectors that calculate values from current state or the selected snapshot.
- A short simulated analysis delay, about 200–700 ms, with an option to skip motion.

Do not stream an invented reasoning monologue. Show useful actions such as **נמצאה חשבונית תואמת**, **נבדק סעיף ההובלה בחוזה**, and **נדרש מידע שאינו מופיע במסמכים**.

### 9.2 Minimum rule registry

| Rule | Inputs | Deterministic condition and result |
| --- | --- | --- |
| Budget assumption comparison | Draft line, eligible quotes | Filter by matching demo specification/terms and validity. If draft is below all comparable quotes, show range and gap. |
| Cost-code match | Invoice material, budget code definitions, linked order | Matching steel sources plus a finishing code creates a classification proposal. Ambiguous material creates a question. |
| Quantity reconciliation | ERP row, source invoice, delivery note | Compare quantity, unit, price, and total; propose supported field changes, distinguish purchased from delivered. |
| Allocation completeness | Invoice, framework projects, allocations | Missing documented site split creates a consolidated question. Valid replies must allocate exactly the original amount. |
| Future unit-price risk | Plan, verified purchased quantity, current/future price | Calculate actual and remaining exposure separately; unresolved future price creates conditional risk. |
| Commitment overrun | Contract/addenda, incurred linked cost, budget | Recompute net commitment; flag A + C above budget before new invoices. |
| Cumulative certificate | Current/prior cumulative values, processed IDs | Increment equals current cumulative minus prior recognized cumulative; detect duplicate processing. |
| Unbilled approved work | Certificate, contract, matching invoice | Move value from remaining commitment to accrued cost; replace accrual when matched invoice arrives. |
| Quantity variance | Planned task quantity, delivered amount, site reply | Explain variance; require operational context before interpreting additional consumption. |
| Contract charge | Charge type, clause, matching approved addendum | Flag a separate included charge unless a valid matching exception exists; credit requires a credit source. |
| Scope change | Approved change, existing scope/forecast | Add the cost once, track recovery separately. |
| Duration impact | Overall finish, extending monthly components | Months × continuing costs updates a forecast proposal. Milestone-only changes do not imply site extension. |
| Approved memory | Tenant, contract, project set, scope, validity | Reuse only a fully matching active rule; record the application and source. |
| Cross-project comparison | Comparable purchases, quote, remaining quantity | Historical price creates opportunity; a valid new quote can support a reviewed forecast revision. |

Do not pretend these deterministic checks are a production model's measured capabilities. No confidence percentage is necessary. Qualitative status such as **נתמך במסמכים** or **נדרש בירור** is more useful.

### 9.3 Chat intent handling

Normalize whitespace, Hebrew punctuation, common spelling variants, commas in numbers, and project aliases. Support at least:

- הדרים / מגורי הדרים → HAD.
- הפארק / מתחם הפארק → PAR.
- ברזל / ברזלים → steel cost code in the selected project.
- קבלן השלד / שלד → H30 when HAD is selected.
- הוצאנו / עלות שנצברה / הוצאות → incurred-cost intent, with the answer clarifying its meaning.
- שילמנו / שולם / תשלום בפועל → payment intent.
- תחזית / בסוף / לסיום → EAC intent.
- חריגה / חרגנו / מעל התקציב → variance intent.
- התחייבויות / הזמנות פתוחות / התחייבנו → net-remaining-commitment intent.
- מאז הדוח / מה השתנה → snapshot-difference intent.
- נשאר לשלם → remaining cash-payment intent.
- למה תיקנת / על סמך מה / מקור → evidence/explanation intent.

Resolve more specific intents first: **נשאר לשלם** must not accidentally match only **שילמנו**. If the project is explicit, use it; otherwise use the selected project. “כל החברה” changes scope to active portfolio, subject to the coverage rules in Section 5.5. Do not include NOF's draft in active-company totals. If the user requests an unavailable period breakdown or progress measure, explain the missing data instead of answering an all-time question they did not ask.

For missing context, ask one short choice:

> לאיזה פרויקט התכוונת?

For unsupported input:

> בדמו אפשר לשאול על הוצאות, תשלומים, התחייבויות, תחזית לסיום, חריגות ושינויים מאז הדוח. למשל: ״כמה צפוי לעלות הברזל בהדרים?״

For unavailable operational information:

> אין במסמכים שבדמו אישור לכמות העבודה שנותרה בשטח. אפשר לפתוח בירור מול מנהלת התפעול.

Opening that clarification should create an in-app draft question, not a real message.

### 9.4 Adapter boundary for optional future AI

Keep business calculations and write authorization in the application domain layer. A later AI implementation can propose analyses or interpret text; it must not become the sole owner of ledger math.

~~~typescript
interface IntelligenceAdapter {
  analyzeRecord(
    recordId: string,
    context: Readonly<AnalysisContext>
  ): Promise<AnalysisResult>;

  answerQuestion(
    text: string,
    scope: QueryScope,
    context: Readonly<QueryContext>
  ): Promise<AnswerWithEvidence>;

  interpretClarification(
    questionId: string,
    reply: string,
    context: Readonly<ClarificationContext>
  ): Promise<ParsedReplyOrFollowup>;
}
~~~

Implement only a deterministic adapter now. Return structured proposed actions, required evidence, and response text. Domain commands validate and apply approved actions. Do not add an API-key field or “connect live AI” screen to the customer experience.

## 10. Interaction and data contracts

### 10.1 Important domain commands

Use a small set of explicit commands rather than scattered component-level mutations:

~~~text
loadScenario(scenarioId)
restartScenario()
resetDemo()
setActiveProject(projectId)
receiveScenarioEvent(eventId)
saveErpRecord(recordId, input, expectedVersion)
analyzeRecord(recordId)
reviewAndReleaseAlert(alertId, reviewerId)
draftClientQuestion(findingIds, contactId)
simulateSendQuestion(questionId)
recordClientReply(questionId, reply)
approveProposal(proposalId, reviewerId)
rejectProposal(proposalId, reason)
applyApprovedProposal(proposalId)
acceptForecast(forecastProposalId, reviewerId)
saveApprovedRule(ruleDraft)
generateReport(projectId, preferences)
approveReport(reportId, reviewerId)
simulateDeliverReport(reportId, channel, recipientId)
advanceDemoClock(days)
askQuestion(text, scope)
~~~

You may combine approval and application in one visible button when the underlying sequence is explicit and auditable. If a proposal's target changed since its analysis, recalculate it and request review of the updated proposal instead of applying stale values.

### 10.2 Editable steel purchase in free exploration

Provide a required **נסה נתונים אחרים** panel in S04/S06 or the free workspace; editing purchase inputs is part of free exploration:

| Field | Default | Validation |
| --- | ---: | --- |
| Planned quantity | 500 tons | Fixed for the simple purchase experiment |
| Purchased quantity | 20 tons | Greater than 0 and no greater than 500 |
| Purchase unit price | 3,300 | Positive number |
| Future assumed unit price | 3,000 initially | Positive number; editable candidate |
| Raw ERP quantity | 200 in S04, otherwise matches purchase | Positive number; may differ to create reconciliation |

When editing the **synthetic purchase fixture**, create new labeled synthetic invoice/order/delivery versions together and replace the current demo purchase projection, rather than appending repeated purchases accidentally. Preserve prior versions referenced by reports or audits. Keep the budget fixed. These source-editing controls belong to the presenter experiment panel, not the ordinary invoice-review UI.

~~~text
purchase amount = purchased quantity × purchase unit price
remaining quantity = 500 − verified purchased quantity
accepted remaining forecast = remaining quantity × accepted future price
steel EAC = purchase amount + accepted remaining forecast
actual price variance = purchased quantity × (purchase unit price − 3,000)
conditional future variance = remaining quantity × (candidate future price − 3,000)
~~~

A raw ERP-only edit preserves the original synthetic sources and creates a reconciliation issue. Label the two actions differently: **שנה את נתוני הדוגמה** versus **ערוך את הרשומה בזיו**.

Candidate future-price edits update a what-if preview. They change accepted EAC only through **אשר עדכון תחזית**. Reports already generated remain unchanged.

These simple formulas apply to the fully uncommitted remainder. If the locked-order S06 branch is active, show its committed quantity separately and apply the candidate price only to the uncommitted remainder, or visibly restart the simple experiment before editing it. Never reprice an existing fixed-price commitment through this slider.

Use quantity precision up to three decimal places and money up to two; reject NaN/infinite values, negative amounts in ordinary invoice forms, unsupported units, or purchased quantity above the fixed plan in this bounded experiment. Credits use the dedicated credit action. Parse currency input explicitly and round monetary transaction totals once to the nearest agora; do not sum rounded display strings.

### 10.3 Questions and batching

The unresolved-question queue should support selecting multiple ready questions and creating one message to OPS. Each question has its own status and answer link. The primary S05 scenario contains one question, but the design should work when another scenario in free exploration creates an additional unresolved issue.

Before batching, show **מה כבר נבדק** with checked sources. This makes the reduction of management interruptions concrete without inventing a time-saving percentage.

A single-contact default is sufficient. Allow a visible contact override to BUYER for pricing questions, while keeping OPS as the initial coordinator.

### 10.4 Report schedule and export behavior

Use the simulated clock, not browser background scheduling. Each report's period and source revision must be explicit. Advancing a week can create a due draft report. Provider approval releases it for simulated delivery. Changing the channel affects subsequent deliveries.

Assign distinct report versions for deliberate regeneration, for example RPT-HAD-2026-09-07-v01 and v02. Display the date and version in the archive. The shorter report IDs elsewhere in this brief identify the logical reporting date; they are not permission to overwrite an existing snapshot.

Before delivery, distinguish:

- **Confirmed posted-data error affecting reported values:** block final delivery until its correction is applied, or produce only an internal draft. An approved but failed ERP write remains unresolved.
- **Uncertain operational assumption or potential future risk:** the provider may approve a report that explicitly includes that open assumption. Do not hide the issue or claim the assumption is confirmed.
- **Change since the report was generated:** keep the existing snapshot unchanged and show its data-through timestamp. Offer regeneration with current data; do not silently attach a new calculation to an already reviewed snapshot.

The baseline future steel-price question and unsupported equipment split are open assumptions, so S01 can demonstrate a report with open questions. A proven incorrect posting in S09/S11 cannot be presented as a clean completed report.

Define the layouts concretely: **סיכום להנהלה** emphasizes project totals, change since previous report, three largest accepted variances, and open assumptions; **פירוט לפי סעיפי תקציב** shows each cost code with B/A/C/R/EAC/variance and expandable sources. Allow hiding/showing paid and quantity columns. Only Excel is required as an export format; flexibility is demonstrated through layout, columns, and channel without claiming other exports work.

For idempotency, key scheduled drafts by project and scheduled period; key deliveries by report ID, channel, and recipient. A deliberate resend can have its own explicit action and delivery event, but repeated clicks must not masquerade as new reports.

Excel export can be minimal. Use a proper workbook writer available in the chosen stack, or a valid bundled .xlsx template whose name and metadata are set consistently. A .csv file renamed .xlsx is not acceptable. At minimum the attachment filename should include project and report date, for example:

~~~text
דוח_בקרה_מגורי_הדרים_2026-09-07.xlsx
~~~

The on-screen report must contain the actual scenario data even if the workbook itself is minimal. If the spreadsheet is only a demo template, label that clearly when opened; do not promise populated tabs that are absent.

### 10.5 Evidence and revisions

Evidence links need stable document and anchor IDs. Scenario-specific replies can use generated IDs such as MSG-S05-REPLY-001 with the reply timestamp and exact text.

Store enough information in a report to reconstruct its financial values and the evidence versions it used. A newer document version should not retroactively rewrite the explanation of an old report.

For aggregate opening balances, say that the historical detail is summarized in the demo. Do not fabricate unavailable underlying invoices to satisfy a drilldown.

## 11. Guided walkthrough

Provide a suggested 8–10 minute guided tour. This sequence is a presentation convenience; all sixteen scenarios remain equally accessible in the gallery and usable independently.

| Step | Approx. time | Presenter action | State handling and takeaway |
| --- | --- | --- | --- |
| 1 | 40 sec | Open company overview and HAD | Load baseline. Existing ERP, current accepted forecast, report archive, no system replacement. |
| 2 | 75 sec | Run S04, inspect sources, approve quantity correction | Load S04 fixture. Show 200 → 20 tons and unchanged invoice amount. |
| 3 | 110 sec | Run S06 on that verified purchase; open the early WhatsApp alert, then approve future price 3,300 | Continue the same state. Alert arrives before a new report. Show 6,000 actual premium and 144,000 future impact; HAD EAC 6,250,000. |
| 4 | 45 sec | Ask what changed since last report | Continue state. Answer +150,000 versus 31/08, with evidence. |
| 5 | 60 sec | Generate and deliver the weekly Excel report | Continue state. Report and message show 6,250,000, not baseline 6,106,000. |
| 6 | 75 sec | Run S05, answer the WhatsApp question, approve allocation, and explicitly save the reuse rule | Explicitly load S05 fixture. One consolidated question, two projects updated, company total unchanged. |
| 7 | 40 sec | Run S15 and open the approved rule | Continue completed S05 history, visibly move to the next billing period, and receive the invoice. First reuse needs no new client question. |
| 8 | 60 sec | Run S02 and revise the draft concrete price | Explicitly load NOF draft fixture. Show value before construction begins. |
| 9 | 20 sec | Open the scenario gallery and pilot preparation panel | Invite free exploration of the remaining scenarios and a pilot on the customer's own project. |

Guidance appears as dismissible Hebrew hints next to the relevant control. The user can stop the tour at any point and continue exploring. Do not automatically click approval buttons for the presenter.

Useful introductory Hebrew copy:

> הנה חברה עם כמה פרויקטים פעילים. נתחיל מתנועה שנקלטה בזיו, נראה איך היא נבדקת, איך מתקבל מידע שחסר, ואיך הכול מגיע לדוח ולתחזית.

Useful pilot invitation:

> רוצים לבדוק את זה על פרויקט שלכם?

The button opens a concise panel describing the proposed pilot inputs: a sample budget, ERP export, relevant contracts/invoices, a recent report, and one operational contact. Show proposed pilot measurements: correction quality, report preparation effort, questions sent to the client, internal review effort, and usefulness of early warnings. These are measurement goals, not claimed results. A **העתק רשימת הכנה** button is sufficient; no real signup, scheduling, or external submission is required.

## 12. Hebrew UI copy and interaction states

Use these labels consistently. Additional text should follow the same direct, professional tone.

| Concept | Hebrew text |
| --- | --- |
| Approved budget | תקציב מאושר |
| Incurred cost | עלות שנצברה |
| Invoice component | חשבוניות שנקלטו |
| Accrued unbilled work | עבודה שבוצעה וטרם חויבה |
| Net remaining commitments | התחייבויות שנותרו |
| Remaining uncommitted forecast | יתרת עבודה ללא התחייבות |
| Estimated total completion cost | תחזית עלות לסיום |
| Expected overrun | חריגה צפויה מהתקציב |
| Paid | שולם בפועל |
| Conditional risk | סיכון מותנה |
| Potential opportunity | הזדמנות לבדיקה |
| Sources | מקורות |
| What has already been checked | מה כבר נבדק |
| Proposed correction | הצעת תיקון |
| Awaiting internal review | ממתין לבדיקת צוות הבקרה |
| Awaiting client reply | ממתין לתשובת הלקוח |
| Approved, not yet applied | אושר וממתין לעדכון |
| Applied to mock ERP | עודכן בזיו — סביבת הדגמה |
| Automatic analysis | המידע נבדק עם כל עדכון |
| Provisional posted values | טרם הושלמה הבדיקה |
| Early alert | התרעה מוקדמת |
| Write failed | העדכון לא הושלם; הנתונים בזיו לא שונו |
| Retry | נסה שוב |
| Partial category coverage | קיים פירוט רק בחלק מהפרויקטים |
| Rejected | ההצעה נדחתה |
| Current analysis scope | נתונים עדכניים |
| Frozen report scope | לפי הדוח מתאריך |
| Newer data exists | קיימים עדכונים מאז הדוח |
| No open questions | אין שאלות פתוחות כרגע |
| No results | לא נמצאו תוצאות לסינון שבחרת |
| Invalid allocation | סכום החלוקה חייב להתאים לסכום החשבונית |
| Missing evidence | חסר מקור תומך; נדרש בירור |
| Simulated sending note | ההודעה מוצגת בתוך ההדגמה בלבד |
| Start scenario | התחל תרחיש |
| Restart scenario | התחל מחדש |
| Free exploration | מעבר לחקירה חופשית |
| Reset everything | אפס את נתוני ההדגמה |
| Before VAT | לפני מע״מ |

Make status understandable without relying on color alone. Buttons have hover, focus, disabled, busy, and completion states. Dialogs are keyboard navigable and close with Escape; focus returns to the triggering control. Wide tables can scroll on smaller screens without hiding important labels. Respect reduced-motion settings.

Avoid customer-visible phrases such as “fixture,” “reducer,” “mock API,” “LLM adapter,” “hardcoded response,” or “state revision.” The persistent demo label is enough to identify the environment. Developer documentation may use those terms.

## 13. Implementation guidance

### 13.1 Suggested stack

If starting a new project, a React + TypeScript frontend with Vite is a suitable default. If an existing application scaffold is provided, use its framework and conventions. Use compatible available dependencies and commit a lockfile. No particular package version is required by this brief.

Use a lightweight store or reducer, pure calculation functions, and data-driven scenario definitions. A local backend is unnecessary. Keep the application usable without external network calls after its assets have loaded.

An illustrative module split:

~~~text
src/app
src/components
src/features/overview
src/features/projects
src/features/review
src/features/documents
src/features/messages
src/features/reports
src/features/chat
src/features/scenarios
src/domain/calculations
src/domain/commands
src/domain/validation
src/data/seed
src/data/documents
src/data/scenarios
src/intelligence/deterministic
src/intelligence/types
src/persistence
src/locales/he
~~~

This is an organizational suggestion, not a required directory structure. The important boundary is between UI, state-changing commands, calculations, evidence, and the deterministic intelligence adapter.

### 13.2 Persistence and reset

Persist the demo state in localStorage or an equivalent local browser store. Include the seed version. On incompatible stored data, offer **טעינת נתוני ההדגמה החדשים** instead of rendering broken state. Reset must reliably restore all transactions, forecasts, messages, rules, reports, and scenario progression.

An optional export/import of the local demo session as JSON is useful for a presenter, but is lower priority than the sixteen working scenarios.

### 13.3 Suggested build sequence

1. Implement financial types, seed loading, source objects, selectors, and baseline assertions.
2. Build the Hebrew RTL shell, overview, project table, document viewer, and audit drawer.
3. Complete one end-to-end path: S04 → S06 → S07 → S01.
4. Implement client clarification and allocation using S05, then rule reuse using S15.
5. Implement the remaining scenarios using the same evidence/proposal/approval components.
6. Add isolated scenario loading, tour guidance, free-input controls, report schedule, and reset.
7. Verify calculations and representative end-to-end flows, then polish the visual interaction.

This sequence is not permission to stop after the first path. All sixteen scenarios belong in the completed demo.

### 13.4 Keep the implementation focused

Required: functioning local simulation, credible financial semantics, inspectable documents, dynamic calculations, Hebrew UI, dual exploration modes, report attachment delivery, and all scenarios.

Optional after those work: richer Excel formatting, additional charts, animated document matching, local session export, and more natural-language synonyms.

Future work: real ERP integration, real WhatsApp/email sending, production authentication, live AI, actual OCR, and arbitrary customer-file ingestion. Do not spend the demo build implementing these.

Avoid impressive-looking but misleading shortcuts:

- A scenario gallery whose buttons only open explanatory text.
- Static charts or chat answers that ignore user changes.
- Every issue triggering a client message even when a contract answers it.
- An invoice correction represented only by a toast while the ERP row stays unchanged.
- A forecast that changes the approved budget automatically.
- All opportunities added into a single invented “money saved” number.
- Source links that open empty drawers.
- A fake Excel download with the wrong file format.
- Historical reports changing when today's data changes.

## 14. Verification and acceptance

Use meaningful tests for the core calculations and state transitions. Do not settle for tests that only assert the presence of a button or repeat a hardcoded label.

### 14.1 Numeric fixture assertions

All amounts in this table are whole ILS unless decimals are shown. These are independent scenario outcomes, not a cumulative sequence.

| Check | Expected result |
| --- | --- |
| Baseline HAD | B 6,100,000; A 1,606,000; C 1,830,000; R 2,670,000; EAC 6,106,000 |
| Baseline active portfolio | B 15,100,000; A 4,184,000; C 4,950,000; R 5,970,000; EAC 15,104,000 |
| S02 draft at 390 | Concrete 390,000; NOF draft 5,090,000; active totals unchanged |
| S03 classification | H10 A 66,000; H60 A 300,000; HAD EAC unchanged 6,106,000 |
| S04 units | 20 × 3,300 = 66,000; no monetary change |
| S05 cost split | HAD EAC 6,086,000; PAR EAC 4,018,000; portfolio EAC unchanged 15,104,000 |
| S05 payment split | 13,333.33 + 6,666.67 = 20,000; portfolio paid unchanged 3,358,000 |
| S06 conditional risk | Actual premium 6,000; future premium 144,000; total conditional variance 150,000 |
| S06 accepted 3,300 | Steel R 1,584,000; steel EAC 1,650,000; HAD EAC 6,250,000 |
| S06 accepted 3,150 | Steel R 1,512,000; steel EAC 1,578,000; HAD EAC 6,178,000 |
| S06 200 tons locked at 3,000; other 280 at 3,300 | C 600,000; R 924,000; steel EAC 1,590,000; HAD EAC 6,190,000; extra future risk 84,000 |
| S07 remaining subcontract payment | 50,000 + 800,000 = 850,000 at baseline |
| S08 additional commitment | H30 C 900,000; EAC 1,100,000; HAD EAC 6,206,000 |
| S09 cumulative account | Period 80,000; total incurred 300,000; C 700,000; contract EAC unchanged 1,000,000 |
| S10 unbilled work | A 180,000; C 170,000; R 50,000; EAC unchanged 400,000 |
| S10 later invoice | Accrual replaced; A remains 180,000; no extra cost |
| S10 remaining cash | Original waterproofing contract 270,000; broader H50 scope 320,000 |
| S11 concrete quantity | Additional 8,000; H20 EAC 1,008,000; HAD EAC 6,114,000 |
| S12 freight before/after credit | HAD EAC 6,108,000 → 6,106,000 only after approved credit |
| S13 cost change | H50 C 330,000; EAC 480,000; HAD EAC 6,186,000 |
| S13 internally approved, not supplier-committed | H50 C 250,000; R 130,000; EAC 480,000 |
| S14 duration | Extra R 100,000; H70 EAC 700,000; HAD EAC 6,206,000 |
| S15 recurring equipment | H40 A 260,000/R 140,000; P40 A 160,000/R 140,000; both EACs unchanged |
| S15 custom actual 30,000/30,000 | HAD EAC 6,076,000; PAR EAC 4,028,000; portfolio EAC unchanged |
| S16 opportunity and new quote | Historical opportunity 192,000; accepted forecast improvement 96,000; HAD EAC 6,154,000 |
| Prior report comparison | 6,250,000 − 6,100,000 = 150,000, distinct from 144,000 versus baseline |
| Last delivered report after a new delivery, no later changes | Current-versus-last-report difference 0 |
| Company-wide steel query | 124,000 known-detail subtotal with explicit missing coverage; never presented as complete company total |

### 14.2 Behavioral checks

- Each scenario can be started from the gallery, completed, and restarted.
- Repeated analysis and duplicate approval clicks are idempotent.
- A rejected or unresolved proposal does not alter reviewed ERP data.
- The allocation parser accepts a valid custom split and rejects an incorrect total.
- Paid amounts remain separate from incurred costs and are conserved on reallocation.
- Accrued work and commitments are not double counted.
- A cumulative certificate's original total remains inspectable after its incremental posting is corrected.
- Conditional price risk does not change accepted EAC before review.
- A previously generated report remains frozen after a forecast change.
- The chat answer changes when the relevant current data changes.
- Report-scoped chat remains tied to its selected snapshot.
- An expired or mismatched approved rule is not reused.
- An expired or incomparable quote is not treated as a firm current offer.
- The simulated ERP row, budget table, audit trail, and report generation use the same applied state.
- Email and WhatsApp report delivery each work inside the app.
- The Excel attachment is a valid workbook.
- Scheduled report generation uses the simulated clock and does not duplicate the same period.
- Reset clears scenario effects and restores the canonical baseline.
- A saved/received record starts analysis automatically; merely opening a screen does not post it again.
- S06 delivers a reviewed early alert inside WhatsApp before any new report is generated.
- A failed ERP write leaves observed and projected values unchanged; retry applies once.
- Refresh or reset during an analysis cannot let a stale result mutate another scenario.
- Independent scenarios cannot see unreceived documents or replies from another branch.
- The free-exploration workspace is restored after exiting a separate scenario session.
- A missing link is resolved from existing documents before a client question is created.
- Fixed-price orders remove the corresponding quantity from price-risk exposure and uncommitted forecast.
- An already fulfilled purchase order contributes zero remaining commitment.
- Report-scoped chat cannot cite a source received after that report's cutoff.
- The actual cost of a fulfilled forecast item is compared with that item's forecast amount; price/allocation variances do not disappear through arbitrary R reductions.
- Company-wide category answers state incomplete coverage rather than treating unknown breakdowns as zero.

### 14.3 Visual and end-to-end review

Manually or with browser automation, review:

1. Desktop RTL overview and expanded budget table.
2. S04 source comparison and correction.
3. S06 a pending risk and then an accepted forecast.
4. S05 a valid reply and an invalid reply.
5. S01 report preview, simulated delivery, and attachment opening.
6. S07 current-data and historical-report questions.
7. A narrower/mobile WhatsApp view.
8. At least one independent scenario after another, to verify fixture isolation.
9. The primary S06 early alert arriving before a report, and the locked-price alternative reducing its exposure.
10. S03 failed write/retry, and S11's single immutable invoice versus corrected ERP entry.

Inspect Hebrew direction, mixed numeric text, clipping, modal focus, scrolling, and readable labels. Check the production build and absence of runtime errors. Broaden testing only to resolve a concrete remaining issue.

## 15. What to deliver

Deliver the implemented application with:

1. All sixteen working scenarios and both usage modes.
2. The complete synthetic dataset and source documents bundled with the app.
3. A Hebrew interface, including guidance and error states.
4. Clear local run/build instructions in a README.
5. A short guide to the primary walkthrough and how to reset the demo.
6. A concise explanation of where to change branding, data, Hebrew copy, scenarios, and the intelligence adapter.
7. A summary of verification performed and any actual limitations.

If the execution environment supports a preview, make the application runnable there. Do not require real credentials to demonstrate it. Do not claim external integrations, messages, payments, or AI calls were performed when they were simulated.

The completion standard is that a construction-company manager can explore the product, understand what was checked, answer a real-looking question, see a supported correction in the existing ERP view, inspect a forward-looking cost implication, and receive the resulting report — all using coherent synthetic data.
