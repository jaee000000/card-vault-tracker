import { Link } from "wouter";
import { Activity, ScanLine, LayoutGrid, TrendingUp } from "lucide-react";

const features = [
  {
    icon: ScanLine,
    title: "AI Card Scanner",
    body: "Point your camera at any card — GPT-4o vision identifies it and pulls live market data instantly.",
  },
  {
    icon: LayoutGrid,
    title: "3×3 Binder Grid",
    body: "Organise your collection into classic binder pages and track set completion at a glance.",
  },
  {
    icon: TrendingUp,
    title: "Live GBP Prices",
    body: "Real-time market values in pounds, with graded PSA 10 and BGS estimates per card.",
  },
];

export default function Landing() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground font-sans selection:bg-primary/30 relative overflow-hidden">
      {/* Ambient grid / glow backdrop */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(184 100% 50%) 1px, transparent 1px), linear-gradient(90deg, hsl(184 100% 50%) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
        }}
      />
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-[480px] w-[480px] rounded-full bg-primary/20 blur-[140px]" />

      {/* Top bar */}
      <header className="relative z-10 w-full border-b border-border/60 bg-background/70 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary drop-shadow-[0_0_8px_rgba(0,245,255,0.5)]" />
            <span className="text-lg font-bold uppercase tracking-tight">PokéVault</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/sign-in"
              className="rounded border border-border px-3 py-2 text-xs font-mono uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              Sign In
            </Link>
            <Link
              href="/sign-up"
              className="rounded border border-primary bg-primary/10 px-3 py-2 text-xs font-mono uppercase tracking-wider text-primary transition-colors hover:bg-primary/20"
            >
              Sign Up
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="relative z-10 flex-1">
        <section className="mx-auto flex w-full max-w-[1200px] flex-col items-center px-4 pt-20 pb-16 text-center sm:pt-28">
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 text-[11px] font-mono uppercase tracking-widest text-primary">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            Your collection, digitised
          </span>
          <h1 className="max-w-3xl text-4xl font-bold uppercase leading-[1.05] tracking-tight sm:text-6xl">
            Track every card in your{" "}
            <span className="text-primary drop-shadow-[0_0_18px_rgba(0,245,255,0.45)]">
              Pokémon vault
            </span>
          </h1>
          <p className="mt-6 max-w-xl text-base text-muted-foreground sm:text-lg">
            Scan cards with AI, organise them into binders, and watch your
            collection's real market value update live — all in one private vault.
          </p>
          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row">
            <Link
              href="/sign-up"
              className="flex h-12 items-center justify-center gap-2 rounded border border-primary bg-primary px-7 text-sm font-mono font-semibold uppercase tracking-wider text-primary-foreground shadow-[0_0_28px_rgba(0,245,255,0.35)] transition-transform hover:scale-[1.02]"
            >
              <ScanLine className="h-4 w-4" />
              Create your vault
            </Link>
            <Link
              href="/sign-in"
              className="flex h-12 items-center justify-center rounded border border-border px-7 text-sm font-mono uppercase tracking-wider text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              I already have one
            </Link>
          </div>
        </section>

        {/* Feature cards */}
        <section className="mx-auto grid w-full max-w-[1100px] grid-cols-1 gap-4 px-4 pb-24 sm:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="group rounded-lg border border-border bg-card/40 p-6 backdrop-blur-sm transition-colors hover:border-primary/40"
            >
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded border border-primary/30 bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mb-2 text-lg font-bold uppercase tracking-tight">{f.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="relative z-10 border-t border-border/60 py-6 text-center">
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          PokéVault · Card Collection Tracker
        </p>
      </footer>
    </div>
  );
}
