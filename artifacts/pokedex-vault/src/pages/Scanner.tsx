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
import { Loader2, Camera, X, Plus, ChevronDown, ChevronUp } from "lucide-react";
import { useLocation } from "wouter";
import Tesseract from "tesseract.js";

const CONDITIONS = ["Raw", "PSA 10", "PSA 9", "BGS 10", "CGC 10", "Lightly Played", "Heavily Played"];
const NEW_BINDER_VALUE = "__new__";

// Crop and enhance the bottom strip of the card frame where set numbers live.
// Pokemon set numbers appear in the bottom-left or bottom-right corner of the card.
function extractSetNumberRegion(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): string {
  const vw = video.videoWidth;
  const vh = video.videoHeight;

  // The card overlay is centred and 70% of the rendered video width.
  // We need to map from display coords back to video pixel coords.
  const displayW = video.clientWidth || vw;
  const displayH = video.clientHeight || vh;

  const scaleX = vw / displayW;
  const scaleY = vh / displayH;

  // Card frame in display space
  const frameDisplayW = displayW * 0.70;
  const frameDisplayH = frameDisplayW * (3.5 / 2.5);
  const frameDisplayX = (displayW - frameDisplayW) / 2;
  const frameDisplayY = (displayH - frameDisplayH) / 2;

  // Convert to video pixel space
  const frameX = frameDisplayX * scaleX;
  const frameY = frameDisplayY * scaleY;
  const frameW = frameDisplayW * scaleX;
  const frameH = frameDisplayH * scaleY;

  // Crop just the bottom 18% of the card — where the set number sits
  const cropH = frameH * 0.18;
  const cropY = frameY + frameH - cropH;
  const cropX = frameX;
  const cropW = frameW;

  // Upscale 3× for better OCR accuracy
  const scale = 3;
  canvas.width = cropW * scale;
  canvas.height = cropH * scale;

  const ctx = canvas.getContext("2d")!;

  // Scale up
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);

  // Enhance: high-contrast greyscale
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const grey = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    // Binarize at threshold 128
    const val = grey > 128 ? 255 : 0;
    data[i] = val;
    data[i + 1] = val;
    data[i + 2] = val;
  }
  ctx.putImageData(imageData, 0, 0);

  return canvas.toDataURL("image/png");
}

// Fallback: scan whole card frame (less accurate but wider net)
function extractFullCardRegion(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): string {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const displayW = video.clientWidth || vw;
  const displayH = video.clientHeight || vh;
  const scaleX = vw / displayW;
  const scaleY = vh / displayH;

  const frameDisplayW = displayW * 0.70;
  const frameDisplayH = frameDisplayW * (3.5 / 2.5);
  const frameDisplayX = (displayW - frameDisplayW) / 2;
  const frameDisplayY = (displayH - frameDisplayH) / 2;

  const fx = frameDisplayX * scaleX;
  const fy = frameDisplayY * scaleY;
  const fw = frameDisplayW * scaleX;
  const fh = frameDisplayH * scaleY;

  const scale = 2;
  canvas.width = fw * scale;
  canvas.height = fh * scale;

  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(video, fx, fy, fw, fh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

function parseSetNumbers(text: string): { setNumber: number; setTotal: number } | null {
  // Accept 2-4 digit patterns like 026/193, 7/94, 199/193, etc.
  const patterns = [
    /\b(\d{1,4})\s*\/\s*(\d{1,4})\b/g,
  ];
  const candidates: Array<{ setNumber: number; setTotal: number }> = [];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      if (b > 0 && a <= b + 50 && b <= 500) {
        candidates.push({ setNumber: a, setTotal: b });
      }
    }
  }
  if (!candidates.length) return null;
  // Prefer candidates where setNumber <= setTotal
  const valid = candidates.filter((c) => c.setNumber <= c.setTotal);
  return (valid[0] ?? candidates[0]) || null;
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState(false);

  const [status, setStatus] = useState<"idle" | "scanning" | "success" | "error">("idle");
  const [scanResult, setScanResult] = useState<{ setNumber: number; setTotal: number } | null>(null);
  const [scanAttempt, setScanAttempt] = useState(0);

  const [cardName, setCardName] = useState("");
  const [condition, setCondition] = useState("Raw");
  const [selectedBinderId, setSelectedBinderId] = useState<string>("");

  // New binder form (shown when user picks "Create new binder")
  const [newBinderName, setNewBinderName] = useState("");
  const [newBinderCode, setNewBinderCode] = useState("");
  const [showNewBinder, setShowNewBinder] = useState(false);

  const startCamera = useCallback(async () => {
    setCameraError(false);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch {
      setCameraError(true);
      setStatus("error");
      toast({
        title: "Camera Access Denied",
        variant: "destructive",
        description: "Allow camera access in your browser settings.",
      });
    }
  }, [toast]);

  const stopCamera = useCallback(() => {
    if (stream) stream.getTracks().forEach((t) => t.stop());
  }, [stream]);

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  const handleScan = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    setStatus("scanning");
    setScanAttempt((n) => n + 1);

    const video = videoRef.current;
    const canvas = canvasRef.current;

    try {
      // Pass 1: cropped bottom strip (most reliable for set numbers)
      const croppedData = extractSetNumberRegion(video, canvas);
      const result1 = await Tesseract.recognize(croppedData, "eng", {
        logger: () => {},
      });

      let parsed = parseSetNumbers(result1.data.text);

      if (!parsed) {
        // Pass 2: full card frame as fallback
        const fullData = extractFullCardRegion(video, canvas);
        const result2 = await Tesseract.recognize(fullData, "eng", {
          logger: () => {},
        });
        parsed = parseSetNumbers(result2.data.text);
      }

      if (parsed) {
        setScanResult(parsed);
        setStatus("success");
        stopCamera();
        // Pre-fill new binder code from setTotal
        setNewBinderCode(`SET${parsed.setTotal}`);
        toast({
          title: "Card Identified",
          description: `Set number ${parsed.setNumber}/${parsed.setTotal} detected.`,
        });
      } else {
        setStatus("idle");
        toast({
          title: "Scan Failed",
          variant: "destructive",
          description:
            "Could not read the set number. Align the bottom edge of the card clearly in the frame and try again.",
        });
      }
    } catch {
      setStatus("idle");
      toast({
        title: "OCR Error",
        variant: "destructive",
        description: "Image processing failed. Please try again.",
      });
    }
  };

  const handleSave = async () => {
    if (!scanResult || !cardName) {
      toast({
        title: "Incomplete",
        variant: "destructive",
        description: "Please fill in the card name.",
      });
      return;
    }

    let binderId: number;

    if (selectedBinderId === NEW_BINDER_VALUE) {
      if (!newBinderName || !newBinderCode) {
        toast({
          title: "Incomplete",
          variant: "destructive",
          description: "Please fill in the new binder name and set code.",
        });
        return;
      }
      // Create binder first
      try {
        const newBinder = await new Promise<{ id: number }>((resolve, reject) => {
          createBinder.mutate(
            {
              data: {
                name: newBinderName,
                setCode: newBinderCode.toUpperCase(),
                setTotal: scanResult.setTotal,
              },
            },
            {
              onSuccess: (b) => resolve(b),
              onError: reject,
            }
          );
        });
        await refetchBinders();
        binderId = newBinder.id;
        toast({ title: "Binder Created", description: `Created binder: ${newBinderName}` });
      } catch {
        toast({
          title: "Binder Creation Failed",
          variant: "destructive",
          description: "Could not create binder.",
        });
        return;
      }
    } else {
      if (!selectedBinderId) {
        toast({
          title: "No Binder",
          variant: "destructive",
          description: "Please select a binder.",
        });
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
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries();
          toast({ title: "Card Added", description: `${cardName} committed to vault.` });
          setLocation(`/binder/${binderId}`);
        },
        onError: () => {
          toast({
            title: "Save Failed",
            variant: "destructive",
            description: "Could not save card.",
          });
        },
      }
    );
  };

  const isPending = createCard.isPending || createBinder.isPending;

  return (
    <div className="min-h-[calc(100dvh-3.5rem)] sm:min-h-[calc(100dvh-4rem)] flex flex-col bg-background w-full max-w-lg mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
        <h1 className="font-mono text-sm uppercase font-bold tracking-widest flex items-center gap-2">
          <ScanLineIcon className="w-4 h-4 text-primary" />
          Optical Scanner
        </h1>
        <Button variant="ghost" size="icon" onClick={() => setLocation("/")} className="h-8 w-8">
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 flex flex-col min-h-0">
        {status === "success" && scanResult ? (
          /* ── Result / commit screen ── */
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
            {/* Detected pattern badge */}
            <div className="p-4 bg-primary/10 border border-primary/30 rounded-lg flex flex-col items-center">
              <span className="font-mono text-[10px] uppercase tracking-widest text-primary mb-1">
                Pattern Matched
              </span>
              <span className="font-mono text-3xl sm:text-4xl font-bold">
                {String(scanResult.setNumber).padStart(3, "0")}&nbsp;/&nbsp;{scanResult.setTotal}
              </span>
            </div>

            <div className="space-y-3">
              {/* Card name */}
              <div className="space-y-1.5">
                <Label className="font-mono uppercase text-[10px] text-muted-foreground">Card Name</Label>
                <Input
                  value={cardName}
                  onChange={(e) => setCardName(e.target.value)}
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
                    {CONDITIONS.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Binder selector */}
              <div className="space-y-1.5">
                <Label className="font-mono uppercase text-[10px] text-muted-foreground">Assign to Binder</Label>
                <Select
                  value={selectedBinderId}
                  onValueChange={(v) => {
                    setSelectedBinderId(v);
                    setShowNewBinder(v === NEW_BINDER_VALUE);
                  }}
                >
                  <SelectTrigger className="font-mono bg-card border-border text-sm">
                    <SelectValue placeholder="Select binder" />
                  </SelectTrigger>
                  <SelectContent>
                    {binders?.map((b) => (
                      <SelectItem key={b.id} value={b.id.toString()}>
                        {b.name} ({b.setCode})
                      </SelectItem>
                    ))}
                    <SelectItem value={NEW_BINDER_VALUE}>
                      <span className="flex items-center gap-2 text-primary">
                        <Plus className="w-3 h-3" /> Create new binder for this set
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* New binder inline form */}
              {showNewBinder && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-3">
                  <p className="font-mono text-[10px] uppercase text-primary tracking-widest">
                    New Binder — Set Total: {scanResult.setTotal} (auto-detected)
                  </p>
                  <div className="space-y-1.5">
                    <Label className="font-mono uppercase text-[10px] text-muted-foreground">Binder Name</Label>
                    <Input
                      value={newBinderName}
                      onChange={(e) => setNewBinderName(e.target.value)}
                      className="font-mono bg-card border-border text-sm"
                      placeholder="e.g. Scarlet & Violet"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="font-mono uppercase text-[10px] text-muted-foreground">Set Code</Label>
                    <Input
                      value={newBinderCode}
                      onChange={(e) => setNewBinderCode(e.target.value.toUpperCase())}
                      className="font-mono bg-card border-border text-sm uppercase"
                      placeholder="SVB"
                      maxLength={10}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2 pb-4">
              <Button
                variant="outline"
                className="flex-1 font-mono uppercase text-xs h-11"
                onClick={() => {
                  setStatus("idle");
                  setScanResult(null);
                  setSelectedBinderId("");
                  setShowNewBinder(false);
                  startCamera();
                }}
              >
                Retake
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
          /* ── Camera scan screen ── */
          <>
            {/* Video */}
            <div className="flex-1 bg-black relative overflow-hidden flex items-center justify-center min-h-0">
              {cameraError ? (
                <div className="flex flex-col items-center gap-3 p-8 text-center">
                  <Camera className="w-12 h-12 text-muted-foreground opacity-40" />
                  <p className="font-mono text-sm text-muted-foreground uppercase">Camera unavailable</p>
                  <p className="text-xs text-muted-foreground/60">Allow camera access in your browser, then reload.</p>
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
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  <canvas ref={canvasRef} className="hidden" />

                  {/* Dark vignette around card area */}
                  <div className="absolute inset-0 pointer-events-none" style={{
                    background: "radial-gradient(ellipse 72% 85% at 50% 50%, transparent 55%, rgba(0,0,0,0.75) 100%)"
                  }} />

                  {/* Card frame overlay */}
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-[70%] aspect-[2.5/3.5] relative">
                      {/* Cyan corner brackets */}
                      <div className="absolute -top-0.5 -left-0.5 w-7 h-7 sm:w-10 sm:h-10 border-t-[3px] border-l-[3px] border-primary shadow-[0_0_8px_rgba(0,255,255,0.6)]" />
                      <div className="absolute -top-0.5 -right-0.5 w-7 h-7 sm:w-10 sm:h-10 border-t-[3px] border-r-[3px] border-primary shadow-[0_0_8px_rgba(0,255,255,0.6)]" />
                      <div className="absolute -bottom-0.5 -left-0.5 w-7 h-7 sm:w-10 sm:h-10 border-b-[3px] border-l-[3px] border-primary shadow-[0_0_8px_rgba(0,255,255,0.6)]" />
                      <div className="absolute -bottom-0.5 -right-0.5 w-7 h-7 sm:w-10 sm:h-10 border-b-[3px] border-r-[3px] border-primary shadow-[0_0_8px_rgba(0,255,255,0.6)]" />

                      {/* Bottom strip hint */}
                      <div className="absolute bottom-0 left-0 right-0 h-[18%] border-t border-primary/30 bg-primary/5 pointer-events-none">
                        <span className="absolute left-1/2 -translate-x-1/2 bottom-1 font-mono text-[8px] sm:text-[10px] text-primary/60 uppercase tracking-widest whitespace-nowrap">
                          set number zone
                        </span>
                      </div>

                      {/* Scan animation */}
                      {status === "scanning" && (
                        <div className="absolute top-0 left-0 w-full h-[3px] bg-primary shadow-[0_0_12px_#00ffff] animate-[scan_1.5s_ease-in-out_infinite]" />
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Tip + button */}
            <div className="shrink-0 bg-card border-t border-border px-4 pt-3 pb-4 sm:pb-6 flex flex-col items-center gap-3">
              <p className="font-mono text-[10px] sm:text-xs uppercase text-primary tracking-widest text-center animate-pulse">
                {status === "scanning"
                  ? "Reading optical data..."
                  : `Align card • keep set number visible${scanAttempt > 0 ? " • try holding still" : ""}`}
              </p>
              {scanAttempt >= 2 && status === "idle" && (
                <p className="font-mono text-[10px] text-muted-foreground text-center">
                  Tip: get close to the bottom corner — the number looks like 026/193
                </p>
              )}
              <Button
                size="lg"
                className="w-full font-mono uppercase tracking-widest h-12 sm:h-14 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded-none"
                onClick={handleScan}
                disabled={status === "scanning" || cameraError}
              >
                {status === "scanning" ? (
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                ) : (
                  <Camera className="w-5 h-5 mr-2" />
                )}
                Initiate Scan
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ScanLineIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 7V5a2 2 0 0 1 2-2h2"/>
      <path d="M17 3h2a2 2 0 0 1 2 2v2"/>
      <path d="M21 17v2a2 2 0 0 1-2 2h-2"/>
      <path d="M7 21H5a2 2 0 0 1-2-2v-2"/>
      <path d="M7 12h10"/>
    </svg>
  );
}
