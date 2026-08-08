/* ==========================================================================
   MINDRA — vanilla JS
   ========================================================================== */

(() => {
  'use strict';

  const API_URL = 'https://mindra-wjcg.onrender.com/predict';

  const LOADING_MESSAGES = [
    'Looking at your lifestyle patterns',
    'Analyzing sleep & activity',
    'Processing your responses',
    'Preparing your result',
  ];

  // score → interpretation buckets. The model returns a score on a 0-10
  // scale. Thresholds are UI framing only, not clinically validated
  // categories — see disclaimer in the result modal.
  const SCORE_MAX = 10;
  const SCORE_STATES = [
    { max: 3.9, label: 'Concerning range', color: '#8C3F27', bg: '#F3DCCB',
      note: "Your recent patterns point to real strain. It may help to lean on people around you and revisit sleep, movement or screen time first." },
    { max: 5.9, label: 'Needs attention', color: '#C98A3E', bg: '#F6E7D2',
      note: 'A few areas look stretched thin. Small, steady changes to sleep or downtime tend to move this the most.' },
    { max: 7.9, label: 'Moderate — healthy range', color: '#7C8863', bg: '#E6EADA',
      note: 'Overall your habits look fairly balanced, with some room to fine-tune where your energy is going.' },
    { max: 10, label: 'Strong', color: '#4F5B3E', bg: '#DCE4CC',
      note: "Your current rhythm looks well-balanced across rest, focus and activity. Worth noticing what's working." },
  ];

  const GAUGE_RADIUS = 86;
  const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;

  const els = {};
  let lastFormData = null;
  let loadingIntervalId = null;
  let lastFocusedEl = null;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    cacheEls();
    initNavbar();
    initSliders();
    initForm();
    initModal();
    initToast();
  }

  function cacheEls() {
    els.navbar = document.getElementById('navbar');
    els.navToggle = document.getElementById('navToggle');
    els.mobileMenu = document.getElementById('mobileMenu');

    els.form = document.getElementById('predictForm');
    els.submitBtn = document.getElementById('submitBtn');

    els.loadingOverlay = document.getElementById('loadingOverlay');
    els.loadingMessage = document.getElementById('loadingMessage');

    els.resultModal = document.getElementById('resultModal');
    els.resultClose = document.getElementById('resultClose');
    els.editResponses = document.getElementById('editResponses');
    els.tryAgain = document.getElementById('tryAgain');
    els.scoreNumber = document.getElementById('scoreNumber');
    els.gaugeArc = document.getElementById('gaugeArc');
    els.resultState = document.getElementById('resultState');
    els.resultNote = document.getElementById('resultNote');

    els.errorToast = document.getElementById('errorToast');
    els.toastTitle = document.getElementById('toastTitle');
    els.toastMessage = document.getElementById('toastMessage');
    els.toastRetry = document.getElementById('toastRetry');
    els.toastClose = document.getElementById('toastClose');
  }

  /* ---------------------------------------------------------------------
     Navbar
     --------------------------------------------------------------------- */
  function initNavbar() {
    window.addEventListener('scroll', () => {
      els.navbar.classList.toggle('is-scrolled', window.scrollY > 12);
    }, { passive: true });

    els.navToggle.addEventListener('click', () => {
      const isOpen = els.mobileMenu.classList.toggle('is-open');
      els.navToggle.setAttribute('aria-expanded', String(isOpen));
      els.navToggle.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
    });

    els.mobileMenu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => closeMobileMenu());
    });
  }

  function closeMobileMenu() {
    els.mobileMenu.classList.remove('is-open');
    els.navToggle.setAttribute('aria-expanded', 'false');
    els.navToggle.setAttribute('aria-label', 'Open menu');
  }

  /* ---------------------------------------------------------------------
     Sliders
     --------------------------------------------------------------------- */
  function initSliders() {
    document.querySelectorAll('.slider input[type="range"]').forEach((input) => {
      updateSlider(input);
      input.addEventListener('input', () => updateSlider(input));
    });
  }

  function updateSlider(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    const pct = ((value - min) / (max - min)) * 100;

    input.closest('.slider').style.setProperty('--pct', pct + '%');

    const output = document.getElementById(input.id + '-value');
    if (output) {
      const rounded = Math.round(value * 10) / 10;
      const unit = rounded === 1 ? 'hr' : 'hrs';
      output.textContent = `${rounded} ${unit}`;
    }
  }

  /* ---------------------------------------------------------------------
     Form: validation, collection, submission
     --------------------------------------------------------------------- */
  function initForm() {
    els.form.addEventListener('submit', (event) => {
      event.preventDefault();
      handleSubmit();
    });

    // Clear a field's error the moment the person fixes it.
    els.form.addEventListener('input', (event) => {
      const field = event.target.closest('[name]');
      if (field) clearFieldError(field.name);
    });
    els.form.addEventListener('change', (event) => {
      const field = event.target.closest('[name]');
      if (field) clearFieldError(field.name);
    });
  }

  async function handleSubmit() {
    const errors = validateForm();
    if (errors.length) {
      applyErrors(errors);
      const firstField = document.getElementById(errors[0].id) ||
        els.form.querySelector(`[name="${errors[0].name}"]`);
      if (firstField) firstField.focus();
      return;
    }

    const data = collectFormData();
    lastFormData = data;
    await submitPrediction(data);
  }

  function validateForm() {
    const errors = [];
    const fd = new FormData(els.form);

    const age = fd.get('age');
    if (age === null || age === '' || Number(age) < 10 || Number(age) > 100 || !Number.isFinite(Number(age))) {
      errors.push({ name: 'age', id: 'age', message: 'Enter an age between 10 and 100.' });
    }

    if (!fd.get('gender')) {
      errors.push({ name: 'gender', id: 'gender-male', message: 'Please select a gender.' });
    }

    if (!fd.get('country')) {
      errors.push({ name: 'country', id: 'country', message: 'Please select your country.' });
    }

    if (!fd.get('academic_level')) {
      errors.push({ name: 'academic_level', id: 'acad-hs', message: 'Please select your academic level.' });
    }

    if (!fd.get('most_used_platform')) {
      errors.push({ name: 'most_used_platform', id: 'platform', message: 'Please choose a platform.' });
    }

    if (!fd.get('purpose_of_use')) {
      errors.push({ name: 'purpose_of_use', id: 'purpose-net', message: 'Please select a purpose.' });
    }

    const unlocks = fd.get('daily_unlocks');
    if (unlocks === null || unlocks === '' || Number(unlocks) < 0 || !Number.isFinite(Number(unlocks))) {
      errors.push({ name: 'daily_unlocks', id: 'unlocks', message: 'Enter a number of 0 or more.' });
    }

    if (!fd.get('stress_level')) {
      errors.push({ name: 'stress_level', id: 'stress-low', message: 'Please select your stress level.' });
    }

    // Slider values (usage/study/activity/sleep) are constrained to 0–24 by
    // the range input itself, so no separate check is needed for them.

    return errors;
  }

  function applyErrors(errors) {
    errors.forEach(({ name, message }) => {
      const errorEl = document.getElementById(`${name}-error`);
      if (errorEl) errorEl.textContent = message;

      const control = els.form.querySelector(`[name="${name}"]`);
      if (control && (control.tagName === 'INPUT' && control.type === 'number' || control.tagName === 'SELECT')) {
        control.classList.add('is-invalid');
      }
    });
  }

  function clearFieldError(name) {
    const errorEl = document.getElementById(`${name}-error`);
    if (errorEl) errorEl.textContent = '';
    const control = els.form.querySelector(`[name="${name}"]`);
    if (control) control.classList.remove('is-invalid');
  }

  function collectFormData() {
    const fd = new FormData(els.form);
    return {
      age: parseInt(fd.get('age'), 10),
      gender: fd.get('gender'),
      country: fd.get('country'),
      academic_level: fd.get('academic_level'),
      most_used_platform: fd.get('most_used_platform'),
      purpose_of_use: fd.get('purpose_of_use'),
      avg_daily_usage_hours: parseFloat(fd.get('avg_daily_usage_hours')),
      daily_unlocks: parseInt(fd.get('daily_unlocks'), 10),
      study_hours: parseFloat(fd.get('study_hours')),
      physical_activity_hours: parseFloat(fd.get('physical_activity_hours')),
      sleep_hours_per_night: parseFloat(fd.get('sleep_hours_per_night')),
      stress_level: fd.get('stress_level'),
    };
  }

  async function submitPrediction(data) {
    setSubmitting(true);
    showLoading();

    let response;
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    } catch (networkError) {
      hideLoading();
      setSubmitting(false);
      showError('network');
      return;
    }

    if (!response.ok) {
      hideLoading();
      setSubmitting(false);
      showError(response.status === 422 ? 'validation' : 'server');
      return;
    }

    let payload;
    try {
      payload = await response.json();
    } catch (parseError) {
      hideLoading();
      setSubmitting(false);
      showError('server');
      return;
    }

    const score = Number(payload.predicted_mental_health_score);
    if (!Number.isFinite(score)) {
      hideLoading();
      setSubmitting(false);
      showError('server');
      return;
    }

    hideLoading();
    setSubmitting(false);
    showResult(score, data);
  }

  function setSubmitting(isSubmitting) {
    els.submitBtn.disabled = isSubmitting;
    els.submitBtn.classList.toggle('is-loading', isSubmitting);
  }

  /* ---------------------------------------------------------------------
     Loading overlay
     --------------------------------------------------------------------- */
  function showLoading() {
    els.loadingOverlay.hidden = false;
    let index = 0;
    els.loadingMessage.textContent = LOADING_MESSAGES[0];

    loadingIntervalId = window.setInterval(() => {
      index = (index + 1) % LOADING_MESSAGES.length;
      els.loadingMessage.style.opacity = '0';
      window.setTimeout(() => {
        els.loadingMessage.textContent = LOADING_MESSAGES[index];
        els.loadingMessage.style.opacity = '1';
      }, 220);
    }, 1500);
  }

  function hideLoading() {
    els.loadingOverlay.hidden = true;
    if (loadingIntervalId) {
      window.clearInterval(loadingIntervalId);
      loadingIntervalId = null;
    }
  }

  /* ---------------------------------------------------------------------
     Result modal
     --------------------------------------------------------------------- */
  function getScoreState(score) {
    const clamped = Math.max(0, Math.min(SCORE_MAX, score));
    return SCORE_STATES.find((state) => clamped <= state.max) || SCORE_STATES[SCORE_STATES.length - 1];
  }

  function showResult(score, data) {
    const clamped = Math.max(0, Math.min(SCORE_MAX, score));
    const state = getScoreState(clamped);

    els.gaugeArc.style.stroke = state.color;
    const offset = GAUGE_CIRCUMFERENCE * (1 - clamped / SCORE_MAX);
    // Force reflow so the transition runs from the current (full) offset.
    void els.gaugeArc.getBoundingClientRect();
    els.gaugeArc.style.strokeDashoffset = String(offset);

    els.resultState.textContent = state.label;
    els.resultState.style.background = state.bg;
    els.resultState.style.color = state.color;
    els.resultNote.textContent = state.note;

    document.getElementById('bd-sleep').textContent = `${data.sleep_hours_per_night}h sleep`;
    document.getElementById('bd-study').textContent = `${data.study_hours}h study`;
    document.getElementById('bd-activity').textContent = `${data.physical_activity_hours}h activity`;
    document.getElementById('bd-screen').textContent = `${data.avg_daily_usage_hours}h screen`;
    document.getElementById('bd-stress').textContent = `${data.stress_level} stress`;

    animateScore(score);
    openModal(els.resultModal);
  }

  function animateScore(target) {
    const duration = 1100;
    const start = performance.now();
    const from = 0;

    function tick(now) {
      const elapsed = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - elapsed, 3); // ease-out cubic
      const current = from + (target - from) * eased;
      els.scoreNumber.textContent = elapsed < 1 ? current.toFixed(1) : target.toFixed(2);
      if (elapsed < 1) requestAnimationFrame(tick);
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      els.scoreNumber.textContent = target.toFixed(2);
      return;
    }
    requestAnimationFrame(tick);
  }

  function initModal() {
    els.resultClose.addEventListener('click', () => closeModal(els.resultModal));
    els.resultModal.addEventListener('click', (event) => {
      if (event.target === els.resultModal) closeModal(els.resultModal);
    });

    els.editResponses.addEventListener('click', () => {
      closeModal(els.resultModal);
      scrollToForm();
    });

    els.tryAgain.addEventListener('click', () => {
      closeModal(els.resultModal);
      resetForm();
      scrollToForm();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !els.resultModal.hidden) closeModal(els.resultModal);
    });
  }

  function openModal(modalEl) {
    lastFocusedEl = document.activeElement;
    modalEl.hidden = false;
    trapFocus(modalEl);
    const closeBtn = modalEl.querySelector('.modal__close');
    if (closeBtn) closeBtn.focus();
  }

  function closeModal(modalEl) {
    modalEl.hidden = true;
    if (lastFocusedEl) lastFocusedEl.focus();
  }

  function scrollToForm() {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('predict').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  function trapFocus(container) {
    const focusable = container.querySelectorAll(
      'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    container.addEventListener('keydown', function handler(event) {
      if (event.key !== 'Tab' || container.hidden) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }

  /* ---------------------------------------------------------------------
     Error toast
     --------------------------------------------------------------------- */
  const TOAST_COPY = {
    network: {
      title: "We couldn't reach the prediction engine.",
      message: 'Please make sure the FastAPI server is running at 127.0.0.1:8000 and try again.',
    },
    server: {
      title: 'Something went wrong on our end.',
      message: 'The prediction server responded unexpectedly. Please try again in a moment.',
    },
    validation: {
      title: "Your answers couldn't be processed.",
      message: 'Please double-check your responses and try again.',
    },
  };

  function initToast() {
    els.toastClose.addEventListener('click', hideError);
    els.toastRetry.addEventListener('click', async () => {
      hideError();
      if (lastFormData) await submitPrediction(lastFormData);
    });
  }

  function showError(type) {
    const copy = TOAST_COPY[type] || TOAST_COPY.server;
    els.toastTitle.textContent = copy.title;
    els.toastMessage.textContent = copy.message;
    els.errorToast.hidden = false;
  }

  function hideError() {
    els.errorToast.hidden = true;
  }

  /* ---------------------------------------------------------------------
     Reset
     --------------------------------------------------------------------- */
  function resetForm() {
    els.form.reset();
    els.form.querySelectorAll('.is-invalid').forEach((el) => el.classList.remove('is-invalid'));
    els.form.querySelectorAll('.field__error').forEach((el) => { el.textContent = ''; });
    document.querySelectorAll('.slider input[type="range"]').forEach((input) => updateSlider(input));
  }

})();