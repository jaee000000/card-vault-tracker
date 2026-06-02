import { useGetVaultStats, getGetVaultStatsQueryKey } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { ScanLine, Activity, LayoutGrid, LogOut } from "lucide-react";
import { useClerk } from "@clerk/react";
import { cn } from "@/lib/utils";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function TelemetryNav() {
  const { data: stats } = useGetVaultStats({
    query: { queryKey: getGetVaultStatsQueryKey() }
  });
  const [location] = useLocation();
  const { signOut } = useClerk();

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-sidebar-border bg-sidebar/95 backdrop-blur-md">
      <div className="flex h-14 sm:h-16 items-center px-3 sm:px-4 gap-2 sm:gap-4 w-full max-w-[1400px] mx-auto">
        {/* Logo */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Activity className="h-5 w-5 text-primary" />
          <Link href="/" className="font-bold text-sm sm:text-xl tracking-tight text-foreground hover:text-primary transition-colors uppercase">
            PokéVault
          </Link>
        </div>

        {/* Vault value — dominant, always visible */}
        <div className="flex flex-col items-center justify-center ml-2 sm:ml-6 border-l border-border pl-2 sm:pl-6">
          <span className="text-[8px] sm:text-[10px] uppercase text-muted-foreground font-mono tracking-widest leading-none">Vault Value</span>
          <div className="font-mono text-lg sm:text-2xl font-bold text-primary tracking-tight drop-shadow-[0_0_8px_rgba(0,255,255,0.4)] leading-tight">
            £{stats?.totalValueGBP?.toFixed(2) ?? "0.00"}
          </div>
        </div>

        {/* Secondary telemetry — hidden on xs, show on sm+ */}
        <div className="hidden sm:flex items-center gap-4 sm:gap-6 ml-4 pl-4 border-l border-border">
          <div className="flex flex-col items-center">
            <span className="text-[8px] sm:text-[10px] uppercase text-muted-foreground font-mono tracking-widest leading-none">Cards</span>
            <span className="font-mono text-sm sm:text-base text-foreground font-semibold leading-tight">{stats?.totalCards ?? 0}</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-[8px] sm:text-[10px] uppercase text-muted-foreground font-mono tracking-widest leading-none whitespace-nowrap">Sets Done</span>
            <span className="font-mono text-sm sm:text-base text-foreground font-semibold leading-tight">{stats?.completedSets ?? 0}/{stats?.totalBinders ?? 0}</span>
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Nav links */}
        <div className="flex items-center gap-2">
          <Link
            href="/collection"
            className={cn(
              "flex items-center justify-center gap-1.5 rounded border transition-colors px-2.5 sm:px-3 py-2 text-xs font-mono uppercase tracking-wider shrink-0 h-9 sm:h-10",
              location === "/collection"
                ? "border-primary/60 text-primary bg-primary/10"
                : "border-border text-muted-foreground bg-transparent hover:border-primary/40 hover:text-primary hover:bg-primary/5"
            )}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Collection</span>
          </Link>

          <Link
            href="/scan"
            className="flex items-center justify-center gap-1.5 rounded border border-primary text-primary bg-primary/5 hover:bg-primary/15 active:bg-primary/20 transition-colors px-3 sm:px-4 py-2 text-xs font-mono uppercase tracking-wider shrink-0 h-9 sm:h-10"
          >
            <ScanLine className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            <span className="hidden xs:inline sm:inline">Scan</span>
            <span className="hidden sm:inline"> Card</span>
          </Link>

          <button
            type="button"
            onClick={() => signOut({ redirectUrl: basePath || "/" })}
            title="Sign out"
            className="flex items-center justify-center gap-1.5 rounded border border-border text-muted-foreground bg-transparent hover:border-destructive/50 hover:text-destructive transition-colors px-2.5 sm:px-3 py-2 text-xs font-mono uppercase tracking-wider shrink-0 h-9 sm:h-10"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Exit</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
