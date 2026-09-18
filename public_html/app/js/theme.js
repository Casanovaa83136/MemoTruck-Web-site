// ════════════════════════════════════════════════════════════════════════
// MémoTruck — Système de thèmes v2
// ════════════════════════════════════════════════════════════════════════

export const THEMES = {
  NUIT:     "nuit",
  DARK:     "dark",
  WHITE:    "white",
  AURORA:   "aurora",
  OBSIDIAN: "obsidian",
  NOVA:     "nova"
};

export const THEME_PREVIEWS = {
  [THEMES.NUIT]:     { titre: "🌙 Nuit",            description: "Bleu profond — thème par défaut",        colors: ["#0F1923", "#00C2FF", "#243044"] },
  [THEMES.DARK]:     { titre: "⚫ Dark",             description: "Noir profond — contraste maximal",       colors: ["#000000", "#00E5FF", "#181818"] },
  [THEMES.WHITE]:    { titre: "☀️ Clair",            description: "Fond blanc — idéal en plein jour",      colors: ["#F4F6F8", "#0077B6", "#FFFFFF"] },
  [THEMES.AURORA]:   { titre: "✨ Aurora",           description: "Blanc néon · Cyan glacé · Bleu clair",  colors: ["#020810", "#a8d8ff", "#7fffcf"] },
  [THEMES.OBSIDIAN]: { titre: "⚡ Obsidian Pulse",  description: "Noir absolu — orbes lumineux — ultime", colors: ["#05070f", "#2979ff", "#06b6d4"] },
  [THEMES.NOVA]:     { titre: "🌌 Nova",            description: "Violet cosmique · Rose néon · Cyan — ciel étoilé animé", colors: ["#070312", "#c084fc", "#22d3ee"] }
};

export function loadSavedTheme() {
  const saved = localStorage.getItem("atil_theme") || THEMES.NUIT;
  applyTheme(saved);
  return saved;
}

export function saveTheme(theme) {
  localStorage.setItem("atil_theme", theme);
  applyTheme(theme);
}

export function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);

  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  const bgColors = {
    [THEMES.NUIT]:     "#0F1923",
    [THEMES.DARK]:     "#000000",
    [THEMES.WHITE]:    "#F4F6F8",
    [THEMES.AURORA]:   "#020810",
    [THEMES.OBSIDIAN]: "#05070f",
    [THEMES.NOVA]:     "#070312"
  };
  if (metaThemeColor) {
    metaThemeColor.setAttribute("content", bgColors[theme] || bgColors[THEMES.NUIT]);
  }

  // Injecte ou retire les éléments décoratifs
  _applyDecorations(theme);

  // Effets JS exclusifs au thème Nova (spot lumineux, comètes, ripple FAB)
  if (theme === THEMES.NOVA) {
    _enableNovaFX();
  } else {
    _disableNovaFX();
  }
}

export function getCurrentTheme() {
  return document.documentElement.getAttribute("data-theme") || THEMES.NUIT;
}

// ─── Ciel étoilé (thème Nova) ──────────────────────────────────────────────
function _buildStars(count) {
  const colors = ["255,255,255", "244,114,182", "192,132,252", "34,211,238"];
  let html = "";
  for (let i = 0; i < count; i++) {
    const size  = (Math.random() * 2 + 1.5).toFixed(1);
    const top   = (Math.random() * 100).toFixed(1);
    const left  = (Math.random() * 100).toFixed(1);
    const dur   = (Math.random() * 2.5 + 2).toFixed(1);
    const delay = (Math.random() * 4).toFixed(1);
    const c     = colors[Math.floor(Math.random() * colors.length)];
    html += `<div class="theme-star" style="position:absolute;width:${size}px;height:${size}px;border-radius:50%;
      background:rgba(${c},0.9);box-shadow:0 0 6px rgba(${c},0.8);
      top:${top}%;left:${left}%;pointer-events:none;
      animation:star-twinkle ${dur}s ease-in-out ${delay}s infinite;"></div>`;
  }
  return html;
}

// ─── Décorations dynamiques ───────────────────────────────────────────────
function _applyDecorations(theme) {
  // Si les orbes existent déjà pour ce thème → ne pas les recréer
  const existing = document.querySelector(".theme-deco-layer");
  if (existing && existing.dataset.theme === theme) return;

  // Supprime toutes les décos existantes
  document.querySelectorAll(".theme-deco-layer").forEach(el => el.remove());

  if (theme !== THEMES.AURORA && theme !== THEMES.OBSIDIAN && theme !== THEMES.NOVA) return;

  // Injecte les keyframes
  if (!document.getElementById("theme-deco-keyframes")) {
    const style = document.createElement("style");
    style.id = "theme-deco-keyframes";
    style.textContent = `
      @keyframes orb-float {
        0%,100% { transform: translate(0,0) scale(1); }
        33%     { transform: translate(30px,-25px) scale(1.05); }
        66%     { transform: translate(-20px,20px) scale(0.96); }
      }
    `;
    document.head.appendChild(style);
  }

  const orbsAurora = `
    <div class="theme-orb-1" style="position:absolute;width:400px;height:400px;border-radius:50%;
      background:radial-gradient(circle,rgba(168,216,255,0.7),transparent 70%);
      top:-50px;left:-50px;filter:blur(40px);pointer-events:none;"></div>
    <div class="theme-orb-2" style="position:absolute;width:350px;height:350px;border-radius:50%;
      background:radial-gradient(circle,rgba(127,255,207,0.65),transparent 70%);
      bottom:-50px;right:-50px;filter:blur(40px);pointer-events:none;"></div>
    <div class="theme-orb-3" style="position:absolute;width:280px;height:280px;border-radius:50%;
      background:radial-gradient(circle,rgba(255,255,255,0.4),transparent 70%);
      top:45%;left:45%;filter:blur(35px);pointer-events:none;"></div>
  `;

  const orbsObsidian = `
    <div class="theme-orb-4" style="position:absolute;width:420px;height:420px;border-radius:50%;
      background:radial-gradient(circle,rgba(41,121,255,0.65),transparent 70%);
      top:-50px;left:-50px;filter:blur(40px);pointer-events:none;"></div>
    <div class="theme-orb-5" style="position:absolute;width:360px;height:360px;border-radius:50%;
      background:radial-gradient(circle,rgba(124,58,237,0.60),transparent 70%);
      bottom:-50px;right:-50px;filter:blur(40px);pointer-events:none;"></div>
    <div class="theme-orb-6" style="position:absolute;width:280px;height:280px;border-radius:50%;
      background:radial-gradient(circle,rgba(6,182,212,0.45),transparent 70%);
      top:45%;left:45%;filter:blur(35px);pointer-events:none;"></div>
    <div style="position:absolute;inset:0;
      background-image:radial-gradient(rgba(255,255,255,0.025) 1px,transparent 1px);
      background-size:30px 30px;pointer-events:none;"></div>
  `;

  const orbsNova = `
    <div class="theme-orb-7" style="position:absolute;width:440px;height:440px;border-radius:50%;
      background:radial-gradient(circle,rgba(244,114,182,0.55),transparent 70%);
      top:-70px;left:-90px;filter:blur(46px);pointer-events:none;"></div>
    <div class="theme-orb-8" style="position:absolute;width:380px;height:380px;border-radius:50%;
      background:radial-gradient(circle,rgba(192,132,252,0.55),transparent 70%);
      bottom:-60px;right:-60px;filter:blur(46px);pointer-events:none;"></div>
    <div class="theme-orb-9" style="position:absolute;width:300px;height:300px;border-radius:50%;
      background:radial-gradient(circle,rgba(34,211,238,0.45),transparent 70%);
      top:38%;left:52%;filter:blur(40px);pointer-events:none;"></div>
    <div class="theme-nova-core" style="position:absolute;width:220px;height:220px;border-radius:50%;
      background:radial-gradient(circle,rgba(255,255,255,0.35),transparent 70%);
      top:28%;left:18%;filter:blur(30px);pointer-events:none;
      animation:nova-core-pulse 4s ease-in-out infinite;"></div>
    <div style="position:absolute;inset:0;
      background-image:radial-gradient(rgba(255,255,255,0.03) 1px,transparent 1px);
      background-size:26px 26px;pointer-events:none;"></div>
    ${_buildStars(26)}
  `;

  const orbs = theme === THEMES.AURORA ? orbsAurora : (theme === THEMES.OBSIDIAN ? orbsObsidian : orbsNova);

  // Injecte dans CHAQUE écran directement
  document.querySelectorAll(".screen").forEach(screen => {
    screen.style.position = "relative";
    screen.style.overflow = "hidden";

    const layer = document.createElement("div");
    layer.className = "theme-deco-layer";
    layer.dataset.theme = theme;
    layer.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:0;overflow:hidden;";
    layer.innerHTML = orbs;

    // Insère en premier dans le screen
    screen.insertBefore(layer, screen.firstChild);

    // S'assure que le contenu du screen est au-dessus
    // (on exclut le FAB et tout élément déjà en position:fixed, pour ne pas
    // casser leur ancrage à l'écran — ex: bouton "+" décalé à gauche)
    Array.from(screen.children).forEach(child => {
      if (child.classList.contains("theme-deco-layer")) return;
      if (child.classList.contains("fab")) {
        child.style.zIndex = "21";
        return;
      }
      child.style.position = "relative";
      child.style.zIndex   = "1";
    });
  });
}

// ─── Effets JS exclusifs au thème Nova : spot lumineux, comètes, ripple FAB ─
let _novaFxLayer    = null;
let _novaPointerFn  = null;
let _novaRippleFn   = null;
let _novaCometTimer = null;
let _novaRafPending = false;

function _enableNovaFX() {
  if (_novaFxLayer) return; // déjà actif, rien à faire

  const app = document.getElementById("app") || document.body;

  const layer = document.createElement("div");
  layer.className = "nova-fx-layer";
  layer.innerHTML = `<div class="nova-grain"></div><div class="nova-spotlight"></div>`;
  app.appendChild(layer);
  _novaFxLayer = layer;

  const spotlight = layer.querySelector(".nova-spotlight");

  // Spot lumineux qui suit la souris (desktop uniquement : "touchmove" se
  // déclenche aussi pendant un simple scroll tactile, ce qui forcerait un
  // repaint plein écran du dégradé à chaque frame de défilement sur mobile).
  _novaPointerFn = (e) => {
    const point = e.touches ? e.touches[0] : e;
    if (!point) return;
    const rect = app.getBoundingClientRect();
    const sx = ((point.clientX - rect.left) / rect.width) * 100;
    const sy = ((point.clientY - rect.top) / rect.height) * 100;
    if (!_novaRafPending) {
      _novaRafPending = true;
      requestAnimationFrame(() => {
        spotlight.style.setProperty("--nova-sx", sx + "%");
        spotlight.style.setProperty("--nova-sy", sy + "%");
        _novaRafPending = false;
      });
    }
  };
  document.addEventListener("pointermove", _novaPointerFn, { passive: true });

  // Comètes filantes aléatoires, en boucle tant que Nova est actif
  const spawnComet = () => {
    if (!_novaFxLayer) return;
    const comet = document.createElement("div");
    comet.className = "nova-comet";
    comet.style.top  = (Math.random() * 35).toFixed(1) + "%";
    comet.style.left = (55 + Math.random() * 40).toFixed(1) + "%";
    comet.style.animationDuration = (1.1 + Math.random() * 0.8).toFixed(2) + "s";
    layer.appendChild(comet);
    comet.addEventListener("animationend", () => comet.remove());
  };
  const scheduleComet = () => {
    _novaCometTimer = setTimeout(() => {
      spawnComet();
      scheduleComet();
    }, 8000 + Math.random() * 6000);
  };
  scheduleComet();

  // Ripple coloré au tap sur le bouton "+" (délégation, survit aux re-render)
  _novaRippleFn = (e) => {
    const fab = e.target.closest && e.target.closest(".fab");
    if (!fab) return;
    const ripple = document.createElement("div");
    ripple.className = "nova-ripple";
    fab.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove());
  };
  document.addEventListener("pointerdown", _novaRippleFn);
}

function _disableNovaFX() {
  if (_novaPointerFn) {
    document.removeEventListener("pointermove", _novaPointerFn);
    _novaPointerFn = null;
  }
  if (_novaRippleFn) {
    document.removeEventListener("pointerdown", _novaRippleFn);
    _novaRippleFn = null;
  }
  if (_novaCometTimer) {
    clearTimeout(_novaCometTimer);
    _novaCometTimer = null;
  }
  if (_novaFxLayer) {
    _novaFxLayer.remove();
    _novaFxLayer = null;
  }
}
