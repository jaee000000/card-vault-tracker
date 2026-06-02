import {
  useGetBinder,
  getGetBinderQueryKey,
  useGetBinderStats,
  getGetBinderStatsQueryKey,
} from "@workspace/api-client-react";
import { useParams, Link, useSearch } from "wouter";
import { ChevronLeft, ChevronRight, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useRef } from "react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { QuickAddCardDialog } from "@/components/cards/QuickAddCardDialog";
import { CardDetailPanel } from "@/components/cards/CardDetailPanel";

export default function BinderView() {
  const params = useParams();
  const search = useSearch();
  const binderId = parseInt(params.id || "0", 10);
  const [currentPage, setCurrentPage] = useState(0);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const [highlightSlot, setHighlightSlot] = useState<number | null>(null);

  const { data: binder, isLoading } = useGetBinder(binderId, {
    query: { enabled: !!binderId, queryKey: getGetBinderQueryKey(binderId) },
  });

  const { data: stats } = useGetBinderStats(binderId, {
    query: { enabled: !!binderId, queryKey: getGetBinderStatsQueryKey(binderId) },
  });

  const cards = binder?.cards || [];
  const setTotal = binder?.setTotal || 9;
  // Secret-rare / alt-art cards can be numbered above the printed set total
  // (e.g. 224/193). Extend the binder so those cards still have a slot.
  const maxCardNumber = cards.reduce((m, c) => Math.max(m, c.setNumber), 0);
  const effectiveTotal = Math.max(setTotal, maxCardNumber);
  const totalPages = Math.ceil(effectiveTotal / 9);

  const getCardForSlot = (slotNumber: number) =>
    cards.find((c) => c.setNumber === slotNumber);

  // Deep-link: ?slot=126 jumps to that card's page and briefly highlights it.
  // One-shot per slot value so a background refetch can't yank the user back
  // to this page after they navigate away.
  const consumedSlotRef = useRef<string | null>(null);
  useEffect(() => {
    if (!binder) return;
    const raw = new URLSearchParams(search).get("slot") ?? "";
    const slot = parseInt(raw, 10);
    if (!slot || consumedSlotRef.current === raw) return;
    consumedSlotRef.current = raw;
    const clamped = Math.min(Math.max(slot, 1), effectiveTotal);
    setCurrentPage(Math.floor((clamped - 1) / 9));
    setHighlightSlot(clamped);
    const t = setTimeout(() => setHighlightSlot(null), 2600);
    return () => clearTimeout(t);
  }, [search, binder, effectiveTotal]);

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] sm:h-[calc(100vh-4rem)] items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!binder) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center font-mono text-muted-foreground uppercase text-sm">
        Binder not found.
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] sm:h-[calc(100vh-4rem)] w-full max-w-[1400px] mx-auto px-2 sm:px-4 py-3 sm:py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-3 sm:mb-6 gap-2">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <Link
            href="/"
            className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1.5 sm:p-2 bg-card rounded border border-border"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <h1 className="text-base sm:text-2xl font-bold tracking-tight uppercase truncate">{binder.name}</h1>
              <span className="shrink-0 px-1.5 sm:px-2 py-0.5 rounded bg-primary/10 text-primary text-[10px] sm:text-xs font-mono uppercase border border-primary/20">
                {binder.setCode}
              </span>
            </div>
            <div className="flex items-center gap-2 sm:gap-4 mt-1 sm:mt-2">
              <div className="w-28 sm:w-64">
                <Progress value={stats?.completionPercent ?? 0} className="h-1.5 sm:h-2" />
              </div>
              <span className="font-mono text-[10px] sm:text-xs text-muted-foreground uppercase whitespace-nowrap">
                {stats?.scannedCards ?? 0}/{binder.setTotal}
              </span>
            </div>
          </div>
        </div>

        <div className="shrink-0 bg-card px-3 sm:px-4 py-1.5 sm:py-2 rounded border border-border">
          <span className="text-[9px] sm:text-[10px] uppercase text-muted-foreground font-mono tracking-widest block">Value</span>
          <span className="font-mono font-bold text-primary text-sm sm:text-base">£{stats?.totalValueGBP?.toFixed(2) ?? "0.00"}</span>
        </div>
      </div>

      {/* Binder page */}
      <div className="flex-1 flex flex-col items-center justify-center min-h-0 bg-secondary/30 rounded-xl border border-border p-2 sm:p-4 md:p-8 overflow-hidden">
        <div className="w-full max-w-3xl h-full max-h-full bg-[#111] rounded-lg shadow-2xl flex flex-col border border-border relative overflow-hidden">
          {/* Rings */}
          <div className="absolute left-0 top-0 bottom-0 w-5 sm:w-8 border-r border-border/50 bg-[#0a0a0a] flex flex-col justify-evenly py-8 items-center z-10">
            {[1, 2, 3].map((i) => (
              <div key={i} className="w-3 h-5 sm:w-4 sm:h-8 rounded-full border-2 border-muted-foreground/30 bg-background shadow-inner" />
            ))}
          </div>

          <div className="pl-5 sm:pl-8 flex-1 flex flex-col p-2 sm:p-4 min-h-0">
            <div className="grid grid-cols-3 grid-rows-3 gap-1.5 sm:gap-3 flex-1 min-h-0">
              {Array.from({ length: 9 }).map((_, i) => {
                const slotNumber = currentPage * 9 + i + 1;
                const card = getCardForSlot(slotNumber);
                // Beyond the printed total, only render slots that hold a card
                // (secret rares / alt arts). Pure padding slots stay blank.
                if (slotNumber > binder.setTotal && !card) {
                  return <div key={i} className="rounded bg-background/10" />;
                }

                const isHighlighted = highlightSlot === slotNumber;

                return (
                  <button
                    key={slotNumber}
                    onClick={() =>
                      card ? setSelectedCardId(card.id) : setSelectedSlot(slotNumber)
                    }
                    className={cn(
                      "relative group rounded-lg overflow-hidden aspect-[2.5/3.5] transition-all duration-200 flex flex-col w-full h-full",
                      card
                        ? "border-2 border-primary/30 hover:border-primary bg-background hover:scale-[1.02] shadow-[0_0_10px_rgba(0,255,255,0.05)] hover:shadow-[0_0_16px_rgba(0,255,255,0.2)] active:scale-[1.01]"
                        : "border border-dashed border-border hover:border-muted-foreground bg-background/40 opacity-60 hover:opacity-100 flex items-center justify-center active:opacity-80",
                      isHighlighted &&
                        "!border-primary border-2 z-10 animate-[slot-pop_2.4s_ease-out] shadow-[0_0_22px_rgba(0,255,255,0.55)]"
                    )}
                  >
                    {card ? (
                      <>
                        {card.imageUrl ? (
                          <div
                            className="flex-1 w-full bg-cover bg-center"
                            style={{ backgroundImage: `url(${card.imageUrl})` }}
                          />
                        ) : (
                          <div className="flex-1 w-full bg-[#151515] flex items-center justify-center p-1">
                            <span className="font-mono text-[8px] sm:text-[10px] text-center text-muted-foreground leading-tight">
                              {card.name}
                            </span>
                          </div>
                        )}
                        <div className="shrink-0 w-full bg-card border-t border-border flex flex-col justify-center px-1 sm:px-2 py-0.5 sm:py-1">
                          <div className="flex justify-between items-center w-full">
                            <span className="font-mono text-[7px] sm:text-[9px] text-muted-foreground">
                              {String(slotNumber).padStart(3, "0")}/{binder.setTotal}
                            </span>
                            <span className="font-mono text-[7px] sm:text-[9px] font-bold text-primary">
                              £{card.currentPriceGBP.toFixed(2)}
                            </span>
                          </div>
                          <div className="text-[6px] sm:text-[8px] uppercase tracking-wider text-muted-foreground truncate">
                            {card.condition}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-0.5 sm:gap-1 p-1">
                        <span className="font-mono text-sm sm:text-xl text-muted-foreground/30 font-bold">
                          {String(slotNumber).padStart(3, "0")}
                        </span>
                        <span className="font-mono text-[7px] sm:text-[9px] text-muted-foreground/40 uppercase">
                          Empty
                        </span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Page nav */}
            <div className="flex justify-between items-center mt-2 sm:mt-4 pt-2 sm:pt-4 border-t border-border/50 shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={currentPage === 0}
                className="font-mono uppercase text-[10px] sm:text-xs gap-1 sm:gap-2 h-7 sm:h-8 px-2 sm:px-3"
              >
                <ChevronLeft className="w-3 h-3" /> Prev
              </Button>
              <div className="font-mono text-[10px] sm:text-xs text-muted-foreground uppercase tracking-widest">
                {currentPage + 1} / {totalPages || 1}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={currentPage >= totalPages - 1}
                className="font-mono uppercase text-[10px] sm:text-xs gap-1 sm:gap-2 h-7 sm:h-8 px-2 sm:px-3"
              >
                Next <ChevronRight className="w-3 h-3" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      <QuickAddCardDialog
        binderId={binderId}
        setTotal={binder.setTotal}
        slotNumber={selectedSlot}
        open={selectedSlot !== null}
        onOpenChange={(open) => !open && setSelectedSlot(null)}
      />

      <CardDetailPanel
        cardId={selectedCardId}
        open={selectedCardId !== null}
        onOpenChange={(open) => !open && setSelectedCardId(null)}
      />
    </div>
  );
}
