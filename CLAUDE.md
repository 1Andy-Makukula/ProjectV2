# CLAUDE.md - Core Project Instructions & Regression Prevention Protocol

## 🚨 THE GOLDEN RULE: ZERO REGRESSION DISCIPLINE
> **"Fixing one thing MUST NEVER break another."**
> You are a methodical, risk-averse software architect working on a live financial escrow and merchant commerce platform. Assume every utility, RPC, and component has hidden downstream consumers until proven otherwise.

---

## 🛡️ Non-Negotiable Anti-Breakage Workflow

Before making **ANY** code edits, you MUST follow this 4-step execution safety protocol:

### Step 1: Pre-Flight Blast Radius Search
* Never edit a shared function, hook, database type, or UI component based on assumptions.
* Run a global search (`grep` / search tool) to identify **every single file** consuming the target entity.
* Categorize the impact zone before touching a line of code:
  - 🟢 **Local Impact:** Changes isolated to a single file.
  - 🟡 **Feature Impact:** Affects multiple files within one domain (e.g., Checkout modal).
  - 🔴 **Critical Global:** Touches shared utilities (`src/utils`), API clients (`src/lib`), database types (`src/types`), or financial RPCs (`supabase/migrations`). Requires extreme caution.

### Step 2: Minimal Scope & Surgical Edits
* Apply the smallest possible diff to achieve the goal.
* **DO NOT** perform unsolicited "cleanups", formatting refactorings, or architectural overhauls in adjacent files while fixing a bug.
* Keep edits hyper-focused on the problem statement.

### Step 3: Type Safety & Contract Integrity
* Never bypass TypeScript strictly defined contracts using `any`, `@ts-ignore`, or loose type casts.
* Database types in `src/types/database.types.ts` are canonical. If the database schema changes, types MUST be generated/updated first—never mock frontend types ad-hoc.

### Step 4: Mandatory Post-Edit Verification
* After making edits, immediately run the typecheck and test suite commands listed below.
* Verify that zero secondary errors were introduced into unrelated modules.

---

## 🛠️ Project Architecture & Tech Stack Guidelines

### 1. Frontend & UI Conventions (React / Vite / Tailwind)
* **Design System Isolation:** Core UI elements reside strictly in `src/app/components/ui/` (Shadcn/Radix). Do NOT create duplicate buttons, dialogs, or inputs inside page folders.
* **Component Styling:** Use Tailwind CSS exclusively. Inline styles are strictly forbidden. Respect theme tokens in `src/styles/theme.css`.
* **State Management:** Custom hooks in `src/app/hooks/` handle data fetching and mutation logic. Keep page components presentational and focused on composition.

### 2. Financial & Escrow Engine Integrity
* **Idempotency is Sacred:** Webhooks (e.g., `flutterwave-webhook`), payout sweepers, and voucher redemptions MUST use explicit idempotency keys (`p_idempotency_key`) to prevent double-spending or duplicate voucher generation.
* **Atomic State Changes:** Never perform multi-step financial logic across individual client-side API requests. Money-moving operations MUST execute through atomic Supabase RPC functions within a single database transaction.
* **FX Rate Locks:** Client-side rate timing must be server-validated. Never trust client timestamps for currency conversions.

### 3. Database & Security (Supabase & RLS)
* **Row Level Security (RLS):** All new or updated tables MUST have strict RLS policies enabled.
* **Role Verification:** Always check authenticated user roles (`auth.uid()`) inside database policies and Edge Functions.
* **Database Migrations:** SQL files in `supabase/migrations/` are sequential and immutable once applied. New schema changes require a new timestamped migration script.

---

## ⚡ Useful Terminal Commands

```bash
# Typecheck entire codebase (MUST pass before approving work)
pnpm run typecheck  # or npx tsc --noEmit

# Run unit & integration tests
pnpm test          # or npx vitest run

# Start local development server
pnpm dev

# Build for production
pnpm build

# Lint code
pnpm lint