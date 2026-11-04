# Budget Tracker: Claude Code instructions

Personal, mobile-first budget tracker. Next.js (App Router) + Supabase, English + Arabic (RTL), USD + LBP + SYP, open sign-up with email verification, self-hosted.

## Read first

| File | What it decides |
| --- | --- |
| `PRODUCT.md` | Users, scope, principles, what is out of v1 |
| `docs/MOBILE-UX.md` | Layout, navigation, Add flow, responsive rules, **definition of done** |
| `docs/ARCHITECTURE.md` | Stack, folders, data model, auth, money, i18n, tests |
| `docs/PLAN.md` | Phases and acceptance criteria; update checkboxes as work lands |
| `DESIGN.md` | Visual tokens and components (written at the end of Phase 1; tokens live in `src/app/globals.css`) |
| `.impeccable/surfaces/src-app-locale.md` | Direction contract for the chosen "Encaustic tile" world |
| `docs/REFERENCE-NOTES.md` | What we borrow/avoid from the friend's reference app |

## Commands

```bash
pnpm dev            # Next.js dev server
pnpm build          # production build (standalone)
pnpm lint
pnpm typecheck
pnpm test           # Vitest unit tests
pnpm test:e2e       # Playwright (mobile-small, iphone, android, desktop × en/ar)
pnpm db:start       # supabase start (local stack, Docker)
pnpm db:reset       # re-apply migrations + seed
pnpm db:types       # supabase gen types → src/lib/supabase/database.types.ts
pnpm owner:create   # create a confirmed account without email (needs SUPABASE_SECRET_KEY)
```

(Scripts are added in Phase 0; keep this list in sync with `package.json`.)

## Non-negotiable rules

**Mobile first**
- Design and build at 390px first; base Tailwind classes = phone, `sm/md/lg` add.
- Every UI change meets `docs/MOBILE-UX.md` §14 before it is called done, including screenshots at 390px in EN and AR.
- `min-h-dvh` not `h-screen`; fixed bars respect `env(safe-area-inset-*)`; touch targets ≥ 44px; inputs ≥ 16px font.
- Modals are bottom sheets on phones (shared responsive Drawer/Dialog component).

**RTL / i18n**
- Logical utilities only (`ms-`, `pe-`, `start-`, `text-start`). Physical ones (`ml-`, `pr-`, `left-`, `text-left`) are lint errors.
- Every user-visible string goes in both `messages/en.json` and `messages/ar.json` in the same change.
- Names and amounts are wrapped in `<bdi>`; amounts never mirror.

**Money**
- Integer minor units only (USD cents, LBP whole lira, SYP whole pounds). Parse/format only through `src/lib/money.ts`; currency metadata lives in `src/lib/currency.ts`.
- Never add or compare different currencies. The legacy reference-rate helper supports only USD/LBP. SYP moves use actual sent/received amounts; cashier cross-currency change keeps its own confirmed direct-rate snapshot.
- Descriptive expense items do not create ledger movements. Cashier reports use purchase cost; wallet balances use tender/change. Loan principal is separate from fee income/spending. Preserve the canonical transaction revision, stable draft ID and exact-revision Undo contracts when extending mutations.

**Data & security**
- Schema changes only through `supabase/migrations/`, with SQL tests.
- RLS on every table (`user_id = (select auth.uid())`). App code uses the publishable key + user session; the secret key is for scripts only and never imported under `src/`.
- Reads in Server Components; writes in Server Actions validated with zod.
- Open sign-up with email verification: an account works only after its confirmation link is opened (`/auth/confirm`). RLS on `user_id` isolates accounts; `supabase/tests/isolation.test.sql` pins it. There is no owner allowlist.

**UI process**
- Use the `impeccable` skill before any UI work (global rule). New screens get a mockup/screenshot for the owner before full build.
- Skeletons for loading (no "Loading…" text); optimistic updates with no layout jump; respect `prefers-reduced-motion`.

**Hosting**
- Keep the app platform-neutral: `output: "standalone"`, optional `basePath`, Docker image. Don't add host-specific APIs.

## Conventions

- Feature code in `src/features/<feature>/{actions,queries,schema}.ts` + `components/`.
- shadcn primitives live in `src/components/ui/` and are restyled to `DESIGN.md` tokens; don't fork per feature.
- Seed data is synthetic; never put real financial data in the repo, tests, or screenshots.
