import { Diamond } from "lucide-react";

const items = [
  "Contrôle technique", "Assurance flotte", "Permis de conduire", "Tachygraphe",
  "Visite médicale", "Formation FCO", "Certificat ADR", "Carte conducteur",
  "Vignette Crit'Air", "Entretien périodique",
];

export default function Marquee() {
  const row = [...items, ...items];
  return (
    <section className="relative border-y border-slate-800 bg-[#050b18] py-8 overflow-hidden" data-testid="marquee-strip">
      <div className="marquee-track items-center gap-10 pr-10">
        {row.map((item, i) => (
          <div key={i} className="flex items-center gap-10 shrink-0">
            <span className="font-display font-bold text-xl md:text-2xl uppercase tracking-wide text-slate-600 hover:text-cyan-400 transition-colors duration-500 whitespace-nowrap">
              {item}
            </span>
            <Diamond size={12} className="text-cyan-500/60 shrink-0" fill="currentColor" />
          </div>
        ))}
      </div>
      <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-[#050b18] to-transparent pointer-events-none" />
      <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-[#050b18] to-transparent pointer-events-none" />
    </section>
  );
}
