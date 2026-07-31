import { Truck } from "lucide-react";

export default function Footer({ onNavigate }) {
  return (
    <footer className="border-t border-slate-800 bg-[#030712]" data-testid="main-footer">
      <div className="max-w-7xl mx-auto px-6 md:px-12 py-12 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Truck size={15} strokeWidth={2.2} />
          </span>
          <span className="font-display font-extrabold text-white">Mémo<span className="text-cyan-400">Truck</span></span>
        </div>
        <p className="text-xs md:text-sm text-slate-500 max-w-md">
          La conformité de votre flotte, en pilote automatique. Alertes d'échéances
          et suivi de véhicules pour transporteurs routiers.
        </p>
        <div className="flex items-center gap-8">
          <button onClick={() => onNavigate("#fonctionnalites")} className="font-mono text-[11px] tracking-[0.2em] uppercase text-slate-500 hover:text-cyan-400 transition-colors duration-300" data-testid="footer-link-features">Fonctionnalités</button>
          <button onClick={() => onNavigate("#contact")} className="font-mono text-[11px] tracking-[0.2em] uppercase text-slate-500 hover:text-cyan-400 transition-colors duration-300" data-testid="footer-link-contact">Contact</button>
        </div>
      </div>
      <div className="border-t border-slate-800/60">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-5 flex flex-col sm:flex-row justify-between gap-2 text-[11px] text-slate-600">
          <span>© 2026 MémoTruck — Tous droits réservés</span>
          <span className="font-mono tracking-widest uppercase">Fait pour la route</span>
        </div>
      </div>
    </footer>
  );
}
