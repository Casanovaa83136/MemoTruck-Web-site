import { motion } from "framer-motion";
import { Truck } from "lucide-react";

const EASE = [0.16, 1, 0.3, 1];

export default function Navbar({ onNavigate }) {
  return (
    <motion.header
      initial={{ y: -80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 1, delay: 0.2, ease: EASE }}
      className="fixed top-0 left-0 right-0 z-50 bg-[#030712]/70 backdrop-blur-2xl border-b border-white/5"
      data-testid="main-navbar"
    >
      <div className="max-w-7xl mx-auto px-6 md:px-12 h-[72px] flex items-center justify-between">
        <button onClick={() => onNavigate(0)} className="flex items-center gap-3 group" data-testid="nav-logo">
          <span className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_18px_rgba(6,182,212,0.25)] transition-shadow duration-300 group-hover:shadow-[0_0_28px_rgba(6,182,212,0.5)]">
            <Truck size={18} strokeWidth={2.2} />
          </span>
          <span className="font-display text-lg tracking-tight text-white font-extrabold">
            Mémo<span className="text-cyan-400">Truck</span>
          </span>
        </button>

        <nav className="hidden md:flex items-center gap-10">
          <button onClick={() => onNavigate("#fonctionnalites")} className="font-mono text-xs tracking-[0.2em] uppercase text-slate-400 hover:text-cyan-400 transition-colors duration-300" data-testid="nav-link-features">
            Fonctionnalités
          </button>
          <button onClick={() => onNavigate("#contact")} className="font-mono text-xs tracking-[0.2em] uppercase text-slate-400 hover:text-cyan-400 transition-colors duration-300" data-testid="nav-link-contact">
            Contact
          </button>
        </nav>

        <button onClick={() => onNavigate("#contact")} className="px-5 py-2.5 rounded-full bg-cyan-500 text-[#030712] font-display font-bold text-sm shadow-[0_0_20px_rgba(6,182,212,0.35)] hover:-translate-y-0.5 hover:shadow-[0_0_32px_rgba(6,182,212,0.6)] transition-[transform,box-shadow] duration-300" data-testid="nav-cta-button">
          Demander une démo
        </button>
      </div>
    </motion.header>
  );
}
