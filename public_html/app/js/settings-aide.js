// ════════════════════════════════════════════════════════════════════════
// MémoTruck — Paramètres & Aide
// ════════════════════════════════════════════════════════════════════════

import { saveTheme, applyTheme, THEMES, THEME_PREVIEWS, getCurrentTheme } from "./theme.js";
import { dbUpdate } from "./supabase-client.js";
import { showToast, showConfirmDialog, navigateTo, escapeHtml } from "./ui-helpers.js";
import { clearSession } from "./auth.js";
import { stopCartesPersoListener } from "./cartes-perso.js";
import { stopDocPhotosListener, clearDocPhotosCache } from "./photo-docs.js";
import { stopInterventionsRealtime } from "./intervention-historique.js";
import { ATIL_VERSION } from "./utils.js";
import { openChangelogModal } from "./update-manager.js";

const WHATSAPP_NUMERO = "33650716507";

let appState = null;
export function setAppStateSettings(state) { appState = state; }

// ════════════════════════════════════════════════════════════════════════
// PARAMÈTRES
// ════════════════════════════════════════════════════════════════════════

export function setupSettingsScreenLogic() {
  // Le prénom est chargé automatiquement depuis la base de données à la connexion

  document.getElementById("btn-whatsapp").addEventListener("click", () => {
    const message = "Bonjour, j'ai une question concernant l'application MémoTruck.";
    window.open(`https://wa.me/${WHATSAPP_NUMERO}?text=${encodeURIComponent(message)}`, "_blank");
  });

  document.getElementById("btn-changelog").addEventListener("click", openChangelogModal);

  document.getElementById("btn-logout").addEventListener("click", handleLogout);

  document.getElementById("theme-accordion-toggle").addEventListener("click", () => {
    themeAccordionOpen = !themeAccordionOpen;
    renderThemeOptions();
  });

  document.getElementById("footer-parametres").textContent =
    `© 2026 · ${ATIL_VERSION} · MémoTruck`;
}

function handleLogout() {
  showConfirmDialog({
    title: "Déconnexion",
    text: "Voulez-vous vraiment vous déconnecter ?",
    confirmLabel: "Déconnecter",
    onConfirm: () => {
      // Stoppe les listeners temps réel
      if (appState.unsubTracteur)  appState.unsubTracteur();
      if (appState.unsubRemorque)  appState.unsubRemorque();
      if (appState.unsubChauffeur) appState.unsubChauffeur();
      if (appState.unsubEngin)     appState.unsubEngin();
      if (appState.unsubAdmin)     appState.unsubAdmin();
      stopCartesPersoListener();
      stopDocPhotosListener();
      stopInterventionsRealtime();
      clearDocPhotosCache();

      // Efface la session locale et le JWT
      clearSession();

      // Remet l'état à zéro
      appState.plaqueT        = "";
      appState.plaqueR        = "";
      appState.prenom         = "";
      appState.chauffeurId    = "";
      appState.chauffeur      = null;
      appState.tracteurData   = null;
      appState.remorqueData   = null;
      appState.vehiculeData   = null;
      appState.unsubTracteur  = null;
      appState.unsubRemorque  = null;
      appState.unsubChauffeur = null;
      appState.unsubEngin     = null;
      appState.unsubAdmin     = null;

      // Remet l'écran de connexion à zéro
      document.getElementById("input-email").value = "";
      // S'assure qu'on est bien sur le panel "connexion" (pas inscription)
      document.getElementById("login-panel-connexion").classList.remove("hidden");
      document.getElementById("login-panel-inscription").classList.add("hidden");

      navigateTo("screen-login");
    }
  });
}

export function openParametresScreen() {
  renderThemeOptions();
  navigateTo("screen-parametres");
}

let themeAccordionOpen = false;

function renderThemeOptions() {
  const container = document.getElementById("theme-options");
  const current   = getCurrentTheme();

  document.getElementById("theme-current-label").textContent = THEME_PREVIEWS[current].titre;
  document.getElementById("theme-accordion-card").classList.toggle("is-open", themeAccordionOpen);
  document.getElementById("theme-accordion-chevron").classList.toggle("rotated", themeAccordionOpen);
  document.getElementById("theme-options-wrap").classList.toggle("expanded", themeAccordionOpen);

  container.innerHTML = Object.values(THEMES).map((theme) => {
    const preview    = THEME_PREVIEWS[theme];
    const isSelected = current === theme;
    return `
      <div class="theme-option-card ${isSelected ? "selected" : ""}" data-theme-select="${theme}">
        <div class="theme-preview-colors">
          ${preview.colors.map((c) => `<span style="background:${c};"></span>`).join("")}
        </div>
        <div class="theme-option-info">
          <div class="theme-option-title">${preview.titre}</div>
          <div class="theme-option-desc">${preview.description}</div>
        </div>
        ${isSelected ? '<span class="theme-check">✓</span>' : ""}
      </div>
    `;
  }).join("");

  container.querySelectorAll("[data-theme-select]").forEach((el) => {
    el.addEventListener("click", () => {
      const theme = el.dataset.themeSelect;
      saveTheme(theme);
      renderThemeOptions();
      if (appState?.render) {
        appState.render();
        // Réinjecte les orbes après le re-render car le DOM est recréé
        setTimeout(() => applyTheme(theme), 50);
      }
      // Sauvegarde sur le compte (best-effort, l'appareil garde déjà la
      // préférence localement même hors-ligne ou en cas d'échec réseau).
      if (appState?.chauffeurId) {
        dbUpdate("chauffeurs", { theme_prefere: theme }, [
          { col: "id", op: "eq", val: appState.chauffeurId }
        ]).catch((e) => console.warn("[theme] sauvegarde compte échouée:", e.message));
      }
    });
  });
}

// ════════════════════════════════════════════════════════════════════════
// AIDE / FAQ
// ════════════════════════════════════════════════════════════════════════

const FAQ_ITEMS = [
  {
    question: "Comment fonctionne la jauge des pneus ?",
    reponse: "La jauge additionne uniquement les kilomètres réellement saisis dans le suivi Consommation depuis la date de pose du pneu concerné. Un jour sans saisie compte pour 0 km (aucune estimation automatique). C'est pour ça qu'à la prise de service, l'appli te relance si une saisie de la veille (ou du week-end le lundi) est manquante — pour que la jauge reste toujours juste. Rien d'autre à faire, elle se met à jour automatiquement dès que tu ajoutes ta conso du jour."
  },
  {
    question: "Le kilométrage noté lors du changement de pneu influence-t-il la jauge ?",
    reponse: "Non. Le kilométrage au compteur saisi au moment du changement sert uniquement de référence informative pour savoir à quel compteur les pneus ont été posés. Seule la somme des km saisis en Consommation depuis la date de pose détermine l'usure affichée."
  },
  {
    question: "Quels sont les seuils objectif pour chaque type de pneu ?",
    reponse: "• Pneus AVANT tracteur : 100 000 km — ce sont les plus chers, on les garde le plus longtemps.\n• Pneus ARRIÈRE tracteur (moteur) : 50 000 km — ils s'usent plus vite à cause de la traction.\n• Pneus REMORQUE (3 essieux) : 70 000 km — usure intermédiaire."
  },
  {
    question: "Que signifient les couleurs de la jauge pneu ?",
    reponse: "🟢 Vert — moins de 50% de l'objectif atteint, pneu en bon état.\n🟡 Jaune — entre 50% et 85%, usure en cours, à surveiller.\n🟠 Orange — entre 85% et 100%, approche du seuil, préparer le remplacement.\n🔴 Rouge — seuil dépassé, inspection recommandée."
  },
  {
    question: "Comment fonctionnent les cartes « Véhicules », « Données personnelles » et « Cartes Gazole » ?",
    reponse: "Le tableau de bord regroupe les échéances par catégorie dans des cartes que tu peux déplier en appuyant dessus :\n\n🚛 Véhicules : CT Tracteur, CT Remorque, Limiteur de vitesse, Chronotachygraphe.\n👤 Données personnelles : Carte Conducteur, Visite médicale, FCO, ADR.\n⛽ Cartes Gazole : AS24, TOTAL avec leur date d'expiration et un code mémo masqué.\n\nChaque carte prend la couleur de l'échéance la plus urgente qu'elle contient."
  },
  {
    question: "Comment fonctionne le suivi de consommation ?",
    reponse: "Chaque soir, appuie sur la carte « Consommation » du tableau de bord pour ouvrir le détail, puis sur le bouton + pour ajouter ta conso du jour. Saisis le kilométrage du jour et la moyenne L/100km affichée sur l'écran de bord — le litrage se calcule automatiquement."
  },
  {
    question: "Comment enregistrer une intervention ?",
    reponse: "Appuie sur « Enregistrer une intervention » depuis le tableau de bord. Tu peux choisir le type (Entretien, Panne, Crevaison), le véhicule concerné, la date, et ajouter des notes. En cas de crevaison, tu peux préciser la localisation du pneu."
  },
  {
    question: "Comment créer un compte ?",
    reponse: "Sur l'écran de connexion, appuie sur « Créer un compte ». Renseigne ton email, ton prénom, ton nom et le code entreprise fourni par ton responsable. Ton compte sera visible par l'admin qui devra le valider avant que tu puisses te connecter."
  },
  {
    question: "Comment me connecter une fois mon compte validé ?",
    reponse: "Il suffit de saisir ton adresse email sur l'écran de connexion et d'appuyer sur « Se connecter ». Ton tracteur et ta remorque sont affectés par ton exploitant directement dans la base — tu n'as rien à saisir toi-même."
  },
  {
    question: "Que se passe-t-il si je me déconnecte ?",
    reponse: "Ta session est effacée de l'appareil. À la prochaine connexion, il suffit de ressaisir ton email. Toutes tes données restent intactes dans la base de données."
  },
  {
    question: "Puis-je corriger ou supprimer une saisie erronée ?",
    reponse: "Oui. Dans le détail de la carte « Consommation », chaque ligne a une icône crayon (modifier) et une icône poubelle (supprimer). Dans « Voir l'historique », tu peux supprimer une intervention via l'icône poubelle. Une confirmation est toujours demandée avant suppression définitive."
  }
];

const openFaq = {};

export function openAideScreen() {
  renderAideContent();
  navigateTo("screen-aide");
}

function renderAideContent() {
  const container = document.getElementById("aide-content");

  const introHTML = `
    <div class="faq-intro-card">
      <span class="icon">ℹ️</span>
      <div class="text">Appuie sur une question pour afficher la réponse. Rappuie pour fermer.</div>
    </div>
  `;

  const itemsHTML = FAQ_ITEMS.map((item, idx) => {
    const isOpen = !!openFaq[idx];
    return `
      <div class="faq-card ${isOpen ? "is-open" : ""}" data-faq-toggle="${idx}">
        <div class="faq-question-row">
          <div class="faq-question-text">${escapeHtml(item.question)}</div>
          <span class="chevron ${isOpen ? "rotated" : ""}">⌄</span>
        </div>
        <div class="faq-answer ${isOpen ? "expanded" : ""}">${escapeHtml(item.reponse)}</div>
      </div>
    `;
  }).join("");

  container.innerHTML = introHTML + itemsHTML +
    `<div class="atil-footer">© 2026 · ${ATIL_VERSION} · MémoTruck</div>`;

  container.querySelectorAll("[data-faq-toggle]").forEach((el) => {
    el.addEventListener("click", () => {
      const idx    = el.dataset.faqToggle;
      const wasOpen = !!openFaq[idx];
      Object.keys(openFaq).forEach((k) => delete openFaq[k]);
      if (!wasOpen) openFaq[idx] = true;
      renderAideContent();
    });
  });
}
