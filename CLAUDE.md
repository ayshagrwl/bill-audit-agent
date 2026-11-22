# BillAudit Pro — notes for Claude

## Storage: Firebase (Cloud Firestore)
- Firebase project: **`billaudit-pro-bfd2d3`** ("BillAudit Pro"), web app `1:871115037185:web:5dba586793304464863e00`.
- Web config lives in `firebase-config.js` (public by design; access is controlled by `firestore.rules`).
  Set the config to `null` there to fall back to the Apps Script tracking sheet.
- The app signs in **anonymously** (`BILLAUDIT_AUTH_MODE = 'anonymous'`). A shared email/password
  login is prepared for later (see the comment at the top of `firestore.rules`).
- All Firestore access goes through the `Cloud` object in `app.js` (Firebase compat SDK 10.14.1 from gstatic,
  offline persistence on).

### Collections
| Collection | What | Written by |
|---|---|---|
| `custody/{normalized bill no}` | current state of each bill (same fields as the old Live_Custody sheet) | dispatch / return / settlement |
| `scanOut/{queueId_bill}` | one row per bill per Scan OUT | Morning Dispatch |
| `scanIn/{queueId_bill}` | one row per Scan IN | Evening Return |
| `billAudits/{auditId}` | one saved Outstanding Bill Audit: agent, beat, summary, rows (FOUND / MISSING / EXTRA) | Bill Audit tab |

### Changing rules
- Edit `firestore.rules`, validate, then deploy **rules only**: `firebase deploy --only firestore:rules`.
- Never deploy anything to the live project without the user's OK.

## Tabs and keyboard shortcuts
1 Dashboard · 2 Morning Dispatch · 3 Evening Return · 4 Difference Audit · 5 Master Ledger ·
6 Settings · 7 Weekly Insights · 8 / B Bill Review · 9 Bill Audit

## Bill Audit tab
- Expected list = Master Sheet outstanding (unpaid) bills for the chosen agent & beat.
- Scan with the 2D gun or type the invoice number (same shorthand as dispatch: `7-1005`, `3-6757`).
- It only records what is physically present; it never changes custody / dispatch / settlement data.
- In-progress audits and not-yet-uploaded audits are kept in localStorage
  (`billAudit_auditSessions`, `billAudit_firebasePendingAudits`) and retried when online.

## Branches
- `main` does **not** yet include the Firebase backend. It lives on `firebase-backend` → merged into
  `insights-tab` → merged into `claude/admiring-euler-a7x3wn` (which adds the Bill Audit tab).

## Tests
`npm test` (scan lookup, insights, cloud suites).
