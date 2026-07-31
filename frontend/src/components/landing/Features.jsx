import { motion } from "framer-motion";
import { BellRing, MapPin, FolderLock, CheckCircle2, AlertTriangle, Clock3, FileCheck2, Truck } from "lucide-react";

const EASE = [0.16, 1, 0.3, 1];

const reveal = {
  initial: { opacity: 0, y: 48 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.9, ease: EASE },
};

const alertChips = ["Contrôle technique", "Assurance", "Permis", "Tachygraphe", "Visite médicale", "FCO / ADR"];

const alerts = [
  { icon: AlertTriangle, tone: "text-amber-400 bg-amber-500/10 border-amber-500/30", label: "CT · FR-482-XK", time: "J-7" },
  { icon: Clock3, tone: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30", label: "Assurance flotte", time: "J-30" },
  { icon: FileCheck2, tone: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30", label: "Permis · J. Martin", time: "J-90" },
];

const docs = [
  { name: "Carte grise — 12 véhicules", ok: true },
  { name: "Attestations d'assurance 2026", ok: true },
  { name: "Données tachygraphe — T1", ok: true },
  { name: "Certificats ADR conducteurs", ok: true },
];

export default function Features() {
  return (
    <section id="fonctionnalites" className="relative py-28 md:py-40 bg-[#030712]" data-testid="features-section">
      <div className="max-w-7xl mx-auto px-6 md:px-12">
        <motion.div {...reveal} className="mb-24 md:mb-32 max-w-2xl">
          <span className="font-mono text-xs tracking-[0.25em] uppercase text-cyan-400 font-bold">Manifeste</span>
          <h2 className="mt-4 font-display font-black tracking-tighter text-4xl sm:text-5xl lg:text-6xl text-white leading-[1.02]">
            Trois chapitres.<br /><span className="text-slate-500">Zéro oubli.</span>
          </h2>
        </motion.div>

        {/* Chapitre 01 */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-14 items-center mb-32 md:mb-44" data-testid="feature-chapter-1">
          <motion.div {...reveal} className="md:col-span-2">
            <span className="font-display font-black text-7xl md:text-8xl text-outline leading-none">01</span>
          </motion.div>
          <motion.div {...reveal} transition={{ ...reveal.transition, delay: 0.1 }} className="md:col-span-5">
            <div className="flex items-center gap-3 mb-5">
              <span className="p-3 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.25)]"><BellRing size={22} /></span>
              <h3 className="font-display font-bold text-2xl md:text-3xl text-white tracking-tight">Alertes d'échéances</h3>
            </div>
            <p className="text-base md:text-lg leading-relaxed text-slate-400">
              Contrôle technique qui expire, assurance à renouveler, permis à vérifier :
              MémoTruck vous alerte au bon moment, sur le bon canal, pour chaque
              véhicule et chaque conducteur.
            </p>
            <div className="mt-7 flex flex-wrap gap-2.5">
              {alertChips.map((chip) => (
                <span key={chip} className="px-3.5 py-1.5 rounded-full border border-slate-800 text-xs font-mono text-slate-400 hover:border-cyan-500/50 hover:text-cyan-300 transition-colors duration-300">{chip}</span>
              ))}
            </div>
          </motion.div>
          <motion.div {...reveal} transition={{ ...reveal.transition, delay: 0.2 }} className="md:col-span-5">
            <div className="space-y-3">
              {alerts.map((a, i) => (
                <motion.div key={a.label} initial={{ opacity: 0, x: 40 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.8, delay: 0.25 + i * 0.15, ease: EASE }} className={`flex items-center justify-between px-5 py-4 rounded-xl border bg-[#0f172a]/60 backdrop-blur-md ${a.tone.split(" ")[2]} hover:-translate-y-1 transition-transform duration-300`}>
                  <div className="flex items-center gap-3">
                    <span className={`p-2 rounded-lg ${a.tone.split(" ").slice(0, 2).join(" ")}`}><a.icon size={17} /></span>
                    <span className="text-sm font-medium text-slate-200">{a.label}</span>
                  </div>
                  <span className={`font-mono text-sm font-bold ${a.tone.split(" ")[0]}`}>{a.time}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Chapitre 02 */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-14 items-center mb-32 md:mb-44" data-testid="feature-chapter-2">
          <motion.div {...reveal} className="md:col-span-6 md:order-1 order-2">
            <div className="relative rounded-2xl border border-slate-800 overflow-hidden group hover:border-cyan-500/40 transition-colors duration-500">
              <img src="https://images.unsplash.com/photo-1551288049-bebda4e38f71?q=80&w=1400&auto=format&fit=crop" alt="Analytique de flotte en temps réel" className="w-full h-[340px] md:h-[400px] object-cover opacity-80 group-hover:opacity-100 group-hover:scale-[1.03] transition-[opacity,transform] duration-700" />
              <div className="absolute inset-0 bg-gradient-to-t from-[#030712]/80 via-transparent to-transparent" />
              <div className="absolute bottom-5 left-5 flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-[#030712]/80 backdrop-blur-xl border border-cyan-500/30">
                <span className="relative w-2 h-2 rounded-full bg-cyan-400 radar-dot" />
                <span className="font-mono text-xs text-cyan-300">38 véhicules en ligne</span>
              </div>
            </div>
          </motion.div>
          <motion.div {...reveal} transition={{ ...reveal.transition, delay: 0.1 }} className="md:col-span-4 md:order-2 order-1">
            <div className="flex items-center gap-3 mb-5">
              <span className="p-3 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.25)]"><MapPin size={22} /></span>
              <h3 className="font-display font-bold text-2xl md:text-3xl text-white tracking-tight">Suivi de flotte</h3>
            </div>
            <p className="text-base md:text-lg leading-relaxed text-slate-400">
              Chaque camion, chaque position, en direct. Kilométrage, statuts,
              disponibilité : votre exploitation entière tient dans un seul écran,
              pensé pour les transporteurs.
            </p>
          </motion.div>
          <motion.div {...reveal} className="hidden md:block md:col-span-2 md:order-3 order-3 md:text-right">
            <span className="font-display font-black text-7xl md:text-8xl text-outline leading-none">02</span>
          </motion.div>
        </div>

        {/* Chapitre 03 */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-14 items-center" data-testid="feature-chapter-3">
          <motion.div {...reveal} className="md:col-span-2">
            <span className="font-display font-black text-7xl md:text-8xl text-outline leading-none">03</span>
          </motion.div>
          <motion.div {...reveal} transition={{ ...reveal.transition, delay: 0.1 }} className="md:col-span-5">
            <div className="flex items-center gap-3 mb-5">
              <span className="p-3 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.25)]"><FolderLock size={22} /></span>
              <h3 className="font-display font-bold text-2xl md:text-3xl text-white tracking-tight">Conformité centralisée</h3>
            </div>
            <p className="text-base md:text-lg leading-relaxed text-slate-400">
              Tous vos documents réglementaires dans un coffre unique, horodatés et
              exportables. En cas de contrôle, tout est prêt en trente secondes —
              pas en trois heures.
            </p>
            <div className="mt-7 flex items-center gap-2 text-sm text-cyan-300 font-medium">
              <Truck size={16} /> Pensé pour les exploitants, pas pour les informaticiens.
            </div>
          </motion.div>
          <motion.div {...reveal} transition={{ ...reveal.transition, delay: 0.2 }} className="md:col-span-5">
            <div className="rounded-2xl border border-slate-800 bg-[#0f172a]/50 backdrop-blur-md divide-y divide-slate-800 overflow-hidden">
              {docs.map((d, i) => (
                <motion.div key={d.name} initial={{ opacity: 0, x: 40 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7, delay: 0.25 + i * 0.12, ease: EASE }} className="flex items-center justify-between px-5 py-4 hover:bg-cyan-500/5 transition-colors duration-300">
                  <span className="text-sm text-slate-300">{d.name}</span>
                  <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
