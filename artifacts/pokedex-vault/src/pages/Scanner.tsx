import { useState, useRef, useEffect } from "react";
import { useListBinders, getListBindersQueryKey, useCreateCard } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Camera, X } from "lucide-react";
import { useLocation } from "wouter";
import Tesseract from "tesseract.js";

const CONDITIONS = ["Raw", "PSA 10", "PSA 9", "BGS 10", "CGC 10", "Lightly Played", "Heavily Played"];

export default function Scanner() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createCard = useCreateCard();

  const { data: binders } = useListBinders({ query: { queryKey: getListBindersQueryKey() } });

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const [status, setStatus] = useState<"idle" | "scanning" | "success" | "error">("idle");
  const [scanResult, setScanResult] = useState<{ setNumber: number, setTotal: number } | null>(null);

  const [cardName, setCardName] = useState("");
  const [condition, setCondition] = useState("Raw");
  const [selectedBinderId, setSelectedBinderId] = useState<string>("");

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } } 
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      setStatus("error");
      toast({ title: "Camera Error", variant: "destructive", description: "Cannot access camera feed." });
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
  };

  const handleScan = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    setStatus("scanning");

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas to video dimensions
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Get image data URL
    const imageData = canvas.toDataURL("image/jpeg");

    try {
      const result = await Tesseract.recognize(imageData, "eng", {
        logger: m => console.log(m)
      });

      const text = result.data.text;
      // Look for NNN/NNN pattern
      const match = text.match(/\b(\d{2,3})\/(\d{2,3})\b/);
      
      if (match) {
        const setNumber = parseInt(match[1], 10);
        const setTotal = parseInt(match[2], 10);
        setScanResult({ setNumber, setTotal });
        setStatus("success");
        stopCamera();
        toast({ title: "Target Acquired", description: `Detected slot ${setNumber}/${setTotal}` });
      } else {
        setStatus("idle");
        toast({ title: "Scan Failed", variant: "destructive", description: "Could not read set numbers. Please try again." });
      }
    } catch (err) {
      setStatus("idle");
      toast({ title: "OCR Error", variant: "destructive", description: "Optical character recognition failed." });
    }
  };

  const handleSave = () => {
    if (!scanResult || !selectedBinderId || !cardName) {
      toast({ title: "Incomplete Data", variant: "destructive", description: "Please fill all fields." });
      return;
    }

    createCard.mutate({
      data: {
        name: cardName,
        setNumber: scanResult.setNumber,
        setTotal: scanResult.setTotal,
        condition,
        assignedBinderId: parseInt(selectedBinderId, 10),
      }
    }, {
      onSuccess: () => {
        toast({ title: "Card Saved", description: "Card committed to vault." });
        setLocation(`/binder/${selectedBinderId}`);
      }
    });
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col bg-background relative max-w-md mx-auto w-full border-x border-border">
      {/* Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-border bg-card">
        <h1 className="font-mono uppercase font-bold tracking-widest flex items-center gap-2">
          <ScanLineIcon className="w-5 h-5 text-primary" />
          Optical Scanner
        </h1>
        <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
          <X className="w-5 h-5" />
        </Button>
      </div>

      <div className="flex-1 flex flex-col relative">
        {status === "success" && scanResult ? (
          <div className="flex-1 p-6 flex flex-col gap-6">
            <div className="p-4 bg-primary/10 border border-primary/30 rounded-lg flex flex-col items-center justify-center">
              <span className="font-mono text-xs uppercase tracking-widest text-primary mb-2">Pattern Match Found</span>
              <span className="font-mono text-4xl font-bold">{String(scanResult.setNumber).padStart(3, '0')} / {scanResult.setTotal}</span>
            </div>

            <div className="space-y-4 flex-1">
              <div className="space-y-2">
                <Label className="font-mono uppercase text-[10px] text-muted-foreground">Target Binder</Label>
                <Select value={selectedBinderId} onValueChange={setSelectedBinderId}>
                  <SelectTrigger className="font-mono bg-card border-border">
                    <SelectValue placeholder="Select partition" />
                  </SelectTrigger>
                  <SelectContent>
                    {binders?.map(b => (
                      <SelectItem key={b.id} value={b.id.toString()}>{b.name} ({b.setCode})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="font-mono uppercase text-[10px] text-muted-foreground">Card Designation</Label>
                <Input value={cardName} onChange={e => setCardName(e.target.value)} className="font-mono bg-card border-border" placeholder="Enter card name" />
              </div>

              <div className="space-y-2">
                <Label className="font-mono uppercase text-[10px] text-muted-foreground">Condition Rating</Label>
                <Select value={condition} onValueChange={setCondition}>
                  <SelectTrigger className="font-mono bg-card border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDITIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex gap-4">
              <Button variant="outline" className="flex-1 font-mono uppercase text-xs" onClick={() => { setStatus("idle"); setScanResult(null); startCamera(); }}>
                Retake
              </Button>
              <Button className="flex-1 font-mono uppercase text-xs" onClick={handleSave} disabled={createCard.isPending}>
                {createCard.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Commit to Vault
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Camera feed */}
            <div className="flex-1 bg-black relative overflow-hidden flex items-center justify-center">
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                muted 
                className="absolute w-full h-full object-cover opacity-80"
              />
              <canvas ref={canvasRef} className="hidden" />

              {/* Overlay guides */}
              <div className="absolute inset-0 pointer-events-none border-[40px] border-black/60 transition-all duration-300" />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-[70%] aspect-[2.5/3.5] border-2 border-primary/50 relative">
                  {/* Corner brackets */}
                  <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-primary" />
                  <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-primary" />
                  <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-primary" />
                  <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-primary" />
                  
                  {/* Scanning scanline */}
                  {status === "scanning" && (
                    <div className="absolute top-0 left-0 w-full h-1 bg-primary shadow-[0_0_10px_#00ffff] animate-[scan_2s_ease-in-out_infinite]" />
                  )}
                </div>
              </div>
            </div>

            {/* Controls */}
            <div className="h-32 bg-card border-t border-border flex flex-col items-center justify-center p-4">
              <span className="font-mono text-xs uppercase text-primary mb-4 tracking-widest animate-pulse">
                {status === "scanning" ? "Processing Optical Data..." : "Align card within frame"}
              </span>
              <Button 
                size="lg" 
                className="w-full font-mono uppercase tracking-widest h-12 text-sm bg-primary hover:bg-primary/90 text-primary-foreground rounded-none"
                onClick={handleScan}
                disabled={status === "scanning"}
              >
                {status === "scanning" ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Camera className="w-5 h-5 mr-2" />}
                Initiate Scan
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ScanLineIcon(props: any) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>
    </svg>
  );
}