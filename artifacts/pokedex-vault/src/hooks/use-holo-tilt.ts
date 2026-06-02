import { useRef, useState, useEffect, useCallback } from "react";

const SPRING = 0.11;
const DAMPING = 0.72;
const IDLE_AMP = 4;       // degrees of idle oscillation
const IDLE_SHIMMER = 0.28; // shimmer opacity at rest
const ACTIVE_SHIMMER = 0.55;

interface HoloState {
  rx: number;
  ry: number;
  px: number;
  py: number;
  scale: number;
  active: boolean;
}

export function useHoloTilt<T extends HTMLElement = HTMLElement>(maxAngle = 35, perspectivePx = 650, enabled = true) {
  const ref = useRef<T>(null);

  // target values set from mouse/touch
  const target = useRef({ rx: 0, ry: 0, px: 50, py: 50, active: false });
  // spring velocities
  const vel = useRef({ rx: 0, ry: 0, px: 0, py: 0, scale: 0 });
  // current interpolated values
  const cur = useRef({ rx: 0, ry: 0, px: 50, py: 50, scale: 1 });

  const raf = useRef<number | null>(null);
  const t0 = useRef(performance.now());

  const [s, setS] = useState<HoloState>({ rx: 0, ry: 0, px: 50, py: 50, scale: 1, active: false });

  const tick = useCallback((now: number) => {
    const elapsed = (now - t0.current) / 1000;
    const tgt = target.current;
    const v = vel.current;
    const c = cur.current;

    let tRx = tgt.rx;
    let tRy = tgt.ry;
    let tPx = tgt.px;
    let tPy = tgt.py;

    if (!tgt.active) {
      // gentle sinusoidal idle sway
      tRx = Math.sin(elapsed * 0.65) * IDLE_AMP;
      tRy = Math.sin(elapsed * 0.45 + 1.2) * IDLE_AMP;
      tPx = 50 + Math.sin(elapsed * 0.55) * 22;
      tPy = 50 + Math.cos(elapsed * 0.38) * 18;
    }

    // spring integration
    v.rx = v.rx * DAMPING + (tRx - c.rx) * SPRING;
    v.ry = v.ry * DAMPING + (tRy - c.ry) * SPRING;
    v.px = v.px * DAMPING + (tPx - c.px) * SPRING;
    v.py = v.py * DAMPING + (tPy - c.py) * SPRING;

    c.rx += v.rx;
    c.ry += v.ry;
    c.px += v.px;
    c.py += v.py;

    const tScale = tgt.active ? 1.07 : 1;
    v.scale = v.scale * DAMPING + (tScale - c.scale) * SPRING;
    c.scale += v.scale;

    setS({ rx: c.rx, ry: c.ry, px: c.px, py: c.py, scale: c.scale, active: tgt.active });

    raf.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (raf.current) cancelAnimationFrame(raf.current);
      return;
    }
    t0.current = performance.now();
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [tick, enabled]);

  const compute = useCallback((clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = Math.min(Math.max((clientX - r.left) / r.width, 0), 1);
    const py = Math.min(Math.max((clientY - r.top) / r.height, 0), 1);
    target.current = { rx: (py - 0.5) * -maxAngle, ry: (px - 0.5) * maxAngle, px: px * 100, py: py * 100, active: true };
  }, [maxAngle]);

  const onMouseMove = useCallback((e: React.MouseEvent) => compute(e.clientX, e.clientY), [compute]);
  const onMouseLeave = useCallback(() => { target.current = { rx: 0, ry: 0, px: 50, py: 50, active: false }; }, []);
  const onTouchMove = useCallback((e: React.TouchEvent) => { if (e.touches[0]) compute(e.touches[0].clientX, e.touches[0].clientY); }, [compute]);
  const onTouchEnd = useCallback(() => { target.current = { ...target.current, active: false }; }, []);

  const shimAlpha = s.active ? ACTIVE_SHIMMER : IDLE_SHIMMER;
  const whiteAlpha = s.active ? 0.5 : 0.18;

  const cardStyle: React.CSSProperties = {
    transform: `perspective(${perspectivePx}px) rotateX(${s.rx}deg) rotateY(${s.ry}deg) scale3d(${s.scale},${s.scale},${s.scale})`,
    willChange: "transform",
  };

  const shimmerStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    zIndex: 10,
    mixBlendMode: "screen",
    background: `
      radial-gradient(farthest-corner ellipse at ${s.px}% ${s.py}%,
        rgba(255,255,255,${whiteAlpha}) 0%,
        rgba(255,255,255,${whiteAlpha * 0.2}) 30%,
        transparent 62%
      ),
      linear-gradient(
        ${108 + s.px * 1.6}deg,
        transparent 12%,
        rgba(255,50,130,${shimAlpha}) 22%,
        rgba(255,215,55,${shimAlpha}) 33%,
        rgba(55,255,145,${shimAlpha}) 44%,
        rgba(55,155,255,${shimAlpha}) 55%,
        rgba(185,55,255,${shimAlpha}) 66%,
        rgba(255,50,130,${shimAlpha * 0.6}) 76%,
        transparent 86%
      )
    `,
  };

  return {
    ref,
    handlers: { onMouseMove, onMouseLeave, onTouchMove, onTouchEnd },
    cardStyle,
    shimmerStyle,
    active: s.active,
  };
}
