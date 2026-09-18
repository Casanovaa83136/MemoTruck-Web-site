// ════════════════════════════════════════════════════════════════════════
// MémoTruck — Utilitaires métier
// Adapté Supabase : les dates arrivent en ISO string "YYYY-MM-DD"
// (plus de Timestamp Firestore ni .toDate())
// ════════════════════════════════════════════════════════════════════════

import { CHANGELOG } from "./changelog.js";
import { dbSelect, getClient } from "./supabase-client.js";

// Dérivée de l'entrée la plus récente de js/changelog.js — un seul endroit
// à modifier (voir le commentaire en tête de ce fichier) à chaque release.
export const ATIL_VERSION = CHANGELOG[0].version;

// ─── Constantes métier (identiques à Android) ────────────────────────────
export const SEUIL_PNEU_AVANT   = 100_000;
export const SEUIL_PNEU_ARRIERE = 50_000;
export const SEUIL_PNEU_REMORQUE = 70_000;

export const CARTES_GAZOLE = [
  { nom: "AS24",  champDate: "date_carte_as24",  champCode: "code_carte_as24"  },
  { nom: "TOTAL", champDate: "date_carte_total", champCode: "code_carte_total" }
];

// Champs dates pour le score de santé.
// NB : date_chronotachygraphe est sur le tracteur (tracteurData),
//      les docs perso sont sur le chauffeur (chauffeurData).
// app.js construit un objet "vehiculeData" fusionné des deux.
export const CHAMPS_DATES_SANTE = [
  { label: "CT Tracteur",          champ: "date_ct",                 source: "tracteur" },
  { label: "CT Remorque",          champ: "date_ct_remorque",        source: "remorque" },
  { label: "Assurance Tracteur",   champ: "date_assurance_tracteur", source: "tracteur" },
  { label: "Assurance Remorque",   champ: "date_assurance_remorque", source: "remorque" },
  { label: "Limiteur de Vitesse",  champ: "date_limiteur_vitesse",   source: "tracteur" },
  { label: "Chronotachygraphe",    champ: "date_chronotachygraphe",  source: "tracteur" },
  { label: "Carte Conducteur",     champ: "date_carte_conducteur",   source: "chauffeur" },
  { label: "Visite médicale",      champ: "date_visite_medicale",    source: "chauffeur" },
  { label: "FCO",                  champ: "date_fco",                source: "chauffeur" },
  { label: "ADR",                  champ: "date_adr",                source: "chauffeur" },
  { label: "Carte d'identité",     champ: "date_carte_identite",     source: "chauffeur" }
];

// ─── Normalisation date ───────────────────────────────────────────────────
// Accepte : Date JS, ISO string "YYYY-MM-DD", null/undefined.
// Retourne toujours une Date JS (minuit heure locale) ou null.
export function toDate(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === "string") {
    // "YYYY-MM-DD" → évite le décalage UTC en forçant l'heure locale
    const d = new Date(`${val}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// ─── Formatage dates (équivalent SimpleDateFormat) ───────────────────────
const MOIS_FR = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
const JOURS_FR = ["dimanche","lundi","mardi","mercredi","jeudi","vendredi","samedi"];

export function formatDateFR(val) {
  const d = toDate(val);
  if (!d) return null;
  const jj = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${jj}/${mm}/${yyyy}`;
}

export function formatDateLongFR(val) {
  const d = toDate(val);
  if (!d) return "—";
  return `${JOURS_FR[d.getDay()]} ${d.getDate()} ${MOIS_FR[d.getMonth()]}`;
}

export function formatMoisAnneeFR(val) {
  const d = toDate(val) || new Date();
  const mois = MOIS_FR[d.getMonth()];
  return mois.charAt(0).toUpperCase() + mois.slice(1) + " " + d.getFullYear();
}

export function moisCleDeDate(val) {
  const d = toDate(val) || new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function moisLabelDeCle(cle) {
  const [annee, mois] = cle.split("-").map(Number);
  if (!annee || !mois) return cle;
  const nom = MOIS_FR[mois - 1];
  return nom.charAt(0).toUpperCase() + nom.slice(1) + " " + annee;
}

// ─── Calcul jauge pneu ────────────────────────────────────────────────────
// entries = [{ date: Date|ISOstring, km: number }]
export const KM_DEFAUT_SANS_SAISIE = 0;

export function kmParcourusDepuisPose(datePoseVal, entries) {
  const datePose = toDate(datePoseVal);
  if (!datePose) return 0;
  const entriesDepuisPose = (entries || []).filter((e) => {
    const d = toDate(e.date);
    return d && d >= datePose;
  });
  if (!entriesDepuisPose.length) return KM_DEFAUT_SANS_SAISIE;
  return entriesDepuisPose.reduce((total, e) => total + (e.km || 0), 0);
}

export function ratioUsurePneu(datePoseVal, entries, seuilKm) {
  if (!datePoseVal) return null;
  const km = kmParcourusDepuisPose(datePoseVal, entries);
  return Math.min(1, Math.max(0, km / seuilKm));
}

export function rangStatutPneu(datePoseVal, entries, seuilKm) {
  if (!datePoseVal) return -1;
  const ratio = ratioUsurePneu(datePoseVal, entries, seuilKm);
  if (ratio >= 1.0) return 3;
  if (ratio >= 0.85) return 2;
  if (ratio >= 0.50) return 1;
  return 0;
}

export function couleurStatutPneu(datePoseVal, entries, seuilKm) {
  if (!datePoseVal) return "var(--color-text-secondary)";
  const ratio = ratioUsurePneu(datePoseVal, entries, seuilKm);
  if (ratio >= 1.0) return "var(--color-danger)";
  if (ratio >= 0.85) return "var(--color-warning)";
  if (ratio >= 0.50) return "#FFD54F";
  return "var(--color-success)";
}

export function labelStatutPneu(datePoseVal, entries, seuilKm) {
  if (!datePoseVal) return "Date de pose non renseignée";
  const ratio = ratioUsurePneu(datePoseVal, entries, seuilKm);
  if (ratio >= 1.0) return "⚠️ Seuil dépassé — à surveiller";
  if (ratio >= 0.85) return "Approche du seuil — préparer remplacement";
  if (ratio >= 0.50) return "Usure en cours";
  return "Bon état";
}

// ─── Calcul statut date ───────────────────────────────────────────────────
function diffJours(val) {
  const d = toDate(val);
  if (!d) return null;
  return Math.floor((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export function rangStatut(val) {
  if (!val) return -1;
  const diff = diffJours(val);
  if (diff === null) return -1;
  if (diff < 0)  return 3;
  if (diff < 15) return 2;
  if (diff < 60) return 1;
  return 0;
}

export function getStatusColor(val) {
  if (!val) return "var(--color-text-secondary)";
  const diff = diffJours(val);
  if (diff === null) return "var(--color-text-secondary)";
  if (diff < 0)  return "var(--color-danger)";
  if (diff < 15) return "var(--color-warning)";
  if (diff < 60) return "#FFD54F";
  return "var(--color-success)";
}

export function getStatusColorStatic(val) {
  if (!val) return "#78909C";
  const diff = diffJours(val);
  if (diff === null) return "#78909C";
  if (diff < 0)  return "#FF5252";
  if (diff < 15) return "#FFB300";
  if (diff < 60) return "#FFD54F";
  return "#00E676";
}

export function getStatusLabel(val) {
  if (!val) return "Non renseigné";
  const diff = diffJours(val);
  if (diff === null) return "Non renseigné";
  if (diff < 0)  return `EXPIRÉ (${-diff}j)`;
  if (diff === 0) return "Expire AUJOURD'HUI — URGENT";
  if (diff < 15) return `Expire dans ${diff}j — URGENT`;
  if (diff < 60) return `Expire dans ${diff}j`;
  return `Valide — ${diff}j restants`;
}

// ─── Validation des saisies ───────────────────────────────────────────────
// Variante pour <input type="date"> natif (sélecteur calendrier) : la valeur
// est déjà au format ISO "YYYY-MM-DD" (ou vide), donc pas de parsing
// jj/mm/aaaa — seules les bornes (15 ans dans le passé, 5 ans dans le futur)
// sont vérifiées. Retourne directement la string ISO, prête pour Supabase.
export function validerDateISO(input, maxAnneesFutur = 5) {
  if (!input) return { valeur: null, erreur: "La date ne peut pas être vide" };
  const parsed = toDate(input);
  if (!parsed) return { valeur: null, erreur: "Date invalide" };

  const limiteMin = new Date();
  limiteMin.setFullYear(limiteMin.getFullYear() - 15);
  const limiteMax = new Date();
  limiteMax.setFullYear(limiteMax.getFullYear() + maxAnneesFutur);

  if (parsed < limiteMin) return { valeur: null, erreur: "Date trop ancienne (max 15 ans)" };
  if (parsed > limiteMax) return { valeur: null, erreur: `Date trop éloignée dans le futur (max ${maxAnneesFutur} ans)` };
  return { valeur: input, erreur: null };
}

// Bornes futures spécifiques par champ, quand 5 ans (défaut) est trop court —
// ex. la carte d'identité française est valide 15 ans pour un majeur.
const MAX_ANNEES_FUTUR_PAR_CHAMP = {
  date_carte_identite: 16,
};

export function maxAnneesFuturPourChamp(fieldName) {
  return MAX_ANNEES_FUTUR_PAR_CHAMP[fieldName] || 5;
}

export function validerNombrePositif(input, champ, max = 9_999_999) {
  if (!input || !input.toString().trim()) return { valeur: null, erreur: `${champ} ne peut pas être vide` };
  const valeur = parseFloat(input.toString().replace(",", "."));
  if (isNaN(valeur)) return { valeur: null, erreur: `${champ} doit être un nombre valide` };
  if (valeur < 0)    return { valeur: null, erreur: `${champ} ne peut pas être négatif` };
  if (valeur > max)  return { valeur: null, erreur: `${champ} semble anormalement élevé, vérifie la saisie` };
  return { valeur, erreur: null };
}

export function validerMoyenneConso(input)  { return validerNombrePositif(input, "La moyenne L/100km", 200); }
export function validerKilometres(input)    { return validerNombrePositif(input, "Le kilométrage", 3000); }

export function validerKmCompteur(input) {
  if (!input || !input.toString().trim()) return { valeur: 0, erreur: null };
  const valeur = parseInt(input, 10);
  if (isNaN(valeur))    return { valeur: null, erreur: "Le kilométrage compteur doit être un nombre entier" };
  if (valeur < 0)       return { valeur: null, erreur: "Le kilométrage ne peut pas être négatif" };
  if (valeur > 5_000_000) return { valeur: null, erreur: "Kilométrage compteur anormalement élevé" };
  return { valeur, erreur: null };
}

// ─── Gestion erreurs réseau / Supabase ───────────────────────────────────
// Message générique pour les actions SANS file d'attente offline (suppression,
// édition d'intervention, etc.) — ne jamais promettre une synchronisation
// automatique ici : seules les créations d'intervention/consommation sont
// mises en file (voir intervention-historique.js / consommation.js), tout le
// reste doit simplement être retenté par l'utilisateur.
export function messageErreurSupabase(error) {
  const msg = (error && error.message) || "";
  if (/network|fetch|unavailable/i.test(msg)) {
    return "📡 Pas de connexion internet. Réessaie une fois la connexion rétablie.";
  }
  if (/permission|denied|403|401/i.test(msg)) {
    return "⛔ Accès refusé. Contacte le support si le problème persiste.";
  }
  if (/row-level security/i.test(msg)) {
    return "⛔ Cette intervention a déjà été prise en charge par l'atelier — elle ne peut plus être modifiée.";
  }
  return "⚠️ Une erreur est survenue, réessaie dans quelques instants.";
}

// ─── Formatage nombres ────────────────────────────────────────────────────
export function formatMilliers(n) {
  return Math.round(n).toLocaleString("fr-FR");
}

export function formatDecimal(n, decimales = 1) {
  return n.toFixed(decimales).replace(".", ",");
}

// Champs dates communs aux engins BTP (utilisé pour l'affichage ET les alertes)
export const CHAMPS_ENGIN = [
  { key: "date_assurance", label: "Assurance" },
  { key: "date_vgp",       label: "VGP"       },
  { key: "date_entretien", label: "Entretien" },
];

// ─── Score de santé global ────────────────────────────────────────────────
function healthScoreFromRang(rang) {
  switch (rang) {
    case 0: return 100;
    case 1: return 75;
    case 2: return 40;
    case 3: return 0;
    default: return -1;
  }
}

// vehiculeData = objet fusionné { ...tracteurData, ...remorqueData (prefixé), ...chauffeurData }
// Construit par app.js via buildVehiculeData()
export function calculerSanteFlotte(vehiculeData, consoEntriesMoteur, cartesPerso = [], consoEntriesRemorque = [], profilMoteur = null, profilRemorque = null, enginsData = []) {
  const d = vehiculeData || {};
  const scores = [];
  const alertes = [];

  CHAMPS_DATES_SANTE.forEach(({ label, champ }) => {
    const rang  = rangStatut(d[champ]);
    const score = healthScoreFromRang(rang);
    if (score >= 0) scores.push(score);
    if (rang >= 2)  alertes.push({ label, rang });
  });

  CARTES_GAZOLE.forEach((info) => {
    const rang  = rangStatut(d[info.champDate]);
    const score = healthScoreFromRang(rang);
    if (score >= 0) scores.push(score);
    if (rang >= 2)  alertes.push({ label: info.nom, rang });
  });

  // ── Pneus moteur dynamiques selon profil ─────────────────────────────
  const pm        = PROFILS_MOTEUR.find(p => p.id === profilMoteur) || null;
  const nbAvant   = pm ? pm.essieux_avant   : 1;
  const nbArriere = pm ? pm.essieux_arriere : 1;

  for (let i = 0; i < nbAvant; i++) {
    const fieldDate = i === 0 ? "date_pose_avant" : "date_pose_avant2";
    const label     = nbAvant > 1 ? `Pneus Avant ${i + 1}` : "Pneus Avant";
    const rang  = rangStatutPneu(d[fieldDate], consoEntriesMoteur, SEUIL_PNEU_AVANT);
    const score = healthScoreFromRang(rang);
    if (score >= 0) scores.push(score);
    if (rang >= 2)  alertes.push({ label, rang });
  }
  for (let i = 0; i < nbArriere; i++) {
    const label = nbArriere > 1 ? `Pneus Arrière ${i + 1}` : "Pneus Arrière";
    const rang  = rangStatutPneu(d["date_pose_arriere"], consoEntriesMoteur, SEUIL_PNEU_ARRIERE);
    const score = healthScoreFromRang(rang);
    if (score >= 0) scores.push(score);
    if (rang >= 2)  alertes.push({ label, rang });
  }

  // ── Pneus remorque dynamiques selon profil ────────────────────────────
  const pr        = PROFILS_REMORQUE.find(p => p.id === profilRemorque) || null;
  const nbEssieux = pr ? pr.nb_essieux : (d["date_pose_e1"] ? 3 : 0);
  const FIELDS_R  = ["date_pose_e1","date_pose_e2","date_pose_e3","date_pose_e4","date_pose_e5","date_pose_e6"];
  const LABELS_R  = ["1er Essieu Remorque","2ème Essieu Remorque","3ème Essieu Remorque","4ème Essieu Remorque","5ème Essieu Remorque","6ème Essieu Remorque"];

  for (let i = 0; i < nbEssieux; i++) {
    const rang  = rangStatutPneu(d[FIELDS_R[i]], consoEntriesRemorque, SEUIL_PNEU_REMORQUE);
    const score = healthScoreFromRang(rang);
    if (score >= 0) scores.push(score);
    if (rang >= 2)  alertes.push({ label: LABELS_R[i], rang });
  }

  // ── Groupe frigo / nettoyage intérieur — porteur (moteur) ─────────────
  // Champs non préfixés côté moteur (porteur frigo), "_remorque" côté
  // remorque — même convention que date_ct / date_ct_remorque.
  if (pm && pm.docs && pm.docs.includes("frigo")) {
    const rang  = rangStatut(d["date_entretien_frigo"]);
    const score = healthScoreFromRang(rang);
    if (score >= 0) scores.push(score);
    if (rang >= 2)  alertes.push({ label: "Entretien Groupe Frigo", rang });
  }
  if (pm && pm.docs && pm.docs.includes("nettoyage")) {
    const rang  = rangStatut(d["date_nettoyage_interieur"]);
    const score = healthScoreFromRang(rang);
    if (score >= 0) scores.push(score);
    if (rang >= 2)  alertes.push({ label: "Nettoyage Intérieur", rang });
  }
  if (d["a_hayon"]) {
    const rang  = rangStatut(d["date_hayon"]);
    const score = healthScoreFromRang(rang);
    if (score >= 0) scores.push(score);
    if (rang >= 2)  alertes.push({ label: "Hayon", rang });
  }

  // ── Groupe frigo / nettoyage intérieur / graissage — remorque ─────────
  if (pr && pr.docs && pr.docs.includes("frigo")) {
    const rang  = rangStatut(d["date_entretien_frigo_remorque"]);
    const score = healthScoreFromRang(rang);
    if (score >= 0) scores.push(score);
    if (rang >= 2)  alertes.push({ label: d["bi_temperature"] ? "Entretien Groupe Frigo Remorque (Bi-température)" : "Entretien Groupe Frigo Remorque", rang });
  }
  if (pr && pr.docs && pr.docs.includes("nettoyage")) {
    const rang  = rangStatut(d["date_nettoyage_interieur_remorque"]);
    const score = healthScoreFromRang(rang);
    if (score >= 0) scores.push(score);
    if (rang >= 2)  alertes.push({ label: "Nettoyage Intérieur Remorque", rang });
  }
  if (pr && pr.docs && pr.docs.includes("graissage")) {
    const rang  = rangStatut(d["date_graissage"]);
    const score = healthScoreFromRang(rang);
    if (score >= 0) scores.push(score);
    if (rang >= 2)  alertes.push({ label: "Graissage Articulations", rang });
  }
  // Le hayon est une option cochée sur le véhicule lui-même (a_hayon),
  // indépendante du profil — pas un doc du profil comme frigo/nettoyage/graissage.
  if (d["a_hayon_remorque"]) {
    const rang  = rangStatut(d["date_hayon_remorque"]);
    const score = healthScoreFromRang(rang);
    if (score >= 0) scores.push(score);
    if (rang >= 2)  alertes.push({ label: "Hayon Remorque", rang });
  }

  cartesPerso.forEach((carte) => {
    if (!carte.aDate) return;
    const rang  = rangStatut(carte.dateValeur);
    const score = healthScoreFromRang(rang);
    if (score >= 0) scores.push(score);
    if (rang >= 2)  alertes.push({ label: carte.label, rang });
  });

  // ── Engins BTP ────────────────────────────────────────────────────────
  (enginsData || []).forEach(engin => {
    const nom = engin.numero_parc || engin.numero_serie || "Engin";
    CHAMPS_ENGIN.forEach(({ key, label }) => {
      if (!engin[key]) return;
      const rang  = rangStatut(engin[key]);
      const score = healthScoreFromRang(rang);
      if (score >= 0) scores.push(score);
      if (rang >= 2)  alertes.push({ label: `${nom} — ${label}`, rang });
    });
  });

  const pourcentage = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 100;

  return { pourcentage, alertes };
}

// ════════════════════════════════════════════════════════════════════════
// PROFILS VÉHICULE
// ════════════════════════════════════════════════════════════════════════

// Ces deux tableaux sont des `let` (pas `const`) : ils servent de secours
// hors-ligne / avant premier chargement, mais chargerProfilsDepuisDB() les
// remplace au démarrage par le catalogue Supabase (table profils_vehicules),
// éditable depuis le panel superadmin (profils globaux) et le panel bureau
// (profils perso par entreprise). Voir chargerProfilsDepuisDB plus bas.
export let PROFILS_MOTEUR = [
  // ─ Transport routier ─
  { id: "porteur_19t",      label: "Porteur 19t",         essieux_avant: 1, essieux_arriere: 1, docs: ["ct","assurance","limiteur","chrono"], peut_tracter_remorque: true  },
  { id: "porteur_26t",      label: "Porteur 26t",         essieux_avant: 1, essieux_arriere: 2, docs: ["ct","assurance","limiteur","chrono"], peut_tracter_remorque: true  },
  { id: "porteur_32t",      label: "Porteur 32t",         essieux_avant: 1, essieux_arriere: 3, docs: ["ct","assurance","limiteur","chrono"], peut_tracter_remorque: true  },
  { id: "porteur_32t_8x4",  label: "Porteur 32t 8x4",    essieux_avant: 2, essieux_arriere: 2, docs: ["ct","assurance","limiteur","chrono"], peut_tracter_remorque: true  },
  { id: "tracteur_4x2",     label: "Tracteur 4x2",       essieux_avant: 1, essieux_arriere: 1, docs: ["ct","assurance","limiteur","chrono"], peut_tracter_remorque: true  },
  { id: "tracteur_6x2",     label: "Tracteur 6x2",       essieux_avant: 1, essieux_arriere: 2, docs: ["ct","assurance","limiteur","chrono"], peut_tracter_remorque: true  },
  { id: "tracteur_6x4",     label: "Tracteur 6x4",       essieux_avant: 1, essieux_arriere: 2, docs: ["ct","assurance","limiteur","chrono"], peut_tracter_remorque: true  },
  // ─ Agricole ─
  { id: "tracteur_agricole", label: "Tracteur agricole", essieux_avant: 1, essieux_arriere: 1, docs: ["ct","assurance"],                    peut_tracter_remorque: true  },
  // ─ Utilitaires ─
  { id: "voiture_societe",   label: "Voiture de société",essieux_avant: 1, essieux_arriere: 1, docs: ["ct","assurance"],                    peut_tracter_remorque: false },
  { id: "utilitaire",        label: "Utilitaire / Fourgon",essieux_avant:1,essieux_arriere: 1, docs: ["ct","assurance"],                    peut_tracter_remorque: false },
];

export let PROFILS_REMORQUE = [
  { id: "remorque_1e",   label: "Remorque 1 essieu (city)", nb_essieux: 1, docs: ["ct","assurance"] },
  { id: "remorque_2e",   label: "Remorque 2 essieux",       nb_essieux: 2, docs: ["ct","assurance"] },
  { id: "remorque_3e",   label: "Remorque 3 essieux",       nb_essieux: 3, docs: ["ct","assurance"] },
  { id: "porte_char_4e", label: "Porte-char 4 essieux",     nb_essieux: 4, docs: ["ct","assurance"] },
  { id: "porte_char_5e", label: "Porte-char 5 essieux",     nb_essieux: 5, docs: ["ct","assurance"] },
  { id: "porte_char_6e", label: "Porte-char 6 essieux",     nb_essieux: 6, docs: ["ct","assurance"] },
  // ─ Citernes alimentaires (mémo compartiments : produit + volume) ─
  { id: "citerne_alim_2c", label: "Citerne alimentaire 2 compartiments", nb_essieux: 3, nb_compartiments: 2, docs: ["ct","assurance"] },
  { id: "citerne_alim_3c", label: "Citerne alimentaire 3 compartiments", nb_essieux: 3, nb_compartiments: 3, docs: ["ct","assurance"] },
  { id: "citerne_alim_4c", label: "Citerne alimentaire 4 compartiments", nb_essieux: 3, nb_compartiments: 4, docs: ["ct","assurance"] },
  { id: "citerne_alim_5c", label: "Citerne alimentaire 5 compartiments", nb_essieux: 3, nb_compartiments: 5, docs: ["ct","assurance"] },
  { id: "citerne_alim_6c", label: "Citerne alimentaire 6 compartiments", nb_essieux: 3, nb_compartiments: 6, docs: ["ct","assurance"] },
  // ─ Remorques frigorifiques (entretien groupe froid + nettoyage intérieur mensuel) ─
  { id: "remorque_frigo_2e", label: "Remorque frigorifique 2 essieux", nb_essieux: 2, docs: ["ct","assurance","frigo","nettoyage"] },
  { id: "remorque_frigo_3e", label: "Remorque frigorifique 3 essieux", nb_essieux: 3, docs: ["ct","assurance","frigo","nettoyage"] },
];

// ── Engins BTP / spéciaux (n° série + n° parc, pas de plaque, pas de pneus) ──
export const PROFILS_ENGINS = [
  { id: "pelle_hydraulique",   label: "Pelle hydraulique",     emoji: "🦾", docs: ["assurance","vgp","entretien"], vgp_periodicite: "annuelle"      },
  { id: "rouleau_compacteur",  label: "Rouleau compacteur",    emoji: "🔄", docs: ["assurance","vgp","entretien"], vgp_periodicite: "annuelle"      },
  { id: "bulldozer_chargeuse", label: "Bulldozer / Chargeuse", emoji: "🚜", docs: ["assurance","vgp","entretien"], vgp_periodicite: "annuelle"      },
  { id: "grue_nacelle",        label: "Grue / Nacelle",        emoji: "🏗️", docs: ["assurance","vgp","entretien"], vgp_periodicite: "semestrielle"  },
  { id: "finisseur",           label: "Finisseur",             emoji: "🛣️", docs: ["assurance","vgp","entretien"], vgp_periodicite: "annuelle"      },
  { id: "alimentateur",        label: "Alimentateur",          emoji: "📦", docs: ["assurance","vgp","entretien"], vgp_periodicite: "annuelle"      },
  { id: "raboteuse",           label: "Raboteuse",             emoji: "⚙️", docs: ["assurance","vgp","entretien"], vgp_periodicite: "annuelle",
    note: "Transportée sur porte-char (tracteur + porte-char à gérer séparément)" },
];

export function getProfilMoteur(id) {
  return PROFILS_MOTEUR.find((p) => p.id === id) || null;
}

export function getProfilRemorque(id) {
  return PROFILS_REMORQUE.find((p) => p.id === id) || null;
}

export function getProfilEngin(id) {
  return PROFILS_ENGINS.find((p) => p.id === id) || null;
}

// ════════════════════════════════════════════════════════════════════════
// CATALOGUE DE PROFILS — chargement depuis Supabase (table profils_vehicules)
// Remplace PROFILS_MOTEUR / PROFILS_REMORQUE codés en dur par le catalogue
// éditable (profils globaux du superadmin + profils perso par entreprise).
// Si le fetch échoue (hors-ligne, erreur réseau), les tableaux codés en dur
// ci-dessus restent en place comme filet de sécurité — l'appli continue de
// fonctionner avec le dernier catalogue connu.
// ════════════════════════════════════════════════════════════════════════

function _mapProfilsDB(rows) {
  const moteur = rows
    .filter((r) => r.categorie === "moteur")
    .map((r) => ({
      id: r.id,
      label: r.label,
      essieux_avant: r.essieux_avant ?? 1,
      essieux_arriere: r.essieux_arriere ?? 1,
      peut_tracter_remorque: !!r.peut_tracter_remorque,
      docs: r.docs || [],
      perso: !!r.entreprise_id
    }))
    .sort((a, b) => (a.perso === b.perso ? 0 : a.perso ? 1 : -1));

  const remorque = rows
    .filter((r) => r.categorie === "remorque")
    .map((r) => ({
      id: r.id,
      label: r.label,
      nb_essieux: r.nb_essieux ?? 0,
      ...(r.nb_compartiments ? { nb_compartiments: r.nb_compartiments } : {}),
      docs: r.docs || [],
      perso: !!r.entreprise_id
    }))
    .sort((a, b) => (a.perso === b.perso ? 0 : a.perso ? 1 : -1));

  return { moteur, remorque };
}

export async function chargerProfilsDepuisDB() {
  try {
    // RLS restreint déjà les lignes reçues aux profils globaux + ceux de sa
    // propre entreprise — pas besoin de filtre entreprise_id côté client.
    const rows = await dbSelect("profils_vehicules", {
      filters: [{ col: "actif", op: "eq", val: true }],
      order: { col: "ordre", asc: true }
    });
    if (!rows || rows.length === 0) return false;
    const { moteur, remorque } = _mapProfilsDB(rows);
    if (moteur.length)   PROFILS_MOTEUR   = moteur;
    if (remorque.length) PROFILS_REMORQUE = remorque;
    return true;
  } catch (_) {
    return false;
  }
}

// Realtime : un nouveau profil créé par le superadmin ou un exploitant
// apparaît sans avoir à recharger l'appli. Pas de filtre unique possible
// ("global OU mon entreprise") : on écoute la table entière et on laisse la
// RLS restreindre les lignes réellement reçues au refetch.
export function ecouterProfilsVehicules(onChange) {
  const supabase = getClient();
  const channel = supabase
    .channel("profils_vehicules-changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "profils_vehicules" },
      async () => {
        const ok = await chargerProfilsDepuisDB();
        if (ok && onChange) onChange();
      }
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// Retourne true si ce profil moteur peut tracter une remorque
export function peutTracterRemorque(profilMoteurId) {
  const p = getProfilMoteur(profilMoteurId);
  // Si profil inconnu ou pas de flag → on autorise par défaut (compatibilité)
  if (!p) return true;
  return p.peut_tracter_remorque !== false;
}
