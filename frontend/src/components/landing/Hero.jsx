import { motion, useScroll, useTransform, useMotionValue, useSpring } from "framer-motion";
import { ArrowRight, BellRing, ShieldCheck, CalendarClock } from "lucide-react";
import { useRef } from "react";

const EASE = [0.16, 1, 0.3, 1];

const Line = ({ children, delay }) => (
  <span className="block overflow-hidden pb-1">
    <motion.span
      className="block"
      initial={{ y: "115%" }}
      animate={{ y: 0 }}
      transition={{ duration: 1.1, delay, ease: EASE }}
    >
      {children}
    </motion.span>
  </span>
);

const stats = [
  { value: "2 400+", label: "véhicules suivis" },
  { value: "98,7 %", label: "d'échéances honorées" },
  { value: "0", label: "amende pour oubli" },
];

export default function Hero({ onNavigate }) {
  const sectionRef = useRef(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  const bgY = useTransform(scrollYProgress, [0, 1], [0, 180]);
  const bgOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0.15]);

  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rotateX = useSpring(useTransform(my, [-0.5, 0.5], [7, -7]), { stiffness: 120, damping: 18 });
  const rotateY = useSpring(useTransform(mx, [-0.5, 0.5], [-9, 9]), { stiffness: 120, damping: 18 });

  const handleMouse = (e) => {
    const r = sectionRef.current?.getBoundingClientRect();
    if (!r) return;
    mx.set((e.clientX - r.left) / r.width - 0.5);
    my.set((e.clientY - r.top) / r.height - 0.5);
  };

  return (
    <section ref={sectionRef} onMouseMove={handleMouse} className="relative min-h-screen flex flex-col justify-center overflow-hidden pt-[72px]" data-testid="hero-section">
      <motion.div className="absolute inset-0 -z-10" style={{ y: bgY, opacity: bgOpacity }}>
        <img src="https://images.unsplash.com/photo-1760127831098-6a75c69ee79c?q=80&w=2000&auto=format&fit=crop" alt="Camion de nuit sur autoroute" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-[#030712]/70" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(30,58,138,0.35),transparent_55%)]" />
        <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-[#030712] to-transparent" />
      </motion.div>

      <div className="scanline hidden lg:block" aria-hidden="true" />

      <div className="max-w-7xl mx-auto px-6 md:px-12 w-full grid grid-cols-1 lg:grid-cols-12 gap-16 items-center py-24">
        <div className="lg:col-span-7">
          <motion.div initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.9, delay: 0.35, ease: EASE }} className="flex items-center gap-3 mb-8">
            <span className="relative w-2 h-2 rounded-full bg-cyan-400 radar-dot" />
            <span className="font-mono text-xs tracking-[0.25em] uppercase text-cyan-400 font-bold">
              SaaS · Transporteurs routiers
            </span>
          </motion.div>

          <h1 className="font-display font-black tracking-tighter text-5xl sm:text-6xl lg:text-7xl xl:text-8xl leading-[0.95] text-white">
            <Line delay={0.45}>Votre flotte</Line>
            <Line delay={0.58}>roule.</Line>
            <Line delay={0.71}>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 via-cyan-400 to-blue-500">
                MémoTruck veille.
              </span>
            </Line>
          </h1>

          <motion.p initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 1.0, ease: EASE }} className="mt-8 max-w-xl text-base md:text-lg leading-relaxed text-slate-400">
            Alertes intelligentes pour chaque date critique — contrôles techniques,
            assurances, permis, tachygraphes — et suivi de vos véhicules en temps réel.
            La conformité de votre flotte, en pilote automatique.
          </motion.p>

          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 1.15, ease: EASE }} className="mt-10 flex flex-wrap items-center gap-4">
            <button onClick={() => onNavigate("#contact")} className="group flex items-center gap-2 px-7 py-4 rounded-full bg-cyan-500 text-[#030712] font-display font-bold shadow-[0_0_24px_rgba(6,182,212,0.4)] hover:-translate-y-1 hover:shadow-[0_0_40px_rgba(6,182,212,0.65)] transition-[transform,box-shadow] duration-300" data-testid="hero-cta-demo">
              Demander une démo
              <ArrowRight size={18} className="transition-transform duration-300 group-hover:translate-x-1" />
            </button>
            <button onClick={() => onNavigate("#fonctionnalites")} className="px-7 py-4 rounded-full border border-slate-700 text-slate-200 font-display font-semibold hover:border-cyan-500/60 hover:text-cyan-300 hover:-translate-y-1 transition-[transform,border-color,color] duration-300" data-testid="hero-cta-features">
              Voir les fonctionnalités
            </button>
          </motion.div>

          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 1.4 }} className="mt-16 grid grid-cols-3 gap-6 max-w-lg border-t border-slate-800 pt-8" data-testid="hero-stats">
            {stats.map((s) => (
              <div key={s.label}>
                <div className="font-mono text-2xl md:text-3xl font-bold text-white">{s.value}</div>
                <div className="mt-1 text-xs md:text-sm text-slate-500">{s.label}</div>
              </div>
            ))}
          </motion.div>
        </div>

        <motion.div initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.2, delay: 0.9, ease: EASE }} className="lg:col-span-5 hidden md:block" style={{ perspective: 1200 }}>
          <motion.div style={{ rotateX, rotateY, transformStyle: "preserve-3d" }} className="relative" data-testid="hero-product-visual">
            <div className="relative rounded-2xl border border-cyan-500/20 overflow-hidden shadow-[0_0_60px_rgba(6,182,212,0.18)]">
              <img src="https://images.pexels.com/photos/27141316/pexels-photo-27141316.jpeg?q=80&w=1200&auto=format&fit=crop" alt="Tableau de bord MémoTruck" className="w-full h-[420px] object-cover" />
              <div className="absolute inset-0 bg-gradient-to-tr from-[#030712]/70 via-transparent to-transparent" />
              <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent" />
            </div>

            <motion.div animate={{ y: [0, -12, 0] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }} className="absolute -left-8 top-10 flex items-center gap-3 px-4 py-3 rounded-xl bg-[#0f172a]/80 backdrop-blur-xl border border-cyan-500/30 shadow-[0_0_30px_rgba(6,182,212,0.2)]" style={{ transform: "translateZ(60px)" }}>
              <span className="p-2 rounded-lg bg-amber-500/10 text-amber-400"><CalendarClock size={18} /></span>
              <div>
                <div className="text-xs font-semibold text-white">Contrôle technique</div>
                <div className="text-[11px] font-mono text-amber-400">FR-482-XK · J-7</div>
              </div>
            </motion.div>

            <motion.div animate={{ y: [0, 10, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", delay: 1 }} className="absolute -right-6 bottom-12 flex items-center gap-3 px-4 py-3 rounded-xl bg-[#0f172a]/80 backdrop-blur-xl border border-emerald-500/30 shadow-[0_0_30px_rgba(16,185,129,0.15)]" style={{ transform: "translateZ(80px)" }}>
              <span className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400"><ShieldCheck size={18} /></span>
              <div>
                <div className="text-xs font-semibold text-white">Tachygraphe conforme</div>
                <div className="text-[11px] font-mono text-emerald-400">38 véhicules · à jour</div>
              </div>
            </motion.div>

            <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }} className="absolute left-10 -bottom-6 flex items-center gap-2 px-4 py-2.5 rounded-full bg-cyan-500 text-[#030712] shadow-[0_0_30px_rgba(6,182,212,0.45)]" style={{ transform: "translateZ(100px)" }}>
              <BellRing size={15} />
              <span className="text-xs font-display font-bold">3 alertes planifiées</span>
            </motion.div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
