// ════════════════════════════════════════════════════════════════════════
// MémoTruck — Gestion des mises à jour in-app (PWA)
// - Enregistre le service worker et surveille l'arrivée d'une nouvelle version
// - Affiche une popup "Mise à jour disponible" (générique) pour déclencher
//   l'application de la MAJ
// - Une fois la MAJ appliquée et la page rechargée, affiche une popup
//   "Nouveautés" avec le vrai détail des changements — impossible de le
//   faire de façon fiable AVANT le rechargement : le code encore chargé à
//   ce moment-là est toujours l'ANCIENNE version, donc le contenu de
//   js/changelog.js qu'il connaît est lui aussi l'ancien (les modules JS ne
//   se rechargent pas tout seuls). D'où les deux étapes séparées.
// - Purge des anciens caches déjà gérée côté service-worker.js — plus
//   besoin de désinstaller/réinstaller l'appli à chaque MAJ.
// ════════════════════════════════════════════════════════════════════════

import { showModal } from "./ui-helpers.js";
import { CHANGELOG } from "./changelog.js";

const LAST_SEEN_VERSION_KEY = "memotruck_last_seen_version";
const JUST_UPDATED_KEY      = "memotruck_just_updated"; // sessionStorage, une seule fois après reload
const CHECK_INTERVAL_MS     = 60 * 60 * 1000; // vérifie une nouvelle version toutes les heures

let _reloading = false;

export function initUpdateManager() {
  if (!("serviceWorker" in navigator)) return;

  // Nouvelle installation : pas d'historique connu, on ne veut pas montrer
  // un "Nouveautés" au tout premier lancement — on marque direct comme vu.
  if (!localStorage.getItem(LAST_SEEN_VERSION_KEY)) {
    localStorage.setItem(LAST_SEEN_VERSION_KEY, CHANGELOG[0].version);
  }

  // Ce chargement fait suite à une mise à jour qu'on vient d'appliquer
  // (voir showUpdatePromptModal) : le code tournant maintenant EST la
  // nouvelle version, donc CHANGELOG est fiable — on peut enfin afficher
  // le vrai détail des nouveautés.
  if (sessionStorage.getItem(JUST_UPDATED_KEY)) {
    sessionStorage.removeItem(JUST_UPDATED_KEY);
    showWhatsNewModal();
  }

  navigator.serviceWorker.register("/app/service-worker.js").then((reg) => {
    // Un service worker était déjà en attente (popup ignorée avant fermeture) :
    // reproposer la mise à jour tout de suite.
    if (reg.waiting && navigator.serviceWorker.controller) {
      showUpdatePromptModal(reg);
    }

    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener("statechange", () => {
        // "installed" + un controller déjà actif = vraie mise à jour
        // (sinon c'est juste la toute première installation du service worker)
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          showUpdatePromptModal(reg);
        }
      });
    });

    // Vérifie régulièrement côté serveur si le service-worker.js a changé
    // (au chargement, au retour au premier plan, puis toutes les heures).
    reg.update().catch(() => {});
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") reg.update().catch(() => {});
    });
    setInterval(() => reg.update().catch(() => {}), CHECK_INTERVAL_MS);
  }).catch((err) => console.warn("Service worker non enregistré :", err));

  // Une fois le nouveau service worker activé, il prend le contrôle de la
  // page : on recharge pour charger les nouveaux fichiers (HTML/CSS/JS).
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (_reloading) return;
    _reloading = true;
    window.location.reload();
  });
}

// Popup affichée AVANT la mise à jour, pour déclencher son application.
// Volontairement générique (pas de détail des changements ici) : le code
// encore actif à cet instant est l'ancienne version, afficher son
// changelog serait trompeur (ce ne sont pas les nouveautés qu'on est sur
// le point d'installer). Le vrai détail arrive juste après, sur la page
// rechargée (voir showWhatsNewModal).
function showUpdatePromptModal(reg) {
  showModal({
    title: "🚀 Mise à jour disponible",
    bodyHTML: `<div class="modal-text">Une nouvelle version de MémoTruck est prête. Le détail des nouveautés s'affichera juste après la mise à jour.</div>`,
    confirmLabel: "Mettre à jour maintenant",
    cancelLabel: "Plus tard",
    onConfirm: () => {
      sessionStorage.setItem(JUST_UPDATED_KEY, "1");
      reg.waiting?.postMessage("SKIP_WAITING");
    }
  });
}

// Entrées à afficher : tout ce qui est nouveau depuis la dernière fois où
// l'utilisateur a vu un changelog (popup ou écran Nouveautés) — pas juste
// la toute dernière version, pour ne rien lui faire louper s'il a sauté
// plusieurs mises à jour d'affilée.
function getEntriesSinceLastSeen() {
  const lastSeen = localStorage.getItem(LAST_SEEN_VERSION_KEY);
  const idx = lastSeen ? CHANGELOG.findIndex((e) => e.version === lastSeen) : -1;
  // idx === -1 : version inconnue/trop ancienne (plus dans la liste) → on ne
  //              remonte pas tout l'historique, juste la dernière entrée.
  // idx === 0  : la dernière entrée a déjà été vue.
  // idx > 0    : tout ce qu'il y a de nouveau depuis lastSeen (entrées 0..idx-1).
  return idx > 0 ? CHANGELOG.slice(0, idx) : [CHANGELOG[0]];
}

function markChangelogSeen() {
  localStorage.setItem(LAST_SEEN_VERSION_KEY, CHANGELOG[0].version);
}

function showWhatsNewModal() {
  showModal({
    title: "🎉 Nouveautés",
    bodyHTML: buildChangelogHTML(getEntriesSinceLastSeen()),
    confirmLabel: "Super !",
    cancelLabel: null,
    onClose: markChangelogSeen
  });
}

function buildChangelogHTML(entries) {
  return entries.map((entry) => `
    <div class="changelog-entry">
      <div class="changelog-version-row">
        <span class="changelog-version">${entry.version}</span>
        <span class="changelog-date">${new Date(entry.date).toLocaleDateString("fr-FR")}</span>
      </div>
      <ul class="changelog-list">
        ${entry.changes.map((c) => `<li>${c}</li>`).join("")}
      </ul>
    </div>
  `).join("");
}

// Affiche l'historique complet des mises à jour (accessible depuis Paramètres).
export function openChangelogModal() {
  showModal({
    title: "📋 Nouveautés",
    bodyHTML: buildChangelogHTML(CHANGELOG),
    confirmLabel: "Fermer",
    cancelLabel: null,
    onClose: markChangelogSeen
  });
}
