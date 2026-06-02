import { useListBinders, getListBindersQueryKey, useGetVaultStats, getGetVaultStatsQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Folder, Plus, Activity, Layers, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddBinderDialog } from "@/components/binders/AddBinderDialog";
import { useState } from "react";
import { Progress } from "@/components/ui/progress";

export default function Dashboard() {
  const { data: binders, isLoading: bindersLoading } = useListBinders({
    query: { queryKey: getListBindersQueryKey() }
  });

  const { data: stats } = useGetVaultStats({
    query: { queryKey: getGetVaultStatsQueryKey() }
  });

  const [isAddBinderOpen, setIsAddBinderOpen] = useState(false);

  return (
    <div className="flex flex-col gap-8 pb-12 w-full max-w-[1400px] mx-auto px-4 mt-8">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-6 rounded-lg border border-border bg-card shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
          <div className="flex items-center gap-4 text-muted-foreground mb-4">
            <Coins className="w-5 h-5 text-primary" />
            <h3 className="font-mono text-xs uppercase tracking-widest">Total Value</h3>
          </div>
          <div className="text-3xl font-mono text-foreground font-bold">
            £{stats?.totalValueGBP?.toFixed(2) ?? "0.00"}
          </div>
        </div>
        <div className="p-6 rounded-lg border border-border bg-card shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
          <div className="flex items-center gap-4 text-muted-foreground mb-4">
            <Layers className="w-5 h-5 text-primary" />
            <h3 className="font-mono text-xs uppercase tracking-widest">Total Cards</h3>
          </div>
          <div className="text-3xl font-mono text-foreground font-bold">
            {stats?.totalCards ?? 0}
          </div>
        </div>
        <div className="p-6 rounded-lg border border-border bg-card shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
          <div className="flex items-center gap-4 text-muted-foreground mb-4">
            <Activity className="w-5 h-5 text-primary" />
            <h3 className="font-mono text-xs uppercase tracking-widest">Completed Sets</h3>
          </div>
          <div className="text-3xl font-mono text-foreground font-bold">
            {stats?.completedSets ?? 0}
          </div>
        </div>
        <div className="p-6 rounded-lg border border-border bg-card shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
          <div className="flex items-center gap-4 text-muted-foreground mb-4">
            <Folder className="w-5 h-5 text-primary" />
            <h3 className="font-mono text-xs uppercase tracking-widest">Total Binders</h3>
          </div>
          <div className="text-3xl font-mono text-foreground font-bold">
            {stats?.totalBinders ?? 0}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight uppercase">Binders</h2>
          <p className="text-muted-foreground font-mono text-sm mt-1">Select a folder to view contents</p>
        </div>
        <Button onClick={() => setIsAddBinderOpen(true)} className="uppercase tracking-widest font-mono text-xs gap-2">
          <Plus className="w-4 h-4" />
          Initialize Binder
        </Button>
      </div>

      {bindersLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-48 rounded-lg border border-border/50 bg-card/50 animate-pulse" />
          ))}
        </div>
      ) : binders?.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 rounded-lg border border-dashed border-border/50 bg-card/20">
          <Folder className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
          <p className="text-muted-foreground font-mono">No binders found.</p>
          <Button variant="link" onClick={() => setIsAddBinderOpen(true)} className="text-primary mt-2">Create your first binder</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {binders?.map((binder, i) => (
            <Link key={binder.id} href={`/binder/${binder.id}`} className="group relative rounded-lg border border-border bg-card p-6 hover:border-primary/50 transition-all duration-300 hover:shadow-[0_0_20px_rgba(0,255,255,0.1)] overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary/0 via-primary/50 to-primary/0 opacity-0 group-hover:opacity-100 transition-opacity" />
              
              <div className="flex items-start justify-between mb-8">
                <div className="p-3 bg-primary/10 rounded-md">
                  <Folder className="w-6 h-6 text-primary" />
                </div>
                <div className="font-mono text-xs px-2 py-1 bg-secondary rounded text-muted-foreground">
                  {binder.setCode}
                </div>
              </div>
              
              <h3 className="font-bold text-lg mb-2 uppercase group-hover:text-primary transition-colors">{binder.name}</h3>
              
              <div className="space-y-2 mt-4">
                <div className="flex justify-between text-xs font-mono text-muted-foreground">
                  <span>Capacity</span>
                  <span>{binder.setTotal} slots</span>
                </div>
                {/* Normally we'd use binderStats here for scannedCards. The API returns setTotal but not scannedCards in the main list. Assuming 0 for now unless fetched */}
                <div className="flex justify-between text-xs font-mono text-muted-foreground">
                  <span>Created</span>
                  <span>{new Date(binder.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <AddBinderDialog open={isAddBinderOpen} onOpenChange={setIsAddBinderOpen} />
    </div>
  );
}