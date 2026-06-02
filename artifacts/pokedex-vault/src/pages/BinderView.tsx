import { useGetBinder, getGetBinderQueryKey, useGetBinderStats, getGetBinderStatsQueryKey } from "@workspace/api-client-react";
import { useParams, Link } from "wouter";
import { ChevronLeft, ChevronRight, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useMemo } from "react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

// Assuming we'll create these dialogs next
import { QuickAddCardDialog } from "@/components/cards/QuickAddCardDialog";
import { CardDetailPanel } from "@/components/cards/CardDetailPanel";

export default function BinderView() {
  const params = useParams();
  const binderId = parseInt(params.id || "0", 10);
  const [currentPage, setCurrentPage] = useState(0);

  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);

  const { data: binder, isLoading } = useGetBinder(binderId, {
    query: { enabled: !!binderId, queryKey: getGetBinderQueryKey(binderId) }
  });

  const { data: stats } = useGetBinderStats(binderId, {
    query: { enabled: !!binderId, queryKey: getGetBinderStatsQueryKey(binderId) }
  });

  const cards = binder?.cards || [];
  const setTotal = binder?.setTotal || 9;

  const totalPages = Math.ceil(setTotal / 9);

  const getCardForSlot = (slotNumber: number) => {
    return cards.find(c => c.setNumber === slotNumber);
  };

  const handleNextPage = () => {
    setCurrentPage(p => Math.min(totalPages - 1, p + 1));
  };

  const handlePrevPage = () => {
    setCurrentPage(p => Math.max(0, p - 1));
  };

  if (isLoading) {
    return <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>;
  }

  if (!binder) {
    return <div className="flex h-[calc(100vh-4rem)] items-center justify-center font-mono text-muted-foreground uppercase">Binder sequence corrupted.</div>;
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] w-full max-w-[1400px] mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors p-2 bg-card rounded border border-border">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight uppercase">{binder.name}</h1>
              <span className="px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-mono uppercase border border-primary/20">{binder.setCode}</span>
            </div>
            <div className="flex items-center gap-4 mt-2">
              <div className="w-64">
                <Progress value={stats?.completionPercent ?? 0} className="h-2" />
              </div>
              <span className="font-mono text-xs text-muted-foreground uppercase">{stats?.scannedCards ?? 0} / {binder.setTotal} slots filled</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 bg-card px-4 py-2 rounded border border-border shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
          <div className="flex flex-col items-end">
            <span className="text-[10px] uppercase text-muted-foreground font-mono tracking-widest">Binder Value</span>
            <span className="font-mono font-bold text-primary">£{stats?.totalValueGBP?.toFixed(2) ?? "0.00"}</span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center relative min-h-0 bg-secondary/30 rounded-xl border border-border p-4 md:p-8 overflow-hidden">
        {/* Binder Page Container */}
        <div className="w-full max-w-4xl aspect-[3/4] max-h-full bg-[#111] rounded-lg shadow-2xl p-4 md:p-6 flex flex-col gap-4 border border-border relative overflow-hidden">
          {/* Binder Ring Graphic (Left) */}
          <div className="absolute left-0 top-0 bottom-0 w-8 border-r border-border/50 bg-[#0a0a0a] flex flex-col justify-evenly py-12 items-center">
            {[1, 2, 3].map(i => (
              <div key={i} className="w-4 h-8 rounded-full border-2 border-muted-foreground/30 bg-background shadow-inner" />
            ))}
          </div>

          <div className="pl-6 h-full flex flex-col">
            <div className="grid grid-cols-3 grid-rows-3 gap-2 md:gap-4 flex-1">
              {Array.from({ length: 9 }).map((_, i) => {
                const slotNumber = currentPage * 9 + i + 1;
                if (slotNumber > binder.setTotal) {
                  return <div key={i} className="rounded-lg bg-background/20" />; // Empty dead space
                }

                const card = getCardForSlot(slotNumber);

                return (
                  <button
                    key={slotNumber}
                    onClick={() => card ? setSelectedCardId(card.id) : setSelectedSlot(slotNumber)}
                    className={cn(
                      "relative group rounded-xl overflow-hidden aspect-[2.5/3.5] transition-all duration-300 flex flex-col",
                      card 
                        ? "border-2 border-primary/30 hover:border-primary bg-background hover:scale-[1.02] shadow-[0_0_15px_rgba(0,255,255,0.05)] hover:shadow-[0_0_20px_rgba(0,255,255,0.2)]" 
                        : "border border-dashed border-border hover:border-muted-foreground bg-background/50 opacity-60 hover:opacity-100 flex items-center justify-center"
                    )}
                    style={{ animationDelay: `${i * 50}ms` }}
                  >
                    {card ? (
                      <>
                        {card.imageUrl ? (
                          <div className="flex-1 w-full bg-cover bg-center" style={{ backgroundImage: `url(${card.imageUrl})` }} />
                        ) : (
                          <div className="flex-1 w-full bg-[#151515] flex items-center justify-center p-2">
                            <span className="font-mono text-[10px] text-center text-muted-foreground">{card.name}</span>
                          </div>
                        )}
                        <div className="h-10 w-full bg-card border-t border-border flex flex-col justify-center px-2">
                          <div className="flex justify-between items-center w-full">
                            <span className="font-mono text-[10px] text-muted-foreground">{String(slotNumber).padStart(3, '0')}/{binder.setTotal}</span>
                            <span className="font-mono text-[10px] font-bold text-primary">£{card.currentPriceGBP.toFixed(2)}</span>
                          </div>
                          <div className="text-[8px] uppercase tracking-wider text-muted-foreground mt-0.5">{card.condition}</div>
                        </div>
                      </>
                    ) : (
                      <div className="flex flex-col items-center gap-2">
                        <span className="font-mono text-xl text-muted-foreground/30 font-bold">{String(slotNumber).padStart(3, '0')}</span>
                        <span className="font-mono text-[10px] text-muted-foreground/50 uppercase">Empty Slot</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            
            {/* Page Navigation */}
            <div className="flex justify-between items-center mt-4 pt-4 border-t border-border/50">
              <Button variant="outline" size="sm" onClick={handlePrevPage} disabled={currentPage === 0} className="font-mono uppercase text-[10px] gap-2">
                <ChevronLeft className="w-3 h-3" /> Prev
              </Button>
              <div className="font-mono text-xs text-muted-foreground uppercase tracking-widest">
                Page {currentPage + 1} / {totalPages || 1}
              </div>
              <Button variant="outline" size="sm" onClick={handleNextPage} disabled={currentPage >= totalPages - 1} className="font-mono uppercase text-[10px] gap-2">
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