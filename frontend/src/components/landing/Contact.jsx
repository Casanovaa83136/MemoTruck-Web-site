import { useState } from "react";
import { motion } from "framer-motion";
import axios from "axios";
import { toast } from "sonner";
import { ArrowRight, CheckCircle2, Loader2, Mail, PhoneCall, Timer } from "lucide-react";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;
const EASE = [0.16, 1, 0.3, 1];

const reveal = {
  initial: { opacity: 0, y: 48 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.9, ease: EASE },
};

const inputCls = "w-full px-4 py-3.5 rounded-xl bg-white/5 border border-slate-800 text-slate-100 placeholder:text-slate-500 text-sm outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/40 transition-[border-color,box-shadow] duration-300";

const bullets = [
  "Démo personnalisée de 30 minutes, en visio",
  "Paramétrage offert pour votre première flotte",
  "Réponse garantie sous 24 h ouvrées",
];

export default function Contact() {
  const [form, setForm] = useState({ name: "", email: "", company: "", fleet_size: "1 - 10 véhicules", message: "" });
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const update = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await axios.post(`${API}/contact`, form);
      setSent(true);
      toast.success("Demande envoyée — notre équipe vous recontacte sous 24 h.");
    } catch (err) {
      toast.error("Une erreur est survenue. Réessayez dans un instant.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section id="contact" className="relative py-28 md:py-40 overflow-hidden" data-testid="contact-section">
      <div className="absolute inset-0 -z-10">
        <img src="https://images.unsplash.com/photo-1772735625793-8caa97068a2e?q=80&w=2000&auto=format&fit=crop" alt="" aria-hidden="true" className="w-full h-full object-cover opacity-25" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#030712] via-[#030712]/85 to-[#030712]" />
      </div>

      <div className="max-w-7xl mx-auto px-6 md:px-12 grid grid-cols-1 lg:grid-cols-2 gap-16 lg:gap-24 items-start">
        <motion.div {...reveal}>
          <span className="font-mono text-xs tracking-[0.25em] uppercase text-cyan-400 font-bold">Dernière étape</span>
          <h2 className="mt-4 font-display font-black tracking-tighter text-4xl sm:text-5xl lg:text-6xl text-white leading-[1.02]">
            Parlons de<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-blue-500">votre flotte.</span>
          </h2>
          <p className="mt-6 max-w-md text-base md:text-lg leading-relaxed text-slate-400">
            Dites-nous combien de véhicules vous exploitez — nous vous montrons
            comment MémoTruck sécurise vos échéances en une démonstration.
          </p>

          <ul className="mt-10 space-y-4">
            {bullets.map((b) => (
              <li key={b} className="flex items-center gap-3 text-sm md:text-base text-slate-300">
                <CheckCircle2 size={18} className="text-cyan-400 shrink-0" /> {b}
              </li>
            ))}
          </ul>

          <div className="mt-12 flex flex-col gap-3 text-sm text-slate-400">
            <span className="flex items-center gap-3"><Mail size={16} className="text-cyan-400" /> contact@memotruck.fr</span>
            <span className="flex items-center gap-3"><PhoneCall size={16} className="text-cyan-400" /> +33 1 84 60 22 10</span>
            <span className="flex items-center gap-3"><Timer size={16} className="text-cyan-400" /> Lun – Ven · 8 h 30 – 18 h 30</span>
          </div>
        </motion.div>

        <motion.div {...reveal} transition={{ ...reveal.transition, delay: 0.15 }}>
          <div className="relative rounded-2xl border border-slate-800 bg-[#0f172a]/70 backdrop-blur-2xl p-8 md:p-10 shadow-[0_0_60px_rgba(6,182,212,0.08)]">
            <div className="absolute top-0 inset-x-8 h-px bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent" />

            {sent ? (
              <div className="py-16 text-center" data-testid="contact-success-message">
                <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.6, ease: EASE }} className="mx-auto w-16 h-16 rounded-full bg-cyan-500/10 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shadow-[0_0_30px_rgba(6,182,212,0.3)]">
                  <CheckCircle2 size={30} />
                </motion.div>
                <h3 className="mt-6 font-display font-bold text-2xl text-white">Demande bien reçue</h3>
                <p className="mt-3 text-sm md:text-base text-slate-400 max-w-sm mx-auto">
                  Un expert MémoTruck vous recontacte sous 24 h ouvrées pour planifier
                  votre démonstration personnalisée.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5" data-testid="contact-form">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label htmlFor="contact-name" className="block mb-2 font-mono text-[11px] tracking-[0.2em] uppercase text-slate-400">Nom complet</label>
                    <input id="contact-name" required value={form.name} onChange={update("name")} placeholder="Jean Martin" className={inputCls} data-testid="contact-name-input" />
                  </div>
                  <div>
                    <label htmlFor="contact-email" className="block mb-2 font-mono text-[11px] tracking-[0.2em] uppercase text-slate-400">Email pro</label>
                    <input id="contact-email" type="email" required value={form.email} onChange={update("email")} placeholder="jean@transports-martin.fr" className={inputCls} data-testid="contact-email-input" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label htmlFor="contact-company" className="block mb-2 font-mono text-[11px] tracking-[0.2em] uppercase text-slate-400">Société</label>
                    <input id="contact-company" required value={form.company} onChange={update("company")} placeholder="Transports Martin" className={inputCls} data-testid="contact-company-input" />
                  </div>
                  <div>
                    <label htmlFor="contact-fleet" className="block mb-2 font-mono text-[11px] tracking-[0.2em] uppercase text-slate-400">Taille de flotte</label>
                    <select id="contact-fleet" value={form.fleet_size} onChange={update("fleet_size")} className={`${inputCls} appearance-none cursor-pointer [&>option]:bg-[#0f172a]`} data-testid="contact-fleet-select">
                      <option>1 - 10 véhicules</option>
                      <option>11 - 50 véhicules</option>
                      <option>51 - 200 véhicules</option>
                      <option>200+ véhicules</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="contact-message" className="block mb-2 font-mono text-[11px] tracking-[0.2em] uppercase text-slate-400">
                    Message <span className="text-slate-600 normal-case tracking-normal">(optionnel)</span>
                  </label>
                  <textarea id="contact-message" rows={4} value={form.message} onChange={update("message")} placeholder="Nous gérons 45 tracteurs et nous perdons le fil des contrôles techniques…" className={`${inputCls} resize-none`} data-testid="contact-message-input" />
                </div>
                <button type="submit" disabled={loading} className="group w-full flex items-center justify-center gap-2 px-7 py-4 rounded-full bg-cyan-500 text-[#030712] font-display font-bold shadow-[0_0_24px_rgba(6,182,212,0.35)] hover:-translate-y-0.5 hover:shadow-[0_0_40px_rgba(6,182,212,0.6)] transition-[transform,box-shadow] duration-300 disabled:opacity-60 disabled:hover:translate-y-0" data-testid="contact-submit-button">
                  {loading ? (<><Loader2 size={18} className="animate-spin" /> Envoi en cours…</>) : (<>
                    Demander ma démo
                    <ArrowRight size={18} className="transition-transform duration-300 group-hover:translate-x-1" />
                  </>)}
                </button>
                <p className="text-center text-[11px] text-slate-600">
                  Vos données restent confidentielles — jamais partagées, jamais revendues.
                </p>
              </form>
            )}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
