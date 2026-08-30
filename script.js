/* =========================================================
   CVGEN — script.js
   Application logic — Supabase-backed auth & CV persistence,
   vanilla JS everywhere else (UI, templates, PDF, cropper).
   ========================================================= */

/* ---------------------------------------------------------
   0. STORAGE KEYS & HELPERS
   --------------------------------------------------------- */
const STORAGE_KEYS = {
  SETTINGS_PREFIX: 'cvgen_settings_' // + user id — local UI prefs only, not synced
};

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    console.error('Storage read error for', key, e);
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.error('Storage write error for', key, e);
    return false;
  }
}

/** Short id for nested items within a CV (experience/education/etc rows). Not a DB key. */
function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Real UUID for a CV's own id — required since it maps to a Postgres uuid column. */
function newUUID() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function escapeHTML(str) {
  if (str === undefined || str === null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(d) {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch (e) { return d; }
}

/* ---------------------------------------------------------
   1. AUTHENTICATION (Supabase Auth)
   --------------------------------------------------------- */

// Cached, normalized user for the current page load. Populated by
// requireAuth() / redirectIfLoggedIn(); safe to read synchronously
// anywhere that runs after one of those has resolved.
let currentUser = null;

function normalizeUser(supabaseUser) {
  if (!supabaseUser) return null;
  const meta = supabaseUser.user_metadata || {};
  return {
    id: supabaseUser.id,
    name: meta.full_name || (supabaseUser.email ? supabaseUser.email.split('@')[0] : 'there'),
    email: supabaseUser.email,
    createdAt: supabaseUser.created_at,
    plan: 'free',       // enriched from profiles.plan in requireAuth() — 'free' until proven otherwise
    aiNotifyOptIn: false
  };
}

async function getSupabaseSessionUser() {
  // Right after a Google (or any OAuth) redirect, the session tokens sit in
  // the URL hash. supabase-js is *supposed* to auto-detect and store these
  // (detectSessionInUrl: true is the default), but that hasn't proven
  // reliable in this deployment — so instead of trusting it, parse the
  // hash ourselves and hand the tokens to Supabase directly via
  // setSession(). This is Supabase's own documented fallback for exactly
  // this situation and doesn't depend on the library's automatic behavior.
  if (window.location.hash.includes('access_token')) {
    const params = new URLSearchParams(window.location.hash.slice(1)); // drop leading '#'
    const access_token = params.get('access_token');
    const refresh_token = params.get('refresh_token');
    if (access_token && refresh_token) {
      const { error: setError } = await supabaseClient.auth.setSession({ access_token, refresh_token });
      if (setError) console.error('setSession error:', setError);
    }
    // Remove the token from the URL either way, so it's never left sitting
    // there (and never re-processed if this function runs again).
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    console.error('getSession error:', error);
    return null;
  }
  return data.session ? data.session.user : null;
}

/** Returns the cached current user (sync). Only valid after requireAuth()/redirectIfLoggedIn() resolved. */
function getCurrentUser() {
  return currentUser;
}

/** Registers a new user with Supabase Auth. Returns {success, message, autoLoggedIn}. */
async function registerUser(name, email, password) {
  const { data, error } = await supabaseClient.auth.signUp({
    email: email.trim().toLowerCase(),
    password: password,
    options: { data: { full_name: name.trim() } }
  });

  if (error) {
    return { success: false, message: error.message || 'Could not create your account.' };
  }
  if (data.session) {
    // Email confirmation is disabled on this project — user is signed in immediately.
    return { success: true, message: 'Account created successfully!', autoLoggedIn: true };
  }
  return {
    success: true,
    autoLoggedIn: false,
    message: 'Account created! Check your inbox to confirm your email, then log in.'
  };
}

/** Attempts login with Supabase Auth. Returns {success, message}. */
async function loginUser(email, password) {
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password: password
  });

  if (error) {
    const msg = (error.message || '').toLowerCase();
    if (msg.includes('confirm')) {
      return { success: false, message: 'Please confirm your email before logging in — check your inbox.' };
    }
    return { success: false, message: 'Invalid email or password.' };
  }
  return { success: true, message: 'Welcome back!' };
}

/** Starts the "Sign in with Google" OAuth flow (full-page redirect via Supabase). */
async function signInWithGoogle() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname.replace(/[^/]+$/, 'dashboard.html') }
  });
  if (error) {
    console.error('Google sign-in error:', error);
    showToast('Could not start Google sign-in', 'error');
  }
}

async function logoutUser() {
  await supabaseClient.auth.signOut();
  currentUser = null;
  window.location.href = 'index.html';
}

/** Guards protected pages. Redirects to login.html if not signed in; caches the user otherwise. */
async function requireAuth() {
  const user = await getSupabaseSessionUser();
  if (!user) {
    window.location.href = 'login.html';
    return null;
  }
  currentUser = normalizeUser(user);

  // Pull plan / notify-preference from the profiles table (not part of the
  // auth user object itself). Defaults already set by normalizeUser() above
  // if this row is somehow missing, so a failure here never blocks login.
  const { data: profileRow } = await supabaseClient
    .from('profiles')
    .select('plan, ai_notify_opt_in')
    .eq('id', user.id)
    .maybeSingle();
  if (profileRow) {
    currentUser.plan = profileRow.plan || 'free';
    currentUser.aiNotifyOptIn = !!profileRow.ai_notify_opt_in;
  }

  return currentUser;
}

/** Redirects away from login/register if already signed in. */
async function redirectIfLoggedIn() {
  const user = await getSupabaseSessionUser();
  if (user) {
    window.location.href = 'dashboard.html';
  }
}

/* ---------------------------------------------------------
   1b. PRO / SUBSCRIPTION — template catalog & feature gating
   (UI + gating only — no real billing yet. See PRO_FEATURES.md)
   --------------------------------------------------------- */

/** Every CV template the app knows about. 'tier' is 'free' or 'pro'. */
const TEMPLATE_CATALOG = [
  { id: 'professional', name: 'Classic Professional', description: 'Clean corporate design, ATS-friendly.', category: 'Business', tier: 'free', hasLiveMockup: true },
  { id: 'modern', name: 'Modern', description: 'Bold sidebar layout with an accent color.', category: 'Technology', tier: 'free', hasLiveMockup: true },
  { id: 'minimal', name: 'Minimal', description: 'Elegant black & white, distraction-free.', category: 'Graduate', tier: 'free', hasLiveMockup: true },
  { id: 'classic', name: 'Traditional ATS', description: 'Ultra-clean single column, built for ATS parsing.', category: 'Business', tier: 'free', hasLiveMockup: false },
  { id: 'tech', name: 'Tech Focus', description: 'Skill-forward layout suited to engineering roles.', category: 'Technology', tier: 'free', hasLiveMockup: false },
  { id: 'neon', name: 'Neon', description: 'Futuristic dark cyberpunk styling.', category: 'Creative', tier: 'pro', hasLiveMockup: true },
  { id: 'aurora', name: 'Aurora', description: 'Holographic gradient, softly futuristic.', category: 'Creative', tier: 'pro', hasLiveMockup: true },
  { id: 'executive', name: 'Modern Executive', description: 'Premium two-column layout with a photo banner.', category: 'Business', tier: 'pro', hasLiveMockup: false },
  { id: 'creative-folio', name: 'Creative Portfolio', description: 'Bold color blocks for design & creative roles.', category: 'Creative', tier: 'pro', hasLiveMockup: false },
  { id: 'graduate-entry', name: 'Graduate Entry', description: 'Education-forward layout for new graduates.', category: 'Graduate', tier: 'pro', hasLiveMockup: false },
  { id: 'executive-elite', name: 'Executive Elite', description: 'Dark premium styling with gold accents.', category: 'Business', tier: 'pro', hasLiveMockup: false }
];

function getTemplateMeta(id) {
  return TEMPLATE_CATALOG.find((t) => t.id === id) || TEMPLATE_CATALOG[0];
}

/** True once real subscriptions exist and this user has one. For now: reads profiles.plan. */
function isProUser() {
  return !!(currentUser && currentUser.plan === 'pro');
}

function showProUpgradeModal() {
  const modal = document.getElementById('proUpgradeModal');
  if (modal) modal.classList.add('show');
}

function hideProUpgradeModal() {
  const modal = document.getElementById('proUpgradeModal');
  if (modal) modal.classList.remove('show');
}

/** Runs onAllowed() if the user is Pro; otherwise shows the upgrade modal. */
function requirePro(onAllowed) {
  if (isProUser()) {
    onAllowed();
  } else {
    showProUpgradeModal();
  }
}

function initProUpgradeModal() {
  const modal = document.getElementById('proUpgradeModal');
  if (!modal) return;
  const closeBtn = document.getElementById('proModalClose');
  if (closeBtn) closeBtn.addEventListener('click', hideProUpgradeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) hideProUpgradeModal(); });
}

/** "Notify Me" on the AI Builder Coming Soon page — stores the opt-in on the user's profile row. */
async function notifyMeAI() {
  if (!currentUser) return;
  const btn = document.getElementById('aiNotifyBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Saving...'; }

  const { error } = await supabaseClient
    .from('profiles')
    .update({ ai_notify_opt_in: true })
    .eq('id', currentUser.id);

  if (error) {
    console.error('notifyMeAI error:', error);
    showToast('Could not save your preference — try again', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-bell"></i> Notify Me'; }
    return;
  }

  currentUser.aiNotifyOptIn = true;
  const confirmBox = document.getElementById('aiNotifyConfirm');
  if (btn) btn.style.display = 'none';
  if (confirmBox) confirmBox.style.display = 'flex';
}

/* ---------------------------------------------------------
   2. CV DATA MODEL (Supabase tables: cvs + experiences, education,
      skills, certifications, languages, "references")
   --------------------------------------------------------- */

/** Row → app-shape mappers for each child table (DB column names → the field names the UI uses). */
function rowToExperienceItem(r) {
  return { id: r.id, title: r.job_title || '', company: r.company || '', location: r.location || '', start: r.start_date || '', end: r.end_date || '', description: r.description || '' };
}
function rowToEducationItem(r) {
  return { id: r.id, school: r.school || '', degree: r.degree || '', field: r.field_of_study || '', start: r.start_date || '', end: r.end_date || '', description: r.description || '' };
}
function rowToSkillItem(r) {
  return { id: r.id, name: r.name || '', level: r.level || 'Intermediate' };
}
function rowToCertificationItem(r) {
  return { id: r.id, name: r.name || '', org: r.issuing_organization || '', date: r.issue_date || '' };
}
function rowToLanguageItem(r) {
  return { id: r.id, name: r.name || '', level: r.level || 'Conversational' };
}
function rowToReferenceItem(r) {
  return { id: r.id, name: r.full_name || '', position: r.job_position || '', org: r.organization || '', email: r.email || '', phone: r.phone || '' };
}

function bySortOrder(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); }

/** Combines a `cvs` row with its child-table rows into the app's flat CV shape. */
function rowsToCV(cvRow, children) {
  children = children || {};
  return {
    id: cvRow.id,
    name: cvRow.name || 'Untitled CV',
    template: cvRow.template || 'professional',
    status: cvRow.status || 'draft',
    createdAt: cvRow.created_at,
    lastEdited: cvRow.updated_at,
    personal: {
      fullName: cvRow.full_name || '',
      title: cvRow.professional_title || '',
      email: cvRow.email || '',
      phone: cvRow.phone || '',
      location: cvRow.location || '',
      website: cvRow.website || '',
      linkedin: cvRow.linkedin || '',
      photo: cvRow.photo_url || '',
      // No separate "original photo" column in the DB — re-cropping after a
      // reload just starts from the last-saved photo (still a clean 640x640
      // source, so quality loss on re-crop is negligible).
      photoOriginal: cvRow.photo_url || ''
    },
    summary: cvRow.summary || '',
    experience: (children.experiences || []).slice().sort(bySortOrder).map(rowToExperienceItem),
    education: (children.education || []).slice().sort(bySortOrder).map(rowToEducationItem),
    skills: (children.skills || []).slice().sort(bySortOrder).map(rowToSkillItem),
    certifications: (children.certifications || []).slice().sort(bySortOrder).map(rowToCertificationItem),
    languages: (children.languages || []).slice().sort(bySortOrder).map(rowToLanguageItem),
    references: (children.references || []).slice().sort(bySortOrder).map(rowToReferenceItem)
  };
}

function blankCV() {
  return {
    id: newUUID(),
    name: 'Untitled CV',
    template: 'professional',
    status: 'draft',
    createdAt: new Date().toISOString(),
    lastEdited: new Date().toISOString(),
    personal: { fullName: '', title: '', email: '', phone: '', location: '', website: '', linkedin: '', photo: '', photoOriginal: '' },
    summary: '',
    experience: [],
    education: [],
    skills: [],
    certifications: [],
    languages: [],
    references: []
  };
}

/**
 * Fetches every CV belonging to the signed-in user for list views (Dashboard,
 * My CVs). Only counts of each child table are pulled — not the full rows —
 * so the progress bar / "X% complete" figure is accurate without the cost of
 * fetching every experience/education/etc row for every CV in the list.
 */
async function getAllCVs() {
  if (!currentUser) return [];
  const { data, error } = await supabaseClient
    .from('cvs')
    .select('*, experiences(count), education(count), skills(count), certifications(count), languages(count), "references"(count)')
    .eq('user_id', currentUser.id)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('getAllCVs error:', error);
    showToast('Could not load your CVs — check your connection', 'error');
    return [];
  }

  return data.map((row) => {
    const cv = rowsToCV(row, {});
    // calculateProgress() only checks `.length > 0` for these — placeholder
    // arrays of the right length are enough, without fetching real rows.
    cv.experience = Array(row.experiences?.[0]?.count || 0).fill({});
    cv.education = Array(row.education?.[0]?.count || 0).fill({});
    cv.skills = Array(row.skills?.[0]?.count || 0).fill({});
    cv.certifications = Array(row.certifications?.[0]?.count || 0).fill({});
    cv.languages = Array(row.languages?.[0]?.count || 0).fill({});
    return cv;
  });
}

/** Fetches one CV with all of its child rows — used when opening it in the builder. */
async function getCVById(id) {
  if (!currentUser) return null;
  const { data: cvRow, error: cvError } = await supabaseClient
    .from('cvs')
    .select('*')
    .eq('id', id)
    .eq('user_id', currentUser.id)
    .maybeSingle();

  if (cvError || !cvRow) return null;

  const [experiences, education, skills, certifications, languages, references] = await Promise.all([
    supabaseClient.from('experiences').select('*').eq('cv_id', id),
    supabaseClient.from('education').select('*').eq('cv_id', id),
    supabaseClient.from('skills').select('*').eq('cv_id', id),
    supabaseClient.from('certifications').select('*').eq('cv_id', id),
    supabaseClient.from('languages').select('*').eq('cv_id', id),
    supabaseClient.from('references').select('*').eq('cv_id', id)
  ]);

  return rowsToCV(cvRow, {
    experiences: experiences.data || [],
    education: education.data || [],
    skills: skills.data || [],
    certifications: certifications.data || [],
    languages: languages.data || [],
    references: references.data || []
  });
}

/** Replaces all rows in a child table for one CV with the current in-memory list. */
async function replaceChildRows(table, cvId, rows) {
  const { error: delError } = await supabaseClient.from(table).delete().eq('cv_id', cvId);
  if (delError) {
    console.error(`saveCV error (clearing ${table}):`, delError);
    return false;
  }
  if (rows.length === 0) return true;
  const { error: insError } = await supabaseClient.from(table).insert(rows);
  if (insError) {
    console.error(`saveCV error (inserting ${table}):`, insError);
    return false;
  }
  return true;
}

/**
 * Saves (creates or updates) a CV: upserts the `cvs` row, then fully
 * replaces each child table's rows with the current in-memory arrays.
 * Simpler and safer than diffing add/remove/reorder — the whole form is
 * always re-synced on every save. Returns the freshly reloaded CV.
 */
async function saveCV(cvData) {
  if (!currentUser) return cvData;
  cvData.lastEdited = new Date().toISOString();

  const cvPayload = {
    id: cvData.id,
    user_id: currentUser.id,
    name: cvData.name,
    template: cvData.template,
    status: cvData.status,
    full_name: cvData.personal.fullName,
    professional_title: cvData.personal.title,
    email: cvData.personal.email,
    phone: cvData.personal.phone,
    location: cvData.personal.location,
    website: cvData.personal.website,
    linkedin: cvData.personal.linkedin,
    photo_url: cvData.personal.photo,
    summary: cvData.summary
  };

  const { data: savedCV, error: cvError } = await supabaseClient.from('cvs').upsert(cvPayload).select().single();
  if (cvError) {
    console.error('saveCV error (cvs):', cvError);
    showToast('Could not save your CV — check your connection', 'error');
    return cvData;
  }

  const cvId = savedCV.id;
  const uid_ = currentUser.id;

  const results = await Promise.all([
    replaceChildRows('experiences', cvId, cvData.experience.map((e, i) => ({
      cv_id: cvId, user_id: uid_, job_title: e.title, company: e.company, location: e.location,
      start_date: e.start, end_date: e.end, description: e.description, sort_order: i
    }))),
    replaceChildRows('education', cvId, cvData.education.map((e, i) => ({
      cv_id: cvId, user_id: uid_, school: e.school, degree: e.degree, field_of_study: e.field,
      start_date: e.start, end_date: e.end, description: e.description, sort_order: i
    }))),
    replaceChildRows('skills', cvId, cvData.skills.map((s, i) => ({
      cv_id: cvId, user_id: uid_, name: s.name, level: s.level, sort_order: i
    }))),
    replaceChildRows('certifications', cvId, cvData.certifications.map((c, i) => ({
      cv_id: cvId, user_id: uid_, name: c.name, issuing_organization: c.org, issue_date: c.date, sort_order: i
    }))),
    replaceChildRows('languages', cvId, cvData.languages.map((l, i) => ({
      cv_id: cvId, user_id: uid_, name: l.name, level: l.level, sort_order: i
    }))),
    replaceChildRows('references', cvId, cvData.references.map((r, i) => ({
      cv_id: cvId, user_id: uid_, full_name: r.name, job_position: r.position, organization: r.org,
      email: r.email, phone: r.phone, sort_order: i
    })))
  ]);

  if (results.some((ok) => !ok)) {
    showToast('CV saved, but some sections may not have synced — try saving again', 'error');
  }

  // Reload from the DB so returned ids/order match exactly what's stored.
  return (await getCVById(cvId)) || cvData;
}

/** Loads a CV by id, or returns a blank one if no id supplied / not found. */
async function loadCV(id) {
  if (!id) return blankCV();
  const cv = await getCVById(id);
  return cv || blankCV();
}

/** Deletes a CV — child rows cascade-delete automatically via their cv_id foreign key. */
async function deleteCV(id) {
  if (!currentUser) return;
  const { error } = await supabaseClient.from('cvs').delete().eq('id', id).eq('user_id', currentUser.id);
  if (error) {
    console.error('deleteCV error:', error);
    showToast('Could not delete this CV', 'error');
  }
}

/* ---------------------------------------------------------
   3. PROGRESS CALCULATION
   --------------------------------------------------------- */
function calculateProgress(cv) {
  let total = 0;
  let filled = 0;

  const personalFields = ['fullName', 'title', 'email', 'phone', 'location'];
  personalFields.forEach(f => { total++; if (cv.personal[f] && cv.personal[f].trim()) filled++; });

  total++; if (cv.summary && cv.summary.trim()) filled++;
  total++; if (cv.experience.length > 0) filled++;
  total++; if (cv.education.length > 0) filled++;
  total++; if (cv.skills.length > 0) filled++;
  total++; if (cv.certifications.length > 0) filled++;
  total++; if (cv.languages.length > 0) filled++;
  total++; if (cv.personal.photo) filled++;

  return Math.round((filled / total) * 100);
}

/* ---------------------------------------------------------
   4. TOAST NOTIFICATIONS
   --------------------------------------------------------- */
function ensureToastContainer() {
  let c = document.getElementById('toastContainer');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toastContainer';
    document.body.appendChild(c);
  }
  return c;
}

function showToast(message, type) {
  type = type || 'success';
  const icons = { success: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info' };
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.innerHTML = '<i class="fa-solid ' + icons[type] + '"></i><span>' + escapeHTML(message) + '</span>';
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), 260);
  }, 3200);
}

/* ---------------------------------------------------------
   5. CONFIRM MODAL
   --------------------------------------------------------- */
function confirmDialog(opts, onConfirm) {
  const overlay = document.getElementById('confirmModal');
  if (!overlay) { if (confirm(opts.message)) onConfirm(); return; }
  document.getElementById('confirmTitle').textContent = opts.title || 'Are you sure?';
  document.getElementById('confirmMessage').textContent = opts.message || '';
  overlay.classList.add('show');
  const yesBtn = document.getElementById('confirmYes');
  const noBtn = document.getElementById('confirmNo');
  const cleanup = () => {
    overlay.classList.remove('show');
    yesBtn.removeEventListener('click', yesHandler);
    noBtn.removeEventListener('click', noHandler);
  };
  const yesHandler = () => { cleanup(); onConfirm(); };
  const noHandler = () => { cleanup(); };
  yesBtn.addEventListener('click', yesHandler);
  noBtn.addEventListener('click', noHandler);
}

/* ---------------------------------------------------------
   6. GLOBAL UI: mobile nav, sidebar, settings application
   --------------------------------------------------------- */
function initMobileNav() {
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      links.classList.toggle('open');
      const icon = toggle.querySelector('i');
      if (icon) icon.className = links.classList.contains('open') ? 'fa-solid fa-xmark' : 'fa-solid fa-bars';
    });
  }
}

function initSidebar() {
  const menuBtn = document.querySelector('.mobile-menu-btn');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.querySelector('.sidebar-overlay');
  if (menuBtn && sidebar && overlay) {
    menuBtn.addEventListener('click', () => {
      sidebar.classList.add('open');
      overlay.classList.add('show');
    });
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('show');
    });
  }
}

function getSettings() {
  const user = getCurrentUser();
  const key = STORAGE_KEYS.SETTINGS_PREFIX + (user ? user.id : 'guest');
  return readJSON(key, { darkMode: false, animations: true });
}

function saveSettings(settings) {
  const user = getCurrentUser();
  const key = STORAGE_KEYS.SETTINGS_PREFIX + (user ? user.id : 'guest');
  writeJSON(key, settings);
}

function applySettings() {
  const settings = getSettings();
  document.body.classList.toggle('light-mode', !settings.darkMode && settings.darkMode !== undefined ? false : false);
  // darkMode true => keep default dark theme; false explicitly => light mode
  if (settings.darkMode === false) {
    document.body.classList.add('light-mode');
  } else {
    document.body.classList.remove('light-mode');
  }
  document.body.classList.toggle('no-animations', !settings.animations);
}

function populateSidebarUser() {
  const nameEls = document.querySelectorAll('[data-user-name]');
  const initialEls = document.querySelectorAll('[data-user-initial]');
  const emailEls = document.querySelectorAll('[data-user-email]');
  const user = getCurrentUser();
  if (!user) return;
  nameEls.forEach(el => el.textContent = user.name);
  emailEls.forEach(el => el.textContent = user.email);
  initialEls.forEach(el => el.textContent = user.name.trim().charAt(0).toUpperCase());
}

/* Fade-in on scroll (landing page sections) */
function initFadeInObserver() {
  const els = document.querySelectorAll('.fade-in');
  if (!els.length) return;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  els.forEach(el => observer.observe(el));
}

/* ---------------------------------------------------------
   7. VALIDATION HELPERS
   --------------------------------------------------------- */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function setFieldError(fieldEl, message) {
  fieldEl.classList.add('error');
  const errEl = fieldEl.querySelector('.field-error');
  if (errEl) errEl.textContent = message;
}

function clearFieldError(fieldEl) {
  fieldEl.classList.remove('error');
}

/* =========================================================
   8. PAGE INIT: REGISTER
   ========================================================= */
async function initRegisterPage() {
  await redirectIfLoggedIn();
  const form = document.getElementById('registerForm');
  if (!form) return;

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const nameField = document.getElementById('regNameField');
    const emailField = document.getElementById('regEmailField');
    const passField = document.getElementById('regPassField');
    const confirmField = document.getElementById('regConfirmField');
    [nameField, emailField, passField, confirmField].forEach(clearFieldError);

    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;
    const confirm = document.getElementById('regConfirm').value;

    let valid = true;
    if (!name) { setFieldError(nameField, 'Please enter your full name.'); valid = false; }
    if (!email || !isValidEmail(email)) { setFieldError(emailField, 'Please enter a valid email.'); valid = false; }
    if (!password || password.length < 6) { setFieldError(passField, 'Password must be at least 6 characters.'); valid = false; }
    if (password !== confirm) { setFieldError(confirmField, 'Passwords must match.'); valid = false; }

    if (!valid) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalBtnHTML = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner"></span> Creating account...';
    submitBtn.disabled = true;

    const result = await registerUser(name, email, password);

    submitBtn.innerHTML = originalBtnHTML;
    submitBtn.disabled = false;

    const alertBox = document.getElementById('registerAlert');
    if (result.success) {
      alertBox.className = 'alert alert-success show';
      alertBox.innerHTML = '<i class="fa-solid fa-circle-check"></i> ' + result.message;
      form.reset();
      setTimeout(() => {
        window.location.href = result.autoLoggedIn ? 'dashboard.html' : 'login.html';
      }, 1600);
    } else {
      alertBox.className = 'alert alert-error show';
      alertBox.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> ' + result.message;
    }
  });

  const googleBtn = document.getElementById('googleAuthBtn');
  if (googleBtn) googleBtn.addEventListener('click', signInWithGoogle);

  initPasswordToggles();
}

/* =========================================================
   9. PAGE INIT: LOGIN
   ========================================================= */
async function initLoginPage() {
  await redirectIfLoggedIn();
  const form = document.getElementById('loginForm');
  if (!form) return;

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    const emailField = document.getElementById('loginEmailField');
    const passField = document.getElementById('loginPassField');
    [emailField, passField].forEach(clearFieldError);

    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const alertBox = document.getElementById('loginAlert');

    let valid = true;
    if (!email) { setFieldError(emailField, 'Please enter your email.'); valid = false; }
    if (!password) { setFieldError(passField, 'Please enter your password.'); valid = false; }
    if (!valid) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalBtnHTML = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner"></span> Logging in...';
    submitBtn.disabled = true;

    const result = await loginUser(email, password);

    submitBtn.innerHTML = originalBtnHTML;
    submitBtn.disabled = false;

    if (result.success) {
      alertBox.className = 'alert alert-success show';
      alertBox.innerHTML = '<i class="fa-solid fa-circle-check"></i> ' + result.message;
      setTimeout(() => { window.location.href = 'dashboard.html'; }, 400);
    } else {
      alertBox.className = 'alert alert-error show';
      alertBox.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> ' + result.message;
    }
  });

  const googleBtn = document.getElementById('googleAuthBtn');
  if (googleBtn) googleBtn.addEventListener('click', signInWithGoogle);

  initPasswordToggles();
}

function initPasswordToggles() {
  document.querySelectorAll('.toggle-pass').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = btn.parentElement.querySelector('input');
      const icon = btn.querySelector('i');
      if (input.type === 'password') {
        input.type = 'text';
        icon.className = 'fa-solid fa-eye-slash';
      } else {
        input.type = 'password';
        icon.className = 'fa-solid fa-eye';
      }
    });
  });
}

/* =========================================================
   10. PAGE INIT: DASHBOARD
   ========================================================= */
async function initDashboardPage() {
  const user = await requireAuth();
  if (!user) return;
  applySettings();
  initSidebar();
  populateSidebarUser();

  const greetEl = document.getElementById('greetName');
  if (greetEl) greetEl.textContent = user.name.split(' ')[0];

  const cvs = await getAllCVs();
  const total = cvs.length;
  const drafts = cvs.filter(c => c.status === 'draft').length;
  const completed = cvs.filter(c => c.status === 'completed').length;

  const totalEl = document.getElementById('statTotal');
  const draftEl = document.getElementById('statDraft');
  const completeEl = document.getElementById('statComplete');
  if (totalEl) totalEl.textContent = total;
  if (draftEl) draftEl.textContent = drafts;
  if (completeEl) completeEl.textContent = completed;

  renderRecentCVs(cvs);

  // Already a Pro user (e.g. via the dev-only test override) — no need to upsell.
  const promoCard = document.getElementById('proPromoCard');
  if (promoCard && isProUser()) promoCard.style.display = 'none';
}

function renderRecentCVs(cvs) {
  const container = document.getElementById('recentCVsGrid');
  const emptyState = document.getElementById('cvsEmptyState');
  if (!container) return;

  const sorted = [...cvs].sort((a, b) => new Date(b.lastEdited) - new Date(a.lastEdited));

  if (sorted.length === 0) {
    container.style.display = 'none';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }
  container.style.display = 'grid';
  if (emptyState) emptyState.style.display = 'none';

  container.innerHTML = sorted.map(cv => cvCardHTML(cv)).join('');

  container.querySelectorAll('[data-delete-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const id = btn.getAttribute('data-delete-id');
      confirmDialog({
        title: 'Delete this CV?',
        message: 'This action cannot be undone. The CV and all its data will be permanently removed.'
      }, async () => {
        await deleteCV(id);
        showToast('CV deleted successfully', 'success');
        await initDashboardPage();
        if (typeof initMyCVsPage === 'function' && document.getElementById('allCVsGrid')) await initMyCVsPage();
      });
    });
  });
}

/**
 * Prefers the CV owner's actual name for display over the generic
 * "Untitled CV" placeholder — falls back to their professional title,
 * then finally the CV's own custom name/title.
 */
function getCVDisplayName(cv) {
  const p = cv.personal || {};
  if (p.fullName && p.fullName.trim()) return p.fullName.trim();
  if (p.title && p.title.trim()) return p.title.trim();
  return cv.name || 'Untitled CV';
}

function cvCardHTML(cv) {
  const progress = calculateProgress(cv);
  const status = cv.status === 'completed' ? 'completed' : 'draft';
  return `
    <div class="card cv-card">
      <div class="cv-card-top">
        <div class="cv-thumb"></div>
        <div>
          <strong>${escapeHTML(getCVDisplayName(cv))}</strong>
          <span>${escapeHTML(cv.template)} template &middot; edited ${formatDate(cv.lastEdited)}</span>
        </div>
      </div>
      <div class="flex-between">
        <span class="status-badge ${status}">${status}</span>
        <span class="tag-muted">${progress}% complete</span>
      </div>
      <div class="cv-card-actions">
        <a class="btn btn-secondary btn-sm" href="cv-builder.html?id=${encodeURIComponent(cv.id)}"><i class="fa-solid fa-pen"></i> Edit</a>
        <button class="btn btn-secondary btn-sm" onclick="quickDownload('${cv.id}')"><i class="fa-solid fa-download"></i></button>
        <button class="btn btn-danger btn-sm" data-delete-id="${cv.id}"><i class="fa-solid fa-trash"></i></button>
      </div>
    </div>`;
}

function quickDownload(id) {
  window.location.href = 'cv-builder.html?id=' + encodeURIComponent(id) + '&autodownload=1';
}

/* =========================================================
   11. PAGE INIT: MY CVs (uses dashboard grid render, full list)
   ========================================================= */
async function initMyCVsPage() {
  const user = await requireAuth();
  if (!user) return;
  applySettings();
  initSidebar();
  populateSidebarUser();

  const cvs = await getAllCVs();
  const container = document.getElementById('allCVsGrid');
  const emptyState = document.getElementById('cvsEmptyState');
  if (!container) return;

  const sorted = [...cvs].sort((a, b) => new Date(b.lastEdited) - new Date(a.lastEdited));
  if (sorted.length === 0) {
    container.style.display = 'none';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }
  container.style.display = 'grid';
  if (emptyState) emptyState.style.display = 'none';
  container.innerHTML = sorted.map(cv => cvCardHTML(cv)).join('');

  container.querySelectorAll('[data-delete-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const id = btn.getAttribute('data-delete-id');
      confirmDialog({
        title: 'Delete this CV?',
        message: 'This action cannot be undone. The CV and all its data will be permanently removed.'
      }, async () => {
        await deleteCV(id);
        showToast('CV deleted successfully', 'success');
        await initMyCVsPage();
      });
    });
  });
}

/* =========================================================
   12. PAGE INIT: PROFILE
   ========================================================= */
async function initProfilePage() {
  const user = await requireAuth();
  if (!user) return;
  applySettings();
  initSidebar();
  populateSidebarUser();

  document.getElementById('profileName').value = user.name;
  document.getElementById('profileEmail').value = user.email;
  document.getElementById('profileCreated').textContent = formatDate(user.createdAt);
  document.getElementById('profileInitial').textContent = user.name.trim().charAt(0).toUpperCase();

  const form = document.getElementById('profileForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newName = document.getElementById('profileName').value.trim();
    if (!newName) { showToast('Name cannot be empty', 'error'); return; }

    const submitBtn = form.querySelector('button[type="submit"]');
    const originalHTML = submitBtn.innerHTML;
    submitBtn.innerHTML = '<span class="spinner"></span> Saving...';
    submitBtn.disabled = true;

    const { error } = await supabaseClient.auth.updateUser({ data: { full_name: newName } });
    if (!error) {
      // Mirror onto the profiles table too, so it stays queryable/joinable server-side.
      await supabaseClient.from('profiles').update({ full_name: newName }).eq('id', user.id);
      currentUser.name = newName;
      showToast('Profile updated successfully', 'success');
      populateSidebarUser();
      document.getElementById('profileInitial').textContent = newName.charAt(0).toUpperCase();
    } else {
      console.error('Profile update error:', error);
      showToast('Could not update your profile', 'error');
    }

    submitBtn.innerHTML = originalHTML;
    submitBtn.disabled = false;
  });
}

/* =========================================================
   13. PAGE INIT: SETTINGS
   ========================================================= */
async function initSettingsPage() {
  const user = await requireAuth();
  if (!user) return;
  applySettings();
  initSidebar();
  populateSidebarUser();

  const settings = getSettings();
  const darkToggle = document.getElementById('darkModeToggle');
  const animToggle = document.getElementById('animationsToggle');
  darkToggle.checked = settings.darkMode !== false;
  animToggle.checked = settings.animations !== false;

  darkToggle.addEventListener('change', () => {
    const s = getSettings();
    s.darkMode = darkToggle.checked;
    saveSettings(s);
    applySettings();
    showToast(darkToggle.checked ? 'Dark mode enabled' : 'Light mode enabled', 'info');
  });

  animToggle.addEventListener('change', () => {
    const s = getSettings();
    s.animations = animToggle.checked;
    saveSettings(s);
    applySettings();
    showToast(animToggle.checked ? 'Animations enabled' : 'Animations disabled', 'info');
  });

  const clearBtn = document.getElementById('clearDataBtn');
  clearBtn.addEventListener('click', () => {
    confirmDialog({
      title: 'Clear all CV data?',
      message: 'This will permanently delete every CV you have created. This cannot be undone.'
    }, async () => {
      const { error } = await supabaseClient.from('cvs').delete().eq('user_id', user.id);
      if (error) {
        console.error('Clear data error:', error);
        showToast('Could not clear your CV data', 'error');
      } else {
        showToast('All CV data cleared', 'success');
      }
    });
  });
}

/* =========================================================
   14. PAGE INIT: TEMPLATES GALLERY
   ========================================================= */

/** Live mini-mockups for templates that already exist as real, working CV templates. */
const TEMPLATE_LIVE_THUMBS = {
  professional: `<div class="mini-cv" style="padding:30px; font-family:'Sora', sans-serif;">
    <div style="display:flex; gap:14px; align-items:center; border-bottom:3px solid #1c2233; padding-bottom:16px; margin-bottom:16px;">
      <div style="width:70px;height:70px;border-radius:8px;background:#dde3f5;"></div>
      <div><div style="font-weight:800;font-size:1.3rem;">Amara Chukwu</div><div style="color:#666;font-size:.9rem;">Product Designer</div></div>
    </div>
    <div style="height:8px;width:90%;background:#eef0f6;border-radius:4px;margin-bottom:8px;"></div>
    <div style="height:8px;width:70%;background:#eef0f6;border-radius:4px;margin-bottom:16px;"></div>
    <div style="height:6px;width:30%;background:#4f7cff;border-radius:4px;margin-bottom:10px;"></div>
    <div style="height:8px;width:80%;background:#eef0f6;border-radius:4px;margin-bottom:8px;"></div>
  </div>`,
  modern: `<div class="mini-cv" style="display:flex;height:100%;">
    <div style="width:36%; background:linear-gradient(160deg,#232a4d,#171b33); padding:24px 16px;">
      <div style="width:60px;height:60px;border-radius:50%;background:rgba(255,255,255,0.2);margin:0 auto 14px;"></div>
      <div style="height:8px;width:80%;background:rgba(255,255,255,0.3);border-radius:4px;margin:0 auto 20px;"></div>
      <div style="height:6px;width:60%;background:rgba(255,255,255,0.2);border-radius:4px;margin-bottom:8px;"></div>
      <div style="height:6px;width:70%;background:rgba(255,255,255,0.2);border-radius:4px;"></div>
    </div>
    <div style="flex:1; padding:24px;">
      <div style="height:8px;width:40%;background:#4f7cff;border-radius:4px;margin-bottom:14px;"></div>
      <div style="height:8px;width:90%;background:#eef0f6;border-radius:4px;margin-bottom:8px;"></div>
      <div style="height:8px;width:70%;background:#eef0f6;border-radius:4px;"></div>
    </div>
  </div>`,
  minimal: `<div class="mini-cv" style="padding:34px; text-align:center; font-family:Georgia, serif;">
    <div style="width:60px;height:60px;border-radius:50%;background:#ddd;margin:0 auto 12px;"></div>
    <div style="font-size:1.4rem;letter-spacing:.03em;">Amara Chukwu</div>
    <div style="color:#666;font-size:.85rem;text-transform:uppercase;letter-spacing:.05em;margin-bottom:18px;">Product Designer</div>
    <div style="height:1px;width:40px;background:#111;margin:0 auto 14px;"></div>
    <div style="height:6px;width:60%;background:#eee;border-radius:4px;margin:0 auto 8px;"></div>
    <div style="height:6px;width:40%;background:#eee;border-radius:4px;margin:0 auto;"></div>
  </div>`,
  neon: `<div class="mini-cv" style="padding:28px; font-family:'Sora', sans-serif; background:#0a0e1a; color:#d7deff; height:100%;
       background-image: linear-gradient(rgba(34,211,238,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.08) 1px, transparent 1px);
       background-size: 22px 22px;">
    <div style="display:flex; gap:12px; align-items:center; border-bottom:1px solid rgba(34,211,238,0.35); padding-bottom:14px; margin-bottom:14px;">
      <div style="width:56px;height:56px;border-radius:10px;background:#131a30;border:2px solid #22d3ee;box-shadow:0 0 12px rgba(34,211,238,.5);"></div>
      <div><div style="font-weight:800;font-size:1.15rem;color:#7ff0ff;text-shadow:0 0 8px rgba(34,211,238,.5);">Amara Chukwu</div><div style="color:#c893ff;font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;">Product Designer</div></div>
    </div>
    <div style="height:6px;width:26%;background:#22d3ee;border-radius:4px;margin-bottom:10px;"></div>
    <div style="padding:8px 10px;border-radius:8px;background:rgba(144,97,249,0.1);border:1px solid rgba(144,97,249,0.3);margin-bottom:8px;">
      <div style="height:6px;width:70%;background:rgba(255,255,255,.6);border-radius:4px;"></div>
    </div>
    <div style="padding:8px 10px;border-radius:8px;background:rgba(144,97,249,0.1);border:1px solid rgba(144,97,249,0.3);">
      <div style="height:6px;width:55%;background:rgba(255,255,255,.6);border-radius:4px;"></div>
    </div>
  </div>`,
  aurora: `<div class="mini-cv" style="padding:28px; font-family:'Sora', sans-serif;">
    <div style="display:flex; gap:12px; align-items:center; padding:16px; border-radius:14px;
         background:linear-gradient(120deg,#eaf0ff 0%,#f3ecff 45%,#ffeef8 100%); border:1px solid #ece6fb; margin-bottom:16px;">
      <div style="width:56px;height:56px;border-radius:50%;background:#fff;box-shadow:0 6px 14px rgba(144,97,249,.25);"></div>
      <div><div style="font-weight:800;font-size:1.15rem;color:#2a2350;">Amara Chukwu</div><div style="color:#7c5cff;font-size:.72rem;font-weight:600;">Product Designer</div></div>
    </div>
    <div style="height:6px;width:34%;background:linear-gradient(90deg,#4f7cff,#9061f9,#ff6fd8);border-radius:4px;margin-bottom:12px;"></div>
    <div style="height:6px;width:88%;background:#f1eefc;border-radius:4px;margin-bottom:8px;"></div>
    <div style="height:6px;width:65%;background:#f1eefc;border-radius:4px;"></div>
  </div>`
};

const TEMPLATE_PLACEHOLDER_ICONS = {
  classic: 'fa-file-lines', tech: 'fa-code', executive: 'fa-briefcase',
  'creative-folio': 'fa-palette', 'graduate-entry': 'fa-graduation-cap', 'executive-elite': 'fa-crown'
};

function templateThumbHTML(tpl) {
  if (TEMPLATE_LIVE_THUMBS[tpl.id]) return TEMPLATE_LIVE_THUMBS[tpl.id];
  const icon = TEMPLATE_PLACEHOLDER_ICONS[tpl.id] || 'fa-file';
  return `<div class="tpl-placeholder-thumb"><i class="fa-solid ${icon}"></i><span>${escapeHTML(tpl.name)}</span></div>`;
}

function templateCardHTML(tpl) {
  const thumb = templateThumbHTML(tpl);
  if (tpl.tier === 'free') {
    return `
      <div class="card template-card hoverable">
        <div class="template-card-thumb">${thumb}</div>
        <div class="template-card-body">
          <div><h4>${escapeHTML(tpl.name)}</h4><span>${escapeHTML(tpl.description)}</span></div>
          <button class="btn btn-primary btn-sm" data-select-template="${tpl.id}">Use Template</button>
        </div>
      </div>`;
  }
  return `
    <div class="card template-card template-card-locked" data-locked-template="${tpl.id}">
      <div class="template-card-thumb">
        ${thumb}
        <div class="template-lock-overlay">
          <div class="lock-icon"><i class="fa-solid fa-lock"></i></div>
          <span>Premium Template</span>
          <small>Unlock with CVGEN Pro</small>
        </div>
      </div>
      <div class="template-card-body">
        <div><h4>${escapeHTML(tpl.name)}</h4><span>${escapeHTML(tpl.description)}</span></div>
        <span class="pro-badge"><i class="fa-solid fa-crown"></i> Pro</span>
      </div>
    </div>`;
}

async function initTemplatesPage() {
  const user = await requireAuth();
  if (!user) return;
  applySettings();
  initSidebar();
  populateSidebarUser();
  initProUpgradeModal();

  const freeContainer = document.getElementById('freeTemplatesGrid');
  const proContainer = document.getElementById('proTemplatesGrid');
  const freeTpls = TEMPLATE_CATALOG.filter((t) => t.tier === 'free');
  const proTpls = TEMPLATE_CATALOG.filter((t) => t.tier === 'pro');

  if (freeContainer) freeContainer.innerHTML = freeTpls.map(templateCardHTML).join('');
  if (proContainer) proContainer.innerHTML = proTpls.map(templateCardHTML).join('');

  document.querySelectorAll('[data-select-template]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tpl = btn.getAttribute('data-select-template');
      window.location.href = 'cv-builder.html?template=' + encodeURIComponent(tpl);
    });
  });

  document.querySelectorAll('[data-locked-template]').forEach(card => {
    card.addEventListener('click', () => showProUpgradeModal());
  });
}

/* =========================================================
   14b. PAGE INIT: AI BUILDER (Coming Soon)
   ========================================================= */
async function initAiBuilderPage() {
  const user = await requireAuth();
  if (!user) return;
  applySettings();
  initSidebar();
  populateSidebarUser();

  const notifyBtn = document.getElementById('aiNotifyBtn');
  const confirmBox = document.getElementById('aiNotifyConfirm');
  if (user.aiNotifyOptIn) {
    if (notifyBtn) notifyBtn.style.display = 'none';
    if (confirmBox) confirmBox.style.display = 'flex';
  } else if (notifyBtn) {
    notifyBtn.addEventListener('click', notifyMeAI);
  }
}

/* =========================================================
   14c. PAGE INIT: PRO / PRICING
   ========================================================= */
async function initProPage() {
  const user = await requireAuth();
  if (!user) return;
  applySettings();
  initSidebar();
  populateSidebarUser();

  const upgradeBtn = document.getElementById('upgradeProBtn');
  if (isProUser()) {
    if (upgradeBtn) {
      upgradeBtn.textContent = 'Current Plan';
      upgradeBtn.disabled = true;
      upgradeBtn.classList.remove('btn-primary');
      upgradeBtn.classList.add('btn-secondary');
    }
  } else if (upgradeBtn) {
    upgradeBtn.addEventListener('click', () => {
      showToast('CVGEN Pro is coming soon.', 'info');
    });
  }
}

/* =========================================================
   15. PAGE INIT: CV BUILDER  (core of the application)
   ========================================================= */
let currentCV = null;

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

async function initBuilderPage() {
  const user = await requireAuth();
  if (!user) return;
  applySettings();
  initSidebar();
  populateSidebarUser();

  const cvId = getParam('id');
  const tplParam = getParam('template');
  currentCV = await loadCV(cvId);
  if (tplParam) {
    const meta = getTemplateMeta(tplParam);
    if (meta.tier === 'pro' && !isProUser()) {
      showToast('That template needs CVGEN Pro — showing Professional instead', 'info');
      currentCV.template = 'professional';
    } else {
      currentCV.template = tplParam;
    }
  }

  renderBuilderTemplateSwitch();
  initProUpgradeModal();

  // Populate form fields from currentCV
  populateFormFromCV();
  renderExperienceEntries();
  renderEducationEntries();
  renderSkillChips();
  renderCertificationEntries();
  renderLanguageChips();
  renderReferenceEntries();
  setActiveTemplateSwitch();
  updatePreview();

  // Accordion behavior
  document.querySelectorAll('.accordion-head').forEach(head => {
    head.addEventListener('click', () => {
      head.parentElement.classList.toggle('open');
    });
  });
  // Open first section by default
  const firstSection = document.querySelector('.accordion-section');
  if (firstSection) firstSection.classList.add('open');

  // Live update on any input change within the form
  const formCol = document.getElementById('cvForm');
  formCol.addEventListener('input', () => { syncFormToCV(); updatePreview(); });
  formCol.addEventListener('change', () => { syncFormToCV(); updatePreview(); });

  // The CV name field lives in the top bar, outside the form column, so it needs its own listener
  const cvNameInput = document.getElementById('cvName');
  cvNameInput.addEventListener('input', () => { currentCV.name = cvNameInput.value.trim() || 'Untitled CV'; });

  // Photo upload + cropper
  const photoInput = document.getElementById('photoUpload');
  if (photoInput) {
    photoInput.addEventListener('change', handlePhotoUpload);
  }
  initPhotoCropper();
  const editPhotoBtn = document.getElementById('editPhotoBtn');
  if (editPhotoBtn) {
    editPhotoBtn.addEventListener('click', () => {
      const src = currentCV.personal.photoOriginal || currentCV.personal.photo;
      if (src) openPhotoCropper(src);
    });
  }

  // Add entry buttons
  document.getElementById('addExperienceBtn').addEventListener('click', addExperience);
  document.getElementById('addEducationBtn').addEventListener('click', addEducation);
  document.getElementById('addCertificationBtn').addEventListener('click', addCertification);
  document.getElementById('addReferenceBtn').addEventListener('click', addReference);
  document.getElementById('addSkillBtn').addEventListener('click', addSkill);
  document.getElementById('addLanguageBtn').addEventListener('click', addLanguage);

  // Template switch buttons in preview toolbar (rendered dynamically — see renderBuilderTemplateSwitch)

  // Action buttons
  document.getElementById('saveCVBtn').addEventListener('click', async () => {
    syncFormToCV();
    const progress = calculateProgress(currentCV);
    currentCV.status = progress >= 90 ? 'completed' : 'draft';

    const saveBtn = document.getElementById('saveCVBtn');
    const originalHTML = saveBtn.innerHTML;
    saveBtn.innerHTML = '<span class="spinner"></span> Saving...';
    saveBtn.disabled = true;

    currentCV = await saveCV(currentCV);

    saveBtn.innerHTML = originalHTML;
    saveBtn.disabled = false;
    showToast('CV saved successfully', 'success');

    // Reflect id in URL for subsequent saves
    const url = new URL(window.location);
    url.searchParams.set('id', currentCV.id);
    window.history.replaceState({}, '', url);
  });

  document.getElementById('downloadPDFBtn').addEventListener('click', downloadPDF);
  document.getElementById('printCVBtn').addEventListener('click', printCV);

  const templatesLink = document.getElementById('chooseTemplateLink');
  if (templatesLink) templatesLink.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById('templatesPanel').scrollIntoView({ behavior: 'smooth' });
  });

  if (getParam('autodownload') === '1') {
    setTimeout(downloadPDF, 600);
  }
}

function populateFormFromCV() {
  const p = currentCV.personal;
  document.getElementById('cvName').value = currentCV.name || '';
  document.getElementById('fullName').value = p.fullName || '';
  document.getElementById('profTitle').value = p.title || '';
  document.getElementById('email').value = p.email || '';
  document.getElementById('phone').value = p.phone || '';
  document.getElementById('location').value = p.location || '';
  document.getElementById('website').value = p.website || '';
  document.getElementById('linkedin').value = p.linkedin || '';
  document.getElementById('summary').value = currentCV.summary || '';
  if (p.photo) {
    const preview = document.getElementById('photoPreview');
    preview.innerHTML = '<img src="' + p.photo + '" alt="Profile photo">';
    const editBtn = document.getElementById('editPhotoBtn');
    if (editBtn) editBtn.style.display = 'inline-flex';
  }
}

function syncFormToCV() {
  currentCV.name = document.getElementById('cvName').value.trim() || 'Untitled CV';
  currentCV.personal.fullName = document.getElementById('fullName').value.trim();
  currentCV.personal.title = document.getElementById('profTitle').value.trim();
  currentCV.personal.email = document.getElementById('email').value.trim();
  currentCV.personal.phone = document.getElementById('phone').value.trim();
  currentCV.personal.location = document.getElementById('location').value.trim();
  currentCV.personal.website = document.getElementById('website').value.trim();
  currentCV.personal.linkedin = document.getElementById('linkedin').value.trim();
  currentCV.summary = document.getElementById('summary').value.trim();

  // Sync repeatable entries from DOM back into currentCV arrays
  syncExperienceFromDOM();
  syncEducationFromDOM();
  syncCertificationsFromDOM();
  syncReferencesFromDOM();
}

function handlePhotoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('Please upload a valid image file', 'error'); return; }
  const reader = new FileReader();
  reader.onload = function (ev) {
    openPhotoCropper(ev.target.result);
  };
  reader.readAsDataURL(file);
}

/* ---------------------------------------------------------
   PHOTO CROPPER — portrait crop with drag-to-pan & zoom
   --------------------------------------------------------- */
const CROP_VIEW_W = 260;   // on-screen crop frame, px (1:1 square)
const CROP_VIEW_H = 260;
const CROP_OUTPUT_W = 640; // exported photo resolution — square, well above the 500px minimum
const CROP_OUTPUT_H = 640;

const cropState = {
  naturalWidth: 0,
  naturalHeight: 0,
  baseScale: 1,   // scale at which the image just covers the crop frame
  zoom: 1,        // extra zoom multiplier from the slider (1.0 - 3.0)
  offsetX: 0,
  offsetY: 0,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  dragOffsetStartX: 0,
  dragOffsetStartY: 0
};

function openPhotoCropper(dataUrl) {
  const modal = document.getElementById('photoCropModal');
  const img = document.getElementById('cropImage');
  const slider = document.getElementById('cropZoomSlider');

  img.onload = () => {
    cropState.naturalWidth = img.naturalWidth;
    cropState.naturalHeight = img.naturalHeight;
    cropState.baseScale = Math.max(CROP_VIEW_W / img.naturalWidth, CROP_VIEW_H / img.naturalHeight);
    cropState.zoom = 1;
    slider.value = 100;
    centerCropImage();
    applyCropTransform();
  };
  img.src = dataUrl;
  modal.dataset.pendingPhoto = dataUrl;
  modal.classList.add('show');
}

function centerCropImage() {
  const scale = cropState.baseScale * cropState.zoom;
  const dispW = cropState.naturalWidth * scale;
  const dispH = cropState.naturalHeight * scale;
  cropState.offsetX = (CROP_VIEW_W - dispW) / 2;
  cropState.offsetY = (CROP_VIEW_H - dispH) / 2;
}

function clampCropOffsets() {
  const scale = cropState.baseScale * cropState.zoom;
  const dispW = cropState.naturalWidth * scale;
  const dispH = cropState.naturalHeight * scale;
  const minX = CROP_VIEW_W - dispW; // most negative allowed (right edge flush)
  const minY = CROP_VIEW_H - dispH;
  cropState.offsetX = Math.min(0, Math.max(minX, cropState.offsetX));
  cropState.offsetY = Math.min(0, Math.max(minY, cropState.offsetY));
}

function applyCropTransform() {
  const img = document.getElementById('cropImage');
  const scale = cropState.baseScale * cropState.zoom;
  img.style.width = (cropState.naturalWidth * scale) + 'px';
  img.style.height = (cropState.naturalHeight * scale) + 'px';
  img.style.transform = `translate(${cropState.offsetX}px, ${cropState.offsetY}px)`;
}

function initPhotoCropper() {
  const stage = document.getElementById('cropStage');
  const slider = document.getElementById('cropZoomSlider');
  const applyBtn = document.getElementById('cropApplyBtn');
  const cancelBtn = document.getElementById('cropCancelBtn');
  const modal = document.getElementById('photoCropModal');
  if (!stage) return; // cropper markup only exists on the builder page

  slider.addEventListener('input', () => {
    cropState.zoom = slider.value / 100;
    clampCropOffsets();
    applyCropTransform();
  });

  stage.addEventListener('pointerdown', (e) => {
    cropState.dragging = true;
    cropState.dragStartX = e.clientX;
    cropState.dragStartY = e.clientY;
    cropState.dragOffsetStartX = cropState.offsetX;
    cropState.dragOffsetStartY = cropState.offsetY;
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!cropState.dragging) return;
    cropState.offsetX = cropState.dragOffsetStartX + (e.clientX - cropState.dragStartX);
    cropState.offsetY = cropState.dragOffsetStartY + (e.clientY - cropState.dragStartY);
    clampCropOffsets();
    applyCropTransform();
  });
  const endDrag = () => { cropState.dragging = false; };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('pointerleave', endDrag);

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const nextVal = Math.min(300, Math.max(100, Number(slider.value) - e.deltaY * 0.2));
    slider.value = nextVal;
    cropState.zoom = nextVal / 100;
    clampCropOffsets();
    applyCropTransform();
  }, { passive: false });

  cancelBtn.addEventListener('click', () => {
    modal.classList.remove('show');
    const photoInput = document.getElementById('photoUpload');
    if (photoInput) photoInput.value = '';
  });

  applyBtn.addEventListener('click', () => {
    const img = document.getElementById('cropImage');
    const scale = cropState.baseScale * cropState.zoom;
    const cropX = -cropState.offsetX / scale;
    const cropY = -cropState.offsetY / scale;
    const cropW = CROP_VIEW_W / scale;
    const cropH = CROP_VIEW_H / scale;

    const canvas = document.createElement('canvas');
    canvas.width = CROP_OUTPUT_W;
    canvas.height = CROP_OUTPUT_H;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, CROP_OUTPUT_W, CROP_OUTPUT_H);
    const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.92);

    currentCV.personal.photo = croppedDataUrl;
    currentCV.personal.photoOriginal = modal.dataset.pendingPhoto || croppedDataUrl;
    document.getElementById('photoPreview').innerHTML = '<img src="' + croppedDataUrl + '" alt="Profile photo">';
    document.getElementById('editPhotoBtn').style.display = 'inline-flex';
    modal.classList.remove('show');
    updatePreview();
    showToast('Photo updated', 'success');
  });
}

/* ---- Experience ---- */
function addExperience() {
  currentCV.experience.push({ id: uid('exp'), title: '', company: '', location: '', start: '', end: '', description: '' });
  renderExperienceEntries();
  updatePreview();
}

function renderExperienceEntries() {
  const wrap = document.getElementById('experienceList');
  wrap.innerHTML = currentCV.experience.map((exp, i) => `
    <div class="repeat-entry" data-exp-id="${exp.id}">
      <div class="repeat-entry-head">
        <span>Experience ${i + 1}</span>
        <button type="button" class="remove-entry" onclick="removeExperience('${exp.id}')"><i class="fa-solid fa-trash"></i> Remove</button>
      </div>
      <div class="form-row">
        <div class="field no-icon"><label>Job Title</label><input type="text" data-field="title" value="${escapeHTML(exp.title)}" placeholder="Software Engineer"></div>
        <div class="field no-icon"><label>Company</label><input type="text" data-field="company" value="${escapeHTML(exp.company)}" placeholder="Acme Corp"></div>
      </div>
      <div class="form-row">
        <div class="field no-icon"><label>Location</label><input type="text" data-field="location" value="${escapeHTML(exp.location)}" placeholder="Lagos, Nigeria"></div>
        <div class="field no-icon"><label>Start Date</label><input type="month" data-field="start" value="${escapeHTML(exp.start)}"></div>
      </div>
      <div class="form-row single">
        <div class="field no-icon"><label>End Date</label><input type="month" data-field="end" value="${escapeHTML(exp.end)}" placeholder="Leave blank if current"></div>
      </div>
      <div class="field no-icon"><label>Description</label><textarea rows="3" data-field="description" placeholder="Describe your responsibilities and achievements...">${escapeHTML(exp.description)}</textarea></div>
    </div>`).join('') || '<p class="tag-muted">No work experience added yet.</p>';
}

function syncExperienceFromDOM() {
  document.querySelectorAll('[data-exp-id]').forEach(entryEl => {
    const id = entryEl.getAttribute('data-exp-id');
    const item = currentCV.experience.find(x => x.id === id);
    if (!item) return;
    entryEl.querySelectorAll('[data-field]').forEach(inputEl => {
      item[inputEl.getAttribute('data-field')] = inputEl.value;
    });
  });
}

function removeExperience(id) {
  currentCV.experience = currentCV.experience.filter(x => x.id !== id);
  renderExperienceEntries();
  updatePreview();
}

/* ---- Education ---- */
function addEducation() {
  currentCV.education.push({ id: uid('edu'), school: '', degree: '', field: '', start: '', end: '', description: '' });
  renderEducationEntries();
  updatePreview();
}

function renderEducationEntries() {
  const wrap = document.getElementById('educationList');
  wrap.innerHTML = currentCV.education.map((edu, i) => `
    <div class="repeat-entry" data-edu-id="${edu.id}">
      <div class="repeat-entry-head">
        <span>Education ${i + 1}</span>
        <button type="button" class="remove-entry" onclick="removeEducation('${edu.id}')"><i class="fa-solid fa-trash"></i> Remove</button>
      </div>
      <div class="form-row">
        <div class="field no-icon"><label>School / Institution</label><input type="text" data-field="school" value="${escapeHTML(edu.school)}" placeholder="University of Lagos"></div>
        <div class="field no-icon"><label>Degree / Qualification</label><input type="text" data-field="degree" value="${escapeHTML(edu.degree)}" placeholder="B.Sc."></div>
      </div>
      <div class="form-row">
        <div class="field no-icon"><label>Field of Study</label><input type="text" data-field="field" value="${escapeHTML(edu.field)}" placeholder="Computer Science"></div>
        <div class="field no-icon"><label>Start Date</label><input type="month" data-field="start" value="${escapeHTML(edu.start)}"></div>
      </div>
      <div class="form-row single">
        <div class="field no-icon"><label>End Date</label><input type="month" data-field="end" value="${escapeHTML(edu.end)}"></div>
      </div>
      <div class="field no-icon"><label>Description</label><textarea rows="2" data-field="description" placeholder="Notable achievements, honors...">${escapeHTML(edu.description)}</textarea></div>
    </div>`).join('') || '<p class="tag-muted">No education added yet.</p>';
}

function syncEducationFromDOM() {
  document.querySelectorAll('[data-edu-id]').forEach(entryEl => {
    const id = entryEl.getAttribute('data-edu-id');
    const item = currentCV.education.find(x => x.id === id);
    if (!item) return;
    entryEl.querySelectorAll('[data-field]').forEach(inputEl => {
      item[inputEl.getAttribute('data-field')] = inputEl.value;
    });
  });
}

function removeEducation(id) {
  currentCV.education = currentCV.education.filter(x => x.id !== id);
  renderEducationEntries();
  updatePreview();
}

/* ---- Skills ---- */
function addSkill() {
  const nameInput = document.getElementById('newSkillName');
  const levelInput = document.getElementById('newSkillLevel');
  const name = nameInput.value.trim();
  if (!name) { showToast('Please enter a skill name', 'error'); return; }
  currentCV.skills.push({ id: uid('skill'), name: name, level: levelInput.value });
  nameInput.value = '';
  renderSkillChips();
  updatePreview();
}

function renderSkillChips() {
  const wrap = document.getElementById('skillsChipList');
  wrap.innerHTML = currentCV.skills.map(s => `
    <div class="chip">
      <span>${escapeHTML(s.name)}</span>
      <span class="lvl">${escapeHTML(s.level)}</span>
      <span class="rm" onclick="removeSkill('${s.id}')"><i class="fa-solid fa-xmark"></i></span>
    </div>`).join('') || '<span class="tag-muted">No skills added yet.</span>';
}

function removeSkill(id) {
  currentCV.skills = currentCV.skills.filter(x => x.id !== id);
  renderSkillChips();
  updatePreview();
}

/* ---- Certifications ---- */
function addCertification() {
  currentCV.certifications.push({ id: uid('cert'), name: '', org: '', date: '' });
  renderCertificationEntries();
  updatePreview();
}

function renderCertificationEntries() {
  const wrap = document.getElementById('certificationsList');
  wrap.innerHTML = currentCV.certifications.map((c, i) => `
    <div class="repeat-entry" data-cert-id="${c.id}">
      <div class="repeat-entry-head">
        <span>Certification ${i + 1}</span>
        <button type="button" class="remove-entry" onclick="removeCertification('${c.id}')"><i class="fa-solid fa-trash"></i> Remove</button>
      </div>
      <div class="form-row">
        <div class="field no-icon"><label>Certification Name</label><input type="text" data-field="name" value="${escapeHTML(c.name)}" placeholder="AWS Certified Developer"></div>
        <div class="field no-icon"><label>Issuing Organization</label><input type="text" data-field="org" value="${escapeHTML(c.org)}" placeholder="Amazon Web Services"></div>
      </div>
      <div class="form-row single">
        <div class="field no-icon"><label>Date</label><input type="month" data-field="date" value="${escapeHTML(c.date)}"></div>
      </div>
    </div>`).join('') || '<p class="tag-muted">No certifications added yet.</p>';
}

function syncCertificationsFromDOM() {
  document.querySelectorAll('[data-cert-id]').forEach(entryEl => {
    const id = entryEl.getAttribute('data-cert-id');
    const item = currentCV.certifications.find(x => x.id === id);
    if (!item) return;
    entryEl.querySelectorAll('[data-field]').forEach(inputEl => {
      item[inputEl.getAttribute('data-field')] = inputEl.value;
    });
  });
}

function removeCertification(id) {
  currentCV.certifications = currentCV.certifications.filter(x => x.id !== id);
  renderCertificationEntries();
  updatePreview();
}

/* ---- Languages ---- */
function addLanguage() {
  const nameInput = document.getElementById('newLangName');
  const levelInput = document.getElementById('newLangLevel');
  const name = nameInput.value.trim();
  if (!name) { showToast('Please enter a language name', 'error'); return; }
  currentCV.languages.push({ id: uid('lang'), name: name, level: levelInput.value });
  nameInput.value = '';
  renderLanguageChips();
  updatePreview();
}

function renderLanguageChips() {
  const wrap = document.getElementById('languagesChipList');
  wrap.innerHTML = currentCV.languages.map(l => `
    <div class="chip">
      <span>${escapeHTML(l.name)}</span>
      <span class="lvl">${escapeHTML(l.level)}</span>
      <span class="rm" onclick="removeLanguage('${l.id}')"><i class="fa-solid fa-xmark"></i></span>
    </div>`).join('') || '<span class="tag-muted">No languages added yet.</span>';
}

function removeLanguage(id) {
  currentCV.languages = currentCV.languages.filter(x => x.id !== id);
  renderLanguageChips();
  updatePreview();
}

/* ---- References ---- */
function addReference() {
  currentCV.references.push({ id: uid('ref'), name: '', position: '', org: '', email: '', phone: '' });
  renderReferenceEntries();
  updatePreview();
}

function renderReferenceEntries() {
  const wrap = document.getElementById('referencesList');
  wrap.innerHTML = currentCV.references.map((r, i) => `
    <div class="repeat-entry" data-ref-id="${r.id}">
      <div class="repeat-entry-head">
        <span>Reference ${i + 1}</span>
        <button type="button" class="remove-entry" onclick="removeReference('${r.id}')"><i class="fa-solid fa-trash"></i> Remove</button>
      </div>
      <div class="form-row">
        <div class="field no-icon"><label>Name</label><input type="text" data-field="name" value="${escapeHTML(r.name)}" placeholder="Jane Doe"></div>
        <div class="field no-icon"><label>Job Position</label><input type="text" data-field="position" value="${escapeHTML(r.position)}" placeholder="Engineering Manager"></div>
      </div>
      <div class="form-row">
        <div class="field no-icon"><label>Organization</label><input type="text" data-field="org" value="${escapeHTML(r.org)}" placeholder="Acme Corp"></div>
        <div class="field no-icon"><label>Email</label><input type="email" data-field="email" value="${escapeHTML(r.email)}" placeholder="jane@acme.com"></div>
      </div>
      <div class="form-row single">
        <div class="field no-icon"><label>Phone</label><input type="tel" data-field="phone" value="${escapeHTML(r.phone)}" placeholder="+234..."></div>
      </div>
    </div>`).join('') || '<p class="tag-muted">No references added yet.</p>';
}

function syncReferencesFromDOM() {
  document.querySelectorAll('[data-ref-id]').forEach(entryEl => {
    const id = entryEl.getAttribute('data-ref-id');
    const item = currentCV.references.find(x => x.id === id);
    if (!item) return;
    entryEl.querySelectorAll('[data-field]').forEach(inputEl => {
      item[inputEl.getAttribute('data-field')] = inputEl.value;
    });
  });
}

function removeReference(id) {
  currentCV.references = currentCV.references.filter(x => x.id !== id);
  renderReferenceEntries();
  updatePreview();
}

/* ---------------------------------------------------------
   16. LIVE PREVIEW RENDERING
   --------------------------------------------------------- */
/** Builds the row of template-switch buttons in the builder's preview toolbar, gated by plan. */
function renderBuilderTemplateSwitch() {
  const wrap = document.getElementById('templateSwitchButtons');
  if (!wrap) return;

  wrap.innerHTML = TEMPLATE_CATALOG.map((tpl) => {
    const lockIcon = tpl.tier === 'pro' ? ' <i class="fa-solid fa-lock" style="font-size:.7em;"></i>' : '';
    return `<button type="button" data-template="${tpl.id}" data-tier="${tpl.tier}">${escapeHTML(tpl.name)}${lockIcon}</button>`;
  }).join('');

  wrap.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tplId = btn.getAttribute('data-template');
      const meta = getTemplateMeta(tplId);
      if (meta.tier === 'pro' && !isProUser()) {
        showProUpgradeModal();
        return;
      }
      currentCV.template = tplId;
      setActiveTemplateSwitch();
      updatePreview();
    });
  });

  setActiveTemplateSwitch();
}

function setActiveTemplateSwitch() {
  document.querySelectorAll('.template-switch button').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-template') === currentCV.template);
  });
}

function updatePreview() {
  const frame = document.getElementById('cvPreview');
  if (!frame) return;
  frame.className = 'cv-page tpl-' + currentCV.template;
  frame.innerHTML = renderTemplate(currentCV);

  const progress = calculateProgress(currentCV);
  const circumference = 169.6; // 2 * PI * r(27), matches stroke-dasharray in CSS
  const ringFill = document.getElementById('progressRingFill');
  const ringText = document.getElementById('progressRingText');
  const label = document.getElementById('progressLabel');
  if (ringFill) ringFill.style.strokeDashoffset = circumference - (circumference * progress) / 100;
  if (ringText) ringText.textContent = progress + '%';
  if (label) label.textContent = progress >= 100 ? 'All done!' : progress >= 90 ? 'Almost there' : 'Keep going';
}

function renderTemplate(cv) {
  const p = cv.personal;
  const photoHTML = p.photo ? `<img class="cv-avatar" src="${p.photo}" alt="${escapeHTML(p.fullName)}">` : `<div class="cv-avatar"></div>`;

  const contactsArr = [
    p.email ? `<span><i class="fa-solid fa-envelope"></i> ${escapeHTML(p.email)}</span>` : '',
    p.phone ? `<span><i class="fa-solid fa-phone"></i> ${escapeHTML(p.phone)}</span>` : '',
    p.location ? `<span><i class="fa-solid fa-location-dot"></i> ${escapeHTML(p.location)}</span>` : '',
    p.website ? `<span><i class="fa-solid fa-globe"></i> ${escapeHTML(p.website)}</span>` : '',
    p.linkedin ? `<span><i class="fa-brands fa-linkedin"></i> ${escapeHTML(p.linkedin)}</span>` : ''
  ].filter(Boolean).join('');

  const experienceHTML = cv.experience.map(e => `
    <div class="entry">
      <div class="entry-top"><span>${escapeHTML(e.title) || 'Job Title'}</span><span>${escapeHTML(e.start)} – ${escapeHTML(e.end) || 'Present'}</span></div>
      <div class="entry-sub">${escapeHTML(e.company)}${e.location ? ' — ' + escapeHTML(e.location) : ''}</div>
      <div class="entry-desc">${escapeHTML(e.description)}</div>
    </div>`).join('');

  const educationHTML = cv.education.map(e => `
    <div class="entry">
      <div class="entry-top"><span>${escapeHTML(e.degree) || 'Degree'}${e.field ? ', ' + escapeHTML(e.field) : ''}</span><span>${escapeHTML(e.start)} – ${escapeHTML(e.end) || 'Present'}</span></div>
      <div class="entry-sub">${escapeHTML(e.school)}</div>
      <div class="entry-desc">${escapeHTML(e.description)}</div>
    </div>`).join('');

  const skillsHTML = cv.skills.map(s => `<span class="skill-pill">${escapeHTML(s.name)} &middot; ${escapeHTML(s.level)}</span>`).join('');

  const certsHTML = cv.certifications.map(c => `<div class="entry"><div class="entry-top"><span>${escapeHTML(c.name)}</span><span>${escapeHTML(c.date)}</span></div><div class="entry-sub">${escapeHTML(c.org)}</div></div>`).join('');
  const langsHTML = cv.languages.map(l => `<p>${escapeHTML(l.name)} — ${escapeHTML(l.level)}</p>`).join('');
  const refsHTML = cv.references.map(r => `<div class="entry"><div class="entry-top"><span>${escapeHTML(r.name)}</span></div><div class="entry-sub">${escapeHTML(r.position)}${r.org ? ', ' + escapeHTML(r.org) : ''}</div><div class="entry-desc">${escapeHTML(r.email)} ${r.phone ? '· ' + escapeHTML(r.phone) : ''}</div></div>`).join('');

  const sectionsCommon = `
      ${cv.summary ? `<div class="cv-section"><h5>Summary</h5><p class="entry-desc">${escapeHTML(cv.summary)}</p></div>` : ''}
      ${cv.experience.length ? `<div class="cv-section"><h5>Work Experience</h5>${experienceHTML}</div>` : ''}
      ${cv.education.length ? `<div class="cv-section"><h5>Education</h5>${educationHTML}</div>` : ''}
      ${cv.certifications.length ? `<div class="cv-section"><h5>Certifications</h5>${certsHTML}</div>` : ''}
      ${cv.references.length ? `<div class="cv-section"><h5>References</h5>${refsHTML}</div>` : ''}
  `;

  if (cv.template === 'modern') {
    return `
      <div class="cv-inner">
        <div class="cv-side">
          ${photoHTML}
          <div class="cv-name">${escapeHTML(p.fullName) || 'Your Name'}</div>
          <div class="cv-title">${escapeHTML(p.title) || 'Professional Title'}</div>
          <div class="side-block"><h5>Contact</h5>
            ${p.email ? `<p><i class="fa-solid fa-envelope"></i> ${escapeHTML(p.email)}</p>` : ''}
            ${p.phone ? `<p><i class="fa-solid fa-phone"></i> ${escapeHTML(p.phone)}</p>` : ''}
            ${p.location ? `<p><i class="fa-solid fa-location-dot"></i> ${escapeHTML(p.location)}</p>` : ''}
            ${p.website ? `<p><i class="fa-solid fa-globe"></i> ${escapeHTML(p.website)}</p>` : ''}
            ${p.linkedin ? `<p><i class="fa-brands fa-linkedin"></i> ${escapeHTML(p.linkedin)}</p>` : ''}
          </div>
          ${cv.skills.length ? `<div class="side-block"><h5>Skills</h5>${skillsHTML}</div>` : ''}
          ${cv.languages.length ? `<div class="side-block"><h5>Languages</h5>${langsHTML}</div>` : ''}
        </div>
        <div class="cv-main">
          ${cv.summary ? `<div class="cv-section"><h5>Summary</h5><p class="entry-desc">${escapeHTML(cv.summary)}</p></div>` : ''}
          ${cv.experience.length ? `<div class="cv-section"><h5>Experience</h5>${experienceHTML}</div>` : ''}
          ${cv.education.length ? `<div class="cv-section"><h5>Education</h5>${educationHTML}</div>` : ''}
          ${cv.certifications.length ? `<div class="cv-section"><h5>Certifications</h5>${certsHTML}</div>` : ''}
          ${cv.references.length ? `<div class="cv-section"><h5>References</h5>${refsHTML}</div>` : ''}
        </div>
      </div>`;
  }

  if (cv.template === 'minimal') {
    return `
      <div class="cv-head">
        ${photoHTML}
        <div class="cv-name">${escapeHTML(p.fullName) || 'Your Name'}</div>
        <div class="cv-title">${escapeHTML(p.title) || 'Professional Title'}</div>
        <div class="cv-contacts">${contactsArr}</div>
      </div>
      ${sectionsCommon}
      ${cv.skills.length ? `<div class="cv-section"><h5>Skills</h5><div class="skills-grid">${cv.skills.map(s => escapeHTML(s.name)).join(' &nbsp;•&nbsp; ')}</div></div>` : ''}
      ${cv.languages.length ? `<div class="cv-section"><h5>Languages</h5><div class="skills-grid">${cv.languages.map(l => escapeHTML(l.name) + ' (' + escapeHTML(l.level) + ')').join(' &nbsp;•&nbsp; ')}</div></div>` : ''}
    `;
  }

  // default: professional
  return `
    <div class="cv-head">
      ${photoHTML}
      <div>
        <div class="cv-name">${escapeHTML(p.fullName) || 'Your Name'}</div>
        <div class="cv-title">${escapeHTML(p.title) || 'Professional Title'}</div>
        <div class="cv-contacts">${contactsArr}</div>
      </div>
    </div>
    ${sectionsCommon}
    ${cv.skills.length ? `<div class="cv-section"><h5>Skills</h5><div class="skills-grid">${skillsHTML}</div></div>` : ''}
    ${cv.languages.length ? `<div class="cv-section"><h5>Languages</h5>${langsHTML}</div>` : ''}
  `;
}

/* ---------------------------------------------------------
   17. PDF DOWNLOAD & PRINT
   --------------------------------------------------------- */
function downloadPDF() {
  syncFormToCV();
  const progressCheck = calculateProgress(currentCV);
  if (progressCheck === 0) {
    showToast('Please add some information before downloading', 'error');
    return;
  }

  const btn = document.getElementById('downloadPDFBtn');
  const originalHTML = btn.innerHTML;
  btn.innerHTML = '<span class="spinner"></span> Generating...';
  btn.disabled = true;

  // The live preview sits inside a scrollable, height-limited container
  // (.cv-preview-frame), and html2canvas also factors in the *page's* own
  // scroll position when it captures. Cloning the CV into an off-screen
  // wrapper avoids the container problem, but pushing it out with an
  // extreme offset (e.g. -99999px) breaks html2canvas's internal canvas
  // math — that's what was producing the blank/shifted exports. Instead,
  // keep the clone at normal on-screen coordinates (0,0) and simply make
  // it invisible to the user (near-zero opacity, sent behind the UI with a
  // negative z-index), and pin scrollX/scrollY/x/y to 0 explicitly so the
  // capture always starts from the clone's true top-left corner.
  const source = document.getElementById('cvPreview');
  const clone = source.cloneNode(true);
  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.top = '0';
  wrapper.style.left = '0';
  wrapper.style.width = '794px';
  wrapper.style.zIndex = '-1';
  wrapper.style.opacity = '0.01';
  wrapper.style.pointerEvents = 'none';
  wrapper.style.background = '#ffffff';
  clone.style.maxHeight = 'none';
  clone.style.overflow = 'visible';
  clone.style.width = '794px';
  clone.style.margin = '0';
  wrapper.appendChild(clone);
  document.body.appendChild(wrapper);

  const opt = {
    margin: 0,
    filename: 'My-CV.pdf',
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      windowWidth: 794,
      scrollX: 0,
      scrollY: 0,
      x: 0,
      y: 0
    },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
  };

  html2pdf().set(opt).from(clone).save().then(async () => {
    document.body.removeChild(wrapper);
    btn.innerHTML = originalHTML;
    btn.disabled = false;
    showToast('PDF downloaded successfully', 'success');
    currentCV = await saveCV(currentCV);
  }).catch((err) => {
    console.error(err);
    if (wrapper.parentNode) document.body.removeChild(wrapper);
    btn.innerHTML = originalHTML;
    btn.disabled = false;
    showToast('Something went wrong generating the PDF', 'error');
  });
}

function printCV() {
  syncFormToCV();
  window.print();
}

/* ---------------------------------------------------------
   18. GLOBAL INIT (runs on every page)
   --------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', async () => {
  initMobileNav();
  initFadeInObserver();

  // Defensive catch-all: if we've landed anywhere with a fresh sign-in
  // token in the URL — e.g. Supabase's OAuth redirect fell back to the
  // project's default Site URL instead of the exact page the app asked
  // for — finish establishing the session here and send the person to
  // their dashboard, instead of stranding them wherever they landed.
  const page = document.body.getAttribute('data-page');
  if (window.location.hash.includes('access_token') && page !== 'dashboard') {
    const user = await getSupabaseSessionUser();
    if (user) {
      window.location.href = 'dashboard.html';
      return;
    }
  }

  // Logout works from any page that has a .logout-trigger element (sidebar, settings row, etc.)
  document.querySelectorAll('.logout-trigger').forEach(el => {
    el.addEventListener('click', async (e) => { e.preventDefault(); await logoutUser(); });
  });

  switch (page) {
    case 'landing': break; // no auth-bound logic needed
    case 'register': await initRegisterPage(); break;
    case 'login': await initLoginPage(); break;
    case 'dashboard': await initDashboardPage(); break;
    case 'builder': await initBuilderPage(); break;
    case 'templates': await initTemplatesPage(); break;
    case 'ai-builder': await initAiBuilderPage(); break;
    case 'pro': await initProPage(); break;
    case 'mycvs': await initMyCVsPage(); break;
    case 'profile': await initProfilePage(); break;
    case 'settings': await initSettingsPage(); break;
    default: break;
  }
});
