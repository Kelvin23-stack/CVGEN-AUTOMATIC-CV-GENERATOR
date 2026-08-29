# CVGEN — Supabase Setup Guide

CVGEN now uses [Supabase](https://supabase.com) for real accounts (email/password
+ optional "Sign in with Google") and a real cloud database for CVs — replacing
the old `localStorage`-only demo. Everything else (the UI, CV builder, live
preview, templates, PDF download, print) is unchanged.

Follow these steps once, then redeploy.

---

## 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → sign in (free tier is enough) → **New project**.
2. Pick any name/region, set a database password (you won't need it day-to-day), and wait ~2 minutes for it to provision.

## 2. Run the database schema

1. In your new project, open **SQL Editor** (left sidebar) → **New query**.
2. Open `supabase-schema.sql` from this project folder, copy its entire contents, paste into the editor, and click **Run**.
3. This creates 9 tables — `profiles`, `cvs`, and one table each for `experiences`, `education`, `skills`, `certifications`, `languages`, `references`, and `projects` — all with Row Level Security enabled, so each user can only ever see or edit their own data.

## 3. Connect the app to your project

This is the only step that requires editing a file — everything else in the app already expects it.

1. In Supabase: **Project Settings → API Keys**.
2. Copy the **Project URL** and the **publishable key** (older projects may label it "anon" / "public" key instead — same thing).
   - Do **not** copy your database password or the **secret** / `service_role` key — those must never go in this file, or anywhere in front-end code.
3. Open **`supabase-config.js`** in this project folder and paste them in, replacing the two placeholder strings:

   ```js
   const SUPABASE_URL = 'https://your-project-ref.supabase.co';
   const SUPABASE_PUBLISHABLE_KEY = 'your-publishable-key';
   ```

   That's the entire file — nothing else in it needs to change, and no other file needs editing for this step.

4. That's it for email/password sign-up and login — they'll work immediately once this is deployed.

## 4. Set your site URL (required for email links & OAuth redirects)

1. In Supabase: **Authentication → URL Configuration**.
2. Set **Site URL** to your deployed site, e.g. `https://cvautogen.netlify.app`.
3. Under **Redirect URLs**, add the same URL (and `http://localhost:...` too if you test locally with a local server).

This is what makes confirmation-email links and Google's redirect-back land in the right place.

## 5. Email confirmation

By default, Supabase requires new users to click a confirmation link before they can log in — real emails, sent automatically, no setup needed.

- **To keep it on** (recommended): after registering, the person sees "Check your inbox to confirm your email," and the confirmation email arrives from Supabase's built-in mailer.
- **To turn it off** (instant sign-up, useful while testing): **Authentication → Providers → Email → toggle off "Confirm email."**
- For a real production app later, you'd add your own SMTP provider under **Authentication → Emails → SMTP Settings** so mail comes from your own domain instead of Supabase's shared sender — not required to get this working.

## 6. (Optional) Enable "Sign in with Google"

The Google button is already wired up in the app — you just need to turn the provider on:

1. **In Google Cloud Console** ([console.cloud.google.com](https://console.cloud.google.com)):
   - Create a project (or use an existing one) → **APIs & Services → Credentials**.
   - **Create Credentials → OAuth client ID** → Application type: **Web application**.
   - Under **Authorized redirect URIs**, add the callback URL Supabase gives you (next step shows you exactly where to find it — it looks like `https://your-project-ref.supabase.co/auth/v1/callback`).
   - Save, then copy the generated **Client ID** and **Client Secret**.
2. **In Supabase**: **Authentication → Providers → Google** → toggle it on, paste in the Client ID and Client Secret, and copy the callback URL shown there into the Google Cloud step above if you haven't already.
3. Save. The "Continue with Google" button on the login/register pages will now work — no code changes needed.

If you skip this step, email/password accounts still work fine; the Google button will just show an error toast if clicked.

## 7. Deploy

- `supabase-config.js` only contains your **publishable key**, which is designed to be exposed in client-side code — Supabase's Row Level Security policies (already set up by the schema script) are what actually keep data private, not secrecy of this key. It's safe to commit and deploy as-is. Your database password and secret/`service_role` key are never used by this app and should never be added to any file here.
- Push everything (including the updated `supabase-config.js`) to your repo and redeploy on Netlify like before.

## 8. Test the full flow

1. Register a new account → confirm via email (or skip if you disabled confirmation) → log in.
2. Create a CV, fill in a few fields, **Save** → refresh the page → your data should still be there (now coming from the cloud, not `localStorage`).
3. Open the same account in a different browser (or incognito) → log in → your CVs should show up there too. This is the real test that it's no longer local-only.
4. Try **Download PDF**, **Print**, and switching templates — all unchanged.
5. If you enabled Google: try "Continue with Google" from the login page.

---

### What changed under the hood

| Before (demo) | Now (Supabase) |
|---|---|
| Accounts stored in `localStorage`, plain-text passwords | Real accounts via Supabase Auth, passwords hashed & never touch your code |
| "Session" = a flag in `localStorage` | Real signed session tokens, managed by Supabase |
| CVs stored per-browser in `localStorage` | CVs stored in a Postgres table, synced across devices |
| No real emails | Real confirmation emails sent automatically |
| No Google sign-in | Optional, one toggle away |

Settings (dark mode / animations) intentionally **stayed** in `localStorage` — they're just local UI preferences, not account data, so there was no reason to move them.
