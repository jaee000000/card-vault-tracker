import { useState, useRef, useEffect, useCallback } from "react";
import {
  useListBinders,
  getListBindersQueryKey,
  useCreateCard,
  useCreateBinder,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Camera, X, Plus, Sparkles, AlertTriangle } from "lucide-react";
import { useLocation } from "wouter";

const CONDITIONS = ["Raw", "PSA 10", "PSA 9", "BGS 10", "CGC 10", "Lightly Played", "Heavily Played"];
const NEW_BINDER_VALUE = "__new__";

interface ScanResult {
  name: string;
  setNumber: number;
  setTotal: number;
  setId?: string;
  rarity?: string;
  confidence: string;
  priceGBP: number;
  imageUrl: string | null;
  priceNote?: string | null;
}

/** Full-frame capture, downscaled to max 1024px wide for fast upload */
function captureFrame(video: HTMLVideoElement): string {
  const MAX = 1024;
  let w = video.videoWidth, h = video.videoHeight;
  if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d")!.drawImage(video, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.82);
}

/** Crop the card area (centre 72% width, card aspect ratio) and resize to a compact thumbnail */
function cropCardThumbnail(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.width, h = img.height;
      const cropW = Math.floor(w * 0.72);
      const cropH = Math.floor(cropW * 3.5 / 2.5);
      const cropX = Math.floor((w - cropW) / 2);
      const cropY = Math.max(0, Math.floor((h - cropH) / 2));
      const OUT_W = 260, OUT_H = Math.floor(260 * 3.5 / 2.5);
      const canvas = document.createElement("canvas");
      canvas.width = OUT_W; canvas.height = OUT_H;
      canvas.getContext("2d")!.drawImage(img, cropX, cropY, cropW, Math.min(cropH, h - cropY), 0, 0, OUT_W, OUT_H);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.src = dataUrl;
  });
}

/** Crop the top 45% of the frame (where the Pokémon NAME is printed) and upscale 2× for legibility */
function captureTopCrop(video: HTMLVideoElement): string {
  const vw = video.videoWidth, vh = video.videoHeight;
  const cropH = Math.floor(vh * 0.45);    // top 45%
  const OUT_W = Math.min(vw * 2, 1600);
  const OUT_H = Math.round(OUT_W * cropH / vw);
  const canvas = document.createElement("canvas");
  canvas.width = OUT_W; canvas.height = OUT_H;
  canvas.getContext("2d")!.drawImage(video, 0, 0, vw, cropH, 0, 0, OUT_W, OUT_H);
  return canvas.toDataURL("image/jpeg", 0.95); // high quality — text reading
}

/** Crop the bottom 35% of the frame (where set number lives) and upscale 2× for legibility */
function captureBottomCrop(video: HTMLVideoElement): string {
  const vw = video.videoWidth, vh = video.videoHeight;
  const cropY = Math.floor(vh * 0.60);   // start at 60% down
  const cropH = vh - cropY;               // = bottom 40%
  const OUT_W = Math.min(vw * 2, 1600);
  const OUT_H = Math.round(OUT_W * cropH / vw);
  const canvas = document.createElement("canvas");
  canvas.width = OUT_W; canvas.height = OUT_H;
  canvas.getContext("2d")!.drawImage(video, 0, cropY, vw, cropH, 0, 0, OUT_W, OUT_H);
  return canvas.toDataURL("image/jpeg", 0.95); // high quality — text reading
}

export default function Scanner() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createCard = useCreateCard();
  const createBinder = useCreateBinder();

  const { data: binders, refetch: refetchBinders } = useListBinders({
    query: { queryKey: getListBindersQueryKey() },
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);

  const [status, setStatus] = useState<"idle" | "scanning" | "success" | "error" | "manual">("idle");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [scanCount, setScanCount] = useState(0);
  const [manualSetNumber, setManualSetNumber] = useState("");
  const [manualSetTotal, setManualSetTotal] = useState("");

  const [cardName, setCardName] = useState("");
  const [condition, setCondition] = useState("Raw");
  const [selectedBinderId, setSelectedBinderId] = useState<string>("");
  const [newBinderName, setNewBinderName] = useState("");
  const [newBinderCode, setNewBinderCode] = useState("");
  const [showNewBinder, setShowNewBinder] = useState(false);
  const [capturedFrameUrl, setCapturedFrameUrl] = useState<string | null>(null);

  const startCamera = useCallback(async () => {
    setCameraError(false);
    setCameraReady(false);
    try {
      // Stop any existing stream first
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 3840, min: 1280 },
          height: { ideal: 2160, min: 720 },
        },
      });
      streamRef.current = mediaStream;
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch {
      setCameraError(true);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  const handleScan = async () => {
    if (!videoRef.current || !cameraReady) return;
    setStatus("scanning");
    setErrorMsg("");
    setScanCount(n => n + 1);

    try {
      const imageBase64 = captureFrame(videoRef.current);
      const topCropBase64 = captureTopCrop(videoRef.current);
      const bottomCropBase64 = captureBottomCrop(videoRef.current);
      // Store the full frame — used as fallback image if no database image is found
      setCapturedFrameUrl(imageBase64);

      const res = await fetch("/api/scan/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64, topCropBase64, bottomCropBase64 }),
      });

      const data = await res.json() as ScanResult & { error?: string; reason?: string; detail?: string };

      if (res.status === 429 || data.error === "quota_exceeded") {
        setStatus("manual");
        setErrorMsg("AI quota exceeded — enter the set number manually from the bottom of your card.");
        return;
      }

      if (!res.ok || data.error) {
        const reason = data.detail ?? data.reason ?? data.error ?? "Could not identify card.";
        setErrorMsg(reason);
        setStatus("error");
        return;
      }

      setScanResult(data);
      setCardName(data.name);
      setStatus("success");
      stopCamera();

      // Auto-select binder if set total matches an existing one
      if (binders?.length) {
        const match = binders.find(b => b.setTotal === data.setTotal);
        if (match) setSelectedBinderId(String(match.id));
      }

      toast({
        title: "Card Identified",
        description: `${data.name} — ${data.setNumber}/${data.setTotal}`,
      });
    } catch (err) {
      console.error(err);
      setErrorMsg("Network error. Check your connection and try again.");
      setStatus("error");
    }
  };

  const handleManualConfirm = async () => {
    const sn = parseInt(manualSetNumber, 10);
    const st = parseInt(manualSetTotal, 10);
    if (!sn || !st || sn > st + 50) {
      toast({ title: "Invalid", variant: "destructive", description: "Enter a valid set number like 026 and set total like 193." });
      return;
    }
    const priceRes = await fetch(`/api/cards/resync-all`, { method: "POST" }).catch(() => null);
    // Fetch price from PokéTCG directly via the backend resync but just use 0 for now — price refreshes automatically on card add
    setScanResult({ name: cardName || "Unknown", setNumber: sn, setTotal: st, confidence: "low", priceGBP: 0, imageUrl: null });
    setStatus("success");
    stopCamera();
    if (binders?.length) {
      const match = binders.find(b => b.setTotal === st);
      if (match) setSelectedBinderId(String(match.id));
    }
  };

  const handleSave = async () => {
    if (!scanResult || !cardName) {
      toast({ title: "Incomplete", variant: "destructive", description: "Card name is required." });
      return;
    }

    // If no database image, crop the camera frame to just the card area as a compact thumbnail
    let resolvedImageUrl = scanResult.imageUrl ?? undefined;
    if (!resolvedImageUrl && capturedFrameUrl) {
      resolvedImageUrl = await cropCardThumbnail(capturedFrameUrl);
    }

    let binderId: number;

    if (selectedBinderId === NEW_BINDER_VALUE) {
      if (!newBinderName || !newBinderCode) {
        toast({ title: "Incomplete", variant: "destructive", description: "Fill in binder name and code." });
        return;
      }
      try {
        const newBinder = await new Promise<{ id: number }>((resolve, reject) => {
          createBinder.mutate(
            { data: { name: newBinderName, setCode: newBinderCode.toUpperCase(), setTotal: scanResult.setTotal } },
            { onSuccess: (b) => resolve(b), onError: reject }
          );
        });
        await refetchBinders();
        binderId = newBinder.id;
        toast({ title: "Binder Created", description: newBinderName });
      } catch {
        toast({ title: "Binder Creation Failed", variant: "destructive", description: "Please try again." });
        return;
      }
    } else {
      if (!selectedBinderId) {
        toast({ title: "No Binder Selected", variant: "destructive", description: "Choose a binder." });
        return;
      }
      binderId = parseInt(selectedBinderId, 10);
    }

    createCard.mutate(
      {
        data: {
          name: cardName,
          setNumber: scanResult.setNumber,
          setTotal: scanResult.setTotal,
          condition,
          assignedBinderId: binderId,
          currentPriceGBP: scanResult.priceGBP,
          imageUrl: resolvedImageUrl,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries();
          toast({
            title: "Card Added",
            description: `${cardName} placed in slot ${String(scanResult.setNumber).padStart(3, "0")}.`,
          });
          setLocation(`/binder/${binderId}?slot=${scanResult.setNumber}`);
        },
        onError: () => {
          toast({ title: "Save Failed", variant: "destructive", description: "Could not save card." });
        },
      }
    );
  };

  const handleRetry = () => {
    setStatus("idle");
    setScanResult(null);
    setErrorMsg("");
    setSelectedBinderId("");
    setShowNewBinder(false);
    setCapturedFrameUrl(null);
    startCamera();
  };

  const isPending = createCard.isPending || createBinder.isPending;

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] sm:min-h-[calc(100dvh-4rem)] flex flex-col bg-background w-full max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
        <h1 className="font-mono text-sm uppercase font-bold tracking-widest flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          AI Card Scanner
        </h1>
        <Button variant="ghost" size="icon" onClick={() => setLocation("/")} className="h-8 w-8">
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        {/* ── MANUAL ENTRY: quota exceeded fallback ── */}
        {status === "manual" ? (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg flex gap-3 items-start">
              <AlertTriangle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-mono text-xs font-bold uppercase text-yellow-400">AI Quota Exceeded</p>
                <p className="text-xs text-muted-foreground mt-1">{errorMsg}</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="font-mono uppercase text-[10px] text-muted-foreground">Card Name</Label>
                <Input value={cardName} onChange={e => setCardName(e.target.value)} className="font-mono bg-card border-border text-sm" placeholder="e.g. Dragonite ex" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="font-mono uppercase text-[10px] text-muted-foreground">Set Number</Label>
                  <Input value={manualSetNumber} onChange={e => setManualSetNumber(e.target.value)} className="font-mono bg-card border-border text-sm" placeholder="026" type="number" />
                </div>
                <div className="space-y-1.5">
                  <Label className="font-mono uppercase text-[10px] text-muted-foreground">Set Total</Label>
                  <Input value={manualSetTotal} onChange={e => setManualSetTotal(e.target.value)} className="font-mono bg-card border-border text-sm" placeholder="193" type="number" />
                </div>
              </div>
              <p className="font-mono text-[10px] text-muted-foreground">Find these on the bottom of your card, e.g. <span className="text-primary">026/193</span></p>
            </div>
            <div className="flex gap-3 pb-6">
              <Button variant="outline" className="flex-1 font-mono uppercase text-xs h-11" onClick={handleRetry}>Back</Button>
              <Button className="flex-1 font-mono uppercase text-xs h-11" onClick={handleManualConfirm}>Continue</Button>
            </div>
          </div>
        ) : /* ── SUCCESS: show result form ── */
        status === "success" && scanResult ? (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {/* Card preview card */}
            <div className="flex gap-4 p-4 bg-primary/10 border border-primary/30 rounded-lg">
              {(scanResult.imageUrl ?? capturedFrameUrl) ? (
                <img
                  src={scanResult.imageUrl ?? capturedFrameUrl!}
                  alt={scanResult.name}
                  className="w-20 h-28 object-cover rounded shadow-lg shrink-0"
                  style={scanResult.imageUrl ? {} : { objectPosition: "center 15%" }}
                />
              ) : (
                <div className="w-20 h-28 bg-card border border-border rounded flex items-center justify-center shrink-0">
                  <span className="font-mono text-[9px] text-muted-foreground text-center leading-tight px-1">No image</span>
                </div>
              )}
              <div className="flex flex-col justify-between min-w-0">
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${scanResult.confidence === "high" ? "bg-green-400" : scanResult.confidence === "medium" ? "bg-yellow-400" : "bg-red-400"}`} />
                    <span className="font-mono text-[9px] uppercase text-muted-foreground tracking-widest">
                      {scanResult.confidence} confidence
                    </span>
                  </div>
                  <p className="font-bold text-sm leading-tight">{scanResult.name}</p>
                  <p className="font-mono text-xs text-muted-foreground mt-0.5">
                    {String(scanResult.setNumber).padStart(3, "0")}/{scanResult.setTotal}
                    {scanResult.setId && <span className="ml-1.5 uppercase">{scanResult.setId}</span>}
                    {scanResult.rarity && <span className="ml-1 text-primary/70">{scanResult.rarity}</span>}
                  </p>
                </div>
                <div>
                  <div className="font-mono text-xl font-bold text-primary">
                    {scanResult.priceGBP > 0 ? `£${scanResult.priceGBP.toFixed(2)}` : "Price N/A"}
                  </div>
                  {scanResult.priceNote && (
                    <p className="font-mono text-[9px] text-yellow-400/80 mt-0.5 leading-tight">{scanResult.priceNote}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {/* Card name — pre-filled, editable */}
              <div className="space-y-1.5">
                <Label className="font-mono uppercase text-[10px] text-muted-foreground">Card Name</Label>
                <Input
                  value={cardName}
                  onChange={e => setCardName(e.target.value)}
                  className="font-mono bg-card border-border text-sm"
                  placeholder="e.g. Charizard ex"
                />
              </div>

              {/* Condition */}
              <div className="space-y-1.5">
                <Label className="font-mono uppercase text-[10px] text-muted-foreground">Condition</Label>
                <Select value={condition} onValueChange={setCondition}>
                  <SelectTrigger className="font-mono bg-card border-border text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDITIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Binder */}
              <div className="space-y-1.5">
                <Label className="font-mono uppercase text-[10px] text-muted-foreground">Assign to Binder</Label>
                <Select
                  value={selectedBinderId}
                  onValueChange={v => {
                    setSelectedBinderId(v);
                    setShowNewBinder(v === NEW_BINDER_VALUE);
                  }}
                >
                  <SelectTrigger className="font-mono bg-card border-border text-sm">
                    <SelectValue placeholder="Select binder" />
                  </SelectTrigger>
                  <SelectContent>
                    {binders?.map(b => (
                      <SelectItem key={b.id} value={String(b.id)}>
                        {b.name} ({b.setCode})
                      </SelectItem>
                    ))}
                    <SelectItem value={NEW_BINDER_VALUE}>
                      <span className="flex items-center gap-2 text-primary">
                        <Plus className="w-3 h-3" /> Create new binder
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Inline new-binder form */}
              {showNewBinder && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
                  <p className="font-mono text-[10px] uppercase text-primary tracking-widest">
                    New Binder — {scanResult.setTotal} cards total (auto-detected)
                  </p>
                  <div className="space-y-1.5">
                    <Label className="font-mono uppercase text-[10px] text-muted-foreground">Binder Name</Label>
                    <Input
                      value={newBinderName}
                      onChange={e => setNewBinderName(e.target.value)}
                      className="font-mono bg-card border-border text-sm"
                      placeholder="e.g. Scarlet & Violet Base"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="font-mono uppercase text-[10px] text-muted-foreground">Set Code</Label>
                    <Input
                      value={newBinderCode}
                      onChange={e => setNewBinderCode(e.target.value.toUpperCase())}
                      className="font-mono bg-card border-border text-sm uppercase"
                      placeholder="SVB"
                      maxLength={10}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2 pb-6">
              <Button
                variant="outline"
                className="flex-1 font-mono uppercase text-xs h-11"
                onClick={handleRetry}
              >
                Rescan
              </Button>
              <Button
                className="flex-1 font-mono uppercase text-xs h-11"
                onClick={handleSave}
                disabled={isPending}
              >
                {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Add to Vault
              </Button>
            </div>
          </div>
        ) : (
          /* ── CAMERA SCREEN ── */
          <>
            <div className="flex-1 bg-black relative overflow-hidden flex items-center justify-center min-h-0">
              {cameraError ? (
                <div className="flex flex-col items-center gap-3 p-8 text-center">
                  <Camera className="w-12 h-12 text-muted-foreground opacity-40" />
                  <p className="font-mono text-sm text-muted-foreground uppercase">Camera unavailable</p>
                  <p className="text-xs text-muted-foreground/60">Allow camera access in your browser settings, then retry.</p>
                  <Button size="sm" variant="outline" onClick={startCamera} className="font-mono text-xs uppercase mt-2">
                    Retry
                  </Button>
                </div>
              ) : (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    onCanPlay={() => setCameraReady(true)}
                    className="absolute inset-0 w-full h-full object-cover"
                  />

                  {/* Vignette */}
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{ background: "radial-gradient(ellipse 75% 88% at 50% 48%, transparent 52%, rgba(0,0,0,0.7) 100%)" }}
                  />

                  {/* Card frame */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-[72%] aspect-[2.5/3.5] relative">
                      {(() => {
                        const scanning = status === "scanning";
                        const corner = scanning ? "animate-[corner-pulse_1s_ease-in-out_infinite]" : "";
                        return (
                          <>
                            <div className={`absolute -top-0.5 -left-0.5 w-8 h-8 sm:w-10 sm:h-10 border-t-[3px] border-l-[3px] border-primary shadow-[0_0_10px_rgba(0,255,255,0.7)] ${corner}`} />
                            <div className={`absolute -top-0.5 -right-0.5 w-8 h-8 sm:w-10 sm:h-10 border-t-[3px] border-r-[3px] border-primary shadow-[0_0_10px_rgba(0,255,255,0.7)] ${corner}`} />
                            <div className={`absolute -bottom-0.5 -left-0.5 w-8 h-8 sm:w-10 sm:h-10 border-b-[3px] border-l-[3px] border-primary shadow-[0_0_10px_rgba(0,255,255,0.7)] ${corner}`} />
                            <div className={`absolute -bottom-0.5 -right-0.5 w-8 h-8 sm:w-10 sm:h-10 border-b-[3px] border-r-[3px] border-primary shadow-[0_0_10px_rgba(0,255,255,0.7)] ${corner}`} />
                          </>
                        );
                      })()}

                      {status === "scanning" && (
                        <div className="absolute inset-0 overflow-hidden rounded-sm">
                          {/* Tinted analysis wash */}
                          <div className="absolute inset-0 bg-primary/10" />

                          {/* Scanline grid */}
                          <div
                            className="absolute inset-0 animate-[grid-pulse_1.6s_ease-in-out_infinite]"
                            style={{
                              backgroundImage:
                                "repeating-linear-gradient(0deg, rgba(0,255,255,0.25) 0px, rgba(0,255,255,0.25) 1px, transparent 1px, transparent 14px), repeating-linear-gradient(90deg, rgba(0,255,255,0.18) 0px, rgba(0,255,255,0.18) 1px, transparent 1px, transparent 14px)",
                            }}
                          />

                          {/* Sweeping scan band */}
                          <div className="absolute inset-x-0 h-1/3 animate-[scan-sweep_1.5s_ease-in-out_infinite]">
                            <div
                              className="w-full h-full"
                              style={{
                                background:
                                  "linear-gradient(to bottom, transparent, rgba(0,255,255,0.28) 60%, rgba(0,255,255,0.55) 100%)",
                              }}
                            />
                            <div className="w-full h-[2px] bg-primary shadow-[0_0_18px_4px_#00ffff]" />
                          </div>

                          {/* Analyzing label */}
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                            <Sparkles className="w-7 h-7 text-primary animate-pulse drop-shadow-[0_0_8px_#00ffff]" />
                            <span className="font-mono text-[10px] sm:text-xs uppercase tracking-[0.25em] text-primary drop-shadow-[0_0_6px_#00ffff]">
                              Analyzing
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Error overlay */}
                  {status === "error" && errorMsg && (
                    <div className="absolute bottom-2 left-3 right-3 bg-destructive/90 text-destructive-foreground rounded-lg p-3 flex gap-2 items-start backdrop-blur-sm">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-mono text-xs font-bold uppercase">Scan Failed</p>
                        <p className="text-xs mt-0.5 opacity-90">{errorMsg}</p>
                        {scanCount >= 2 && (
                          <p className="text-[10px] mt-1 opacity-75">
                            Tip: hold the card flat, ensure good lighting, fill the frame
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Controls */}
            <div className="shrink-0 bg-card border-t border-border px-4 pt-3 pb-5 sm:pb-7 flex flex-col items-center gap-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                <p className="font-mono text-[10px] sm:text-xs uppercase text-primary tracking-widest text-center">
                  {status === "scanning" ? "AI identifying card..." : "Hold card flat · fill the frame · good light"}
                </p>
              </div>
              <Button
                size="lg"
                className="w-full font-mono uppercase tracking-widest h-13 sm:h-14 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded-none"
                style={{ height: "3.25rem" }}
                onClick={handleScan}
                disabled={status === "scanning" || cameraError || !cameraReady}
              >
                {status === "scanning" ? (
                  <><Loader2 className="w-5 h-5 animate-spin mr-2" /> Identifying…</>
                ) : (
                  <><Sparkles className="w-5 h-5 mr-2" /> AI Scan Card</>
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
