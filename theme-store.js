/* ═══════════════════════════════════════════════════
   Theme Store — State Management & Interactions
   ═══════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── State ───────────────────────────────────────
  const STORAGE_KEY = 'themeStore_v1';

  const defaultState = {
    selectedId: 0,
    favorited: false,
    isDark: true,
    purchasedIds: [1],   // Shadow Monk pre-purchased
    activeTag: 'anime'
  };

  let state = loadState();

  const THEMES = [
    { id: 0, name: 'Celestial Warrior', price: 1200, duration: '10:00:00', locked: false },
    { id: 1, name: 'Shadow Monk',       price: 0,    duration: '08:00:00', locked: false },
    { id: 2, name: 'Dragon Sage',       price: 800,  duration: '07:00:00', locked: false },
    { id: 3, name: 'Phoenix Scholar',   price: 950,  duration: '06:00:00', locked: false },
    { id: 4, name: 'Void Emperor',      price: 2000, duration: '12:00:00', locked: true  },
    { id: 5, name: 'Storm Diviner',     price: 1800, duration: '09:00:00', locked: true  },
    { id: 6, name: 'Jade Hermit',       price: 600,  duration: '05:00:00', locked: false },
    { id: 7, name: 'Aurora Seeker',     price: 1500, duration: '11:00:00', locked: false },
  ];

  // ─── DOM Refs ─────────────────────────────────────
  const $body            = document.getElementById('body');
  const $skeleton        = document.getElementById('skeleton-loader');
  const $mainPage        = document.getElementById('main-page');
  const $heartBtn        = document.getElementById('heart-btn');
  const $heartIcon       = document.getElementById('heart-icon');
  const $heroName        = document.getElementById('hero-name');
  const $heroPrice       = document.getElementById('hero-price');
  const $heroCharacter   = document.getElementById('hero-character');
  const $heroGlowRing    = document.getElementById('hero-glow-ring');
  const $priceGlowBadge  = document.getElementById('price-glow-badge');
  const $navSubtitle     = document.getElementById('nav-subtitle');
  const $tagsWrap        = document.getElementById('tags-wrap');
  const $modeIndicator   = document.getElementById('mode-indicator');
  const $btnLight        = document.getElementById('btn-light');
  const $btnDark         = document.getElementById('btn-dark');
  const $variantsGrid    = document.getElementById('variants-grid');
  const $btnPurchase     = document.getElementById('btn-purchase');
  const $purchaseLabel   = document.getElementById('purchase-label');
  const $btnGift         = document.getElementById('btn-gift');
  const $backBtn         = document.getElementById('back-btn');
  const $toastContainer  = document.getElementById('toast-container');
  const $canvas          = document.getElementById('particles-canvas');

  // ─── Init ─────────────────────────────────────────
  function init() {
    applyThemeMode(state.isDark);
    renderAll();
    initParticles();
    bindEvents();

    // Brief skeleton then reveal
    $skeleton.classList.add('hidden');
    $mainPage.classList.remove('hidden');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => $mainPage.classList.add('visible'));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ─── State Persistence ───────────────────────────
  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return saved ? Object.assign({}, defaultState, saved) : Object.assign({}, defaultState);
    } catch { return Object.assign({}, defaultState); }
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  }

  // ─── Render ───────────────────────────────────────
  function renderAll() {
    renderHero();
    renderHeart();
    renderModeToggle();
    renderCards();
    renderPurchaseBar();
  }

  function renderHero() {
    const theme = THEMES[state.selectedId];
    if (!theme) return;

    $heroName.textContent = theme.name;
    $heroCharacter.setAttribute('data-char', String(state.selectedId));
    $navSubtitle.textContent = theme.name;

    const isPurchased = state.purchasedIds.includes(theme.id);
    if (isPurchased) {
      $heroPrice.textContent = 'Owned';
      $priceGlowBadge.textContent = 'OWNED';
      $priceGlowBadge.style.background = 'rgba(34,197,94,0.18)';
      $priceGlowBadge.style.borderColor = 'rgba(34,197,94,0.4)';
      $priceGlowBadge.style.color = '#22c55e';
      $priceGlowBadge.style.boxShadow = '0 0 12px rgba(34,197,94,0.35)';
    } else if (theme.locked) {
      $heroPrice.textContent = `${theme.price.toLocaleString()} XP`;
      $priceGlowBadge.textContent = 'LOCKED';
      $priceGlowBadge.style.background = 'rgba(255,255,255,0.06)';
      $priceGlowBadge.style.borderColor = 'rgba(255,255,255,0.12)';
      $priceGlowBadge.style.color = 'rgba(255,255,255,0.4)';
      $priceGlowBadge.style.boxShadow = 'none';
    } else {
      $heroPrice.textContent = `${theme.price.toLocaleString()} XP`;
      $priceGlowBadge.textContent = 'PREMIUM';
      $priceGlowBadge.style.background = '';
      $priceGlowBadge.style.borderColor = '';
      $priceGlowBadge.style.color = '';
      $priceGlowBadge.style.boxShadow = '';
    }
  }

  function renderHeart() {
    if (state.favorited) {
      $heartBtn.classList.add('favorited');
    } else {
      $heartBtn.classList.remove('favorited');
    }
  }

  function renderModeToggle() {
    if (state.isDark) {
      $modeIndicator.classList.add('right');
      $btnDark.classList.add('active');
      $btnLight.classList.remove('active');
    } else {
      $modeIndicator.classList.remove('right');
      $btnLight.classList.add('active');
      $btnDark.classList.remove('active');
    }
  }

  function renderCards() {
    const cards = $variantsGrid.querySelectorAll('.variant-card');
    cards.forEach(card => {
      const id = parseInt(card.dataset.id, 10);
      const isPurchased = state.purchasedIds.includes(id);

      // Selected state
      if (id === state.selectedId) {
        card.classList.add('selected');
      } else {
        card.classList.remove('selected');
      }

      // Purchased badge
      let purchasedBadge = card.querySelector('.card-purchased-badge');
      if (isPurchased && !card.dataset.locked) {
        if (!purchasedBadge) {
          purchasedBadge = document.createElement('div');
          purchasedBadge.className = 'card-purchased-badge';
          purchasedBadge.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polyline points="20 6 9 17 4 12"/></svg>';
          const wrap = card.querySelector('.card-image-wrap');
          if (wrap) wrap.appendChild(purchasedBadge);
        }
      } else if (purchasedBadge && id !== state.selectedId) {
        // keep purchased badge but remove selected badge overlap
      }
    });
  }

  function renderPurchaseBar() {
    const theme = THEMES[state.selectedId];
    if (!theme) return;

    const isPurchased = state.purchasedIds.includes(theme.id);
    const isLocked = theme.locked;

    if (isPurchased) {
      $btnPurchase.classList.add('purchased');
      $btnPurchase.classList.remove('disabled-btn');
      $purchaseLabel.textContent = 'Apply Theme';
      $btnPurchase.querySelector('svg').innerHTML = '<polyline points="20 6 9 17 4 12"/>';
    } else if (isLocked) {
      $btnPurchase.classList.remove('purchased');
      $btnPurchase.classList.add('disabled-btn');
      $purchaseLabel.textContent = `Locked · ${theme.price.toLocaleString()} XP`;
      $btnPurchase.querySelector('svg').innerHTML = '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>';
    } else {
      $btnPurchase.classList.remove('purchased', 'disabled-btn');
      $purchaseLabel.textContent = `Purchase · ${theme.price.toLocaleString()} XP`;
      $btnPurchase.querySelector('svg').innerHTML = '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>';
    }
  }

  // ─── Theme Mode ───────────────────────────────────
  function applyThemeMode(isDark) {
    if (isDark) {
      $body.classList.remove('light-mode');
      $body.classList.add('dark-mode');
    } else {
      $body.classList.remove('dark-mode');
      $body.classList.add('light-mode');
    }
  }

  // ─── Events ───────────────────────────────────────
  function bindEvents() {

    // Back button
    $backBtn.addEventListener('click', () => {
      haptic();
      $mainPage.style.opacity = '0';
      $mainPage.style.transform = 'translateY(14px)';
      $mainPage.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      setTimeout(() => {
        if (document.referrer) window.history.back();
        else showToast('Navigating back…', '←');
        $mainPage.style.opacity = '';
        $mainPage.style.transform = '';
      }, 300);
    });

    // Heart / Favorite
    $heartBtn.addEventListener('click', () => {
      haptic();
      state.favorited = !state.favorited;
      renderHeart();
      saveState();
      if (state.favorited) {
        $heartBtn.style.transform = 'scale(1.35)';
        setTimeout(() => { $heartBtn.style.transform = ''; }, 280);
        showToast('Added to favorites', '❤️');
      } else {
        showToast('Removed from favorites', '🤍');
      }
    });

    // Tags
    $tagsWrap.addEventListener('click', e => {
      const tag = e.target.closest('.tag');
      if (!tag) return;
      haptic();
      $tagsWrap.querySelectorAll('.tag').forEach(t => t.classList.remove('active'));
      tag.classList.add('active');
      state.activeTag = tag.dataset.tag;
      saveState();
      showToast(`Browsing #${tag.dataset.tag}`, '🏷️');
    });

    // Mode toggle
    document.getElementById('mode-toggle').addEventListener('click', e => {
      const btn = e.target.closest('.mode-btn');
      if (!btn) return;
      haptic();
      const isDark = btn.dataset.mode === 'dark';
      if (state.isDark === isDark) return;
      state.isDark = isDark;
      applyThemeMode(isDark);
      renderModeToggle();
      saveState();
      showToast(isDark ? 'Dark mode enabled' : 'Light mode enabled', isDark ? '🌙' : '☀️');
    });

    // Card selection
    $variantsGrid.addEventListener('click', e => {
      const card = e.target.closest('.variant-card');
      if (!card) return;

      const id   = parseInt(card.dataset.id, 10);
      const locked = card.dataset.locked === 'true';

      if (locked) {
        haptic();
        pulseCard(card);
        showToast(`Unlock for ${THEMES[id].price.toLocaleString()} XP`, '🔒');
        return;
      }

      haptic();
      state.selectedId = id;
      renderAll();
      saveState();

      // Scroll hero char into view smoothly
      $heroCharacter.style.opacity = '0';
      $heroCharacter.style.transform = 'scale(0.92)';
      setTimeout(() => {
        $heroCharacter.setAttribute('data-char', String(id));
        $heroCharacter.style.transition = 'opacity 0.35s ease, transform 0.35s ease';
        $heroCharacter.style.opacity = '1';
        $heroCharacter.style.transform = 'scale(1)';
        setTimeout(() => { $heroCharacter.style.transition = ''; }, 360);
      }, 120);
    });

    // Purchase button
    $btnPurchase.addEventListener('click', () => {
      const theme = THEMES[state.selectedId];
      if (!theme) return;

      const isPurchased = state.purchasedIds.includes(theme.id);
      const isLocked    = theme.locked;

      if (isLocked) {
        haptic();
        showToast('Complete more study hours to unlock', '🔒');
        return;
      }

      haptic();
      ripple($btnPurchase);

      if (isPurchased) {
        // Apply the theme
        showToast(`"${theme.name}" applied!`, '✨');
        $btnPurchase.style.transform = 'scale(0.96)';
        setTimeout(() => { $btnPurchase.style.transform = ''; }, 200);
        return;
      }

      // Purchase flow
      $btnPurchase.disabled = true;
      $purchaseLabel.textContent = 'Processing…';

      setTimeout(() => {
        state.purchasedIds.push(theme.id);
        saveState();
        renderAll();
        $btnPurchase.disabled = false;
        showToast(`"${theme.name}" purchased!`, '🎉');

        // Confetti burst
        confettiBurst();
      }, 900);
    });

    // Gift button
    $btnGift.addEventListener('click', () => {
      haptic();
      ripple($btnGift);
      showToast('Gift feature coming soon!', '🎁');
    });

    // Hero image tap zoom
    document.getElementById('hero-image').addEventListener('click', () => {
      haptic();
    });

    // Swipe support for hero preview
    initSwipe();
  }

  // ─── Swipe Navigation ────────────────────────────
  function initSwipe() {
    const container = document.getElementById('hero-image');
    let startX = 0;
    let isDragging = false;

    container.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
      isDragging = true;
    }, { passive: true });

    container.addEventListener('touchend', e => {
      if (!isDragging) return;
      isDragging = false;
      const dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) < 40) return;

      const unlocked = THEMES.filter(t => !t.locked);
      const curIndex = unlocked.findIndex(t => t.id === state.selectedId);

      if (dx < 0) {
        // swipe left → next
        const next = unlocked[(curIndex + 1) % unlocked.length];
        if (next) swipeTo(next.id, 'left');
      } else {
        // swipe right → prev
        const prev = unlocked[(curIndex - 1 + unlocked.length) % unlocked.length];
        if (prev) swipeTo(prev.id, 'right');
      }
    }, { passive: true });
  }

  function swipeTo(id, dir) {
    haptic();
    $heroCharacter.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    $heroCharacter.style.opacity = '0';
    $heroCharacter.style.transform = `translateX(${dir === 'left' ? '-24px' : '24px'})`;
    setTimeout(() => {
      state.selectedId = id;
      renderAll();
      saveState();
      $heroCharacter.style.transform = `translateX(${dir === 'left' ? '24px' : '-24px'})`;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          $heroCharacter.style.transition = 'opacity 0.28s ease, transform 0.28s ease';
          $heroCharacter.style.opacity = '1';
          $heroCharacter.style.transform = 'translateX(0)';
        });
      });
    }, 200);
  }

  // ─── Toast System ─────────────────────────────────
  function showToast(msg, icon = 'ℹ️', duration = 2800) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${msg}</span>`;
    $toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('out');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ─── Haptic (visual feedback) ─────────────────────
  function haptic() {
    if (navigator.vibrate) navigator.vibrate(8);
  }

  // ─── Ripple Effect ────────────────────────────────
  function ripple(btn) {
    const existing = btn.querySelector('.ripple');
    if (existing) existing.remove();

    const r = document.createElement('span');
    r.className = 'ripple';
    Object.assign(r.style, {
      position: 'absolute',
      borderRadius: '50%',
      background: 'rgba(255,255,255,0.25)',
      width: '100%', paddingBottom: '100%',
      top: '50%', left: '50%',
      transform: 'translate(-50%, -50%) scale(0)',
      animation: 'rippleAnim 0.5s ease-out forwards',
      pointerEvents: 'none',
    });

    // Inject keyframe once
    if (!document.getElementById('ripple-style')) {
      const style = document.createElement('style');
      style.id = 'ripple-style';
      style.textContent = '@keyframes rippleAnim { to { transform: translate(-50%,-50%) scale(2.5); opacity: 0; } }';
      document.head.appendChild(style);
    }

    btn.style.position = 'relative';
    btn.style.overflow = 'hidden';
    btn.appendChild(r);
    setTimeout(() => r.remove(), 500);
  }

  // ─── Pulse locked card ────────────────────────────
  function pulseCard(card) {
    card.style.transition = 'transform 0.1s';
    card.style.transform = 'scale(0.97)';
    setTimeout(() => {
      card.style.transform = 'scale(1.02)';
      setTimeout(() => { card.style.transform = ''; }, 120);
    }, 100);
  }

  // ─── Confetti ────────────────────────────────────
  function confettiBurst() {
    const colors = ['#ff7a1a', '#ffa040', '#ffcc00', '#22c55e', '#60a5fa', '#e879f9'];
    for (let i = 0; i < 28; i++) {
      const dot = document.createElement('div');
      const size = 6 + Math.random() * 7;
      Object.assign(dot.style, {
        position: 'fixed',
        left: '50%', top: '60%',
        width: size + 'px', height: size + 'px',
        borderRadius: Math.random() > 0.5 ? '50%' : '2px',
        background: colors[Math.floor(Math.random() * colors.length)],
        pointerEvents: 'none',
        zIndex: '9999',
        transform: 'translate(-50%,-50%)',
        transition: `transform ${0.8 + Math.random() * 0.6}s cubic-bezier(0,0.8,0.5,1), opacity 0.8s ease`,
      });
      document.body.appendChild(dot);
      const angle = (Math.random() * 360) * (Math.PI / 180);
      const dist  = 80 + Math.random() * 140;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          dot.style.transform = `translate(calc(-50% + ${Math.cos(angle)*dist}px), calc(-50% + ${Math.sin(angle)*dist}px))`;
          dot.style.opacity = '0';
        });
      });
      setTimeout(() => dot.remove(), 1500);
    }
  }

  // ─── Particles ───────────────────────────────────
  function initParticles() {
    const ctx = $canvas.getContext('2d');
    let W, H, particles;

    function resize() {
      W = $canvas.width  = window.innerWidth;
      H = $canvas.height = window.innerHeight;
    }

    function createParticles() {
      particles = Array.from({ length: 32 }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 1 + Math.random() * 2.5,
        vx: (Math.random() - 0.5) * 0.35,
        vy: -0.2 - Math.random() * 0.4,
        alpha: 0.15 + Math.random() * 0.45,
        flicker: Math.random() * Math.PI * 2,
      }));
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      const isDark = state.isDark;
      particles.forEach(p => {
        p.flicker += 0.025;
        p.alpha = 0.15 + Math.abs(Math.sin(p.flicker)) * 0.4;
        p.x += p.vx;
        p.y += p.vy;
        if (p.y < -10) { p.y = H + 5; p.x = Math.random() * W; }
        if (p.x < -10) p.x = W + 5;
        if (p.x > W + 10) p.x = -5;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = isDark
          ? `rgba(255, 122, 26, ${p.alpha})`
          : `rgba(200, 90, 0, ${p.alpha * 0.5})`;
        ctx.fill();
      });
      requestAnimationFrame(draw);
    }

    resize();
    createParticles();
    draw();
    window.addEventListener('resize', () => { resize(); createParticles(); });
  }

})();
