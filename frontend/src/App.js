import { useEffect, useRef } from "react";
import "@/App.css";
import Lenis from "lenis";
import { Toaster } from "sonner";
import Navbar from "@/components/landing/Navbar";
import Hero from "@/components/landing/Hero";
import Marquee from "@/components/landing/Marquee";
import Features from "@/components/landing/Features";
import Contact from "@/components/landing/Contact";
import Footer from "@/components/landing/Footer";

function App() {
  const lenisRef = useRef(null);

  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.25,
      smoothWheel: true,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    });
    lenisRef.current = lenis;

    let rafId;
    const raf = (time) => {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
    };
  }, []);

  const scrollTo = (target) => {
    lenisRef.current?.scrollTo(target, { offset: -72, duration: 1.6 });
  };

  return (
    <div className="App font-body">
      <div className="grain-overlay" aria-hidden="true" />
      <Navbar onNavigate={scrollTo} />
      <main>
        <Hero onNavigate={scrollTo} />
        <Marquee />
        <Features />
        <Contact />
      </main>
      <Footer onNavigate={scrollTo} />
      <Toaster theme="dark" position="bottom-right" />
    </div>
  );
}

export default App;
