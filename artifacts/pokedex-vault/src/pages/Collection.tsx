import { useState, useEffect } from "react";
import { Link } from "wouter";
import { ArrowLeft, TrendingUp, Package, Coins } from "lucide-react";
import { CardDetailPanel } from "@/components/cards/CardDetailPanel";
import { cn } from "@/lib/utils";

type CollectionCard = {
  id: number;
  name: string;
  setNumber: number;
  setTotal: number;
  condition: string;
  currentPriceGBP: number;
  psa10GBP: number | null;
  imageUrl: string | null;
  binderName: string | null;
  binderSetCode: string | null;
};

const RANK_STYLES: Record<number, { badge: string; border: string; glow: string }> = {
  1: {
    badge: "bg-amber-500/20 text-amber-400 border-amber-500/40",
    border: "border-amber-500/40 hover:border-amber-400/70",
    glow: "hover:shadow-[0_0_20px_rgba(245,158,11,0.25)]",
  },
  2: {
    badge: "bg-slate-400/20 text-slate-300 border-slate-400/40",
    border: "border-slate-400/30 hover:border-slate-300/60",
    glow: "hover:shadow-[0_0_20px_rgba(148,163,184,0.2)]",
  },
  3: {
    badge: "bg-orange-600/20 text-orange-400 border-orange-600/40",
    border: "border-orange-600/30 hover:border-orange-400/60",
    glow: "hover:shadow-[0_0_20px_rgba(234,88,12,0.2)]",
  },
};

function rankStyle(rank: number) {
  return (
    RANK_STYLES[rank] ?? {
      badge: "bg-muted/40 text-muted-foreground border-border",
      border: "border-border hover:border-primary/40",
      glow: "hover:shadow-[0_0_14px_rgba(0,255,255,0.12)]",
    }
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border/50 bg-card/60 overflow-hidden animate-pulse">
      <div className="aspect-[2.5/3.5] bg-muted/20" />
      <div className="p-2.5 space-y-1.5">
        <div className="h-2.5 bg-muted/30 rounded w-3/4" />
        <div className="h-2 bg-muted/20 rounded w-1/2" />
        <div className="h-3 bg-muted/25 rounded w-1/3 mt-1" />
      </div>
    </div>
  );
}

export default function Collection() {
  const [cards, setCards] = useState<CollectionCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/cards/collection")
      .then((r) => r.json())
      .then((data: CollectionCard[]) => {
        setCards(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const totalValue = cards.reduce((s, c) => s + c.currentPriceGBP, 0);

  return (
    <div className="flex flex-col min-h-[calc(100vh-3.5rem)] sm:min-h-[calc(100vh-4rem)] w-full max-w-[1400px] mx-auto px-3 sm:px-4 py-4 sm:py-8 pb-16">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 sm:mb-8 gap-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <Link
            href="/"
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1.5 sm:p-2 bg-card rounded border border-border"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl sm:text-3xl font-bold tracking-tight uppercase">Collection</h1>
            <p className="text-muted-foreground font-mono text-[10px] sm:text-xs mt-0.5 uppercase tracking-widest">
              All cards · Highest value first
            </p>
          </div>
        </div>

        {!loading && (
          <div className="hidden sm:flex items-center gap-4 shrink-0">
            <div className="flex flex-col items-end">
              <span className="text-[9px] uppercase font-mono tracking-widest text-muted-foreground">Total Value</span>
              <span className="font-mono font-bold text-primary text-lg drop-shadow-[0_0_6px_rgba(0,255,255,0.4)]">
                £{totalValue.toFixed(2)}
              </span>
            </div>
            <div className="flex flex-col items-end border-l border-border pl-4">
              <span className="text-[9px] uppercase font-mono tracking-widest text-muted-foreground">Cards</span>
              <span className="font-mono font-bold text-foreground text-lg">{cards.length}</span>
            </div>
          </div>
        )}
      </div>

      {/* Mobile stats */}
      {!loading && (
        <div className="flex sm:hidden gap-3 mb-5">
          {[
            { icon: Coins, label: "Value", value: `£${totalValue.toFixed(2)}`, primary: true },
            { icon: Package, label: "Cards", value: String(cards.length) },
            { icon: TrendingUp, label: "Top Card", value: cards[0] ? `£${cards[0].currentPriceGBP.toFixed(2)}` : "—" },
          ].map(({ icon: Icon, label, value, primary }) => (
            <div key={label} className="flex-1 bg-card border border-border rounded-lg p-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className={cn("w-3 h-3 shrink-0", primary ? "text-primary" : "text-muted-foreground")} />
                <span className="font-mono text-[8px] uppercase tracking-widest text-muted-foreground">{label}</span>
              </div>
              <span className={cn("font-mono font-bold text-sm", primary && "text-primary")}>{value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Card grid */}
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2.5 sm:gap-4">
        {loading
          ? Array.from({ length: 12 }).map((_, i) => <SkeletonCard key={i} />)
          : cards.map((card, idx) => {
              const rank = idx + 1;
              const styles = rankStyle(rank);
              return (
                <button
                  key={card.id}
                  onClick={() => setSelectedCardId(card.id)}
                  className={cn(
                    "group relative rounded-xl border bg-card overflow-hidden transition-all duration-200 text-left flex flex-col hover:scale-[1.03] active:scale-[1.01]",
                    styles.border,
                    styles.glow
                  )}
                >
                  {/* Rank badge */}
                  <div
                    className={cn(
                      "absolute top-1.5 left-1.5 z-10 px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-mono font-bold border",
                      styles.badge
                    )}
                  >
                    #{rank}
                  </div>

                  {/* Image */}
                  <div className="aspect-[2.5/3.5] w-full overflow-hidden bg-[#0d0d0d] relative">
                    {card.imageUrl ? (
                      <img
                        src={card.imageUrl}
                        alt={card.name}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center p-2">
                        <span className="font-mono text-[9px] text-center text-muted-foreground leading-tight">{card.name}</span>
                      </div>
                    )}
                    {/* Top-right PSA10 hint */}
                    {card.psa10GBP && (
                      <div className="absolute top-1.5 right-1.5 bg-background/80 backdrop-blur-sm rounded px-1 py-0.5 font-mono text-[7px] text-primary border border-primary/20">
                        PSA £{card.psa10GBP >= 1000 ? `${(card.psa10GBP / 1000).toFixed(1)}k` : card.psa10GBP.toFixed(1)}
                      </div>
                    )}
                  </div>

                  {/* Info footer */}
                  <div className="p-2 sm:p-2.5 flex flex-col gap-0.5 shrink-0 border-t border-border/50">
                    <span className="font-mono text-[9px] sm:text-[10px] font-semibold text-foreground truncate leading-tight">
                      {card.name}
                    </span>
                    {card.binderSetCode && (
                      <span className="font-mono text-[7px] sm:text-[8px] text-muted-foreground uppercase tracking-wide truncate">
                        {card.binderSetCode}
                      </span>
                    )}
                    <span className="font-mono text-[10px] sm:text-xs font-bold text-primary mt-0.5">
                      £{card.currentPriceGBP.toFixed(2)}
                    </span>
                  </div>
                </button>
              );
            })}
      </div>

      {!loading && cards.length === 0 && (
        <div className="flex flex-col items-center justify-center h-64 rounded-xl border border-dashed border-border/40 bg-card/10 mt-8">
          <Package className="w-10 h-10 text-muted-foreground/40 mb-3" />
          <p className="font-mono text-sm text-muted-foreground">No cards in your vault yet.</p>
          <Link href="/scan" className="text-primary text-xs font-mono mt-2 hover:underline">
            Scan your first card →
          </Link>
        </div>
      )}

      <CardDetailPanel
        cardId={selectedCardId}
        open={selectedCardId !== null}
        onOpenChange={(open) => !open && setSelectedCardId(null)}
      />
    </div>
  );
}
