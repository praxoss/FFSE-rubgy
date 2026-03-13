import { useState, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { motion } from "motion/react";

interface Match {
  id: number;
  home_team: string;
  away_team: string;
  home_logo: string | null;
  away_logo: string | null;
  score_home: number | null;
  score_away: number | null;
  tries_home?: number;
  tries_away?: number;
  yellow_home?: number;
  yellow_away?: number;
  red_home?: number;
  red_away?: number;
  bonus_off_home?: number;
  bonus_def_home?: number;
  bonus_off_away?: number;
  bonus_def_away?: number;
}

interface Ranking {
  team: string;
  logo?: string | null;
}

type Division = "d1" | "d2" | "d3" | "d4";

type Metric = {
  key: string;
  label: string;
  compute: (team: string, matches: Match[]) => number;
  computeRed?: (team: string, matches: Match[]) => number;
  unit?: string;
};

const METRICS: Metric[] = [
  {
    key: "tries_for",
    label: "Essais marqués",
    unit: "essai",
    compute: (team, matches) =>
      matches
        .filter(m => m.score_home !== null)
        .filter(m => m.home_team.toLowerCase() === team.toLowerCase() || m.away_team.toLowerCase() === team.toLowerCase())
        .reduce((acc, m) => {
          const isHome = m.home_team.toLowerCase() === team.toLowerCase();
          return acc + (isHome ? (m.tries_home || 0) : (m.tries_away || 0));
        }, 0),
  },
  {
    key: "tries_against",
    label: "Essais concédés",
    unit: "essai",
    compute: (team, matches) =>
      matches
        .filter(m => m.score_home !== null)
        .filter(m => m.home_team.toLowerCase() === team.toLowerCase() || m.away_team.toLowerCase() === team.toLowerCase())
        .reduce((acc, m) => {
          const isHome = m.home_team.toLowerCase() === team.toLowerCase();
          return acc + (isHome ? (m.tries_away || 0) : (m.tries_home || 0));
        }, 0),
  },
  {
    key: "points_for",
    label: "Points marqués",
    unit: "point",
    compute: (team, matches) =>
      matches
        .filter(m => m.score_home !== null)
        .filter(m => m.home_team.toLowerCase() === team.toLowerCase() || m.away_team.toLowerCase() === team.toLowerCase())
        .reduce((acc, m) => {
          const isHome = m.home_team.toLowerCase() === team.toLowerCase();
          return acc + (isHome ? (m.score_home || 0) : (m.score_away || 0));
        }, 0),
  },
  {
    key: "points_against",
    label: "Points concédés",
    unit: "point",
    compute: (team, matches) =>
      matches
        .filter(m => m.score_home !== null)
        .filter(m => m.home_team.toLowerCase() === team.toLowerCase() || m.away_team.toLowerCase() === team.toLowerCase())
        .reduce((acc, m) => {
          const isHome = m.home_team.toLowerCase() === team.toLowerCase();
          return acc + (isHome ? (m.score_away || 0) : (m.score_home || 0));
        }, 0),
  },
  {
    key: "points_for_avg",
    label: "Moy. points marqués",
    unit: "point",
    compute: (team, matches) => {
      const teamMatches = matches
        .filter(m => m.score_home !== null)
        .filter(m => m.home_team.toLowerCase() === team.toLowerCase() || m.away_team.toLowerCase() === team.toLowerCase());
      if (teamMatches.length === 0) return 0;
      const total = teamMatches.reduce((acc, m) => {
        const isHome = m.home_team.toLowerCase() === team.toLowerCase();
        return acc + (isHome ? (m.score_home || 0) : (m.score_away || 0));
      }, 0);
      return Math.round((total / teamMatches.length) * 10) / 10;
    },
  },
  {
    key: "points_against_avg",
    label: "Moy. points encaissés",
    unit: "point",
    compute: (team, matches) => {
      const teamMatches = matches
        .filter(m => m.score_home !== null)
        .filter(m => m.home_team.toLowerCase() === team.toLowerCase() || m.away_team.toLowerCase() === team.toLowerCase());
      if (teamMatches.length === 0) return 0;
      const total = teamMatches.reduce((acc, m) => {
        const isHome = m.home_team.toLowerCase() === team.toLowerCase();
        return acc + (isHome ? (m.score_away || 0) : (m.score_home || 0));
      }, 0);
      return Math.round((total / teamMatches.length) * 10) / 10;
    },
  },
  {
    key: "penalties",
    label: "Pénalités",
    unit: "pénalité",
    compute: () => 0,
  },
  {
    key: "penalties",
    label: "Pénalités",
    unit: "pénalité",
    compute: () => 0,
  },
  {
    key: "cards",
    label: "Cartons",
    unit: "carton",
    compute: (team, matches) =>
      matches
        .filter(m => m.score_home !== null)
        .filter(m => m.home_team.toLowerCase() === team.toLowerCase() || m.away_team.toLowerCase() === team.toLowerCase())
        .reduce((acc, m) => {
          const isHome = m.home_team.toLowerCase() === team.toLowerCase();
          return acc + (isHome ? (m.yellow_home || 0) : (m.yellow_away || 0));
        }, 0),
    computeRed: (team: string, matches: Match[]) =>
      matches
        .filter(m => m.score_home !== null)
        .filter(m => m.home_team.toLowerCase() === team.toLowerCase() || m.away_team.toLowerCase() === team.toLowerCase())
        .reduce((acc, m) => {
          const isHome = m.home_team.toLowerCase() === team.toLowerCase();
          return acc + (isHome ? (m.red_home || 0) : (m.red_away || 0));
        }, 0),
  },
  {
    key: "bonus_off",
    label: "Bonus offensifs",
    unit: "bonus",
    compute: (team, matches) =>
      matches
        .filter(m => m.score_home !== null)
        .filter(m => m.home_team.toLowerCase() === team.toLowerCase() || m.away_team.toLowerCase() === team.toLowerCase())
        .reduce((acc, m) => {
          const isHome = m.home_team.toLowerCase() === team.toLowerCase();
          return acc + (isHome ? (m.bonus_off_home || 0) : (m.bonus_off_away || 0));
        }, 0),
  },
  {
    key: "bonus_def",
    label: "Bonus défensifs",
    unit: "bonus",
    compute: (team, matches) =>
      matches
        .filter(m => m.score_home !== null)
        .filter(m => m.home_team.toLowerCase() === team.toLowerCase() || m.away_team.toLowerCase() === team.toLowerCase())
        .reduce((acc, m) => {
          const isHome = m.home_team.toLowerCase() === team.toLowerCase();
          return acc + (isHome ? (m.bonus_def_home || 0) : (m.bonus_def_away || 0));
        }, 0),
  },
];

export default function StatsPage() {
  const { div } = useParams<{ div: string }>();
  const navigate = useNavigate();
  const division = (div || "d3") as Division;

  const [matches, setMatches] = useState<Match[]>([]);
  const [rankings, setRankings] = useState<Ranking[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMetric, setSelectedMetric] = useState<string>("tries_for");

  useEffect(() => {
    fetch(`${window.location.origin}/api/data`)
      .then(r => r.json())
      .then(json => {
        setMatches(json[division]?.matches || []);
        setRankings(json[division]?.rankings || []);
      })
      .finally(() => setLoading(false));
  }, [division]);

  const metric = METRICS.find(m => m.key === selectedMetric)!;

  const teamStats = useMemo(() => {
    return rankings.map(r => ({
      team: r.team,
      logo: r.logo,
      value: metric.compute(r.team, matches),
      redValue: metric.computeRed ? metric.computeRed(r.team, matches) : undefined,
    })).sort((a, b) => {
      const asc = ["tries_against", "points_against", "points_against_avg", "cards", "penalties"].includes(selectedMetric);
      if (!asc) return b.value - a.value;
      if (selectedMetric === "cards" && a.redValue !== undefined && b.redValue !== undefined) {
        if (a.redValue !== b.redValue) return a.redValue - b.redValue;
        return a.value - b.value;
      }
      return a.value - b.value;
    });
  }, [rankings, matches, selectedMetric, metric]);

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-neutral-900 text-white">
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
        <RefreshCw size={48} className="text-blue-500" />
      </motion.div>
    </div>
  );

  return (
    <div className="min-h-screen font-sans pb-20 bg-neutral-50">
      <header className="bg-ffse-navy text-white px-4 pt-4 pb-3 border-b-4 border-ffse-red sticky top-0 z-50">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <button onClick={() => navigate(`/${division}`)} className="flex items-center gap-1 text-blue-300 hover:text-white font-bold uppercase tracking-wider transition-colors text-xs">
            <ChevronLeft size={18} /> Retour
          </button>
          <div className="text-[10px] uppercase tracking-widest text-blue-300/60 font-bold">
            {division.toUpperCase()} · Classements spécifiques
          </div>
          <div className="w-16" />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 mt-8 space-y-6">
        {/* Dropdown */}
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-4">
          <label className="text-[10px] uppercase tracking-widest font-bold text-neutral-400 block mb-2">Classer par</label>
          <div className="flex flex-wrap gap-2">
            {METRICS.filter(m => m.key !== "penalties").map(m => (
              <button
                key={m.key}
                onClick={() => setSelectedMetric(m.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                  selectedMetric === m.key
                    ? "bg-ffse-navy text-white shadow-md"
                    : "bg-neutral-100 text-neutral-400 hover:bg-neutral-200 hover:text-ffse-navy"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Classement */}
        <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-neutral-200">
          <div className="px-4 py-3 border-b border-neutral-100 flex items-center justify-between">
            <h2 className="font-display text-xl uppercase tracking-tighter">{metric.label}</h2>
            <span className="text-[10px] uppercase tracking-widest font-bold text-neutral-400">
              {["tries_against", "points_against", "points_against_avg", "cards", "penalties"].includes(selectedMetric) ? "ordre croissant" : "ordre décroissant"}
            </span>
          </div>
          <div className="divide-y divide-neutral-100">
            {teamStats.map((team, idx) => (
              <motion.div
                key={team.team}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03 }}
                className="flex items-center gap-4 px-4 py-3 hover:bg-neutral-50 transition-colors"
              >
                <span className="font-display text-3xl text-neutral-200 w-8 shrink-0">{idx + 1}</span>
                <div className="w-9 h-9 bg-white rounded-full flex items-center justify-center border border-neutral-100 shadow-sm overflow-hidden shrink-0">
                  <img
                    src={team.logo || `https://api.dicebear.com/7.x/initials/svg?seed=${team.team}&backgroundColor=f5f5f5&textColor=999`}
                    alt="" className="w-full h-full object-contain p-1" referrerPolicy="no-referrer"
                  />
                </div>
                <button
                  onClick={() => navigate(`/${division}/club/${encodeURIComponent(team.team)}`)}
                  className="flex-1 font-bold text-sm text-neutral-900 hover:text-ffse-blue transition-colors text-left"
                >
                  {team.team}
                </button>
                <span className="font-display text-2xl text-ffse-navy shrink-0 flex items-center gap-2">
                  {selectedMetric === "cards" ? (
                    <>
                      <span className="flex items-center gap-0.5">
                        <img src="https://www.lequipe.fr/img/icons/ico_carton_rouge.svg" width={10} height={14} alt="rouge" style={{ height: "auto" }} />
                        <span className={(team.redValue ?? 0) > 0 ? "text-red-500 text-lg" : "text-neutral-200 text-lg"}>{team.redValue ?? 0}</span>
                      </span>
                      <span className="flex items-center gap-0.5">
                        <img src="https://www.lequipe.fr/img/icons/ico_carton_jaune.svg" width={10} height={14} alt="jaune" style={{ height: "auto" }} />
                        <span className={team.value > 0 ? "text-yellow-500 text-lg" : "text-neutral-200 text-lg"}>{team.value}</span>
                      </span>
                    </>
                  ) : team.value}
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
