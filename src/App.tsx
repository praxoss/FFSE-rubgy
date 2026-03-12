import { useState, useEffect, useMemo } from "react";
import { Routes, Route, useNavigate, useParams, useLocation } from "react-router-dom";
import HomePage from "./HomePage";
import { Trophy, Calendar, RefreshCw, ChevronRight, ChevronLeft, Info, MapPin, LogIn, LogOut } from "lucide-react";
import { motion } from "motion/react";
import { auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged, User, isFirebaseConfigured } from "./firebase";

interface Ranking {
  id: number;
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  bonus: number;
  diff: number;
  points: number;
  logo?: string | null;
  trend?: "up" | "down" | "equal" | null;
}

interface Match {
  id: number;
  ffse_event_id?: number;
  bonus_off_home?: number;
  bonus_def_home?: number;
  bonus_off_away?: number;
  bonus_def_away?: number;
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

interface MatchStats {
  tries: string | null;
  conversions: string | null;
  penalties: string | null;
  drops: string | null;
  yellow: string | null;
  red: string | null;
  bonus_def: string | null;
  bonus_off: string | null;
}

interface MatchDetail {
  match: Match & { ffse_event_id: number };
  venue: { id: number; name: string; slug: string } | null;
  stats: { home: MatchStats | null; away: MatchStats | null };
  ffse_url: string;
}

interface DivisionData {
  rankings: Ranking[];
  matches: Match[];
}

type Division = "d1" | "d2" | "d3" | "d4";
type Tab = "ranking" | "results";

function DivisionPage() {
  const { div, day, club } = useParams<{ div: string; day?: string; club?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const division = (div || "d3") as Division;
  const activeTab: Tab = location.pathname.includes("/results") ? "results" : "ranking";

  const [data, setData] = useState<Record<Division, DivisionData>>({
    d1: { rankings: [], matches: [] },
    d2: { rankings: [], matches: [] },
    d3: { rankings: [], matches: [] },
    d4: { rankings: [], matches: [] },
  });
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [debugResult, setDebugResult] = useState<any>(null);
  const [user, setUser] = useState<User | null>(null);

  const { rankings, matches } = data[division];

  const computeMatchday = (matches: Match[]) => {
    if (matches.length === 0) return 1;
    const withResults = matches.filter(m => m.score_home !== null);
    if (withResults.length > 0) return Math.max(...withResults.map(m => m.matchday));
    return Math.min(...matches.map(m => m.matchday));
  };

  const defaultMatchday = useMemo(() => computeMatchday(matches), [matches]);
  const currentMatchday = day ? parseInt(day) : defaultMatchday;
  const maxMatchday = useMemo(() => matches.length > 0 ? Math.max(...matches.map(m => m.matchday)) : 1, [matches]);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  const fetchData = async () => {
    try {
      const res = await fetch(`${window.location.origin}/api/data`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData({
        d1: { rankings: json.d1?.rankings || [], matches: json.d1?.matches || [] },
        d2: { rankings: json.d2?.rankings || [], matches: json.d2?.matches || [] },
        d3: { rankings: json.d3?.rankings || [], matches: json.d3?.matches || [] },
        d4: { rankings: json.d4?.rankings || [], matches: json.d4?.matches || [] },
      });
    } catch (err) {
      console.error("Failed to fetch data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleLogin = async () => {
    if (!isFirebaseConfigured) { alert("Firebase n'est pas configuré."); return; }
    try { await signInWithPopup(auth, googleProvider); }
    catch (err: any) { alert(`Erreur de connexion : ${err.message}`); }
  };

  const handleLogout = async () => {
    if (!isFirebaseConfigured) return;
    try { await signOut(auth); } catch {}
  };

  const handleUpdate = async () => {
    if (!user) { alert("Veuillez vous connecter."); return; }
    setUpdating(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`${window.location.origin}/admin/refresh`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${idToken}` }
      });
      if (res.ok) await fetchData();
      else { const err = await res.json(); alert(`Erreur: ${err.error}`); }
    } catch (err) { console.error("Update failed", err); }
    finally { setUpdating(false); }
  };

  const handleDebugFetch = async () => {
    const url = window.prompt("URL à tester", "https://www.rugby-ffse.fr/saison-2025-2026/d3/");
    if (!url || !user) return;
    setUpdating(true);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`${window.location.origin}/admin/debug-fetch?url=${encodeURIComponent(url)}`, {
        headers: { "Authorization": `Bearer ${idToken}` }
      });
      setDebugResult(await res.json());
    } catch (e) { console.error("Debug fetch failed", e); }
    finally { setUpdating(false); }
  };

  const navigateMatchday = (dir: "prev" | "next") => {
    const next = dir === "prev" ? currentMatchday - 1 : currentMatchday + 1;
    if (next < 1 || next > maxMatchday) return;
    navigate(`/${division}/results/${next}`);
  };

  const currentMatchdayMatches = useMemo(() =>
    matches.filter(m => m.matchday === currentMatchday),
    [matches, currentMatchday]
  );

  const matchesByDate = useMemo(() => {
    const groups: Record<string, Match[]> = {};
    currentMatchdayMatches.forEach(m => {
      if (!groups[m.date]) groups[m.date] = [];
      groups[m.date].push(m);
    });
    return groups;
  }, [currentMatchdayMatches]);

  const formatDate = (dateStr: string) => {
    try {
      return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(dateStr));
    } catch { return dateStr; }
  };

  const formatShortDateTime = (dateStr: string, timeStr: string) => {
    try {
      const d = new Date(dateStr);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      if (timeStr === "00:00") return `${day}/${month}`;
      return `${day}/${month} • ${timeStr}`;
    } catch { return dateStr; }
  };

  const ClubLogo = ({ src, seed, size = "md" }: { src: string | null | undefined; seed: string; size?: "sm" | "md" }) => {
    const sizeClass = size === "sm" ? "w-7 h-7 md:w-9 md:h-9" : "w-8 h-8 md:w-10 md:h-10";
    return (
      <div className={`${sizeClass} bg-white rounded-full flex items-center justify-center border border-neutral-100 shadow-sm overflow-hidden shrink-0`}>
        <img src={src || `https://api.dicebear.com/7.x/initials/svg?seed=${seed}&backgroundColor=f5f5f5&textColor=999`}
          alt="" className="w-full h-full object-contain p-1.5" referrerPolicy="no-referrer" />
      </div>
    );
  };

  const Header = () => (
    <header className="bg-ffse-navy text-white px-4 pt-4 pb-3 border-b-4 border-ffse-red sticky top-0 z-50">
      <div className="max-w-5xl mx-auto flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate("/")} className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-neutral-200 shadow-md overflow-hidden shrink-0 hover:opacity-80 transition-opacity">
              <Trophy className="text-ffse-navy" size={22} />
            </button>
            <div>
              <h1 className="font-display text-xl md:text-3xl tracking-tighter uppercase leading-none">
                Rugby <span className="text-ffse-red">{division.toUpperCase()}</span> FFSE
              </h1>
              <p className="text-blue-300/60 font-medium text-[10px] uppercase tracking-widest">Saison 2025 - 2026</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {updating && <RefreshCw size={12} className="animate-spin text-blue-400" />}
            {user ? (
              <button onClick={handleLogout} className="text-blue-300 hover:text-white transition-colors"><LogOut size={20} /></button>
            ) : (
              <button onClick={handleLogin} className="text-blue-300 hover:text-white transition-colors"><LogIn size={22} /></button>
            )}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {(["d1", "d2", "d3", "d4"] as Division[]).map((d, i) => (
              <span key={d} className="flex items-center gap-2">
                {i > 0 && <span className="text-blue-300/30">|</span>}
                <button onClick={() => navigate(`/${d}`)}
                  className={`font-display text-sm uppercase tracking-wider transition-colors ${division === d ? "text-white" : "text-blue-300/50 hover:text-blue-200"}`}>
                  {d.toUpperCase()}
                </button>
              </span>
            ))}
          </div>
          {user && (
            <div className="flex gap-3">
              <button onClick={handleDebugFetch} className="text-[10px] text-blue-300 hover:text-white uppercase font-bold tracking-wider">Debug</button>
              <button onClick={handleUpdate} className="text-[10px] text-blue-300 hover:text-white uppercase font-bold tracking-wider">MAJ</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-neutral-900 text-white">
        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
          <RefreshCw size={48} className="text-blue-500" />
        </motion.div>
      </div>
    );
  }

  // ── Vue Club ──────────────────────────────────────────────
  if (club) {
    const selectedClub = decodeURIComponent(club);
    const selectedClubData = rankings.find(r => r.team.toLowerCase() === selectedClub.toLowerCase());
    const clubMatches = matches
      .filter(m => {
        const t = selectedClub.toLowerCase();
        return m.home_team.toLowerCase() === t || m.away_team.toLowerCase() === t;
      })
      .sort((a, b) => a.matchday - b.matchday);
    const pastMatches = clubMatches.filter(m => m.score_home !== null);
    const futureMatches = clubMatches.filter(m => m.score_home === null);

    return (
      <div className="min-h-screen font-sans pb-20 bg-neutral-50">
        <header className="bg-ffse-navy text-white py-5 px-4 border-b-4 border-ffse-red sticky top-0 z-50">
          <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
            <div className="shrink-0">
              <button onClick={() => navigate(`/${division}`)} className="flex items-center gap-1 text-blue-300 hover:text-white font-bold uppercase tracking-wider transition-colors text-xs">
                <ChevronLeft size={18} /> Retour
              </button>
            </div>
            <div className="flex items-center gap-3 flex-1 min-w-0 justify-center">
              <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-neutral-200 shadow-md overflow-hidden shrink-0">
                <img src={selectedClubData?.logo || `https://api.dicebear.com/7.x/initials/svg?seed=${selectedClub}&backgroundColor=f5f5f5&textColor=999`}
                  alt="" className="w-full h-full object-contain p-1.5" referrerPolicy="no-referrer" />
              </div>
              <div>
                <h1 className="font-display text-lg md:text-2xl tracking-tighter uppercase leading-none">{selectedClub}</h1>
                <p className="text-blue-300/60 text-[9px] uppercase tracking-widest font-bold">{division.toUpperCase()} · Saison 2025-2026</p>
              </div>
            </div>
            <div className="shrink-0">
              {user && <button onClick={handleLogout} className="text-blue-300 hover:text-white transition-colors"><LogOut size={18} /></button>}
            </div>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 mt-10 space-y-12">
          <section>
            <div className="flex items-center gap-3 mb-6 border-b-4 border-ffse-navy pb-3">
              <Trophy className="text-ffse-red shrink-0" size={22} />
              <h2 className="font-display text-2xl md:text-3xl uppercase tracking-tighter">Résultats de la saison</h2>
            </div>
            <div className="space-y-3">
              {pastMatches.length === 0 && <p className="text-neutral-400 italic text-sm">Aucun résultat pour l'instant.</p>}
              {pastMatches.map((m) => (
                <div key={m.id} className="bg-white p-3 md:p-5 rounded-2xl shadow-sm border border-neutral-200 flex items-center gap-2 md:gap-4">
                  <div className="flex-1 text-right min-w-0"><span className="font-bold text-xs md:text-sm text-neutral-800">{m.home_team}</span></div>
                  <div className="flex items-center gap-2 shrink-0">
                    <ClubLogo src={m.home_logo} seed={m.home_team} size="sm" />
                    <div className="bg-neutral-900 text-white px-3 py-1.5 rounded-lg flex items-center gap-2 font-display text-lg md:text-xl min-w-[76px] justify-center shadow-lg">
                      <button
                        onClick={() => m.ffse_event_id && navigate(`/${division}/match/${m.ffse_event_id}`)}
                        className={m.ffse_event_id ? "hover:opacity-70 transition-opacity flex items-center gap-1" : "flex items-center gap-1"}
                      >
                        <span className={m.score_home! > m.score_away! ? "text-white" : "text-neutral-400"}>{m.score_home}</span>
                        <span className="text-neutral-500 text-sm">-</span>
                        <span className={m.score_away! > m.score_home! ? "text-white" : "text-neutral-400"}>{m.score_away}</span>
                      </button>
                    </div>
                    <ClubLogo src={m.away_logo} seed={m.away_team} size="sm" />
                  </div>
                  <div className="flex-1 text-left min-w-0"><span className="font-bold text-xs md:text-sm text-neutral-800">{m.away_team}</span></div>
                </div>
              ))}
            </div>
          </section>
          <section>
            <div className="flex items-center gap-3 mb-6 border-b-4 border-ffse-navy pb-3">
              <Calendar className="text-ffse-red shrink-0" size={22} />
              <h2 className="font-display text-2xl md:text-3xl uppercase tracking-tighter">Prochains Matchs</h2>
            </div>
            <div className="space-y-3">
              {futureMatches.length === 0 && <p className="text-neutral-400 italic text-sm">Aucun match à venir.</p>}
              {futureMatches.map((m) => (
                <div key={m.id} className="bg-white p-3 md:p-5 rounded-2xl shadow-sm border border-neutral-200 flex items-center gap-2 md:gap-4 relative overflow-hidden">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500 opacity-30" />
                  <div className="flex-1 text-right min-w-0"><span className="font-bold text-xs md:text-sm text-neutral-800">{m.home_team}</span></div>
                  <div className="flex items-center gap-2 shrink-0">
                    <ClubLogo src={m.home_logo} seed={m.home_team} size="sm" />
                    <div className="bg-neutral-800 text-white px-3 py-1.5 rounded-lg flex flex-col items-center justify-center min-w-[76px] shadow-lg">
                      <span className="text-[9px] md:text-xs font-sans font-bold uppercase tracking-tight text-neutral-300 text-center leading-tight">{formatShortDateTime(m.date, m.time)}</span>
                      <div className="flex items-center gap-1 text-[7px] text-neutral-400 mt-0.5 max-w-[70px]">
                        <MapPin size={6} className="shrink-0" />
                        <span className="truncate">{m.location}</span>
                      </div>
                    </div>
                    <ClubLogo src={m.away_logo} seed={m.away_team} size="sm" />
                  </div>
                  <div className="flex-1 text-left min-w-0"><span className="font-bold text-xs md:text-sm text-neutral-800">{m.away_team}</span></div>
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
    );
  }

  // ── Vue Home Division ──────────────────────────────────────────────
  return (
    <div className="min-h-screen font-sans pb-20 bg-neutral-50">
      <Header />

      <div className="max-w-5xl mx-auto mt-6 px-4">
        <div className="bg-white p-1 rounded-xl flex gap-1 border border-neutral-200 shadow-sm">
          {(["ranking", "results"] as Tab[]).map(t => (
            <button key={t} onClick={() => navigate(`/${division}${t === "results" ? "/results" : ""}`)}
              className={`flex-1 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                activeTab === t ? "bg-ffse-navy text-white shadow-md" : "text-neutral-400 hover:text-ffse-navy hover:bg-neutral-50"
              }`}
            >
              {t === "ranking" ? "Classement" : "Résultats et calendrier"}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 mt-6 space-y-12">
        {debugResult && (
          <div className="bg-neutral-900 text-neutral-400 rounded-3xl overflow-hidden border border-neutral-800 shadow-2xl">
            <div className="bg-neutral-800 px-6 py-3 flex items-center justify-between border-b border-neutral-700">
              <h3 className="text-[10px] uppercase tracking-widest font-bold">Debug</h3>
              <button onClick={() => navigator.clipboard.writeText(JSON.stringify(debugResult, null, 2))} className="text-neutral-500 hover:text-white text-xs font-bold uppercase">Copier</button>
              <button onClick={() => setDebugResult(null)} className="text-neutral-500 hover:text-white text-xs font-bold uppercase">Fermer</button>
            </div>
            <div className="p-6 overflow-auto max-h-[400px] font-mono text-[10px] leading-relaxed">
              <pre>{JSON.stringify(debugResult, null, 2)}</pre>
            </div>
          </div>
        )}

        {activeTab === "results" ? (
          <section className="max-w-3xl mx-auto">
            <div className="flex items-center gap-3 mb-6 border-b-4 border-ffse-navy pb-3">
              <Calendar className="text-ffse-red shrink-0" size={22} />
              <h2 className="font-display text-xl md:text-3xl uppercase tracking-tighter">Calendrier & Résultats</h2>
            </div>
            <div className="flex items-center justify-between mb-8 bg-white p-4 rounded-2xl border border-neutral-200 shadow-sm">
              <button onClick={() => navigateMatchday("prev")} className="p-2 rounded-full hover:bg-neutral-100 transition-colors text-neutral-400 hover:text-ffse-navy">
                <ChevronLeft size={26} />
              </button>
              <h3 className="font-display text-2xl md:text-3xl uppercase tracking-tight text-ffse-navy">Journée {currentMatchday}</h3>
              <button onClick={() => navigateMatchday("next")} className="p-2 rounded-full hover:bg-neutral-100 transition-colors text-neutral-400 hover:text-ffse-navy">
                <ChevronRight size={26} />
              </button>
            </div>
            <div className="space-y-2">
              {Object.keys(matchesByDate).sort((a, b) => b.localeCompare(a)).map(date => (
                <div key={date} className="space-y-1">
                  <div className="bg-neutral-100 py-1 px-4 text-neutral-500 font-bold text-[10px] uppercase tracking-wider rounded shadow-sm inline-block">
                    {formatDate(date)}
                  </div>
                  <div className="divide-y divide-neutral-100">
                    {matchesByDate[date].map((match) => (
                      <div key={match.id} className="py-3 flex items-center gap-2 md:gap-4">
                        <div className="flex-1 text-right min-w-0">
                          <button onClick={() => navigate(`/${division}/club/${encodeURIComponent(match.home_team)}`)} className="font-bold text-xs md:text-sm text-neutral-800 hover:text-ffse-blue transition-colors">
                            {match.home_team}
                          </button>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 overflow-visible">
                          <ClubLogo src={match.home_logo} seed={match.home_team} size="sm" />
                          <div className="relative overflow-visible">
                            {(!!(match.bonus_off_home) || !!(match.bonus_def_home)) && (
                              <div className="absolute -top-2 -left-2 flex flex-col gap-0.5 z-10">
                                {!!match.bonus_off_home && <span className="text-[9px] font-black border-2 border-neutral-400 text-neutral-300 bg-neutral-700 px-1 py-0 rounded font-mono leading-4">BO</span>}
                                {!!match.bonus_def_home && <span className="text-[9px] font-black border-2 border-neutral-400 text-neutral-300 bg-neutral-700 px-1 py-0 rounded font-mono leading-4">BD</span>}
                              </div>
                            )}
                            {(!!(match.bonus_off_away) || !!(match.bonus_def_away)) && (
                              <div className="absolute -top-2 -right-2 flex flex-col gap-0.5 z-10">
                                {!!match.bonus_off_away && <span className="text-[9px] font-black border-2 border-neutral-400 text-neutral-300 bg-neutral-700 px-1 py-0 rounded font-mono leading-4">BO</span>}
                                {!!match.bonus_def_away && <span className="text-[9px] font-black border-2 border-neutral-400 text-neutral-300 bg-neutral-700 px-1 py-0 rounded font-mono leading-4">BD</span>}
                              </div>
                            )}
                            <div className="bg-neutral-700 text-white px-2.5 py-1.5 rounded flex items-center gap-1.5 font-display text-base md:text-xl min-w-[72px] md:min-w-[96px] justify-center shadow-lg">
                              {match.score_home !== null && match.score_away !== null ? (
                                <button onClick={() => match.ffse_event_id && navigate(`/${division}/match/${match.ffse_event_id}`)}
                                  className={`flex items-center gap-2 ${match.ffse_event_id ? "hover:opacity-70 transition-opacity" : ""}`}>
                                  <span className={match.score_home > match.score_away ? "text-white" : "text-neutral-400"}>{match.score_home}</span>
                                  <span className="text-neutral-500 text-xs">–</span>
                                  <span className={match.score_away > match.score_home ? "text-white" : "text-neutral-400"}>{match.score_away}</span>
                                </button>
                              ) : (
                                <span className="text-[9px] font-sans font-bold uppercase tracking-tight text-neutral-300 text-center leading-tight">
                                  {formatShortDateTime(match.date, match.time)}
                                </span>
                              )}
                            </div>
                          </div>
                          <ClubLogo src={match.away_logo} seed={match.away_team} size="sm" />
                        </div>
                        <div className="flex-1 text-left min-w-0">
                          <button onClick={() => navigate(`/${division}/club/${encodeURIComponent(match.away_team)}`)} className="font-bold text-xs md:text-sm text-neutral-800 hover:text-ffse-blue transition-colors">
                            {match.away_team}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {currentMatchdayMatches.length === 0 && (
                <div className="text-center py-20 text-neutral-400 italic">Aucun match programmé pour cette journée.</div>
              )}
            </div>
          </section>
        ) : (
          <section className="max-w-5xl mx-auto">
            <div className="flex items-center gap-3 mb-6 border-b-4 border-ffse-navy pb-3">
              <Trophy className="text-ffse-red shrink-0" size={22} />
              <h2 className="font-display text-xl md:text-3xl uppercase tracking-tighter">Classement {division.toUpperCase()}</h2>
            </div>
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-neutral-200">
              <div className="overflow-x-auto">
                <table className="w-full text-left table-fixed">
                  <thead>
                    <tr className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
                      <th className="pl-2 pr-0 py-3 w-4 md:w-10">N°</th>
                      <th className="hidden md:table-cell px-1 py-3 w-6"></th>
                      <th className="px-1 py-3 w-9 md:w-12"></th>
                      <th className="px-2 py-3 text-left w-32 md:w-48">Équipe</th>
                      <th className="hidden sm:table-cell px-2 py-3 w-24"></th>
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
                    {rankings.length > 0 ? rankings.map((team, idx) => {
                      const teamForm = matches
                        .filter(m => {
                          const t = team.team.toLowerCase();
                          return (m.home_team.toLowerCase() === t || m.away_team.toLowerCase() === t) && m.score_home !== null;
                        })
                        .sort((a, b) => b.date.localeCompare(a.date) || b.matchday - a.matchday)
                        .slice(0, 5)
                        .reverse()
                        .map(m => {
                          const isHome = m.home_team.toLowerCase() === team.team.toLowerCase();
                          const ts = isHome ? m.score_home : m.score_away;
                          const os = isHome ? m.score_away : m.score_home;
                          return ts! > os! ? 'W' : ts! < os! ? 'L' : 'D';
                        });

                      return (
                        <motion.tr key={team.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.03 }}
                          className="hover:bg-neutral-50 transition-colors group"
                        >
                          <td className="pl-2 pr-0 py-3 font-display text-xl md:text-4xl text-neutral-200 group-hover:text-neutral-300 transition-colors">{idx + 1}</td>
                          <td className="hidden md:table-cell px-1 py-3">
                            {team.trend === "up" && <span className="text-emerald-500 text-xs font-bold">▲</span>}
                            {team.trend === "down" && <span className="text-red-500 text-xs font-bold">▼</span>}
                            {team.trend === "equal" && <span className="text-neutral-300 text-xs font-bold">=</span>}
                            {team.trend === null && <span className="text-neutral-200 text-xs">–</span>}
                          </td>
                          <td className="px-1 py-3">
                            <div className="w-8 h-8 md:w-10 md:h-10 bg-white rounded-full flex items-center justify-center border border-neutral-100 shadow-sm overflow-hidden">
                              <img src={team.logo || `https://api.dicebear.com/7.x/initials/svg?seed=${team.team}&backgroundColor=f5f5f5&textColor=999`}
                                alt="" className="w-full h-full object-contain p-1.5" referrerPolicy="no-referrer" />
                            </div>
                          </td>
                          <td className="px-2 py-3 w-32 md:w-48">
                            <button onClick={() => navigate(`/${division}/club/${encodeURIComponent(team.team)}`)}
                              className="font-bold text-base text-neutral-900 hover:text-ffse-blue transition-colors text-left leading-tight">
                              {team.team}
                            </button>
                          </td>
                          <td className="hidden sm:table-cell px-2 py-3 w-24">
                            <div className="flex gap-1.5 items-center">
                              {teamForm.map((res, i) => (
                                <div key={`${team.id}-form-${i}`} title={res === 'W' ? 'Victoire' : res === 'L' ? 'Défaite' : 'Nul'}
                                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${res === 'W' ? 'bg-ffse-blue' : res === 'L' ? 'bg-red-500' : 'bg-neutral-300'}`}
                                />
                              ))}
                            </div>
                          </td>
                          <td className="px-1 py-3 text-center text-xs text-neutral-500">{team.played}</td>
                          <td className="px-1 py-3 text-center text-xs text-neutral-500">{team.won}</td>
                          <td className="px-1 py-3 text-center text-xs text-neutral-500">{team.drawn}</td>
                          <td className="px-1 py-3 text-center text-xs text-neutral-500">{team.lost}</td>
                          <td className="hidden md:table-cell px-2 py-3 text-center text-xs text-neutral-500">{team.bonus}</td>
                          <td className={`hidden md:table-cell px-2 py-3 text-center text-xs font-mono ${team.diff > 0 ? 'text-emerald-600' : team.diff < 0 ? 'text-red-600' : 'text-neutral-400'}`}>
                            {team.diff > 0 ? `+${team.diff}` : team.diff}
                          </td>
                          <td className="px-2 py-3 text-center font-display text-xl md:text-2xl text-neutral-900 bg-neutral-50/50">{team.points}</td>
                        </motion.tr>
                      );
                    }) : (
                      <tr><td colSpan={10} className="px-6 py-20 text-center text-neutral-400 italic">Chargement du classement...</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="max-w-5xl mx-auto px-4 mt-20">
        <div className="bg-neutral-100 p-6 md:p-8 rounded-3xl flex items-start gap-4 border border-neutral-200">
          <Info className="text-blue-400 shrink-0 mt-1" size={18} />
          <div className="text-sm text-neutral-600 leading-relaxed">
            <p className="font-bold text-neutral-800 text-base mb-1">À propos de ce site</p>
            <p>Projet personnel pour suivre les championnats D1, D2, D3 et D4 FFSE. Données récupérées automatiquement depuis l'API officielle de la FFSE.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function MatchPage() {
  const { div, eventId } = useParams<{ div: string; eventId: string }>();
  const navigate = useNavigate();
  const division = (div || "d3") as Division;
  const [detail, setDetail] = useState<MatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${window.location.origin}/api/match/${eventId}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) setError(data.error);
        else setDetail(data);
      })
      .catch(() => setError("Erreur de chargement"))
      .finally(() => setLoading(false));
  }, [eventId]);

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-neutral-900 text-white">
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
        <RefreshCw size={48} className="text-blue-500" />
      </motion.div>
    </div>
  );

  if (error || !detail) return (
    <div className="flex items-center justify-center min-h-screen bg-neutral-50">
      <div className="text-neutral-400 italic">Match introuvable</div>
    </div>
  );

  const { match, venue, stats } = detail;
  const played = match.score_home !== null && match.score_away !== null;

  const RugbyIcon = ({ type, size = 20 }: { type: "essai" | "transfo" | "penalite"; size?: number }) => {
    const icons = {
      essai:    "https://www.lequipe.fr/img/icons/live/ico_essai.svg",
      transfo:  "https://www.lequipe.fr/img/icons/live/ico_transfo.svg",
      penalite: "https://www.lequipe.fr/img/icons/live/ico_penalite.svg",
    };
    return <img src={icons[type]} alt={type} width={size} height={size} className="inline-block" style={{ width: size, height: "auto" }} />;
  };

  const Cards = ({ y, r }: { y: number; r: number }) => (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: y }).map((_, i) => (
        <img key={`y${i}`} src="https://www.lequipe.fr/img/icons/ico_carton_jaune.svg" width={14} height={20} alt="jaune" />
      ))}
      {Array.from({ length: r }).map((_, i) => (
        <img key={`r${i}`} src="https://www.lequipe.fr/img/icons/ico_carton_rouge.svg" width={14} height={20} alt="rouge" />
      ))}
    </div>
  );

  const StatRow = ({ label, icon, home, away }: {
    label: string;
    icon: "essai" | "transfo" | "penalite" | null;
    home: string | null;
    away: string | null;
  }) => {
    if ((!home || home === "0") && (!away || away === "0")) return null;
    const h = Number(home) || 0;
    const a = Number(away) || 0;
    const centerLabel = label === "drops" ? "DR" : label.slice(0, 2).toUpperCase();
    return (
      <div
        className="grid grid-cols-[1fr_80px_80px_1fr] items-center py-3 last:border-0"
        style={{ borderBottom: "0.3px solid #e5e5e5" }}
      >
        <div className="flex items-center justify-end gap-1">
          <span className={`font-bold text-base ${h > a ? "text-ffse-navy" : "text-neutral-400"}`}>{home ?? "–"}</span>
          <span className="text-xs font-normal text-neutral-400">{label}</span>
        </div>
        <div className="flex justify-start pl-3">
          {icon
            ? <RugbyIcon type={icon} size={12} />
            : <span className="text-neutral-300 text-xs font-bold uppercase tracking-wider">{centerLabel}</span>
          }
        </div>
        <div className="flex justify-end pr-3">
          {icon
            ? <RugbyIcon type={icon} size={12} />
            : <span className="text-neutral-300 text-xs font-bold uppercase tracking-wider">{centerLabel}</span>
          }
        </div>
        <div className="flex items-center justify-start gap-1">
          <span className={`font-bold text-base ${a > h ? "text-ffse-navy" : "text-neutral-400"}`}>{away ?? "–"}</span>
          <span className="text-xs font-normal text-neutral-400">{label}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen font-sans pb-20 bg-neutral-50">
      {/* Header */}
      <header className="bg-ffse-navy text-white px-4 pt-4 pb-3 border-b-4 border-ffse-red sticky top-0 z-50">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <button onClick={() => navigate(`/${division}/results`)} className="flex items-center gap-1 text-blue-300 hover:text-white font-bold uppercase tracking-wider transition-colors text-xs">
            <ChevronLeft size={18} /> Retour
          </button>
          <div className="text-[10px] uppercase tracking-widest text-blue-300/60 font-bold">
            {division.toUpperCase()} · Journée {match.matchday}
          </div>
          <div className="w-10" />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 mt-8 space-y-6">

        {/* Score card */}
        <div className="bg-white rounded-3xl shadow-xl border border-neutral-200 overflow-hidden">
          <div className="p-8">
            <div className="flex items-center gap-4">
              {/* Home */}
              <div className="flex-1 flex flex-col items-center gap-3 text-center">
                <div className="relative">
                  {match.score_home! > match.score_away! && (
                    <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-xl">👑</span>
                  )}
                  <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center border border-neutral-100 shadow-md overflow-hidden">
                    <img src={match.home_logo || `https://api.dicebear.com/7.x/initials/svg?seed=${match.home_team}&backgroundColor=f5f5f5&textColor=999`} alt="" className="w-full h-full object-contain p-1" referrerPolicy="no-referrer" />
                  </div>
                </div>
                <span className="font-bold text-sm text-neutral-800 leading-tight">{match.home_team}</span>
              </div>

              {/* Score */}
              <div className="flex flex-col items-center gap-2 shrink-0">
                {played ? (
                  <div className="relative">
                    {(!!(stats.home?.bonus_off) || !!(stats.home?.bonus_def)) && (
                      <div className="absolute -top-2 -left-2 flex flex-col gap-0.5 z-10">
                        {stats.home?.bonus_off && <span className="text-[9px] font-black border-2 border-ffse-navy text-ffse-navy bg-white px-1 py-0 rounded font-mono leading-4">BO</span>}
                        {stats.home?.bonus_def && <span className="text-[9px] font-black border-2 border-ffse-navy text-ffse-navy bg-white px-1 py-0 rounded font-mono leading-4">BD</span>}
                      </div>
                    )}
                    <div className="bg-ffse-navy text-white px-6 py-3 rounded-2xl flex items-center gap-3 font-display text-4xl shadow-lg">
                      <span className={match.score_home! >= match.score_away! ? "text-white" : "text-neutral-400"}>{match.score_home}</span>
                      <span className="text-neutral-500 text-2xl">–</span>
                      <span className={match.score_away! >= match.score_home! ? "text-white" : "text-neutral-400"}>{match.score_away}</span>
                    </div>
                    {(!!(stats.away?.bonus_off) || !!(stats.away?.bonus_def)) && (
                      <div className="absolute -top-2 -right-2 flex flex-col gap-0.5 z-10">
                        {stats.away?.bonus_off && <span className="text-[9px] font-black border-2 border-ffse-navy text-ffse-navy bg-white px-1 py-0 rounded font-mono leading-4">BO</span>}
                        {stats.away?.bonus_def && <span className="text-[9px] font-black border-2 border-ffse-navy text-ffse-navy bg-white px-1 py-0 rounded font-mono leading-4">BD</span>}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-neutral-800 text-white px-6 py-3 rounded-2xl flex flex-col items-center gap-1 shadow-lg">
                    <span className="text-xs font-bold uppercase tracking-wider text-neutral-300">{new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(match.date))}</span>
                    <span className="text-lg font-bold">{match.time}</span>
                  </div>
                )}
                {played && (
                  <span className="text-[10px] uppercase tracking-widest font-bold text-neutral-400">
                    {match.score_home! > match.score_away! ? match.home_team : match.score_away! > match.score_home! ? match.away_team : "Nul"} gagne
                  </span>
                )}
              </div>

              {/* Away */}
              <div className="flex-1 flex flex-col items-center gap-3 text-center">
                <div className="relative">
                  {match.score_away! > match.score_home! && (
                    <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-xl">👑</span>
                  )}
                  <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center border border-neutral-100 shadow-md overflow-hidden">
                    <img src={match.away_logo || `https://api.dicebear.com/7.x/initials/svg?seed=${match.away_team}&backgroundColor=f5f5f5&textColor=999`} alt="" className="w-full h-full object-contain p-1" referrerPolicy="no-referrer" />
                  </div>
                </div>
                <span className="font-bold text-sm text-neutral-800 leading-tight">{match.away_team}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Date + Venue */}
        <div className="bg-white rounded-3xl shadow-sm border border-neutral-200 overflow-hidden">
          <div className="px-6 py-4 flex flex-col items-center gap-1">
            <p className="font-bold text-sm text-neutral-800">
              {new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(match.date))}
            </p>
            {match.time !== "00:00" && <p className="text-xs text-neutral-400">{match.time}</p>}
          </div>
          {venue && (
            <div className="bg-neutral-50 px-6 py-3 flex items-center justify-center gap-2 border-t border-neutral-100">
              <MapPin size={12} className="text-neutral-400 shrink-0" />
              <span className="text-xs text-neutral-500 font-medium">{venue.name}</span>
            </div>
          )}
        </div>

        {/* Stats */}
        {played && stats.home && stats.away && (
          <div className="bg-white rounded-3xl shadow-xl border border-neutral-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-neutral-100 flex items-center gap-3">
              <Trophy className="text-ffse-red shrink-0" size={18} />
              <h2 className="font-display text-xl uppercase tracking-tighter">Statistiques</h2>
            </div>
            <div className="px-6 py-4">
              {/* Header noms clubs */}
              <div className="grid grid-cols-[1fr_80px_80px_1fr] pb-3 mb-2 border-b-4 border-ffse-navy">
                <div className="text-right text-xs font-bold uppercase tracking-wider text-neutral-500">{match.home_team}</div>
                <div /><div />
                <div className="text-left text-xs font-bold uppercase tracking-wider text-neutral-500">{match.away_team}</div>
              </div>
              <StatRow label="essais" icon="essai" home={stats.home.tries} away={stats.away.tries} />
              <StatRow label="transf." icon="transfo" home={stats.home.conversions} away={stats.away.conversions} />
              <StatRow label="pénalités" icon="penalite" home={stats.home.penalties} away={stats.away.penalties} />
              <StatRow label="drops" icon={null} home={stats.home.drops} away={stats.away.drops} />
              
              {/* Cartons jaunes */}
              {(() => {
                const hy = Number(stats.home.yellow) || 0;
                const ay = Number(stats.away.yellow) || 0;
                if (hy === 0 && ay === 0) return null;
                return (
                  <div className="grid grid-cols-[1fr_80px_80px_1fr] items-center py-3" style={{ borderBottom: "0.3px solid #e5e5e5" }}>
                    <div className="flex items-center justify-end gap-1">
                      {hy > 0 && <><span className="font-bold text-base text-neutral-400">{hy}</span></>}
                    </div>
                    <div className="flex justify-start pl-3">
                      {hy > 0 && <img src="https://www.lequipe.fr/img/icons/ico_carton_jaune.svg" width={12} height={12} style={{ width: 12, height: "auto" }} alt="jaune" />}
                    </div>
                    <div className="flex justify-end pr-3">
                      {ay > 0 && <img src="https://www.lequipe.fr/img/icons/ico_carton_jaune.svg" width={12} height={12} style={{ width: 12, height: "auto" }} alt="jaune" />}
                    </div>
                    <div className="flex items-center justify-start gap-1">
                      {ay > 0 && <><span className="font-bold text-base text-neutral-400">{ay}</span></>}
                    </div>
                  </div>
                );
              })()}
              {/* Cartons rouges */}
              {(() => {
                const hr = Number(stats.home.red) || 0;
                const ar = Number(stats.away.red) || 0;
                if (hr === 0 && ar === 0) return null;
                return (
                  <div className="grid grid-cols-[1fr_80px_80px_1fr] items-center py-3" style={{ borderBottom: "0.3px solid #e5e5e5" }}>
                    <div className="flex items-center justify-end gap-1">
                      {hr > 0 && <><span className="text-xs font-normal text-neutral-400">cartons r.</span><span className="font-bold text-base text-neutral-400">{hr}</span></>}
                    </div>
                    <div className="flex justify-start pl-3">
                      {hr > 0 && <img src="https://www.lequipe.fr/img/icons/ico_carton_rouge.svg" width={12} height={12} style={{ width: 12, height: "auto" }} alt="rouge" />}
                    </div>
                    <div className="flex justify-end pr-3">
                      {ar > 0 && <img src="https://www.lequipe.fr/img/icons/ico_carton_rouge.svg" width={12} height={12} style={{ width: 12, height: "auto" }} alt="rouge" />}
                    </div>
                    <div className="flex items-center justify-start gap-1">
                      {ar > 0 && <><span className="font-bold text-base text-neutral-400">{ar}</span><span className="text-xs font-normal text-neutral-400">cartons r.</span></>}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/:div/match/:eventId" element={<MatchPage />} />
      <Route path="/:div" element={<DivisionPage />} />
      <Route path="/:div/results" element={<DivisionPage />} />
      <Route path="/:div/results/:day" element={<DivisionPage />} />
      <Route path="/:div/club/:club" element={<DivisionPage />} />
    </Routes>
  );
}
