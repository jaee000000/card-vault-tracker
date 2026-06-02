import { useGetVaultStats, getGetVaultStatsQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Plus, ScanLine, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TelemetryNav() {
  const { data: stats } = useGetVaultStats({
    query: {
      queryKey: getGetVaultStatsQueryKey()
    }
  });

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-sidebar-border bg-sidebar/80 backdrop-blur-md">
      <div className="flex h-16 items-center px-4 gap-6 w-full max-w-[1400px] mx-auto">
        <div className="flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" />
          <Link href="/" className="font-bold text-xl tracking-tight text-foreground hover:text-primary transition-colors uppercase">
            POKÉVAULT
          </Link>
        </div>

        <div className="flex-1 flex items-center justify-center gap-8">
          <div className="flex flex-col items-center justify-center">
            <span className="text-[10px] uppercase text-muted-foreground font-mono tracking-widest">Vault Value</span>
            <div className="font-mono text-2xl font-bold text-primary tracking-tight drop-shadow-[0_0_8px_rgba(0,255,255,0.4)]">
              £{stats?.totalValueGBP?.toFixed(2) ?? "0.00"}
            </div>
          </div>
          
          <div className="h-8 w-px bg-border hidden md:block" />
          
          <div className="hidden md:flex gap-8">
            <div className="flex flex-col items-center justify-center">
              <span className="text-[10px] uppercase text-muted-foreground font-mono tracking-widest">Cards</span>
              <span className="font-mono text-foreground font-semibold">{stats?.totalCards ?? 0}</span>
            </div>
            <div className="flex flex-col items-center justify-center">
              <span className="text-[10px] uppercase text-muted-foreground font-mono tracking-widest">Completed Sets</span>
              <span className="font-mono text-foreground font-semibold">{stats?.completedSets ?? 0}</span>
            </div>
            <div className="flex flex-col items-center justify-center">
              <span className="text-[10px] uppercase text-muted-foreground font-mono tracking-widest">Binders</span>
              <span className="font-mono text-foreground font-semibold">{stats?.totalBinders ?? 0}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <Link href="/scan" className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-primary text-primary hover:bg-primary/10 h-10 px-4 py-2 bg-primary/5 uppercase tracking-wider">
            <ScanLine className="w-4 h-4" />
            <span className="hidden sm:inline">Scan New Card</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}