# CVGEN — AI Features Setup Guide (Google Gemini via Supabase Edge Function)

This wires up 6 real AI features — Professional Summary, Career Objective, Experience Writer,
Skills Suggestions, Cover Letter, and Improve Text — using Google's Gemini API, kept entirely
server-side through a Supabase Edge Function. **Your Gemini key never reaches the browser.**

```
CVGEN frontend  →  Supabase Edge Function (/functions/v1/ai)  →  Gemini API
      ↑                                                                │
      └────────────────────────  AI result  ←──────────────────────────┘
```

The Edge Function verifies you're signed in, checks you're on the Pro plan, validates the
request, calls Gemini, and returns a clean `{ result, suggestions }` response — all before
your API key is ever touched.

---

## 1. Enable Gemini API access

1. Go to [Google AI Studio](https://aistudio.google.com) → sign in with any Google account.
2. Click **Get API key** → **Create API key** (pick or create a Google Cloud project when prompted — no billing needs to be attached for the free tier).
3. Copy the key. **Do not paste it into this chat or into any file that gets committed as plain text in a public repo** — it only ever goes into one place (step 4 below).

This app uses `gemini-3.6-flash` — Google's current generally-available, free-tier-eligible Flash model (no credit card required to start). Free-tier rate limits are per-project and can change, so check your exact live limits anytime at [aistudio.google.com/rate-limit](https://aistudio.google.com/rate-limit) rather than relying on a fixed number here — but they're generous enough for testing and early usage.

## 2. Add the token as a Supabase secret (not a file, not the frontend)

Secrets for Edge Functions are set via the Supabase CLI, never typed into any file in your repo:

```bash
supabase login
supabase link --project-ref your-project-ref     # find this in your Supabase project URL
supabase secrets set GEMINI_API_KEY=paste-your-key-here-directly-in-terminal
```

That last command sends the key straight to Supabase's servers — it's never written to disk in your project, never committed to Git, and never appears in frontend code. You can confirm it's set (without revealing the value) with:

```bash
supabase secrets list
```

**Note:** `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are automatically available inside every Edge Function — you do not need to set those yourself.

## 3. Required token permissions

None beyond what Google AI Studio already grants the key by default — Gemini API keys are scoped to the Gemini API only, no extra permission configuration needed. (This is different from GitHub's fine-grained PAT model — Gemini keys are simpler.)

## 4. Deploy the Edge Function

From your project root (where the `supabase/` folder now lives):

```bash
supabase functions deploy ai
```

This uploads `supabase/functions/ai/index.ts` to your project and makes it live at:

```
https://your-project-ref.supabase.co/functions/v1/ai
```

The frontend already calls exactly this URL (`script.js` builds it from your existing `SUPABASE_URL`) — no frontend config changes needed.

## 5. Test locally (optional but recommended first)

```bash
supabase functions serve ai --env-file supabase/.env.local
```

Create `supabase/.env.local` (already git-ignored by the Supabase CLI's default `.gitignore` — double check it's listed there) with:

```
GEMINI_API_KEY=your-key-here
```

Then, with your CVGEN site pointed at `http://localhost:54321/functions/v1/ai` temporarily (or by testing with `curl` directly), verify a request works:

```bash
curl -i --location --request POST 'http://localhost:54321/functions/v1/ai' \
  --header 'Authorization: Bearer YOUR_SUPABASE_ACCESS_TOKEN' \
  --header 'Content-Type: application/json' \
  --data '{"feature":"professional-summary","input":{"title":"Product Designer","experienceSummary":"3 years at a startup designing mobile apps","skills":"Figma, UX research"}}'
```

(Get a real access token by logging into your deployed site, opening DevTools console, and running `(await supabaseClient.auth.getSession()).data.session.access_token`.)

## 6. Test in production

1. Redeploy your frontend (push `script.js`, the new HTML files, and `style.css` — same as every other update).
2. Log in as a **Pro** user (Table Editor → `profiles` → set `plan` to `pro` for your test account — same dev-only method as before).
3. Open **Create CV**, add a job title and some experience, click **Generate Summary**.
4. You should see a loading state ("Generating...") then a suggestion box with **Use This / Regenerate / Dismiss**.
5. Try the other buttons: **Generate Objective**, **Improve My Text** (on the summary), **Improve with AI** on an experience entry, **Suggest Skills**, and **Cover Letter** (top toolbar).
6. Log in as a **Free** user and confirm every AI button shows the upgrade modal instead of running.

## 7. Troubleshooting

| Symptom | Likely cause |
|---|---|
| "AI service is not configured yet" | `GEMINI_API_KEY` secret isn't set — redo step 2, then redeploy the function. |
| "Not authenticated" | You're testing without a valid session / access token, or it expired — log in again. |
| "This feature requires CVGEN Pro" even though you set `plan = 'pro'` | Double-check you edited the right row in `profiles` (matches your logged-in user's `id`), and that you're testing in the same browser session you set it in (or log out/in to refresh). |
| "AI service is busy right now" (429) | You've hit Gemini's free-tier rate limit for your project — check your current limits at [aistudio.google.com/rate-limit](https://aistudio.google.com/rate-limit), then wait a bit. If this happens often during testing, space out your test clicks. |
| "AI service is temporarily unavailable" (502) | Gemini itself returned an error or was unreachable — check the Edge Function's logs (`supabase functions logs ai`) for the real underlying error. |
| Nothing happens, no error | Check the browser console — likely a CORS or network issue; confirm the function actually deployed (`supabase functions list`). |

---

## What was created / modified

**New:**
- `supabase/functions/ai/index.ts` — the Edge Function (all 6 AI features, all security checks)
- `GEMINI_SETUP.md` — this guide

**Modified:**
- `script.js` — added `callAI()`, `runAIAction()`, and the wiring for every AI button
- `cv-builder.html` — added AI buttons/result boxes to Summary, each Experience entry, and Skills; added the Cover Letter modal
- `style.css` — styling for AI buttons, result previews, and the cover letter modal

**Untouched:** authentication, CV data model/persistence, PDF export, print, all 11 CV templates, the Pro pricing/gating architecture, AI Builder's Coming Soon page.

## Important behavior notes

- **Career Objective** writes into the same Summary field as Professional Summary — the CV data model only has one `summary` field (matching how most real CVs use one or the other, not both), so this is a style toggle rather than a separate section.
- **Cover Letter** is generated and shown for you to copy — it is **not saved to the database**, since there's no cover-letter field in your schema and adding one wasn't necessary for this to work.
- **"Improve with AI"** is wired up for the Summary and each Experience description — the same pattern (`runAIAction` + a small result box) can be copied to Education/Certification descriptions later if you want it there too; I scoped it to the two most-used fields for now.
- Every AI action requires an explicit "Use This" click — nothing is ever auto-applied over existing text.
