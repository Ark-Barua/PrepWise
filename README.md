> This project is actively under development.
> Latest stable snapshot: v1.11.0

# PrepWise

PrepWise is a React + Vite study dashboard app with routed pages, a shared layout shell, and authentication gating.

## Stack

- React 19
- Vite 7
- React Router DOM 7
- Tailwind CSS 4
- Express 4
- SQLite 3
- Stripe (subscription billing)

## Run Locally

```bash
npm install
```

Terminal 1 (backend API):

```bash
npm run dev:server
```

Terminal 2 (frontend):

```bash
npm run dev
```

## Scripts

- `npm run dev` - Start development server
- `npm run dev:client` - Start Vite frontend server
- `npm run dev:server` - Start backend server with watch mode
- `npm run server` - Start backend server
- `npm run build` - Build production bundle
- `npm run preview` - Preview production build locally
- `npm run lint` - Run ESLint checks

## Backend API (Scaffold)

Base URL (local): `http://localhost:4000`

- `GET /api/health` - API/database health check
- `GET /api/users` - List users
- `GET /api/users/:userId` - Get one user
- `POST /api/users` - Create or update a user (supports profile avatar via `avatarUrl`)
- `DELETE /api/users/:userId` - Permanently delete a user account and all dependent data (cascade)
- `POST /api/auth/signup` - Create user account with hashed password
- `POST /api/auth/signin` - Authenticate existing user
- `GET /api/questions?category=<name>&difficulty=<easy|medium|hard>&search=<term>` - List/filter questions
- `POST /api/questions/generate` - Generate and persist new practice questions on demand (template-first, optional LLM-backed)
- `POST /api/resume-assistant/chat` - Resume copilot analysis/chat for ATS fit, keyword gaps, and rewrite suggestions
- `GET /api/questions/:questionId` - Get question detail
- `POST /api/practice-sessions` - Build a sequential practice session from filters
- `GET /api/practice-sessions/:sessionId?userId=<id>` - Get ordered session items + progress state
- `POST /api/practice-sessions/:sessionId/attempts` - Submit next in-sequence answer for a session
- `GET /api/practice-sessions/:sessionId/report?userId=<id>` - Get final report (score + weaknesses + category summary)
- `POST /api/attempts` - Submit an answer attempt and receive rule-based feedback
- `GET /api/attempts?userId=<id>&questionId=<id>&limit=<n>` - List persisted attempts
- `GET /api/attempts/summary/:userId` - Aggregated attempt metrics (includes streak, category performance, score trend, activity-by-day)
- `GET /api/billing/plans` - List available plans and limits
- `GET /api/billing/summary/:userId` - Get current plan, usage, remaining quotas, and billing status
- `POST /api/billing/checkout` - Create Stripe checkout session for paid plan upgrade
- `POST /api/billing/portal` - Create Stripe billing portal session
- `POST /api/billing/webhook` - Stripe webhook receiver for subscription status sync
- `GET /api/sessions?userId=<id>&status=<planned|completed|skipped>` - List sessions
- `POST /api/sessions` - Create a study session
- `PATCH /api/sessions/:sessionId` - Update a study session
- `DELETE /api/sessions/:sessionId` - Delete a study session
- `GET /api/summary/:userId` - User study summary

`vite.config.js` proxies `/api/*` to the backend in development.

## Billing Environment Variables

Set these in `.env` to activate Stripe billing:
- `APP_BASE_URL` (example: `http://localhost:5173`)
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_PRO_MONTHLY`

Optional question generation settings:
- `QUESTION_GEN_PROVIDER` (`template`, `auto`, `huggingface`)
- `QUESTION_GEN_API_KEY` (required for external LLM generation)
- `QUESTION_GEN_MODEL` (Hugging Face model id)
- `QUESTION_GEN_ENDPOINT` (defaults to Hugging Face inference endpoint)
Note: `huggingface` can run on Hugging Face Inference API (free tier with token/rate limits).

## Version History

### v1.11.0 - 2026-02-24

Innovative navbar redesign:
- Rebuilt the primary navbar as a "Command Rail" with icon chips, dual-line labels, and active-state glow for stronger visual identity.
- Added contextual nav subtitles (`Command`, `Drills`, `Metrics`, `Studio`) and refined active/hover interactions.
- Implemented a non-scrolling responsive layout that adapts from 4-column desktop to 2-column mobile while keeping all routes visible.
- Extended dark mode styling for the new command-rail components.

### v1.10.0 - 2026-02-24

Navigation + Resume AI dock redesign:
- Rebuilt primary navbar into a non-scrolling fixed-grid tab layout so all sections remain visible without horizontal scrolling.
- Updated nav label density (`Mock AI`) and tab alignment for cleaner readability across desktop and mobile breakpoints.
- Replaced the floating Resume AI overlay with an inline `Resume AI Studio` dock in Overview so it never blocks underlying page buttons.
- Redesigned Resume AI interaction into a two-column studio (`Context Setup`, `Quick Prompts`, `Live Chat`) with responsive collapse to a single column on small screens.
- Improved dock visual hierarchy, spacing, and dark-mode parity for a more premium structured experience.

### v1.9.0 - 2026-02-24

UI spacing and floater structure stabilization:
- Fixed global icon-to-text spacing for action buttons and links by enforcing consistent flex gaps and icon sizing.
- Improved nav chip readability/alignment with cleaner icon spacing and stable vertical centering.
- Reworked Resume AI launcher visual style to remove the uneven dark patch and improve button hierarchy.
- Re-structured Resume Copilot panel using collapsible blocks (`Context Setup`, `Quick Prompts`) plus a dedicated `Live Chat` section for better information flow.
- Improved floater chat wrapping/overflow behavior and mobile launcher sizing for cleaner responsive presentation.
- Preserved dark mode support in Settings and extended floater block styling consistency in dark theme.

### v1.8.0 - 2026-02-24

Format and spacing refinement pass:
- Replaced the shell brand icon with the actual app asset logo from `src/assets/logo.png`.
- Normalized icon/text spacing across primary UI primitives (buttons, links, menu items, metric labels, and icon-led text rows) for consistent alignment.
- Re-structured Resume Copilot floater sections with clearer hierarchy (`Context`, `Quick prompts`, `Chat`) and improved spacing.
- Improved Resume Copilot message container formatting to prevent awkward overflow and maintain readable wrapping on all viewports.
- Kept dark mode available in `Settings` and ensured styling consistency for the updated floater/formatting blocks in dark theme.

### v1.7.0 - 2026-02-24

UI system upgrade (bio visibility, dark mode, loader, navbar/floater polish):
- Added bio display in two places: a dedicated `Bio Display` card on Profile and a formatted bio preview in the account dropdown.
- Refined account dropdown formatting with cleaner identity alignment (avatar + name + email + bio).
- Added a unique shared React loader (`NebulaLoader`) and integrated it into page loading states across dashboard, practice, profile, progress, billing, settings, and session/question screens.
- Added dark mode support with persistence (`settings.interface.darkMode`) and global body class sync.
- Extended Settings with a new dark mode toggle in the interface controls.
- Removed visible horizontal scrollbar from the navbar while preserving horizontal navigation behavior.
- Reworked Resume AI floater sizing/positioning for mobile responsiveness and improved visual treatment.

### v1.6.0 - 2026-02-24

Profile page restructuring + responsive hardening:
- Removed `Weekly Goal Tracker` and `Strength Map` blocks from the Profile page.
- Re-aligned Profile workspace layout with a cleaner, primary profile editor and dedicated policy/security side cards.
- Added in-page policy documents: Terms and Conditions, Privacy and Data Usage, Security Practices, and Data Retention/Deletion.
- Added account security checklist content directly in Profile for quick user reference.
- Improved global responsiveness with tighter small-screen rules and layout safeguards for mobile devices.

### v1.5.0 - 2026-02-24

Overview expansion (space utilization + actionable intelligence):
- Expanded Overview with additional high-utility cards so unused space is now filled with guidance.
- Added `Recovery Queue` (lowest-performing categories) with quick focus visibility.
- Added `Goal Projection Engine` with run-rate, projected weekly attempts, weekly gap, and average attempt duration.
- Added `Quality Signals` with consistency index, momentum delta, and dominant feedback themes.
- Added `3-Step Execution Lane` that generates concrete next actions from current progress signals.

### v1.4.0 - 2026-02-24

Settings account deletion:
- Added account deletion option in `Settings` with a danger-zone confirmation flow.
- Added email-typed confirmation gate before destructive account deletion.
- Added backend endpoint `DELETE /api/users/:userId` for permanent account deletion.
- Added database-level delete path leveraging existing foreign-key cascade to remove dependent records.
- On successful deletion, user session is signed out and redirected to login.

### v1.3.0 - 2026-02-24

Profile picture support:
- Added profile picture upload/preview/remove on the `Profile` page.
- Added client-side avatar normalization (image crop/resize) before save.
- Persisted avatar URL in SQLite user records (`users.avatar_url`) with automatic migration for existing databases.
- Extended auth/user payloads to include `avatarUrl` so avatar remains available after sign-in and refresh.
- Updated account menu trigger to render the uploaded profile photo (fallback to initials when missing).

### v1.2.0 - 2026-02-24

Progress analytics expansion:
- Rebuilt `Progress` with an expanded intelligence layer so the page is no longer sparse.
- Added momentum + consistency analytics based on recent score movement and volatility.
- Added difficulty mastery panel with pace-quality indicators per difficulty level.
- Added weakness radar to highlight low-performing categories and gap-to-best metrics.
- Added 14-day activity heatmap for continuity visibility and habit tracking.
- Added milestone tracker and a smart next-session blueprint (focus category, recommended difficulty, question count, target time).

### v1.1.0 - 2026-02-24

Overview productivity + resume copilot:
- Enriched `Overview` with a readiness compass, weekly mission tracker, and stronger action-oriented cards so the page is not sparse.
- Added contextual progress helpers (readiness score, weekly attempt target, weakest-category visibility) for faster decision making.
- Added a floating `Resume AI` chatbot on Overview with role/JD/resume context fields and quick prompts.
- Added backend endpoint `POST /api/resume-assistant/chat` with ATS-style match estimation, keyword-gap detection, summary draft support, and bullet rewrite suggestions.
- Added client fallback logic so resume copilot still responds even if the new backend endpoint is temporarily unavailable.

### v1.0.0 - 2026-02-24

Navigation + settings expansion + unlimited question generation:
- Reworked header into a dual-lane professional nav with dedicated `Profile` and `Settings` destinations.
- Added new `Profile` page for account identity and prep performance snapshot.
- Added new `Settings` page with integrated billing controls (upgrade + portal) directly inside settings.
- Added on-demand question generation endpoint and Practice UI controls to generate fresh questions continuously.
- Added template-based question generator with optional Hugging Face LLM enhancement when API credentials are configured.
- Added auto-generation fallback during session creation so filtered sessions can still be created even with sparse pools.

### v0.9.0 - 2026-02-24

Plan limits, quotas, and billing:
- Added plan tiers (`free`, `pro`) with enforced monthly quotas for attempts and practice sessions.
- Enforced per-session question-count limits based on active plan.
- Added billing summary API for quota usage, remaining capacity, and plan metadata.
- Integrated Stripe checkout, customer portal, and webhook handling for subscription lifecycle updates.
- Added a new `/billing` page with upgrade cards, quota meters, and billing management actions.

### v0.8.0 - 2026-02-24

Session workflow and final reporting:
- Added session builder on Practice page to generate filtered, shuffled question sequences.
- Added sequential session runner with per-question timer and real-time progress indication.
- Added ordered-attempt enforcement in backend for session submissions.
- Added final session report with overall score, strengths/weaknesses, and category performance.
- Added session report UI with animated dashboard cards and breakdown sections.

### v0.7.0 - 2026-02-23

UI/UX overhaul for main dashboard pages:
- Redesigned `Overview`, `Practice`, and `Progress` with premium hero sections and richer visual hierarchy.
- Added animated metric cards, interactive question cards, and motion-enhanced chart bars.
- Introduced category/difficulty visual treatments and elevated filter panels.
- Added staggered reveal animations, hover transitions, and reduced-motion fallback support.

### v0.6.0 - 2026-02-23

Unified auth experience + SQLite account activation:
- Added backend auth endpoints for signup/signin (`/api/auth/signup`, `/api/auth/signin`).
- Added password hashing and verification in SQLite-backed user records.
- Added automatic users-table migration for `password_hash` column.
- Rebuilt login into a single, animated signup/signin experience with mode toggle.
- Added password reveal and strength meter interactions in auth UI.

### v0.5.0 - 2026-02-23

Dashboard analytics enhancements:
- Redesigned overview dashboard with metric cards and chart panels.
- Added chart-ready summary data (`scoreTrend`, `activityByDay`) from backend.
- Implemented category-wise performance summary with attempts, average score, and best score.
- Added streak tracking (`currentDays`, `longestDays`, `status`, `lastActiveDate`).
- Updated progress view to surface streak health and category performance bars.

### v0.4.0 - 2026-02-23

Practice workflow implementation:
- Added question bank listing with filters (`category`, `difficulty`, `search`).
- Added timed answer screen per question with live timer and pacing indicator.
- Added answer submission flow with persisted attempts in SQLite.
- Added rule-based feedback scoring (keyword coverage, depth, and pacing).
- Added progress analytics backed by saved attempt history and summary endpoints.

### v0.3.0 - 2026-02-23

SQLite backend scaffold:
- Added Express server under `server/`.
- Added SQLite initialization and schema (`users`, `study_sessions`).
- Added basic REST endpoints for health, users, sessions, and summary.
- Added Vite dev proxy for `/api` to `http://localhost:4000`.
- Added backend scripts and environment template (`.env.example`).

### v0.2.0 - 2026-02-23

Authentication integration:
- Added `AuthProvider` and centralized auth state.
- Added session persistence with `localStorage`.
- Added guarded routing using `ProtectedRoute` and `PublicOnlyRoute`.
- Added `/login` page and redirect flow after sign-in.
- Added authenticated header controls (signed-in user + sign-out).

### v0.1.0 - 2026-02-23

Routing and layout shell:
- Added `BrowserRouter` integration in `main.jsx`.
- Replaced starter app UI with route-based pages.
- Added shared `AppShell` with header/nav/main/footer.
- Added routes for `/`, `/practice`, `/progress`, and `*` (not found).
- Added base responsive shell styling in `index.css`.

### v0.0.0 - 2026-02-17

Initial project scaffold:
- Created project using React + Vite starter template.
- Included ESLint and Tailwind CSS setup.
