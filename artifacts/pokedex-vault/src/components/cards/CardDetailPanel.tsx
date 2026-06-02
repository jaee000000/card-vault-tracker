import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useGetCard, getGetCardQueryKey, useUpdateCard, useDeleteCard, useRefreshCardPrice, getGetBinderQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, Trash2, Award, Sparkles, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

type GradedValues = {
  raw: number;
  psa10: number;
  bgs10: number;
  confidence: "low" | "medium" | "high";
  source: "cached" | "web-search" | "ai-estimate";
};

export function CardDetailPanel({ cardId, open, onOpenChange }: { cardId: number | null, open: boolean, onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: card, isLoading } = useGetCard(cardId || 0, {
    query: { enabled: !!cardId, queryKey: getGetCardQueryKey(cardId || 0) }
  });

  const [graded, setGraded] = useState<GradedValues | null>(null);
  const [gradedStatus, setGradedStatus] = useState<"idle" | "loading" | "error" | "quota">("idle");

  // When a card opens, ask the AI to estimate its graded (PSA 10 / BGS Pristine 10) values.
  useEffect(() => {
    if (!open || !cardId) {
      setGraded(null);
      setGradedStatus("idle");
      return;
    }
    const controller = new AbortController();
    setGraded(null);
    setGradedStatus("loading");
    fetch(`/api/cards/${cardId}/graded-values`, { signal: controller.signal })
      .then(async (res) => {
        if (res.status === 429) {
          setGradedStatus("quota");
          return null;
        }
        if (!res.ok) throw new Error("lookup failed");
        return (await res.json()) as GradedValues;
      })
      .then((data) => {
        if (!data) return;
        setGraded(data);
        setGradedStatus("idle");
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setGradedStatus("error");
      });
    return () => {
      controller.abort();
    };
  }, [open, cardId, card?.currentPriceGBP]);

  const refreshPrice = useRefreshCardPrice();
  const deleteCard = useDeleteCard();

  const handleRefreshPrice = () => {
    if (!cardId) return;
    refreshPrice.mutate({ id: cardId }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetCardQueryKey(cardId) });
        if (card?.assignedBinderId) {
          queryClient.invalidateQueries({ queryKey: getGetBinderQueryKey(card.assignedBinderId) });
        }
        toast({ title: "Price Sync Complete", description: "Latest market value fetched." });
      },
      onError: () => {
        toast({ title: "Price Sync Failed", variant: "destructive", description: "Could not fetch latest market value." });
      }
    });
  };

  const handleDelete = () => {
    if (!cardId) return;
    deleteCard.mutate({ id: cardId }, {
      onSuccess: () => {
        if (card?.assignedBinderId) {
          queryClient.invalidateQueries({ queryKey: getGetBinderQueryKey(card.assignedBinderId) });
        }
        toast({ title: "Card Deleted", description: "Card removed from vault." });
        onOpenChange(false);
      }
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md border-l border-border bg-card p-0 flex flex-col">
        {isLoading || !card ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <div className="h-64 w-full bg-black flex items-center justify-center p-6 border-b border-border relative overflow-hidden">
              <div className="absolute inset-0 bg-primary/5 pattern-diagonal-lines opacity-20" />
              {card.imageUrl ? (
                <img src={card.imageUrl} alt={card.name} className="h-full object-contain drop-shadow-2xl z-10" />
              ) : (
                <div className="w-full h-full border-2 border-dashed border-border rounded-xl flex items-center justify-center z-10 bg-background/50">
                  <span className="font-mono text-muted-foreground uppercase tracking-widest text-sm">No Image</span>
                </div>
              )}
            </div>

            <div className="p-6 flex-1 flex flex-col gap-6 overflow-y-auto">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-xs text-muted-foreground px-2 py-1 bg-secondary rounded uppercase">
                    {String(card.setNumber).padStart(3, '0')}/{card.setTotal}
                  </span>
                  <span className="font-mono text-xs text-primary px-2 py-1 bg-primary/10 rounded uppercase border border-primary/20">
                    {card.condition}
                  </span>
                </div>
                <SheetTitle className="text-3xl font-bold uppercase tracking-tight">{card.name}</SheetTitle>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-background border border-border">
                  <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest block mb-1">Raw Market Value</span>
                  <span className="text-2xl font-mono font-bold text-primary">£{card.currentPriceGBP.toFixed(2)}</span>
                </div>
                <div className="p-4 rounded-lg bg-background border border-border flex flex-col justify-center items-center">
                  <Button 
                    variant="outline" 
                    className="w-full h-full font-mono text-xs uppercase gap-2 border-primary/50 hover:bg-primary hover:text-primary-foreground transition-all"
                    onClick={handleRefreshPrice}
                    disabled={refreshPrice.isPending}
                  >
                    <RefreshCw className={`w-4 h-4 ${refreshPrice.isPending ? 'animate-spin' : ''}`} />
                    Sync Price
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                    <Award className="w-3 h-3 text-primary" />
                    Graded Values
                  </span>
                  {graded && (
                    <span className={`text-[9px] font-mono uppercase tracking-wider flex items-center gap-1 ${graded.source === "web-search" ? "text-primary/80" : "text-muted-foreground/70"}`}>
                      <Sparkles className="w-2.5 h-2.5 text-primary" />
                      {graded.source === "web-search" ? "Live Price" : `AI Estimate · ${graded.confidence} conf.`}
                    </span>
                  )}
                </div>

                {gradedStatus === "loading" && (
                  <div className="grid grid-cols-2 gap-4">
                    {["PSA 10", "BGS Pristine 10"].map((label) => (
                      <div key={label} className="p-4 rounded-lg bg-background border border-border">
                        <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest block mb-2">{label}</span>
                        <div className="flex items-center gap-2 text-primary/70">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span className="font-mono text-xs uppercase">Analysing</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {(gradedStatus === "error" || gradedStatus === "quota") && (
                  <div className="p-4 rounded-lg bg-background border border-destructive/30 flex items-center gap-2 text-destructive">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span className="font-mono text-xs uppercase">
                      {gradedStatus === "quota"
                        ? "AI quota reached — try again later"
                        : "Graded lookup unavailable"}
                    </span>
                  </div>
                )}

                {graded && gradedStatus === "idle" && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg bg-background border border-primary/30 relative overflow-hidden">
                      <div className="absolute inset-0 bg-primary/5" />
                      <span className="relative text-[10px] font-mono text-muted-foreground uppercase tracking-widest block mb-1">PSA 10</span>
                      <span className="relative text-2xl font-mono font-bold text-primary">£{graded.psa10.toFixed(2)}</span>
                      <span className="relative block text-[9px] font-mono text-muted-foreground/60 mt-1">Gem Mint</span>
                    </div>
                    <div className="p-4 rounded-lg bg-background border border-primary/30 relative overflow-hidden">
                      <div className="absolute inset-0 bg-primary/5" />
                      <span className="relative text-[10px] font-mono text-muted-foreground uppercase tracking-widest block mb-1">BGS Pristine 10</span>
                      <span className="relative text-2xl font-mono font-bold text-primary">£{graded.bgs10.toFixed(2)}</span>
                      <span className="relative block text-[9px] font-mono text-muted-foreground/60 mt-1">Black Label</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2 mt-auto">
                <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-widest block">System Actions</span>
                <Button variant="destructive" className="w-full font-mono text-xs uppercase gap-2" onClick={handleDelete} disabled={deleteCard.isPending}>
                  <Trash2 className="w-4 h-4" />
                  Purge from Vault
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}