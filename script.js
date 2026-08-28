/* =========================================================
   CVGEN — script.js
   All application logic (vanilla JS, localStorage powered)
   ========================================================= */

/* ---------------------------------------------------------
   0. STORAGE KEYS & HELPERS
   --------------------------------------------------------- */
const STORAGE_KEYS = {
  USERS: 'cvgen_users',
  SESSION: 'cvgen_session',
  CVS_PREFIX: 'cvgen_cvs_',       // + email
  SETTINGS_PREFIX: 'cvgen_settings_' // + email
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

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
   1. AUTHENTICATION
   --------------------------------------------------------- */
function getUsers() {
  return readJSON(STORAGE_KEYS.USERS, []);
}

function getSession() {
  return readJSON(STORAGE_KEYS.SESSION, null);
}

function isLoggedIn() {
  const s = getSession();
  return !!(s && s.isLoggedIn && s.email);
}

function getCurrentUser() {
  const s = getSession();
  if (!s || !s.email) return null;
  return getUsers().find(u => u.email.toLowerCase() === s.email.toLowerCase()) || null;
}

/** Registers a new user. Returns {success, message} */
function registerUser(name, email, password) {
  const users = getUsers();
  const exists = users.some(u => u.email.toLowerCase() === email.toLowerCase());
  if (exists) {
    return { success: false, message: 'An account with this email already exists.' };
  }
  const newUser = {
    id: uid('user'),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    password: password, // demo only — never store plain-text passwords in production
    createdAt: new Date().toISOString()
  };
  users.push(newUser);
  writeJSON(STORAGE_KEYS.USERS, users);
  return { success: true, message: 'Account created successfully!' };
}

/** Attempts login. Returns {success, message} */
function loginUser(email, password) {
  const users = getUsers();
  const user = users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());
  if (!user || user.password !== password) {
    return { success: false, message: 'Invalid email or password.' };
  }
  writeJSON(STORAGE_KEYS.SESSION, { email: user.email, isLoggedIn: true, loginAt: new Date().toISOString() });
  return { success: true, message: 'Welcome back!' };
}

function logoutUser() {
  localStorage.removeItem(STORAGE_KEYS.SESSION);
  window.location.href = 'index.html';
}

/** Guards protected pages. Call at top of protected pages. */
function requireAuth() {
  if (!isLoggedIn()) {
    window.location.href = 'login.html';
  }
}

/** Redirects away from login/register if already logged in. */
function redirectIfLoggedIn() {
  if (isLoggedIn()) {
    window.location.href = 'dashboard.html';
  }
}

/* ---------------------------------------------------------
   2. CV DATA MODEL
   --------------------------------------------------------- */
function cvsKey() {
  const user = getCurrentUser();
  return STORAGE_KEYS.CVS_PREFIX + (user ? user.email : 'guest');
}

function getAllCVs() {
  return readJSON(cvsKey(), []);
}

function getCVById(id) {
  return getAllCVs().find(c => c.id === id) || null;
}

function blankCV() {
  return {
    id: uid('cv'),
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

/** Saves (creates or updates) a CV. Returns the saved CV. */
function saveCV(cvData) {
  const all = getAllCVs();
  cvData.lastEdited = new Date().toISOString();
  const idx = all.findIndex(c => c.id === cvData.id);
  if (idx >= 0) {
    all[idx] = cvData;
  } else {
    all.push(cvData);
  }
  writeJSON(cvsKey(), all);
  return cvData;
}

/** Loads a CV by id, or returns a blank one if no id supplied. */
function loadCV(id) {
  if (!id) return blankCV();
  return getCVById(id) || blankCV();
}

function deleteCV(id) {
  const all = getAllCVs().filter(c => c.id !== id);
  writeJSON(cvsKey(), all);
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
  const key = STORAGE_KEYS.SETTINGS_PREFIX + (user ? user.email : 'guest');
  return readJSON(key, { darkMode: false, animations: true });
}

function saveSettings(settings) {
  const user = getCurrentUser();
  const key = STORAGE_KEYS.SETTINGS_PREFIX + (user ? user.email : 'guest');
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
function initRegisterPage() {
  redirectIfLoggedIn();
  const form = document.getElementById('registerForm');
  if (!form) return;

  form.addEventListener('submit', function (e) {
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

    const result = registerUser(name, email, password);
    const alertBox = document.getElementById('registerAlert');
    if (result.success) {
      alertBox.className = 'alert alert-success show';
      alertBox.innerHTML = '<i class="fa-solid fa-circle-check"></i> ' + result.message;
      form.reset();
      setTimeout(() => { window.location.href = 'login.html'; }, 1400);
    } else {
      alertBox.className = 'alert alert-error show';
      alertBox.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> ' + result.message;
    }
  });

  initPasswordToggles();
}

/* =========================================================
   9. PAGE INIT: LOGIN
   ========================================================= */
function initLoginPage() {
  redirectIfLoggedIn();
  const form = document.getElementById('loginForm');
  if (!form) return;

  form.addEventListener('submit', function (e) {
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

    const result = loginUser(email, password);
    if (result.success) {
      alertBox.className = 'alert alert-success show';
      alertBox.innerHTML = '<i class="fa-solid fa-circle-check"></i> ' + result.message;
      setTimeout(() => { window.location.href = 'dashboard.html'; }, 500);
    } else {
      alertBox.className = 'alert alert-error show';
      alertBox.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> ' + result.message;
    }
  });

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
function initDashboardPage() {
  requireAuth();
  applySettings();
  initSidebar();
  populateSidebarUser();

  const user = getCurrentUser();
  const greetEl = document.getElementById('greetName');
  if (greetEl && user) greetEl.textContent = user.name.split(' ')[0];

  const cvs = getAllCVs();
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
      }, () => {
        deleteCV(id);
        showToast('CV deleted successfully', 'success');
        initDashboardPage();
        if (typeof initMyCVsPage === 'function' && document.getElementById('allCVsGrid')) initMyCVsPage();
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
function initMyCVsPage() {
  requireAuth();
  applySettings();
  initSidebar();
  populateSidebarUser();
  const cvs = getAllCVs();
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
      }, () => {
        deleteCV(id);
        showToast('CV deleted successfully', 'success');
        initMyCVsPage();
      });
    });
  });

}

/* =========================================================
   12. PAGE INIT: PROFILE
   ========================================================= */
function initProfilePage() {
  requireAuth();
  applySettings();
  initSidebar();
  populateSidebarUser();

  const user = getCurrentUser();
  if (!user) return;
  document.getElementById('profileName').value = user.name;
  document.getElementById('profileEmail').value = user.email;
  document.getElementById('profileCreated').textContent = formatDate(user.createdAt);
  document.getElementById('profileInitial').textContent = user.name.trim().charAt(0).toUpperCase();

  const form = document.getElementById('profileForm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const newName = document.getElementById('profileName').value.trim();
    if (!newName) { showToast('Name cannot be empty', 'error'); return; }
    const users = getUsers();
    const idx = users.findIndex(u => u.email === user.email);
    if (idx >= 0) {
      users[idx].name = newName;
      writeJSON(STORAGE_KEYS.USERS, users);
      showToast('Profile updated successfully', 'success');
      populateSidebarUser();
      document.getElementById('profileInitial').textContent = newName.trim().charAt(0).toUpperCase();
    }
  });

}

/* =========================================================
   13. PAGE INIT: SETTINGS
   ========================================================= */
function initSettingsPage() {
  requireAuth();
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
    }, () => {
      writeJSON(cvsKey(), []);
      showToast('All CV data cleared', 'success');
    });
  });

}

/* =========================================================
   14. PAGE INIT: TEMPLATES GALLERY
   ========================================================= */
function initTemplatesPage() {
  requireAuth();
  applySettings();
  initSidebar();
  populateSidebarUser();

  document.querySelectorAll('[data-select-template]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tpl = btn.getAttribute('data-select-template');
      window.location.href = 'cv-builder.html?template=' + encodeURIComponent(tpl);
    });
  });

}

/* =========================================================
   15. PAGE INIT: CV BUILDER  (core of the application)
   ========================================================= */
let currentCV = null;

function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function initBuilderPage() {
  requireAuth();
  applySettings();
  initSidebar();
  populateSidebarUser();

  const cvId = getParam('id');
  const tplParam = getParam('template');
  currentCV = loadCV(cvId);
  if (tplParam) currentCV.template = tplParam;

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

  // Template switch buttons in preview toolbar
  document.querySelectorAll('.template-switch button').forEach(btn => {
    btn.addEventListener('click', () => {
      currentCV.template = btn.getAttribute('data-template');
      setActiveTemplateSwitch();
      updatePreview();
    });
  });

  // Action buttons
  document.getElementById('saveCVBtn').addEventListener('click', () => {
    syncFormToCV();
    const progress = calculateProgress(currentCV);
    currentCV.status = progress >= 90 ? 'completed' : 'draft';
    saveCV(currentCV);
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
const CROP_VIEW_W = 225;   // on-screen crop frame, px (3:4 portrait)
const CROP_VIEW_H = 300;
const CROP_OUTPUT_W = 450; // exported photo resolution, same 3:4 ratio
const CROP_OUTPUT_H = 600;

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

  html2pdf().set(opt).from(clone).save().then(() => {
    document.body.removeChild(wrapper);
    btn.innerHTML = originalHTML;
    btn.disabled = false;
    showToast('PDF downloaded successfully', 'success');
    saveCV(currentCV);
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
document.addEventListener('DOMContentLoaded', () => {
  initMobileNav();
  initFadeInObserver();

  // Logout works from any page that has a .logout-trigger element (sidebar, settings row, etc.)
  document.querySelectorAll('.logout-trigger').forEach(el => {
    el.addEventListener('click', (e) => { e.preventDefault(); logoutUser(); });
  });

  const page = document.body.getAttribute('data-page');
  switch (page) {
    case 'landing': break; // no auth-bound logic needed
    case 'register': initRegisterPage(); break;
    case 'login': initLoginPage(); break;
    case 'dashboard': initDashboardPage(); break;
    case 'builder': initBuilderPage(); break;
    case 'templates': initTemplatesPage(); break;
    case 'mycvs': initMyCVsPage(); break;
    case 'profile': initProfilePage(); break;
    case 'settings': initSettingsPage(); break;
    default: break;
  }
});
