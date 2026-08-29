/* =========================================================
   CVGEN — Supabase configuration
   =========================================================
   This is the ONLY file you need to edit to connect CVGEN to
   your own Supabase project. Paste in the two values below —
   nothing else in this project needs to change.

   Where to find them:
   Supabase Dashboard → your project → Project Settings → API Keys

     SUPABASE_URL             → "Project URL"
     SUPABASE_PUBLISHABLE_KEY → "publishable" key (older projects may
                                 label this "anon" / "public" key —
                                 it's the same thing)

   Do NOT put your database password or your "secret" / service_role
   key here, or anywhere else in this project. Only the publishable
   key belongs in front-end code — it's designed to be public, and
   the Row Level Security policies in supabase-schema.sql are what
   actually keep each user's data private.

   See SUPABASE_SETUP.md for the full setup guide.
   ========================================================= */

const SUPABASE_URL = 'https://huqznuymwcitwzlkcgpe.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_PdPHTTMlzsveg6-Z3trovQ_MTNLVghM';

if (SUPABASE_URL.startsWith('PASTE_') || SUPABASE_PUBLISHABLE_KEY.startsWith('PASTE_')) {
  console.warn(
    'CVGEN: Supabase is not configured yet. Open supabase-config.js and paste in ' +
    'your Project URL and publishable key — see SUPABASE_SETUP.md for the full guide.'
  );
}

// Single shared client instance used by every page (script.js reads this).
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
