import {
  useListBinders,
  getListBindersQueryKey,
  useGetVaultStats,
  getGetVaultStatsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Folder, Plus, Activity, Layers, Coins, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddBinderDialog } from "@/components/binders/AddBinderDialog";
import { useState } from "react";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const { data: binders, isLoading: bindersLoading } = useListBinders({
    query: { queryKey: getListBindersQueryKey() },
  });

  const { data: stats, refetch: refetchStats } = useGetVaultStats({
    query: { queryKey: getGetVaultStatsQueryKey() },
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isAddBinderOpen, setIsAddBinderOpen] = useState(false);
  const [resyncing, setResyncing] = useState(false);

  const handleResync = async () => {
    setResyncing(true);
    try {
      const res = await fetch("/api/cards/resync-all", { method: "POST" });
      if (!res.ok) throw new Error("Resync failed");
      const data = await res.json() as { updated: number };
      await queryClient.invalidateQueries();
      toast({
        title: "Vault Resynced",
        description: `Live prices updated for ${data.updated} cards.`,
      });
    } catch {
      toast({ title: "Resync Failed", variant: "destructive", description: "Could not fetch live prices." });
    } finally {
      setResyncing(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-12 w-full max-w-[1400px] mx-auto px-3 sm:px-4 mt-4 sm:mt-8">
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {[
          { icon: Coins, label: "Total Value", value: `£${stats?.totalValueGBP?.toFixed(2) ?? "0.00"}` },
          { icon: Layers, label: "Total Cards", value: String(stats?.totalCards ?? 0) },
          { icon: Activity, label: "Completed Sets", value: String(stats?.completedSets ?? 0) },
          { icon: Folder, label: "Total Binders", value: String(stats?.totalBinders ?? 0) },
        ].map(({ icon: Icon, label, value }) => (
          <div key={label} className="p-4 sm:p-6 rounded-lg border border-border bg-card shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
            <div className="flex items-center gap-2 sm:gap-4 text-muted-foreground mb-2 sm:mb-4">
              <Icon className="w-4 h-4 sm:w-5 sm:h-5 text-primary shrink-0" />
              <h3 className="font-mono text-[10px] sm:text-xs uppercase tracking-widest truncate">{label}</h3>
            </div>
            <div className="text-xl sm:text-3xl font-mono text-foreground font-bold">{value}</div>
          </div>
        ))}
      </div>

      {/* Binders header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-0 sm:justify-between mt-2 sm:mt-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight uppercase">Binders</h2>
          <p className="text-muted-foreground font-mono text-xs sm:text-sm mt-0.5">Select a folder to view contents</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleResync}
            disabled={resyncing}
            className="font-mono uppercase text-xs gap-2 border-primary/40 text-primary hover:bg-primary/10"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${resyncing ? "animate-spin" : ""}`} />
            {resyncing ? "Syncing..." : "Re-sync Values"}
          </Button>
          <Button
            size="sm"
            onClick={() => setIsAddBinderOpen(true)}
            className="uppercase tracking-widest font-mono text-xs gap-2"
          >
            <Plus className="w-3.5 h-3.5" />
            New Binder
          </Button>
        </div>
      </div>

      {/* Binder grid */}
      {bindersLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-36 sm:h-48 rounded-lg border border-border/50 bg-card/50 animate-pulse" />
          ))}
        </div>
      ) : binders?.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 sm:h-64 rounded-lg border border-dashed border-border/50 bg-card/20">
          <Folder className="w-10 h-10 text-muted-foreground mb-3 opacity-50" />
          <p className="text-muted-foreground font-mono text-sm">No binders yet.</p>
          <Button variant="link" onClick={() => setIsAddBinderOpen(true)} className="text-primary mt-1 text-xs">
            Create your first binder
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-6">
          {binders?.map((binder) => (
            <Link
              key={binder.id}
              href={`/binder/${binder.id}`}
              className="group relative rounded-lg border border-border bg-card p-4 sm:p-6 hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(0,255,255,0.1)] overflow-hidden block"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary/0 via-primary/50 to-primary/0 opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="flex items-start justify-between mb-4 sm:mb-8">
                <div className="p-2 sm:p-3 bg-primary/10 rounded-md">
                  <Folder className="w-4 h-4 sm:w-6 sm:h-6 text-primary" />
                </div>
                <div className="font-mono text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 sm:py-1 bg-secondary rounded text-muted-foreground">
                  {binder.setCode}
                </div>
              </div>
              <h3 className="font-bold text-sm sm:text-lg mb-2 uppercase group-hover:text-primary transition-colors leading-tight line-clamp-2">
                {binder.name}
              </h3>
              <div className="mt-3 sm:mt-4">
                <div className="flex justify-between text-[10px] sm:text-xs font-mono text-muted-foreground mb-1">
                  <span>{binder.setTotal} slots</span>
                </div>
                <Progress value={0} className="h-1" />
              </div>
            </Link>
          ))}
        </div>
      )}

      <AddBinderDialog open={isAddBinderOpen} onOpenChange={setIsAddBinderOpen} />
    </div>
  );
}
