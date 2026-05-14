/* ═══════════════════════════════════════════════════════
   Focus Theme Engine — Anime/Wuxia Premium Overlay
   Reads from themeStore_v1 localStorage (set by theme-store.html)
   Applies dynamic theme to existing Pomodoro Focus tab.
   Does NOT modify script.js.
   ═══════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── THEME DEFINITIONS ──────────────────────────────────────────
     IDs 0-7 match the selectedId in themeStore_v1 (theme-store.html)
  ────────────────────────────────────────────────────────────────── */
  const FOCUS_THEMES = [
    {
      id: 0, name: 'Celestial Warrior', rarity: 'legendary',
      accentColor: '#ff7a1a', accentDim: 'rgba(255,122,26,0.18)',
      accentGlow: 'rgba(255,122,26,0.45)', accentDark: '#cc5500',
      ringGlow:   'rgba(255,122,26,0.55)',
      bgGradient: 'radial-gradient(ellipse 90% 70% at 15% 50%, rgba(255,122,26,0.1) 0%, transparent 55%), radial-gradient(ellipse 60% 60% at 80% 30%, rgba(120,40,200,0.08) 0%, transparent 55%), linear-gradient(160deg,#08041e 0%,#180a3a 50%,#05020e 100%)',
      particleColor: [255, 122, 26],
      particleType: 'sparks',
      charEmoji: '⚔️',
      charBg: 'radial-gradient(ellipse at center, rgba(255,122,26,0.3) 0%, transparent 70%)',
      workDuration: 25, shortBreak: 5, longBreak: 15,
      locked: false, purchased: true,
    },
    {
      id: 1, name: 'Shadow Monk', rarity: 'epic',
      accentColor: '#6677ff', accentDim: 'rgba(102,119,255,0.18)',
      accentGlow: 'rgba(102,119,255,0.45)', accentDark: '#3344cc',
      ringGlow:   'rgba(102,119,255,0.55)',
      bgGradient: 'radial-gradient(ellipse 80% 60% at 20% 40%, rgba(80,100,255,0.1) 0%, transparent 55%), radial-gradient(ellipse 60% 60% at 75% 60%, rgba(40,20,120,0.1) 0%, transparent 55%), linear-gradient(160deg,#02020f 0%,#08082a 50%,#010108 100%)',
      particleColor: [102, 119, 255],
      particleType: 'glyphs',
      charEmoji: '🥷',
      charBg: 'radial-gradient(ellipse at center, rgba(80,100,255,0.3) 0%, transparent 70%)',
      workDuration: 30, shortBreak: 5, longBreak: 20,
      locked: false, purchased: true,
    },
    {
      id: 2, name: 'Dragon Sage', rarity: 'epic',
      accentColor: '#22cc66', accentDim: 'rgba(34,204,102,0.16)',
      accentGlow: 'rgba(34,204,102,0.4)', accentDark: '#158840',
      ringGlow:   'rgba(34,204,102,0.5)',
      bgGradient: 'radial-gradient(ellipse 80% 60% at 20% 50%, rgba(40,200,80,0.09) 0%, transparent 55%), radial-gradient(ellipse 55% 55% at 75% 65%, rgba(0,80,30,0.1) 0%, transparent 55%), linear-gradient(160deg,#010802 0%,#061808 50%,#010402 100%)',
      particleColor: [34, 204, 102],
      particleType: 'leaves',
      charEmoji: '🐉',
      charBg: 'radial-gradient(ellipse at center, rgba(34,200,80,0.28) 0%, transparent 70%)',
      workDuration: 25, shortBreak: 5, longBreak: 15,
      locked: false, purchased: false,
    },
    {
      id: 3, name: 'Phoenix Scholar', rarity: 'rare',
      accentColor: '#ff4422', accentDim: 'rgba(255,68,34,0.16)',
      accentGlow: 'rgba(255,68,34,0.42)', accentDark: '#cc2200',
      ringGlow:   'rgba(255,68,34,0.52)',
      bgGradient: 'radial-gradient(ellipse 85% 60% at 15% 40%, rgba(255,100,0,0.12) 0%, transparent 55%), radial-gradient(ellipse 55% 55% at 80% 70%, rgba(150,20,0,0.1) 0%, transparent 55%), linear-gradient(160deg,#0e0200 0%,#200600 50%,#080100 100%)',
      particleColor: [255, 68, 34],
      particleType: 'embers',
      charEmoji: '🔥',
      charBg: 'radial-gradient(ellipse at center, rgba(255,80,0,0.32) 0%, transparent 70%)',
      workDuration: 25, shortBreak: 5, longBreak: 15,
      locked: false, purchased: false,
    },
    {
      id: 4, name: 'Void Emperor', rarity: 'legendary',
      accentColor: '#cc00ff', accentDim: 'rgba(200,0,255,0.15)',
      accentGlow: 'rgba(200,0,255,0.4)', accentDark: '#8800bb',
      ringGlow:   'rgba(200,0,255,0.5)',
      bgGradient: 'radial-gradient(ellipse 80% 60% at 20% 40%, rgba(160,0,255,0.1) 0%, transparent 55%), radial-gradient(ellipse 55% 55% at 75% 65%, rgba(60,0,100,0.1) 0%, transparent 55%), linear-gradient(160deg,#04000c 0%,#0f001e 50%,#020008 100%)',
      particleColor: [200, 0, 255],
      particleType: 'void',
      charEmoji: '👑',
      charBg: 'radial-gradient(ellipse at center, rgba(180,0,255,0.28) 0%, transparent 70%)',
      workDuration: 45, shortBreak: 10, longBreak: 25,
      locked: true, purchased: false,
    },
    {
      id: 5, name: 'Storm Diviner', rarity: 'legendary',
      accentColor: '#00bbff', accentDim: 'rgba(0,187,255,0.16)',
      accentGlow: 'rgba(0,187,255,0.4)', accentDark: '#0077cc',
      ringGlow:   'rgba(0,187,255,0.5)',
      bgGradient: 'radial-gradient(ellipse 80% 60% at 20% 40%, rgba(0,180,255,0.1) 0%, transparent 55%), radial-gradient(ellipse 55% 55% at 75% 65%, rgba(0,50,100,0.1) 0%, transparent 55%), linear-gradient(160deg,#000c18 0%,#001a2e 50%,#00060e 100%)',
      particleColor: [0, 187, 255],
      particleType: 'lightning',
      charEmoji: '⚡',
      charBg: 'radial-gradient(ellipse at center, rgba(0,180,255,0.28) 0%, transparent 70%)',
      workDuration: 40, shortBreak: 8, longBreak: 20,
      locked: true, purchased: false,
    },
    {
      id: 6, name: 'Jade Hermit', rarity: 'rare',
      accentColor: '#55ddaa', accentDim: 'rgba(85,221,170,0.15)',
      accentGlow: 'rgba(85,221,170,0.38)', accentDark: '#22998a',
      ringGlow:   'rgba(85,221,170,0.48)',
      bgGradient: 'radial-gradient(ellipse 80% 60% at 20% 45%, rgba(80,200,150,0.09) 0%, transparent 55%), radial-gradient(ellipse 55% 55% at 75% 60%, rgba(10,80,50,0.1) 0%, transparent 55%), linear-gradient(160deg,#010c07 0%,#041a0e 50%,#010603 100%)',
      particleColor: [85, 221, 170],
      particleType: 'petals',
      charEmoji: '🍃',
      charBg: 'radial-gradient(ellipse at center, rgba(80,220,150,0.26) 0%, transparent 70%)',
      workDuration: 25, shortBreak: 5, longBreak: 15,
      locked: false, purchased: false,
    },
    {
      id: 7, name: 'Aurora Seeker', rarity: 'legendary',
      accentColor: '#dd55ff', accentDim: 'rgba(221,85,255,0.16)',
      accentGlow: 'rgba(221,85,255,0.42)', accentDark: '#aa22cc',
      ringGlow:   'rgba(221,85,255,0.52)',
      bgGradient: 'radial-gradient(ellipse 85% 60% at 15% 40%, rgba(220,80,255,0.1) 0%, transparent 55%), radial-gradient(ellipse 55% 55% at 75% 65%, rgba(255,80,150,0.07) 0%, transparent 55%), radial-gradient(ellipse 40% 40% at 85% 30%, rgba(100,20,180,0.08) 0%, transparent 55%), linear-gradient(160deg,#0a0012 0%,#1a0028 50%,#050008 100%)',
      particleColor: [221, 85, 255],
      particleType: 'stars',
      charEmoji: '🌌',
      charBg: 'radial-gradient(ellipse at center, rgba(220,80,255,0.28) 0%, transparent 70%)',
      workDuration: 25, shortBreak: 5, longBreak: 15,
      locked: false, purchased: false,
    },
  ];

  const DEFAULT_THEME = FOCUS_THEMES[0];

  /* ── STATE ───────────────────────────────────────────── */
  let activeTheme = DEFAULT_THEME;
  let particleAnim = null;
  let particles   = [];
  let pCanvas, pCtx;
  let isOnFocusTab = false;

  /* ── BOOT ────────────────────────────────────────────── */
  function init() {
    createLayers();
    loadAndApplyTheme();
    observeFocusView();
    listenTabSwitches();
    listenStorage();
    listenStartBtn();
  }

  // Auto-navigate to focus tab if URL hash is #focus (useful for direct linking)
  function maybeAutoNav() {
    if (window.location.hash === '#focus') {
      setTimeout(() => {
        const btn = document.querySelector('.nav-btn[data-tab="focus"]');
        if (btn) btn.click();
      }, 350);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { init(); maybeAutoNav(); });
  } else {
    setTimeout(() => { init(); maybeAutoNav(); }, 120);
  }

  /* ── LAYER CREATION ──────────────────────────────────── */
  function createLayers() {
    const app = document.getElementById('app') || document.body;

    if (!document.getElementById('ft-bg-layer')) {
      const bg = document.createElement('div');
      bg.id = 'ft-bg-layer';
      bg.setAttribute('aria-hidden', 'true');
      app.appendChild(bg);
    }

    if (!document.getElementById('ft-particles-canvas')) {
      pCanvas = document.createElement('canvas');
      pCanvas.id = 'ft-particles-canvas';
      pCanvas.setAttribute('aria-hidden', 'true');
      app.appendChild(pCanvas);
      pCtx = pCanvas.getContext('2d');
      resizeCanvas();
      window.addEventListener('resize', resizeCanvas, { passive: true });
    } else {
      pCanvas = document.getElementById('ft-particles-canvas');
      pCtx = pCanvas.getContext('2d');
    }

    if (!document.getElementById('ft-char-layer')) {
      const char = document.createElement('div');
      char.id = 'ft-char-layer';
      char.setAttribute('aria-hidden', 'true');
      char.innerHTML = '<div class="ft-char-inner"><div class="ft-char-aura"></div><div class="ft-char-emoji"></div></div>';
      app.appendChild(char);
    }

    if (!document.getElementById('ft-transition-flash')) {
      const flash = document.createElement('div');
      flash.id = 'ft-transition-flash';
      flash.setAttribute('aria-hidden', 'true');
      document.body.appendChild(flash);
    }
  }

  function resizeCanvas() {
    if (!pCanvas) return;
    pCanvas.width  = window.innerWidth;
    pCanvas.height = window.innerHeight;
  }

  /* ── LOAD & APPLY THEME ──────────────────────────────── */
  function loadAndApplyTheme() {
    let themeId = 0;
    try {
      const stored = JSON.parse(localStorage.getItem('themeStore_v1'));
      if (stored && typeof stored.selectedId === 'number') {
        themeId = stored.selectedId;
      }
    } catch (_) {}

    const theme = FOCUS_THEMES[themeId] || DEFAULT_THEME;
    applyTheme(theme);
  }

  function applyTheme(theme, animate) {
    activeTheme = theme;

    /* Flash transition */
    if (animate) flashTransition();

    /* 1 – CSS variables */
    injectCSSVars(theme);

    /* 2 – Background layer */
    const bg = document.getElementById('ft-bg-layer');
    if (bg) {
      bg.style.background = theme.bgGradient;
      bg.style.setProperty('--ft-accent-dim', theme.accentDim);
    }

    /* 3 – Character */
    updateCharacter(theme);

    /* 4 – Particles */
    stopParticles();
    if (isOnFocusTab) startParticles(theme);

    /* 5 – Re-inject into focus view elements */
    enhanceFocusView(theme);
  }

  /* Injects CSS variables via a <style> tag for cascade */
  function injectCSSVars(theme) {
    let el = document.getElementById('ft-vars');
    if (!el) {
      el = document.createElement('style');
      el.id = 'ft-vars';
      document.head.appendChild(el);
    }
    el.textContent = `
      :root {
        --ft-accent:      ${theme.accentColor};
        --ft-accent-dim:  ${theme.accentDim};
        --ft-accent-glow: ${theme.accentGlow};
        --ft-accent-dark: ${theme.accentDark};
        --ft-ring-glow:   ${theme.ringGlow};
        --ft-char-bg:     ${theme.charBg};
        --ft-bg:          ${theme.bgGradient};
        --ft-vignette:    rgba(0,0,0,0.55);
      }
    `;
  }

  /* ── CHARACTER ───────────────────────────────────────── */
  function updateCharacter(theme) {
    const layer = document.getElementById('ft-char-layer');
    if (!layer) return;
    const emoji = layer.querySelector('.ft-char-emoji');
    const aura  = layer.querySelector('.ft-char-aura');
    if (emoji) {
      emoji.style.transition = 'opacity 0.35s ease';
      emoji.style.opacity = '0';
      setTimeout(() => {
        emoji.textContent = theme.charEmoji;
        emoji.style.filter = `drop-shadow(0 0 28px ${theme.accentGlow}) drop-shadow(0 0 10px ${theme.accentGlow})`;
        emoji.style.opacity = '1';
      }, 350);
    }
    if (aura) {
      aura.style.background = theme.charBg;
    }
  }

  /* ── RARITY BADGE ────────────────────────────────────── */
  function injectRarityBadge(theme) {
    // Remove existing badges
    document.querySelectorAll('.ft-rarity-badge, .ft-theme-pill').forEach(el => el.remove());

    const header = document.querySelector('#view-focus .page-header h1');
    if (!header) return;

    const rarityMap = { common: '⬜', rare: '🔵', epic: '🟣', legendary: '🟠' };
    const badge = document.createElement('span');
    badge.className = `ft-rarity-badge ${theme.rarity}`;
    badge.textContent = `${rarityMap[theme.rarity] || ''} ${theme.rarity}`;
    header.appendChild(badge);

    // Add theme name pill to subtitle
    const subtitle = document.querySelector('#view-focus .page-header .subtitle');
    if (subtitle) {
      const pill = document.createElement('span');
      pill.className = 'ft-theme-pill';
      pill.title = 'Change theme in Theme Store';
      pill.innerHTML = `✨ ${theme.name}`;
      pill.addEventListener('click', () => {
        window.location.href = '/theme-store.html';
      });
      subtitle.appendChild(pill);
    }

    // Add accent line
    const existing = document.querySelector('.ft-accent-line');
    if (!existing) {
      const line = document.createElement('div');
      line.className = 'ft-accent-line';
      const ph = document.querySelector('#view-focus .page-header');
      if (ph) ph.appendChild(line);
    }
  }

  /* ── AUDIO VISUALIZER ────────────────────────────────── */
  function injectAudioVisualizer() {
    document.querySelectorAll('.ft-visualizer').forEach(el => el.remove());

    const binHeader = document.querySelector('#view-focus .bb-header');
    if (!binHeader) return;

    const vis = document.createElement('div');
    vis.className = 'ft-visualizer paused';
    vis.innerHTML = Array.from({ length: 6 }, () => '<div class="ft-visualizer-bar"></div>').join('');
    binHeader.appendChild(vis);

    // Watch play state
    const observer = new MutationObserver(() => {
      const card = document.getElementById('binaural-card');
      if (!card) return;
      const isPlaying = card.classList.contains('bb-playing');
      vis.classList.toggle('paused', !isPlaying);
    });
    const card = document.getElementById('binaural-card');
    if (card) observer.observe(card, { attributes: true, attributeFilter: ['class'] });
  }

  /* ── STATS PROGRESS BARS ─────────────────────────────── */
  function injectStatBars() {
    document.querySelectorAll('.ft-stat-bar-wrap').forEach(el => el.remove());

    const statGrid = document.querySelector('#view-focus .focus-sessions-info .grid');
    if (!statGrid) return;

    statGrid.querySelectorAll('div > div.v').forEach(vEl => {
      const parent = vEl.parentElement;
      if (parent && !parent.querySelector('.ft-stat-bar-wrap')) {
        const wrap = document.createElement('div');
        wrap.className = 'ft-stat-bar-wrap';
        const fill = document.createElement('div');
        fill.className = 'ft-stat-bar-fill';
        fill.style.width = '0%';
        wrap.appendChild(fill);
        parent.appendChild(wrap);
        // Animate bar width based on sessions (rough estimate)
        setTimeout(() => {
          const val = parseFloat(vEl.textContent) || 0;
          const pct = Math.min(100, (val / 8) * 100); // 8 sessions = full bar
          fill.style.width = pct + '%';
        }, 400);
      }
    });
  }

  /* ── RIPPLE ON START BUTTON ──────────────────────────── */
  function listenStartBtn() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('#view-focus .focus-buttons .btn:not(.btn-ghost)');
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const r = document.createElement('span');
      r.className = 'ft-ripple';
      const size = Math.max(btn.offsetWidth, btn.offsetHeight);
      r.style.cssText = `width:${size}px;height:${size}px;top:${e.clientY-rect.top-size/2}px;left:${e.clientX-rect.left-size/2}px`;
      btn.style.overflow = 'hidden';
      btn.style.position = 'relative';
      btn.appendChild(r);
      setTimeout(() => r.remove(), 600);
    }, { passive: true });
  }

  /* ── FULL ENHANCE: called on each focus re-render ─────── */
  function enhanceFocusView(theme) {
    if (!isOnFocusTab) return;
    theme = theme || activeTheme;
    injectRarityBadge(theme);
    injectAudioVisualizer();
    injectStatBars();
  }

  /* ── MUTATION OBSERVER ───────────────────────────────── */
  function observeFocusView() {
    const view = document.getElementById('view-focus');
    if (!view) return;
    let debounce = null;
    const obs = new MutationObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        if (isOnFocusTab) enhanceFocusView(activeTheme);
      }, 80);
    });
    obs.observe(view, { childList: true, subtree: false });
  }

  /* ── TAB DETECTION ───────────────────────────────────── */
  function listenTabSwitches() {
    // Watch for body class changes (script.js sets body.tab-focus)
    const obs = new MutationObserver(() => {
      const onFocus = document.body.classList.contains('tab-focus');
      if (onFocus !== isOnFocusTab) {
        isOnFocusTab = onFocus;
        if (onFocus) {
          startParticles(activeTheme);
          enhanceFocusView(activeTheme);
        } else {
          stopParticles();
        }
      }
    });
    obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    // Initial check
    isOnFocusTab = document.body.classList.contains('tab-focus');
  }

  /* ── STORAGE LISTENER (theme changes from theme-store) ── */
  function listenStorage() {
    window.addEventListener('storage', (e) => {
      if (e.key !== 'themeStore_v1') return;
      try {
        const data = JSON.parse(e.newValue);
        if (data && typeof data.selectedId === 'number') {
          const theme = FOCUS_THEMES[data.selectedId] || DEFAULT_THEME;
          applyTheme(theme, true);
        }
      } catch (_) {}
    });

    // Also poll periodically for same-page changes
    let lastId = -1;
    setInterval(() => {
      try {
        const stored = JSON.parse(localStorage.getItem('themeStore_v1'));
        const id = stored?.selectedId ?? 0;
        if (id !== lastId) {
          lastId = id;
          const theme = FOCUS_THEMES[id] || DEFAULT_THEME;
          applyTheme(theme, lastId !== -1);
        }
      } catch (_) {}
    }, 1500);
  }

  /* ── FLASH TRANSITION ────────────────────────────────── */
  function flashTransition() {
    const flash = document.getElementById('ft-transition-flash');
    if (!flash) return;
    flash.classList.add('flash-on');
    setTimeout(() => flash.classList.remove('flash-on'), 180);
  }

  /* ═══════════════════════════════════════════════════════
     PARTICLE SYSTEM
  ═══════════════════════════════════════════════════════ */
  function startParticles(theme) {
    if (!pCanvas || !pCtx) return;
    stopParticles();
    particles = createParticles(theme);
    function loop() {
      if (!isOnFocusTab) return;
      pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
      const [r, g, b] = theme.particleColor;
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        if (p.life <= 0) resetParticle(p, theme);

        pCtx.save();
        pCtx.globalAlpha = Math.max(0, p.life) * 0.75;

        switch (theme.particleType) {
          case 'sparks':
            pCtx.fillStyle = `rgba(${r},${g},${b},1)`;
            pCtx.shadowBlur  = 8;
            pCtx.shadowColor = `rgba(${r},${g},${b},0.8)`;
            pCtx.fillRect(p.x, p.y, p.size, p.size * 2.5);
            break;
          case 'embers':
            pCtx.fillStyle = `rgba(${r},${Math.min(255,g+80)},0,1)`;
            pCtx.shadowBlur  = 10;
            pCtx.shadowColor = `rgba(${r},${g},0,0.9)`;
            pCtx.beginPath();
            pCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            pCtx.fill();
            break;
          case 'leaves':
            pCtx.fillStyle = `rgba(${r},${g},${b},1)`;
            pCtx.translate(p.x, p.y);
            pCtx.rotate(p.rot);
            pCtx.fillRect(-p.size, -p.size * 1.8, p.size * 2, p.size * 3.5);
            break;
          case 'petals':
            pCtx.fillStyle = `rgba(${r},${g},${b},0.85)`;
            pCtx.shadowBlur  = 6;
            pCtx.shadowColor = `rgba(${r},${g},${b},0.5)`;
            pCtx.translate(p.x, p.y);
            pCtx.rotate(p.rot);
            pCtx.beginPath();
            pCtx.ellipse(0, 0, p.size * 2, p.size, 0, 0, Math.PI * 2);
            pCtx.fill();
            break;
          case 'glyphs':
            pCtx.fillStyle = `rgba(${r},${g},${b},0.85)`;
            pCtx.shadowBlur  = 8;
            pCtx.shadowColor = `rgba(${r},${g},${b},0.7)`;
            pCtx.font = `${Math.round(p.size * 7)}px serif`;
            pCtx.textAlign = 'center';
            pCtx.textBaseline = 'middle';
            pCtx.fillText(['気','道','力','心','法','元'][Math.floor(p.rot * 3) % 6], p.x, p.y);
            break;
          case 'stars':
            pCtx.translate(p.x, p.y);
            pCtx.fillStyle = `rgba(${r},${g},${b},1)`;
            pCtx.shadowBlur  = 12;
            pCtx.shadowColor = `rgba(${r},${g},${b},0.9)`;
            drawStar(pCtx, 0, 0, p.size * 2.5, p.size, 4);
            pCtx.fill();
            break;
          case 'void':
            pCtx.strokeStyle = `rgba(${r},${g},${b},0.8)`;
            pCtx.lineWidth = 1;
            pCtx.shadowBlur  = 8;
            pCtx.shadowColor = `rgba(${r},${g},${b},0.7)`;
            pCtx.beginPath();
            pCtx.arc(p.x, p.y, p.size * 2, 0, Math.PI * 2);
            pCtx.stroke();
            break;
          case 'lightning':
            pCtx.strokeStyle = `rgba(${r},${g},${b},0.85)`;
            pCtx.lineWidth = 1.5;
            pCtx.shadowBlur  = 10;
            pCtx.shadowColor = `rgba(${r},${g},${b},0.9)`;
            pCtx.beginPath();
            pCtx.moveTo(p.x, p.y);
            pCtx.lineTo(p.x + p.vx * 8, p.y + p.vy * 8);
            pCtx.stroke();
            break;
          default:
            pCtx.fillStyle = `rgba(${r},${g},${b},1)`;
            pCtx.shadowBlur = 6;
            pCtx.shadowColor = `rgba(${r},${g},${b},0.7)`;
            pCtx.beginPath();
            pCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            pCtx.fill();
        }
        pCtx.restore();
        if (p.rot !== undefined) p.rot += 0.02;
      });
      particleAnim = requestAnimationFrame(loop);
    }
    loop();
  }

  function stopParticles() {
    if (particleAnim) { cancelAnimationFrame(particleAnim); particleAnim = null; }
    if (pCtx && pCanvas) pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
  }

  function createParticles(theme) {
    const count = window.innerWidth < 600 ? 22 : 36;
    return Array.from({ length: count }, () => {
      const p = {};
      resetParticle(p, theme);
      p.life = Math.random(); // stagger initial lifetimes
      return p;
    });
  }

  function resetParticle(p, theme) {
    const W = pCanvas.width, H = pCanvas.height;
    p.x    = Math.random() * W;
    p.y    = Math.random() * H;
    p.vx   = (Math.random() - 0.5) * 0.6;
    p.vy   = -(0.3 + Math.random() * 0.8);
    p.size = 1 + Math.random() * 2.5;
    p.life = 0.5 + Math.random() * 0.5;
    p.decay = 0.003 + Math.random() * 0.005;
    p.rot   = Math.random() * Math.PI * 2;
    if (['embers','sparks'].includes(theme.particleType)) {
      p.vy = -(0.5 + Math.random() * 1.2);
      p.vx = (Math.random() - 0.5) * 1.0;
    }
    if (theme.particleType === 'lightning') {
      p.vx = (Math.random() - 0.5) * 4;
      p.vy = (Math.random() - 0.5) * 4;
      p.decay = 0.05;
    }
  }

  function drawStar(ctx, cx, cy, outerR, innerR, points) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const a = (Math.PI / points) * i - Math.PI / 2;
      i === 0 ? ctx.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a))
              : ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
    }
    ctx.closePath();
  }

})();
