# CVGEN — EmailJS Setup Guide (AI Builder "Notify Me" email)

When someone clicks **Notify Me** on the AI Builder page, CVGEN now does two things:
1. Saves their opt-in to Supabase (`profiles.ai_notify_opt_in`) — already working, no setup needed.
2. Sends them a real confirmation email — this is the part this guide sets up.

Email is sent via [EmailJS](https://www.emailjs.com), which sends real email straight from
the browser with no backend server required — consistent with how the rest of this
site (Supabase, PDF export, etc.) is built entirely client-side.

Follow these steps once, then redeploy.

---

## 1. Create an EmailJS account

Go to [emailjs.com](https://www.emailjs.com) → sign up (free tier: 200 emails/month, plenty for a waitlist).

## 2. Connect an email service

1. In the EmailJS dashboard: **Email Services** → **Add New Service**.
2. Pick a provider — easiest is **Gmail** (connect your own Gmail account) or use EmailJS's built-in test service to start.
3. Once connected, note its **Service ID** (shown in the service list, looks like `service_abc1234`).

## 3. Create an email template

1. **Email Templates** → **Create New Template**.
2. Set the **To Email** field to `{{to_email}}` — this is how EmailJS knows who to send it to.
3. Write the subject and body. This app sends two variables you can use anywhere in the template:
   - `{{to_name}}` — the person's name
   - `{{to_email}}` — their email address

   Example template:

   ```
   Subject: You're on the CVGEN AI Builder waitlist! 🎉

   Hi {{to_name}},

   Thanks for your interest in AI CV Builder! You're officially on the
   waitlist — we'll email you the moment it's ready.

   In the meantime, keep building great CVs with CVGEN.

   — The CVGEN Team
   ```

4. Save, and note the template's **Template ID** (looks like `template_xyz789`).

## 4. Get your Public Key

**Account → General** → copy your **Public Key**. This is safe to use in front-end code — it's designed for that, the same way Supabase's publishable key is.

## 5. Connect the app to your EmailJS account

Open **`emailjs-config.js`** in this project and paste in your three values:

```js
const EMAILJS_PUBLIC_KEY = 'your-public-key';
const EMAILJS_SERVICE_ID = 'service_abc1234';
const EMAILJS_TEMPLATE_ID = 'template_xyz789';
```

That's the entire file — nothing else needs editing.

## 6. Deploy

Push `emailjs-config.js` (and the two other changed files — see below) to your repo like normal; Netlify will redeploy automatically.

## 7. Test it

1. Log in, go to **AI Builder**, click **Notify Me**.
2. Check the inbox of the account you're logged in with — the confirmation email should arrive within a few seconds.
3. If it doesn't arrive: open the browser console — any EmailJS error will be logged there (common causes: template's "To Email" field not set to `{{to_email}}`, or a typo in one of the three IDs).

---

### What changed

| File | Change |
|---|---|
| `emailjs-config.js` | **New.** Your EmailJS credentials go here. |
| `ai-builder.html` | Added the EmailJS SDK + config script tags. |
| `script.js` | `notifyMeAI()` now sends a confirmation email after saving the opt-in. |

### Important behavior notes

- **The Supabase opt-in is still the source of truth.** If EmailJS isn't configured yet, or the send fails for any reason, the person still sees "You're on the list!" and their opt-in is still saved — a missing/broken email never blocks that confirmation. Check the browser console for a warning if EmailJS isn't set up yet.
- **This only sends one email, on click** — it's not a mailing list or campaign tool. When AI Builder actually ships, you'll still need to separately email everyone who opted in (e.g. by exporting the `profiles` table where `ai_notify_opt_in = true` and using EmailJS, Resend, or your provider of choice for that batch send).
