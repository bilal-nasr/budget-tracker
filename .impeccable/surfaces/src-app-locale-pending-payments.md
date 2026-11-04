---
version: 1
slug: "src-app-locale-pending-payments"
primary_target: "src/app/[locale]/(app)/pending-payments"
related_targets: ["src/components/pending-payments"]
---

# Surface brief: pending payments

Mode: Operate. The owner tracks freelance income owed by clients, often received in parts. Inherit the existing Encaustic Floor system; ordinary extension, no new visual identity or assets.

## Direction contract

THESIS: Distinguish money owed from money available. List client jobs with received and remaining amounts; actual receipts are normal income.

OWN-WORLD: Incumbent teal shell, limestone ground, flat bordered white rows, Readex Pro, tabular isolated amounts, existing button and bottom-sheet primitives. English and Arabic, logical layout, light and inherited dark tokens.

STORY: Enter from Wallets, check outstanding money separately per currency, add a job or record the next partial receipt; review history on demand.

FIRST VIEWPORT: Compact title in the shared shell, return link, balance explanation, currency totals, Add pending payment, then outstanding jobs. Each row shows project/client, total/received/remaining, Record receipt and Edit. Completed work is disclosed below.

FORM: Extend incumbent Operate lists and shared sheets, inherited seed d85b1cf1. Native labeled controls; numbers edit LTR. Signature interaction previews the remaining amount before receipt confirmation. Use only shared sheet motion and reduced-motion behavior.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
