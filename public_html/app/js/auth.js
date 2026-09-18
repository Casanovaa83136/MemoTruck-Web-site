// ════════════════════════════════════════════════════════════════════════
// MémoTruck — Authentification
//
// CONNEXION  : email seul → Edge Function "login" → JWT
// INSCRIPTION : email + prénom + nom + code_entreprise → Edge Function "signup"
//
// Le chauffeur n'est plus lié à une plaque à la connexion.
// Ses véhicules (tracteur/remorque) sont affectés par l'admin
// et récupérés depuis la base après authentification.
// ════════════════════════════════════════════════════════════════════════

import { callEdgeFunction, dbSelect, setJWT, getJWT } from "./supabase-client.js";
import { showToast } from "./ui-helpers.js";

// ─── Clés localStorage ───────────────────────────────────────────────────
const STORAGE_KEYS = {
  email:  "atil_email",
  prenom: "atil_prenom"
};

// ─── Lecture session locale ───────────────────────────────────────────────
export function getSession() {
  return {
    email:  localStorage.getItem(STORAGE_KEYS.email)  || "",
    prenom: localStorage.getItem(STORAGE_KEYS.prenom) || ""
  };
}

// ─── Sauvegarde session ───────────────────────────────────────────────────
export function saveSession({ email }) {
  localStorage.setItem(STORAGE_KEYS.email, email);
}

// ─── Efface session + JWT ─────────────────────────────────────────────────
export function clearSession() {
  Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
  setJWT(null);
}

// ─── Sauvegarde prénom (appelé depuis paramètres) ─────────────────────────
export function savePrenom(prenom) {
  localStorage.setItem(STORAGE_KEYS.prenom, prenom);
}

// ════════════════════════════════════════════════════════════════════════
// AUTO-LOGIN
// Si un JWT valide est en localStorage, on recharge les données du
// chauffeur sans redemander l'email.
// ════════════════════════════════════════════════════════════════════════

export async function tryAutoLogin() {
  const session = getSession();
  if (!session.email) return { success: false };

  const jwt = getJWT();
  if (!jwt) return { success: false };

  // Réinjecte le JWT dans le client Supabase Realtime au démarrage
  setJWT(jwt);

  try {
    const data = await _loadChauffeurData(session.email);
    if (!data) return { success: false };

    return { success: true, ...data };
  } catch (e) {
    if (e.message && /401|403/.test(e.message)) {
      // JWT expiré — on efface, l'utilisateur devra se reconnecter
      setJWT(null);
      return { success: false };
    }
    showToast("📡 Connexion au serveur impossible, nouvelle tentative…");
    return { success: false, error: e };
  }
}

// ════════════════════════════════════════════════════════════════════════
// LOGIN (email + mot de passe)
// Compte créé avant l'ajout du mot de passe (password_hash vide côté
// serveur) : la première connexion enregistre le mot de passe saisi ici
// comme étant désormais celui du compte — voir edge function "login".
// ════════════════════════════════════════════════════════════════════════

export async function login({ email, password }) {
  const cleanEmail = (email || "").trim().toLowerCase();

  if (!cleanEmail || !cleanEmail.includes("@")) {
    return { success: false, message: "⚠️ Saisis une adresse email valide" };
  }
  if (!password) {
    return { success: false, message: "⚠️ Saisis ton mot de passe" };
  }

  try {
    const result = await callEdgeFunction("login", { email: cleanEmail, password });
    // result = { jwt, chauffeur_id, entreprise_id, prenom }

    setJWT(result.jwt);
    saveSession({ email: cleanEmail });
    if (result.prenom) savePrenom(result.prenom);

    const data = await _loadChauffeurData(cleanEmail);
    if (!data) return { success: false, message: "⚠️ Erreur lors du chargement du profil" };

    return { success: true, ...data };

  } catch (e) {
    const msg = e.message || "";

    if (msg.includes("en attente")) {
      return { success: false, message: "⏳ Ton compte est en attente de validation par l'admin." };
    }
    if (msg.includes("introuvable") || msg.includes("404")) {
      return { success: false, message: "❌ Aucun compte trouvé avec cet email. Crée un compte ?" };
    }
    if (msg.includes("incorrect") || msg.includes("8 caractères") || msg.includes("suspendu")) {
      return { success: false, message: "❌ " + msg };
    }
    console.error("[auth] login error:", e);
    return { success: false, message: "📡 Connexion impossible, réessaie plus tard." };
  }
}

// ════════════════════════════════════════════════════════════════════════
// SIGNUP (email + prénom + nom + code entreprise)
// ════════════════════════════════════════════════════════════════════════

export async function signup({ email, prenom, nom, codeEntreprise, password }) {
  const cleanEmail    = (email          || "").trim().toLowerCase();
  const cleanPrenom   = (prenom         || "").trim();
  const cleanNom      = (nom            || "").trim();
  const cleanCode     = (codeEntreprise || "").trim().toUpperCase();

  if (!cleanEmail || !cleanEmail.includes("@")) {
    return { success: false, message: "⚠️ Saisis une adresse email valide" };
  }
  if (!cleanPrenom) {
    return { success: false, message: "⚠️ Le prénom est obligatoire" };
  }
  if (!cleanNom) {
    return { success: false, message: "⚠️ Le nom est obligatoire" };
  }
  if (!cleanCode) {
    return { success: false, message: "⚠️ Le code entreprise est obligatoire" };
  }
  if (!password || password.length < 8) {
    return { success: false, message: "⚠️ Le mot de passe doit contenir au moins 8 caractères" };
  }

  try {
    const result = await callEdgeFunction("signup", {
      email:            cleanEmail,
      prenom:           cleanPrenom,
      nom:              cleanNom,
      code_entreprise:  cleanCode,
      password
    });

    return {
      success:  false,   // pas de connexion directe — l'admin doit valider d'abord
      isSignup: true,
      message:  result.message || "✅ Inscription envoyée — en attente de validation par l'admin."
    };

  } catch (e) {
    const msg = e.message || "";
    if (msg.includes("déjà")) {
      return { success: false, message: "⛔ " + msg };
    }
    console.error("[auth] signup error:", e);
    return { success: false, message: "📡 Inscription impossible, réessaie plus tard." };
  }
}

// ════════════════════════════════════════════════════════════════════════
// CHARGEMENT DES DONNÉES CHAUFFEUR + VÉHICULES
// Appelé après login réussi et lors de l'auto-login.
// ════════════════════════════════════════════════════════════════════════

async function _loadChauffeurData(email) {
  // 1. Chauffeur
  const chauffeurs = await dbSelect("chauffeurs", {
    select: "id,entreprise_id,prenom,nom,email,telephone,adresse,est_valide,plaque_tracteur,plaque_remorque,date_carte_conducteur,date_visite_medicale,date_fco,date_adr,date_carte_identite,date_carte_as24,code_carte_as24,date_carte_total,code_carte_total,theme_prefere",
    filters: [{ col: "email", op: "eq", val: email }]
  });

  if (!chauffeurs || chauffeurs.length === 0) return null;
  const chauffeur = chauffeurs[0];
  if (!chauffeur.est_valide) return null;

  // 2. Cherche une session active (prise de service mémorisée)
  let plaqueT = "";
  let plaqueR = "";
  let profilMoteur  = null;
  let profilRemorque = null;
  let enginId = null;
  try {
    const sessions = await dbSelect("sessions_actives", {
      filters: [{ col: "chauffeur_id", op: "eq", val: chauffeur.id }]
    });
    if (sessions && sessions.length > 0) {
      plaqueT        = (sessions[0].plaque_tracteur  || "").toUpperCase().trim();
      plaqueR        = (sessions[0].plaque_remorque  || "").toUpperCase().trim();
      profilMoteur   = sessions[0].profil_moteur   || null;
      profilRemorque = sessions[0].profil_remorque || null;
      enginId        = sessions[0].engin_id        || null;
    }
  } catch (_) {}

  // Fallback sur les plaques du profil chauffeur si pas de session active
  if (!plaqueT && !enginId) {
    plaqueT = (chauffeur.plaque_tracteur || "").toUpperCase().trim();
    plaqueR = (chauffeur.plaque_remorque || "").toUpperCase().trim();
  }

  // 3. Tracteur (seulement si pas d'engin actif)
  let tracteurData = null;
  if (plaqueT && !enginId) {
    const tracteurs = await dbSelect("tracteurs", {
      filters: [{ col: "plaque", op: "eq", val: plaqueT }]
    });
    tracteurData = tracteurs && tracteurs.length > 0 ? tracteurs[0] : null;
  }

  // 4. Remorque (seulement si pas d'engin actif)
  let remorqueData = null;
  if (plaqueR && !enginId) {
    const remorques = await dbSelect("remorques", {
      filters: [{ col: "plaque", op: "eq", val: plaqueR }]
    });
    remorqueData = remorques && remorques.length > 0 ? remorques[0] : null;
  }

  // 5. Engin BTP (si engin_id présent dans la session)
  let enginActif = null;
  if (enginId) {
    try {
      const engins = await dbSelect("engins", {
        filters: [{ col: "id", op: "eq", val: enginId }]
      });
      enginActif = engins && engins.length > 0 ? engins[0] : null;
    } catch (_) {}
    // Si l'engin est actif, réinitialiser les plaques
    if (enginActif) {
      plaqueT = "";
      plaqueR = "";
    }
  }

  return {
    prenom:        chauffeur.prenom || "",
    chauffeurId:   chauffeur.id,
    chauffeur,
    plaqueT,
    plaqueR,
    profilMoteur,
    profilRemorque,
    tracteurData,
    remorqueData,
    enginActif,
    typeVehiculeActif: enginActif ? "engin" : "tracteur"
  };
}
