import {
  useListBinders,
  getListBindersQueryKey,
  useGetVaultStats,
  getGetVaultStatsQueryKey,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { Folder, Plus, Activity, Layers, Coins, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddBinderDialog } from "@/components/binders/AddBinderDialog";
import { useState } from "react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const SET_CODE_COLORS: Record<string, string> = {
  M2A: "text-violet-400 border-violet-500/30 bg-violet-500/10",
  CHR: "text-blue-400 border-blue-500/30 bg-blue-500/10",
  ABY: "text-teal-400 border-teal-500/30 bg-teal-500/10",
  M4: "text-rose-400 border-rose-500/30 bg-rose-500/10",
};

function getSetCodeStyle(code: string) {
  return SET_CODE_COLORS[code] ?? "text-primary border-primary/20 bg-primary/10";
}

export default function Dashboard() {
  const { data: binders, isLoading: bindersLoading } = useListBinders({
    query: { queryKey: getListBindersQueryKey() },
  });

  const { data: stats } = useGetVaultStats({
    query: { queryKey: getGetVaultStatsQueryKey() },
  });

  const [isAddBinderOpen, setIsAddBinderOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6 pb-12 w-full max-w-[1400px] mx-auto px-3 sm:px-4 mt-4 sm:mt-8">
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        {[
          {
            icon: Coins,
            label: "Total Value",
            value: `£${stats?.totalValueGBP?.toFixed(2) ?? "0.00"}`,
            accent: true,
            sub: "GBP market value",
          },
          {
            icon: Layers,
            label: "Total Cards",
            value: String(stats?.totalCards ?? 0),
            sub: "in vault",
          },
          {
            icon: Activity,
            label: "Completed Sets",
            value: String(stats?.completedSets ?? 0),
            sub: `of ${stats?.totalBinders ?? 0} binders`,
          },
          {
            icon: TrendingUp,
            label: "Total Binders",
            value: String(stats?.totalBinders ?? 0),
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
                "text-xl sm:text-3xl font-mono font-bold relative",
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
      ) : binders?.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 sm:h-64 rounded-xl border border-dashed border-border/50 bg-card/20">
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
              className="group relative rounded-xl border border-border bg-card hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_24px_rgba(0,255,255,0.08)] overflow-hidden block"
            >
              {/* Hover top bar */}
              <div className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-primary/0 via-primary/70 to-primary/0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

              {/* Set code color strip */}
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
