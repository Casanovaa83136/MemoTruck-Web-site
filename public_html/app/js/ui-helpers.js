// ════════════════════════════════════════════════════════════════════════
// MémoTruck — Helpers UI
// Toast (équivalent Toast.makeText) + Modal (équivalent AlertDialog)
// ════════════════════════════════════════════════════════════════════════

// ─── Toast ────────────────────────────────────────────────────────────────
export function showToast(message) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ─── Modal générique (équivalent AlertDialog) ────────────────────────────
// options: { title, bodyHTML, confirmLabel, cancelLabel, danger, onConfirm, onCancel, onMount, onClose,
//            tertiaryLabel, onTertiary, confirmClass, cancelClass, tertiaryClass, stackedPrimary }
// onConfirm peut être async — la modale attend le résultat avant de se fermer.
// onClose est appelé après fermeture, quelle que soit la voie (confirmer, annuler, clic extérieur).
// tertiaryLabel/onTertiary ajoutent un 3ème bouton (ex: "Plus tard") — utilisé pour la relance
// de saisie conso manquante, seul cas à 3 choix de l'appli. confirmClass/cancelClass/tertiaryClass
// permettent de sortir des couleurs génériques (cancel/confirm/danger) quand le sens des boutons
// ne colle pas à cette sémantique (ex: reprendre les couleurs statut des cartes conso).
// stackedPrimary place le bouton confirm seul sur sa propre ligne, au-dessus des 2 autres.
export function showModal(options) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const box = document.createElement("div");
  box.className = "modal-box";

  const titleEl = document.createElement("div");
  titleEl.className = "modal-title";
  titleEl.textContent = options.title || "";
  box.appendChild(titleEl);

  const bodyEl = document.createElement("div");
  bodyEl.innerHTML = options.bodyHTML || "";
  box.appendChild(bodyEl);

  const actions = document.createElement("div");
  actions.className = "modal-actions" + (options.stackedPrimary ? " stacked-primary" : "");

  // cancelLabel === null (explicitement) → modale bloquante sans échappatoire
  // (ex : sélection de véhicule obligatoire en prise de service)
  const noCancel = options.cancelLabel === null;

  if (!noCancel) {
    const cancelBtn = document.createElement("button");
    cancelBtn.className = "modal-btn " + (options.cancelClass || "cancel");
    cancelBtn.textContent = options.cancelLabel || "Annuler";
    cancelBtn.onclick = () => {
      close();
      if (options.onCancel) options.onCancel();
    };
    actions.appendChild(cancelBtn);
  }

  if (options.tertiaryLabel) {
    const tertiaryBtn = document.createElement("button");
    tertiaryBtn.className = "modal-btn " + (options.tertiaryClass || "tertiary");
    tertiaryBtn.textContent = options.tertiaryLabel;
    tertiaryBtn.onclick = () => {
      close();
      if (options.onTertiary) options.onTertiary();
    };
    actions.appendChild(tertiaryBtn);
  }

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "modal-btn " + (options.confirmClass || (options.danger ? "danger" : "confirm"));
  confirmBtn.textContent = options.confirmLabel || "Confirmer";
  confirmBtn.onclick = async () => {
    if (options.onConfirm) {
      confirmBtn.disabled = true;
      try {
        // Supporte les onConfirm synchrones ET async
        const result = await Promise.resolve(options.onConfirm(bodyEl, close));
        if (result !== false) close();
      } catch (e) {
        console.error("[modal] onConfirm error:", e);
      } finally {
        confirmBtn.disabled = false;
      }
    } else {
      close();
    }
  };
  actions.appendChild(confirmBtn);

  box.appendChild(actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
    if (options.onClose) options.onClose();
  }

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && !noCancel) {
      close();
      if (options.onCancel) options.onCancel();
    }
  });

  if (options.onMount) options.onMount(bodyEl, close);

  return { close, bodyEl };
}

export function showConfirmDialog({ title, text, confirmLabel, onConfirm }) {
  return showModal({
    title,
    bodyHTML: `<div class="modal-text">${text}</div>`,
    confirmLabel: confirmLabel || "Confirmer",
    danger: true,
    onConfirm
  });
}

// ─── Helper navigation entre écrans (History API du navigateur) ───────────
// "screen-dashboard" et "screen-login" sont des écrans racine : y arriver
// remplace l'entrée d'historique courante au lieu d'en empiler une nouvelle
// (pas de retour vers un écran d'avant une connexion ou un enregistrement,
// ça n'aurait pas de sens — et ça permet au bouton retour natif du
// navigateur / au geste système Android-iOS de vraiment quitter l'appli
// depuis un écran racine, comme n'importe quelle appli).
//
// On s'appuie sur history.pushState/popstate plutôt que sur une pile
// maison : ainsi le bouton "←" natif de Chrome et le geste système de
// retour (qui n'avaient jusqu'ici rien à dépiler, donc fermaient l'onglet)
// suivent exactement la même navigation que le bouton "←" et le geste de
// bord internes à l'appli.
const ROOT_SCREENS = ["screen-dashboard", "screen-login"];

export function navigateTo(screenId) {
  const method = ROOT_SCREENS.includes(screenId) ? "replaceState" : "pushState";
  history[method]({ screen: screenId }, "", location.href);
  _showScreen(screenId);
}

// Revient à l'écran précédent réellement visité (pas une destination fixe).
export function goBack(fallbackScreenId = "screen-dashboard") {
  const current = history.state?.screen;
  if (current && !ROOT_SCREENS.includes(current)) {
    history.back(); // déclenche popstate, qui affiche l'écran précédent
  } else {
    navigateTo(fallbackScreenId);
  }
}

// Bouton retour natif du navigateur / geste système Android-iOS.
window.addEventListener("popstate", (e) => {
  _showScreen(e.state?.screen || "screen-dashboard");
});

function _showScreen(screenId) {
  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.add("hidden");
  });
  const target = document.getElementById(screenId);
  if (target) {
    target.classList.remove("hidden");
    target.scrollTop = 0;
  }
}

// ─── Geste de retour par balayage depuis le bord d'écran (Android/iOS) ────
// Réutilise le bouton "←" déjà présent sur l'écran visible (même logique
// de retour, même fallback) — pas de duplication de la pile d'historique.
export function setupEdgeSwipeBack() {
  const EDGE_ZONE = 24; // px depuis le bord pour démarrer le geste
  const MIN_DX    = 70; // déplacement horizontal minimum pour valider
  const MAX_DY    = 60; // tolérance verticale (évite de gêner le scroll)
  let startX = null, startY = null, active = false;

  document.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    const app = document.getElementById("app");
    const current = document.querySelector(".screen:not(.hidden)");
    if (!t || !app || !current?.querySelector(".topbar-back")) { active = false; return; }
    const rect = app.getBoundingClientRect();
    const fromLeft  = t.clientX - rect.left <= EDGE_ZONE;
    const fromRight = rect.right - t.clientX <= EDGE_ZONE;
    if (!fromLeft && !fromRight) { active = false; return; }
    startX = t.clientX;
    startY = t.clientY;
    active = true;
  }, { passive: true });

  document.addEventListener("touchend", (e) => {
    if (!active) return;
    active = false;
    const t = e.changedTouches[0];
    if (!t || startX === null) return;
    const dx = t.clientX - startX;
    const dy = Math.abs(t.clientY - startY);
    startX = null;
    if (dy > MAX_DY || Math.abs(dx) < MIN_DX) return;
    document.querySelector(".screen:not(.hidden)")?.querySelector(".topbar-back")?.click();
  }, { passive: true });
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
