import {
  useListBinders,
  getListBindersQueryKey,
  useGetVaultStats,
  getGetVaultStatsQueryKey,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { Folder, Plus, Activity, Layers, Coins, TrendingUp, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddBinderDialog } from "@/components/binders/AddBinderDialog";
import { useState, useEffect, useRef } from "react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useHoloTilt } from "@/hooks/use-holo-tilt";

const SET_CODE_COLORS: Record<string, string> = {
  M2A: "text-violet-400 border-violet-500/30 bg-violet-500/10",
  CHR: "text-blue-400 border-blue-500/30 bg-blue-500/10",
  ABY: "text-teal-400 border-teal-500/30 bg-teal-500/10",
  M4: "text-rose-400 border-rose-500/30 bg-rose-500/10",
};

function getSetCodeStyle(code: string) {
  return SET_CODE_COLORS[code] ?? "text-primary border-primary/20 bg-primary/10";
}

type TopCard = {
  id: number;
  name: string;
  imageUrl: string | null;
  currentPriceGBP: number;
  psa10GBP: number | null;
  binderSetCode: string | null;
  binderName: string | null;
};

function useCountUp(target: number | undefined, duration = 1100) {
  const [val, setVal] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (target == null) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    let start: number | null = null;
    const from = 0;
    const tick = (ts: number) => {
      if (!start) start = ts;
      const t = Math.min((ts - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(from + (target - from) * eased);
      if (t < 1) { rafRef.current = requestAnimationFrame(tick); }
      else setVal(target);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target]);

  return val;
}

function VaultChampion({ card }: { card: TopCard }) {
  const holo = useHoloTilt<HTMLDivElement>(18);

  return (
    <div className="relative rounded-xl border border-primary/30 bg-card overflow-hidden shadow-[0_0_40px_rgba(0,255,255,0.08)] mb-2">
      {/* Animated top edge glow */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary/80 to-transparent" />
      {/* Background grid texture */}
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: "linear-gradient(rgba(0,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
      {/* Radial glow behind card image */}
      <div className="absolute right-0 top-0 bottom-0 w-1/2 bg-gradient-to-l from-primary/5 to-transparent pointer-events-none" />

      <div className="relative flex items-stretch gap-0">
        {/* Left: info */}
        <div className="flex-1 p-4 sm:p-6 flex flex-col justify-center gap-3 min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 bg-primary/15 border border-primary/30 text-primary font-mono text-[9px] uppercase tracking-widest px-2 py-1 rounded">
              <Zap className="w-2.5 h-2.5" />
              Vault Champion
            </span>
            {card.binderSetCode && (
              <span className={cn("font-mono text-[9px] px-1.5 py-0.5 rounded border font-semibold uppercase tracking-wider", getSetCodeStyle(card.binderSetCode))}>
                {card.binderSetCode}
              </span>
            )}
          </div>

          <div>
            <h2 className="font-bold text-lg sm:text-2xl tracking-tight leading-tight text-foreground">
              {card.name}
            </h2>
            {card.binderName && (
              <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">
                {card.binderName}
              </p>
            )}
          </div>

          <div className="flex gap-4 sm:gap-6">
            <div>
              <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">Market</div>
              <div className="font-mono font-bold text-xl sm:text-2xl text-primary drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]">
                £{card.currentPriceGBP.toFixed(2)}
              </div>
            </div>
            {card.psa10GBP && (
              <div>
                <div className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground mb-0.5">PSA 10</div>
                <div className="font-mono font-bold text-xl sm:text-2xl text-foreground">
                  £{card.psa10GBP.toFixed(1)}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: card image with holo */}
        <div className="shrink-0 flex items-center justify-end p-3 sm:p-5">
          <div
            ref={holo.ref}
            style={holo.cardStyle}
            {...holo.handlers}
            className="relative w-[90px] sm:w-[130px] aspect-[2.5/3.5] rounded-lg overflow-hidden shadow-[0_8px_32px_rgba(0,0,0,0.6)] cursor-default"
          >
            {card.imageUrl ? (
              <img src={card.imageUrl} alt={card.name} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-[#111] flex items-center justify-center p-2">
                <span className="font-mono text-[8px] text-center text-muted-foreground">{card.name}</span>
              </div>
            )}
            <div style={holo.shimmerStyle} />
            {/* Gold border on champion card */}
            <div className="absolute inset-0 rounded-lg ring-2 ring-amber-400/40 pointer-events-none" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: binders, isLoading: bindersLoading } = useListBinders({
    query: { queryKey: getListBindersQueryKey() },
  });

  // Ensure binders is always an array
  const bindersArray = Array.isArray(binders) ? binders : [];

  const { data: stats } = useGetVaultStats({
    query: { queryKey: getGetVaultStatsQueryKey() },
  });

  const [isAddBinderOpen, setIsAddBinderOpen] = useState(false);
  const [topCard, setTopCard] = useState<TopCard | null>(null);

  useEffect(() => {
    fetch("/api/cards/collection")
      .then((r) => r.json())
      .then((cards: TopCard[]) => { if (cards.length > 0) setTopCard(cards[0]); })
      .catch(() => {});
  }, []);

  const animatedValue = useCountUp(stats?.totalValueGBP);
  const animatedCards = useCountUp(stats?.totalCards);
  const animatedSets = useCountUp(stats?.completedSets);
  const animatedBinders = useCountUp(stats?.totalBinders);

  return (
    <div className="flex flex-col gap-6 pb-12 w-full max-w-[1400px] mx-auto px-3 sm:px-4 mt-4 sm:mt-8">
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {[
          {
            icon: Coins,
            label: "Total Value",
            value: `£${animatedValue.toFixed(2)}`,
            accent: true,
            sub: "GBP market value",
          },
          {
            icon: Layers,
            label: "Total Cards",
            value: Math.round(animatedCards).toString(),
            sub: "in vault",
          },
          {
            icon: Activity,
            label: "Completed Sets",
            value: Math.round(animatedSets).toString(),
            sub: `of ${Math.round(animatedBinders)} binders`,
          },
          {
            icon: TrendingUp,
            label: "Total Binders",
            value: Math.round(animatedBinders).toString(),
            sub: "active collections",
          },
        ].map(({ icon: Icon, label, value, accent, sub }) => (
          <div
            key={label}
            className={cn(
              "p-4 sm:p-6 rounded-xl border bg-card shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] relative overflow-hidden group transition-colors",
              accent
                ? "border-primary/20 hover:border-primary/40"
                : "border-border hover:border-border/80"
            )}
          >
            {accent && (
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />
            )}
            <div className="flex items-center gap-2 sm:gap-3 text-muted-foreground mb-3 sm:mb-4 relative">
              <div className={cn("p-1.5 rounded-md", accent ? "bg-primary/15" : "bg-muted/30")}>
                <Icon className={cn("w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0", accent ? "text-primary" : "text-muted-foreground")} />
              </div>
              <h3 className="font-mono text-[9px] sm:text-[10px] uppercase tracking-widest truncate">{label}</h3>
            </div>
            <div
              className={cn(
                "text-xl sm:text-3xl font-mono font-bold relative tabular-nums",
                accent && "text-primary drop-shadow-[0_0_8px_rgba(0,255,255,0.3)]"
              )}
            >
              {value}
            </div>
            {sub && (
              <div className="font-mono text-[9px] sm:text-[10px] text-muted-foreground/60 uppercase tracking-wider mt-1 relative">
                {sub}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Vault Champion spotlight */}
      {topCard && <VaultChampion card={topCard} />}

      {/* Binders header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-0 sm:justify-between mt-2 sm:mt-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight uppercase">Binders</h2>
          <p className="text-muted-foreground font-mono text-xs sm:text-sm mt-0.5">Select a folder to view contents</p>
        </div>
        <Button
          size="sm"
          onClick={() => setIsAddBinderOpen(true)}
          className="uppercase tracking-widest font-mono text-xs gap-2"
        >
          <Plus className="w-3.5 h-3.5" />
          New Binder
        </Button>
      </div>

      {/* Binder grid */}
      {bindersLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-36 sm:h-48 rounded-xl border border-border/50 bg-card/50 animate-pulse" />
          ))}
        </div>
      ) : bindersArray.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 sm:h-64 rounded-xl border border-dashed border-border/50 bg-card/20">
          <Folder className="w-10 h-10 text-muted-foreground mb-3 opacity-50" />
          <p className="text-muted-foreground font-mono text-sm">No binders yet.</p>
          <Button variant="link" onClick={() => setIsAddBinderOpen(true)} className="text-primary mt-1 text-xs">
            Create your first binder
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-6">
          {bindersArray.map((binder) => (
            <Link
              key={binder.id}
              href={`/binder/${binder.id}`}
              className="group relative rounded-xl border border-border bg-card hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_24px_rgba(0,255,255,0.08)] overflow-hidden block"
            >
              <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-primary/0 via-primary/70 to-primary/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
              <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-primary/40 via-primary/20 to-primary/5 opacity-60 group-hover:opacity-100 transition-opacity" />

              <div className="p-4 sm:p-5 pl-5 sm:pl-6">
                <div className="flex items-start justify-between mb-3 sm:mb-5">
                  <div className="p-2 sm:p-2.5 bg-primary/10 rounded-lg border border-primary/10 group-hover:bg-primary/15 transition-colors">
                    <Folder className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                  </div>
                  <span
                    className={cn(
                      "font-mono text-[9px] sm:text-[10px] px-1.5 sm:px-2 py-0.5 sm:py-1 rounded border font-semibold uppercase tracking-wider",
                      getSetCodeStyle(binder.setCode)
                    )}
                  >
                    {binder.setCode}
                  </span>
                </div>

                <h3 className="font-bold text-sm sm:text-base mb-3 uppercase group-hover:text-primary transition-colors leading-tight line-clamp-2 tracking-tight">
                  {binder.name}
                </h3>

                {(() => {
                  const count = stats?.binderCounts?.[String(binder.id)] ?? 0;
                  const pct = binder.setTotal > 0 ? Math.min(100, parseFloat(((count / binder.setTotal) * 100).toFixed(1))) : 0;
                  return (
                    <div className="mt-auto">
                      <div className="flex justify-between text-[9px] sm:text-[10px] font-mono text-muted-foreground mb-1.5">
                        <span className="uppercase tracking-wide">{count}/{binder.setTotal} slots</span>
                        <span className={pct >= 100 ? "text-primary" : "text-muted-foreground/60"}>{pct}% complete</span>
                      </div>
                      <Progress value={pct} className="h-1 sm:h-1.5" />
                    </div>
                  );
                })()}
              </div>
            </Link>
          ))}
        </div>
      )}

      <AddBinderDialog open={isAddBinderOpen} onOpenChange={setIsAddBinderOpen} />
    </div>
  );
}
