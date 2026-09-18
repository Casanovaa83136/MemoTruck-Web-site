// Capture best-effort des erreurs client (jamais bloquant) envoyées à
// l'edge function log-client-error, visibles dans le panel superadmin.
import { SUPABASE_URL, SUPABASE_ANON } from "./supabase-client.js";

const JWT_KEY = "atil_jwt";
const MAX_ERRORS = 8;
let sent = 0;

function currentEntrepriseId() {
  try {
    const jwt = localStorage.getItem(JWT_KEY);
    if (!jwt) return null;
    const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.entreprise_id || null;
  } catch { return null; }
}

function report(message, stack) {
  if (sent >= MAX_ERRORS || !message) return;
  sent++;
  try {
    fetch(`${SUPABASE_URL}/functions/v1/log-client-error`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON },
      body: JSON.stringify({
        app: "pwa",
        entreprise_id: currentEntrepriseId(),
        message: String(message).slice(0, 2000),
        stack: stack ? String(stack).slice(0, 4000) : null,
        url: location.href,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

export function initErrorMonitor() {
  window.addEventListener("error", (e) => report(e.message, e.error && e.error.stack));
  window.addEventListener("unhandledrejection", (e) => report(e.reason && e.reason.message ? e.reason.message : String(e.reason), e.reason && e.reason.stack));
}
