import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Trophy, Calendar, ChevronLeft, Swords, Archive as ArchiveIcon } from "lucide-react";

interface ArchiveRanking {
  team: string;
  division: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  bonus: number;
  diff: number;
  points: number;
  logo?: string | null;
}

interface ArchiveMatch {
  id: number;
  matchday: number;
  date: string;
  time: string;
  location: string;
  home_team: string;
  away_team: string;
  home_logo: string | null;
  away_logo: string | null;
  score_home: number | null;
  score_away: number | null;
}

interface ArchivePlayoffMatch {
  id: number;
  date: string;
  time: string | null;
  location: string | null;
  home_team: string;
  away_team: string;
  home_logo: string | null;
  away_logo: string | null;
  score_home: number | null;
  score_away: number | null;
  winner: string | null;
}

interface ArchiveDivisionData {
  rankings: ArchiveRanking[];
  matches: ArchiveMatch[];
  playoffs: ArchivePlayoffMatch[];
}

type Division = "d1" | "d2" | "d3" | "d4";

const ClubLogo = ({ src, seed }: { src?: string | null; seed: string }) => (
  <div className="w-8 h-8 md:w-9 md:h-9 bg-white rounded-full flex items-center justify-center border border-neutral-100 shadow-sm overflow-hidden shrink-0">
    <img
      src={src || `https://api.dicebear.com/7.x/initials/svg?seed=${seed}&backgroundColor=f5f5f5&textColor=999`}
      alt=""
      className="w-full h-full object-contain p-1.5"
      referrerPolicy="no-referrer"
    />
  </div>
);

function formatDate(dateStr: string) {
  if (!dateStr) return "";
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
}

// ── Liste des saisons archivées ───────────────────────────
export function ArchiveIndex() {
  const navigate = useNavigate();
  const [seasons, setSeasons] = useState<{ season: string; archived_at: string }[] | null>(null);

  useEffect(() => {
    fetch(`${window.location.origin}/api/archive`)
      .then(res => res.json())
      .then(setSeasons)
      .catch(() => setSeasons([]));
  }, []);

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 gap-10">
      <button onClick={() => navigate("/")} className="absolute top-4 left-4 w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-neutral-200 shadow-md hover:opacity-80 transition-opacity">
        <ChevronLeft className="text-ffse-navy" size={22} />
      </button>
      <div className="flex flex-col items-center gap-3">
        <ArchiveIcon className="text-ffse-red" size={40} />
        <h1 className="font-display text-3xl md:text-5xl tracking-tighter uppercase text-ffse-navy leading-none text-center">
          Saisons précédentes
        </h1>
      </div>

      <div className="flex flex-col gap-3 w-full max-w-sm">
        {seasons === null && <p className="text-neutral-400 text-sm text-center italic">Chargement...</p>}
        {seasons?.length === 0 && <p className="text-neutral-400 text-sm text-center italic">Aucune saison archivée pour l'instant.</p>}
        {seasons?.map(s => (
          <button
            key={s.season}
            onClick={() => navigate(`/archives/${s.season}`)}
            className="bg-ffse-navy hover:bg-ffse-navy/80 border border-ffse-navy rounded-2xl py-6 px-6 text-white font-display text-2xl uppercase tracking-tighter transition-all hover:scale-105 active:scale-95 text-left"
          >
            Saison {s.season}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Accueil d'une saison archivée (choix de division) ─────
export function ArchiveSeasonHome() {
  const { season } = useParams<{ season: string }>();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-6 gap-12">
      <button onClick={() => navigate("/archives")} className="absolute top-4 left-4 w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-neutral-200 shadow-md hover:opacity-80 transition-opacity">
        <ChevronLeft className="text-ffse-navy" size={22} />
      </button>
      <div className="flex flex-col items-center gap-3">
        <ArchiveIcon className="text-ffse-red" size={48} />
        <h1 className="font-display text-4xl md:text-6xl tracking-tighter uppercase text-ffse-navy leading-none">
          Rugby FFSE
        </h1>
        <p className="text-neutral-400 font-medium text-xs uppercase tracking-widest">
          Archives — Saison {season}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 w-full max-w-sm">
        {(["D1", "D2", "D3", "D4"] as const).map(div => (
          <button
            key={div}
            onClick={() => navigate(`/archives/${season}/${div.toLowerCase()}`)}
            className="bg-ffse-navy hover:bg-ffse-navy/80 border border-ffse-navy rounded-2xl py-8 text-white font-display text-4xl uppercase tracking-tighter transition-all hover:scale-105 active:scale-95"
          >
            {div}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Classement + résultats + phases finales d'une division archivée ─
export function ArchiveDivisionPage() {
  const { season, div } = useParams<{ season: string; div: string }>();
  const navigate = useNavigate();
  const division = (div || "d3") as Division;
  const [data, setData] = useState<ArchiveDivisionData | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    setData(null);
    setNotFound(false);
    fetch(`${window.location.origin}/api/archive/${season}`)
      .then(res => {
        if (!res.ok) throw new Error("not found");
        return res.json();
      })
      .then(json => setData(json[division] || { rankings: [], matches: [], playoffs: [] }))
      .catch(() => setNotFound(true));
  }, [season, division]);

  const rankings = data?.rankings || [];
  const matches = data?.matches || [];
  const playoffs = data?.playoffs || [];

  return (
    <div className="min-h-screen font-sans pb-20 bg-neutral-50">
      <header className="bg-ffse-navy text-white px-4 pt-4 pb-3 border-b-4 border-ffse-red sticky top-0 z-50">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <button onClick={() => navigate(`/archives/${season}`)} className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-neutral-200 shadow-md overflow-hidden shrink-0 hover:opacity-80 transition-opacity">
            <ChevronLeft className="text-ffse-navy" size={22} />
          </button>
          <div>
            <h1 className="font-display text-xl md:text-3xl tracking-tighter uppercase leading-none">Rugby <span className="text-ffse-red">{division.toUpperCase()}</span> FFSE</h1>
            <p className="text-blue-300/60 font-medium text-[10px] uppercase tracking-widest">Archives — Saison {season}</p>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 mt-6 space-y-12">
        {notFound && (
          <p className="text-neutral-400 text-sm text-center italic mt-20">Saison introuvable dans les archives.</p>
        )}

        {!notFound && (
          <section>
            <div className="flex items-center gap-3 mb-6 border-b-4 border-ffse-navy pb-3">
              <Trophy className="text-ffse-red shrink-0" size={22} />
              <h2 className="font-display text-xl md:text-3xl uppercase tracking-tighter flex-1">Classement {division.toUpperCase()}</h2>
            </div>
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-neutral-200">
              <div className="overflow-x-auto">
                <table className="w-full text-left table-fixed">
                  <thead>
                    <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
                      <th className="pl-2 pr-0 py-3 w-4 md:w-10">N°</th>
                      <th className="px-1 py-3 w-9 md:w-12"></th>
                      <th className="px-2 py-3 text-left w-32 md:w-48">Équipe</th>
                      <th className="px-1 py-3 text-center w-6">J</th>
                      <th className="px-1 py-3 text-center w-6">G</th>
                      <th className="px-1 py-3 text-center w-6">N</th>
                      <th className="px-1 py-3 text-center w-6">P</th>
                      <th className="hidden md:table-cell px-2 py-3 text-center w-12">Bonus</th>
                      <th className="hidden md:table-cell px-2 py-3 text-center w-12">+/-</th>
                      <th className="px-2 py-3 text-center bg-ffse-red text-white w-10 md:w-14">Pts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {rankings.length > 0 ? rankings.map((team, idx) => (
                      <tr key={team.team}>
                        <td className="pl-2 pr-0 py-3 font-display text-xl md:text-4xl text-neutral-200">{idx + 1}</td>
                        <td className="px-1 py-3"><ClubLogo src={team.logo} seed={team.team} /></td>
                        <td className="px-2 py-3 w-32 md:w-48"><span className="font-bold text-base text-neutral-900 leading-tight">{team.team}</span></td>
                        <td className="px-1 py-3 text-center text-xs text-neutral-500">{team.played}</td>
                        <td className="px-1 py-3 text-center text-xs text-neutral-500">{team.won}</td>
                        <td className="px-1 py-3 text-center text-xs text-neutral-500">{team.drawn}</td>
                        <td className="px-1 py-3 text-center text-xs text-neutral-500">{team.lost}</td>
                        <td className="hidden md:table-cell px-2 py-3 text-center text-xs text-neutral-500">{team.bonus}</td>
                        <td className={`hidden md:table-cell px-2 py-3 text-center text-xs font-mono ${team.diff > 0 ? "text-emerald-600" : team.diff < 0 ? "text-red-600" : "text-neutral-400"}`}>{team.diff > 0 ? `+${team.diff}` : team.diff}</td>
                        <td className="px-2 py-3 text-center font-display text-xl md:text-2xl text-neutral-900 bg-neutral-50/50">{team.points}</td>
                      </tr>
                    )) : (
                      <tr><td colSpan={9} className="px-6 py-20 text-center text-neutral-400 italic">
                        {data ? "Aucun classement archivé pour cette division." : "Chargement..."}
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

        {!notFound && playoffs.length > 0 && (
          <section>
            <div className="flex items-center gap-3 mb-6 border-b-4 border-ffse-navy pb-3">
              <Swords className="text-ffse-red shrink-0" size={22} />
              <h2 className="font-display text-xl md:text-3xl uppercase tracking-tighter">Phases finales</h2>
            </div>
            <div className="space-y-3">
              {playoffs.map(m => (
                <div key={m.id} className="bg-white p-3 md:p-5 rounded-2xl shadow-sm border border-neutral-200 flex items-center gap-2 md:gap-4">
                  <div className="flex-1 text-right min-w-0"><span className="font-bold text-xs md:text-sm text-neutral-800">{m.home_team}</span></div>
                  <div className="flex items-center gap-2 shrink-0">
                    <ClubLogo src={m.home_logo} seed={m.home_team} />
                    <div className="bg-neutral-900 text-white px-3 py-1.5 rounded-lg flex items-center gap-2 font-display text-lg md:text-xl min-w-[76px] justify-center shadow-lg">
                      <span className={m.winner === m.home_team ? "text-white" : "text-white/50"}>{m.score_home ?? "–"}</span>
                      <span className="text-white/30 text-sm">-</span>
                      <span className={m.winner === m.away_team ? "text-white" : "text-white/50"}>{m.score_away ?? "–"}</span>
                    </div>
                    <ClubLogo src={m.away_logo} seed={m.away_team} />
                  </div>
                  <div className="flex-1 text-left min-w-0"><span className="font-bold text-xs md:text-sm text-neutral-800">{m.away_team}</span></div>
                </div>
              ))}
            </div>
          </section>
        )}

        {!notFound && (
          <section>
            <div className="flex items-center gap-3 mb-6 border-b-4 border-ffse-navy pb-3">
              <Calendar className="text-ffse-red shrink-0" size={22} />
              <h2 className="font-display text-xl md:text-3xl uppercase tracking-tighter">Résultats de la saison</h2>
            </div>
            <div className="space-y-3">
              {matches.length === 0 && data && <p className="text-neutral-400 italic text-sm">Aucun résultat archivé.</p>}
              {matches.map(m => (
                <div key={m.id} className="bg-white p-3 md:p-5 rounded-2xl shadow-sm border border-neutral-200 flex items-center gap-2 md:gap-4">
                  <div className="w-16 shrink-0 text-[10px] text-neutral-400 uppercase tracking-wide">{formatDate(m.date)}</div>
                  <div className="flex-1 text-right min-w-0"><span className="font-bold text-xs md:text-sm text-neutral-800">{m.home_team}</span></div>
                  <div className="flex items-center gap-2 shrink-0">
                    <ClubLogo src={m.home_logo} seed={m.home_team} />
                    <div className="bg-neutral-900 text-white px-3 py-1.5 rounded-lg flex items-center gap-2 font-display text-lg md:text-xl min-w-[76px] justify-center shadow-lg">
                      <span className={m.score_home !== null && m.score_away !== null && m.score_home > m.score_away ? "text-white" : "text-white/50"}>{m.score_home ?? "–"}</span>
                      <span className="text-white/30 text-sm">-</span>
                      <span className={m.score_home !== null && m.score_away !== null && m.score_away > m.score_home ? "text-white" : "text-white/50"}>{m.score_away ?? "–"}</span>
                    </div>
                    <ClubLogo src={m.away_logo} seed={m.away_team} />
                  </div>
                  <div className="flex-1 text-left min-w-0"><span className="font-bold text-xs md:text-sm text-neutral-800">{m.away_team}</span></div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
