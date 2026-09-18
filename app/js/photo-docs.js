// ════════════════════════════════════════════════════════════════════════
// MémoTruck — Documents photos
//
// Bucket : documents-chauffeurs
// Chemin : {entreprise_id}/{entity_type}/{entity_id}/{carte_slug}.jpg
//
// entity_type : "chauffeur" | "tracteur" | "remorque"
// entity_id   : chauffeur_id | plaque tracteur | plaque remorque
//
// La table garde toujours chauffeur_id pour le RLS.
// Le cache mémoire est indexé par entity_id.
//
// IMPORTANT — ordre JWT obligatoire :
//   setJWT(token) → listenDocPhotos()
// ════════════════════════════════════════════════════════════════════════

import { getJWT, getClient, SUPABASE_URL, SUPABASE_ANON } from "./supabase-client.js";

const BUCKET = "documents-chauffeurs";

// Cache : { [entity_id]: { [carte_slug]: { label, storage_path, url } } }
let _photoCache  = {};
let _unsubPhotos = null;

function authHeaders(contentType = null) {
  const jwt = getJWT();
  const h   = {
    "apikey":        SUPABASE_ANON,
    "Authorization": jwt ? `Bearer ${jwt}` : `Bearer ${SUPABASE_ANON}`
  };
  if (contentType) h["Content-Type"] = contentType;
  return h;
}

// ════════════════════════════════════════════════════════════════════════
// COMPRESSION IMAGE — 1280px max, JPEG 80%
// ════════════════════════════════════════════════════════════════════════

export function compressImage(file, maxSize = 1280, quality = 0.80) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
          else       { w = Math.round(w * maxSize / h); h = maxSize; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          blob => blob ? resolve(blob) : reject(new Error("Compression échouée")),
          "image/jpeg", quality
        );
      };
      img.onerror = () => reject(new Error("Image illisible"));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

// ════════════════════════════════════════════════════════════════════════
// UPLOAD
// ════════════════════════════════════════════════════════════════════════

export async function uploadDocPhoto(entrepriseId, entityId, carteSlug, carteLabel, file, entityType = "chauffeur", chauffeurId = null) {
  const blob        = await compressImage(file);
  const storagePath = `${entrepriseId}/${entityType}/${entityId}/${carteSlug}.jpg`;
  const rls_id      = chauffeurId || entityId;

  // Upload Storage (upsert)
  const uploadRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`,
    {
      method:  "POST",
      headers: { ...authHeaders(), "x-upsert": "true", "Content-Type": "image/jpeg" },
      body:    blob
    }
  );
  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Upload échoué (${uploadRes.status})`);
  }

  // Upsert métadonnées
  const upsertRes = await fetch(
    `${SUPABASE_URL}/rest/v1/documents_photos?on_conflict=entreprise_id%2Cchauffeur_id%2Ccarte_slug%2Centity_type`,
    {
      method:  "POST",
      headers: { ...authHeaders("application/json"), "Prefer": "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        entreprise_id: entrepriseId,
        chauffeur_id:  rls_id,
        carte_slug:    carteSlug,
        carte_label:   carteLabel,
        storage_path:  storagePath,
        entity_type:   entityType,
        uploaded_by:   "chauffeur",
        uploaded_at:   new Date().toISOString()
      })
    }
  );
  if (!upsertRes.ok) {
    const err = await upsertRes.json().catch(() => ({}));
    throw new Error(err.message || `Métadonnées échouées (${upsertRes.status})`);
  }

  if (_photoCache[entityId]) delete _photoCache[entityId][carteSlug];
  return storagePath;
}

// ════════════════════════════════════════════════════════════════════════
// SIGNED URL — 1h
// ════════════════════════════════════════════════════════════════════════

export async function getDocPhotoUrl(storagePath) {
  if (!storagePath) return null;
  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${storagePath}`,
    { method: "POST", headers: authHeaders("application/json"), body: JSON.stringify({ expiresIn: 3600 }) }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.signedURL ? `${SUPABASE_URL}/storage/v1${data.signedURL}` : null;
}

// ════════════════════════════════════════════════════════════════════════
// FETCH — toutes les photos d'un chauffeur (tous owners)
// ════════════════════════════════════════════════════════════════════════

export async function fetchDocPhotos(chauffeurId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/documents_photos?select=carte_slug,carte_label,storage_path,entity_type&chauffeur_id=eq.${chauffeurId}`,
    { headers: authHeaders() }
  );
  if (!res.ok) return {};
  const rows = await res.json();

  await Promise.all(rows.map(async (row) => {
    const parts    = row.storage_path.split("/");
    const entityId = parts.length >= 3 ? parts[2] : chauffeurId;
    const url      = await getDocPhotoUrl(row.storage_path).catch(() => null);
    if (!_photoCache[entityId]) _photoCache[entityId] = {};
    _photoCache[entityId][row.carte_slug] = { label: row.carte_label, storage_path: row.storage_path, url };
  }));

  return _photoCache;
}

// ════════════════════════════════════════════════════════════════════════
// DELETE
// ════════════════════════════════════════════════════════════════════════

export async function deleteDocPhoto(entrepriseId, entityId, carteSlug, entityType = "chauffeur") {
  const storagePath = `${entrepriseId}/${entityType}/${entityId}/${carteSlug}.jpg`;

  const storageRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`,
    { method: "DELETE", headers: authHeaders() });
  if (!storageRes.ok) throw new Error(`Suppression du fichier échouée (${storageRes.status})`);

  const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/documents_photos?storage_path=eq.${encodeURIComponent(storagePath)}`,
    { method: "DELETE", headers: authHeaders() });
  if (!dbRes.ok) throw new Error(`Suppression de la fiche photo échouée (${dbRes.status})`);

  if (_photoCache[entityId]) delete _photoCache[entityId][carteSlug];
}

// ════════════════════════════════════════════════════════════════════════
// PHOTOS D'INTERVENTION — 0 à N par intervention (signalement chauffeur)
// Mêmes bucket/bucket-policies que les documents (chemin distinct :
// {entreprise_id}/intervention/{intervention_id}/...), table dédiée
// intervention_photos.
// ════════════════════════════════════════════════════════════════════════

export async function uploadInterventionPhoto(entrepriseId, interventionId, file) {
  const blob        = await compressImage(file);
  const storagePath = `${entrepriseId}/intervention/${interventionId}/${Date.now()}.jpg`;

  const uploadRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`,
    { method: "POST", headers: { ...authHeaders(), "Content-Type": "image/jpeg" }, body: blob }
  );
  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Upload photo échoué (${uploadRes.status})`);
  }

  const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/intervention_photos`, {
    method:  "POST",
    headers: { ...authHeaders("application/json"), "Prefer": "return=representation" },
    body: JSON.stringify({ intervention_id: interventionId, entreprise_id: entrepriseId, storage_path: storagePath })
  });
  if (!insertRes.ok) {
    const err = await insertRes.json().catch(() => ({}));
    throw new Error(err.message || `Enregistrement photo échoué (${insertRes.status})`);
  }
  return storagePath;
}

export async function fetchInterventionPhotos(interventionId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/intervention_photos?select=id,storage_path&intervention_id=eq.${interventionId}&order=uploaded_at.asc`,
    { headers: authHeaders() }
  );
  if (!res.ok) return [];
  const rows = await res.json();
  return Promise.all(rows.map(async (r) => ({ id: r.id, url: await getDocPhotoUrl(r.storage_path).catch(() => null) })));
}

// Récupère les photos de plusieurs interventions en une seule requête —
// utilisé au chargement de l'historique pour éviter un aller-retour réseau
// par carte. Retourne { [intervention_id]: [{ id, url }] }.
export async function fetchInterventionPhotosBulk(interventionIds) {
  if (!interventionIds || interventionIds.length === 0) return {};
  const list = interventionIds.map(id => `"${id}"`).join(",");
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/intervention_photos?select=id,intervention_id,storage_path&intervention_id=in.(${list})&order=uploaded_at.asc`,
    { headers: authHeaders() }
  );
  if (!res.ok) return {};
  const rows = await res.json();
  const byIntervention = {};
  await Promise.all(rows.map(async (r) => {
    const url = await getDocPhotoUrl(r.storage_path).catch(() => null);
    if (!byIntervention[r.intervention_id]) byIntervention[r.intervention_id] = [];
    byIntervention[r.intervention_id].push({ id: r.id, url });
  }));
  return byIntervention;
}

export async function deleteInterventionPhoto(id, storagePath) {
  const storageRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`, { method: "DELETE", headers: authHeaders() });
  if (!storageRes.ok) throw new Error(`Suppression du fichier échouée (${storageRes.status})`);
  const dbRes = await fetch(`${SUPABASE_URL}/rest/v1/intervention_photos?id=eq.${id}`, { method: "DELETE", headers: authHeaders() });
  if (!dbRes.ok) throw new Error(`Suppression de la fiche photo échouée (${dbRes.status})`);
}

// ════════════════════════════════════════════════════════════════════════
// HISTORIQUE ENTRETIENS — trace permanente et non-écrasable (frigo,
// nettoyage intérieur, graissage) pour preuve en cas de litige client.
//
// Contrairement à documents_photos (chemin fixe, upsert → écrase l'ancienne
// photo), chaque entretien a un chemin UNIQUE (uuid) : rien n'est jamais
// écrasé, et la table historique_entretiens n'a pas de policy update/delete
// (append-only par design).
//
// Chemin : {entreprise_id}/historique/{entite_type}/{entite_plaque}/{type_entretien}/{uuid}.jpg
// ════════════════════════════════════════════════════════════════════════

export async function uploadHistoriquePhoto(entrepriseId, entiteType, entitePlaque, typeEntretien, file) {
  const blob       = await compressImage(file);
  const uniqueId   = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const storagePath = `${entrepriseId}/historique/${entiteType}/${entitePlaque}/${typeEntretien}/${uniqueId}.jpg`;

  const uploadRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`,
    { method: "POST", headers: { ...authHeaders(), "Content-Type": "image/jpeg" }, body: blob }
  );
  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    throw new Error(err.error || err.message || `Upload échoué (${uploadRes.status})`);
  }
  return storagePath;
}

export async function enregistrerHistoriqueEntretien({
  entrepriseId, entiteType, entitePlaque, typeEntretien, dateEntretien,
  file = null, commentaire = null,
  chauffeurId = null, chauffeurNom = null, adminId = null, adminNom = null
}) {
  let storagePath = null;
  if (file) {
    storagePath = await uploadHistoriquePhoto(entrepriseId, entiteType, entitePlaque, typeEntretien, file);
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/historique_entretiens`, {
    method:  "POST",
    headers: { ...authHeaders("application/json"), "Prefer": "return=representation" },
    body: JSON.stringify({
      entreprise_id:  entrepriseId,
      entite_type:    entiteType,
      entite_plaque:  entitePlaque,
      type_entretien: typeEntretien,
      date_entretien: dateEntretien,
      storage_path:   storagePath,
      commentaire,
      chauffeur_id:   chauffeurId,
      chauffeur_nom:  chauffeurNom,
      admin_id:       adminId,
      admin_nom:      adminNom
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Enregistrement historique échoué (${res.status})`);
  }
  const rows = await res.json();
  return rows[0];
}

export async function fetchHistoriqueEntretiens(entiteType, entitePlaque, typeEntretien = null) {
  let url = `${SUPABASE_URL}/rest/v1/historique_entretiens?select=*&entite_type=eq.${entiteType}` +
    `&entite_plaque=eq.${encodeURIComponent(entitePlaque)}&order=date_entretien.desc,created_at.desc`;
  if (typeEntretien) url += `&type_entretien=eq.${typeEntretien}`;

  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) return [];
  const rows = await res.json();

  await Promise.all(rows.map(async (row) => {
    row.photo_url = row.storage_path ? await getDocPhotoUrl(row.storage_path).catch(() => null) : null;
  }));

  return rows;
}

// ════════════════════════════════════════════════════════════════════════
// REALTIME — écoute par chauffeur_id
// IMPORTANT : appeler APRÈS setJWT()
//
// Fix DELETE : on écoute event:"*" via le SDK directement (pas via
// realtimeListen qui filtre côté serveur et peut rater les DELETE).
// Sur chaque event, on refetch depuis la base pour avoir l'état réel.
// ════════════════════════════════════════════════════════════════════════

export function listenDocPhotos(chauffeurId, callback) {
  if (_unsubPhotos) { _unsubPhotos(); _unsubPhotos = null; }

  const supabase = getClient();

  const channel = supabase
    .channel(`doc-photos-${chauffeurId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "documents_photos" },
      async (payload) => {
        // Vérifie que l'event concerne ce chauffeur
        const evtChauffeurId = payload.new?.chauffeur_id || payload.old?.chauffeur_id;
        if (evtChauffeurId && evtChauffeurId !== chauffeurId) return;
        // Refetch complet — couvre INSERT, UPDATE et DELETE
        await _refetchAndUpdateCache(chauffeurId);
        callback(_photoCache);
      }
    )
    .subscribe();

  _unsubPhotos = () => supabase.removeChannel(channel);

  // Fetch initial
  _refetchAndUpdateCache(chauffeurId).then(() => callback(_photoCache));

  return () => { if (_unsubPhotos) { _unsubPhotos(); _unsubPhotos = null; } };
}

async function _refetchAndUpdateCache(chauffeurId) {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/documents_photos?select=carte_slug,carte_label,storage_path,entity_type&chauffeur_id=eq.${chauffeurId}`,
      { headers: authHeaders() }
    );
    if (!res.ok) return;
    const rows = await res.json();

    // Reset du cache pour ce chauffeur
    Object.keys(_photoCache).forEach(k => delete _photoCache[k]);

    await Promise.all(rows.map(async (row) => {
      const parts    = row.storage_path.split("/");
      const entityId = parts.length >= 3 ? parts[2] : chauffeurId;
      const url      = await getDocPhotoUrl(row.storage_path).catch(() => null);
      if (!_photoCache[entityId]) _photoCache[entityId] = {};
      _photoCache[entityId][row.carte_slug] = {
        label:        row.carte_label,
        storage_path: row.storage_path,
        url
      };
    }));
  } catch (_) {}
}

export function stopDocPhotosListener() {
  if (_unsubPhotos) { _unsubPhotos(); _unsubPhotos = null; }
}

// Cache accessor
export function getCachedDocPhotos(entityId) {
  return _photoCache[entityId] || {};
}

export function clearDocPhotosCache() {
  _photoCache = {};
}
