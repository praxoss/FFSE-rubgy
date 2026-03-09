import { useNavigate } from "react-router-dom";
import { Trophy } from "lucide-react";
import { motion } from "motion/react";

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 gap-12">
      <div className="flex flex-col items-center gap-3">
        <Trophy className="text-ffse-red" size={48} />
        <h1 className="font-display text-4xl md:text-6xl tracking-tighter uppercase text-ffse-navy leading-none">
          Rugby FFSE
        </h1>
        <p className="text-neutral-400 font-medium text-xs uppercase tracking-widest">
          Saison 2025 - 2026
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 w-full max-w-sm">
        {(["D1", "D2", "D3", "D4"] as const).map((div, i) => (
          <motion.button
            key={div}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            onClick={() => navigate(`/${div.toLowerCase()}`)}
            className="bg-white/10 hover:bg-white/20 border border-white/20 rounded-2xl py-8 text-white font-display text-4xl uppercase tracking-tighter transition-all hover:scale-105 active:scale-95"
          >
            {div}
          </motion.button>
        ))}
      </div>
    </div>
  );
}
