/* =========================================================
   CVGEN — EmailJS configuration
   =========================================================
   Powers the confirmation email sent when someone clicks
   "Notify Me" on the AI Builder page. EmailJS sends real email
   straight from the browser — no backend server required,
   consistent with how the rest of this site is built.

   Paste in your own three values below. Find them in your
   EmailJS dashboard (dashboard.emailjs.com):

     EMAILJS_PUBLIC_KEY  → Account → General → "Public Key"
     EMAILJS_SERVICE_ID  → Email Services → your service's ID
     EMAILJS_TEMPLATE_ID → Email Templates → your template's ID

   The public key is designed to be used in front-end code (same
   idea as Supabase's publishable key) — safe to commit and deploy.

   See EMAILJS_SETUP.md for the full setup guide, including the
   exact template variables this app sends.
   ========================================================= */

const EMAILJS_PUBLIC_KEY = 'HeCcTadiEyuN49LTM';
const EMAILJS_SERVICE_ID = 'service_r345emn';
const EMAILJS_TEMPLATE_ID = 'template_6dn0wwk';

if (window.emailjs && !EMAILJS_PUBLIC_KEY.startsWith('PASTE_')) {
  emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY });
} else {
  console.warn(
    'CVGEN: EmailJS is not configured yet. "Notify Me" will still save the ' +
    'opt-in to Supabase, but no confirmation email will send until you fill ' +
    'in emailjs-config.js — see EMAILJS_SETUP.md.'
  );
}
