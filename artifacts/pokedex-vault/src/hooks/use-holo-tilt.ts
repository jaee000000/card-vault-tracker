import { useRef, useState, useCallback } from "react";

interface HoloState {
  rx: number;
  ry: number;
  px: number;
  py: number;
  active: boolean;
}

const RESET: HoloState = { rx: 0, ry: 0, px: 50, py: 50, active: false };

export function useHoloTilt<T extends HTMLElement = HTMLElement>(maxAngle = 22) {
  const ref = useRef<T>(null);
  const [s, setS] = useState<HoloState>(RESET);

  const compute = (clientX: number, clientY: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = Math.min(Math.max((clientX - r.left) / r.width, 0), 1);
    const py = Math.min(Math.max((clientY - r.top) / r.height, 0), 1);
    setS({ rx: (py - 0.5) * -maxAngle, ry: (px - 0.5) * maxAngle, px: px * 100, py: py * 100, active: true });
  };

  const onMouseMove = useCallback((e: React.MouseEvent) => compute(e.clientX, e.clientY), []);
  const onMouseLeave = useCallback(() => setS(RESET), []);
  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches[0]) compute(e.touches[0].clientX, e.touches[0].clientY);
  }, []);
  const onTouchEnd = useCallback(() => setS(RESET), []);

  const cardStyle: React.CSSProperties = {
    transform: s.active
      ? `perspective(700px) rotateX(${s.rx}deg) rotateY(${s.ry}deg) scale3d(1.05,1.05,1.05)`
      : "perspective(700px) rotateX(0deg) rotateY(0deg) scale3d(1,1,1)",
    transition: s.active ? "transform 0.08s linear" : "transform 0.5s ease-out",
    willChange: "transform",
  };

  const shimmerStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    zIndex: 10,
    opacity: s.active ? 1 : 0,
    transition: "opacity 0.25s ease",
    mixBlendMode: "screen",
    background: s.active
      ? `radial-gradient(farthest-corner ellipse at ${s.px}% ${s.py}%,
          rgba(255,255,255,0.45) 0%,
          rgba(255,255,255,0.08) 35%,
          transparent 65%
        ),
        linear-gradient(
          ${110 + s.px * 1.2}deg,
          transparent 18%,
          rgba(255,60,140,0.35) 26%,
          rgba(255,210,60,0.35) 36%,
          rgba(60,255,140,0.35) 46%,
          rgba(60,160,255,0.35) 56%,
          rgba(180,60,255,0.35) 66%,
          transparent 78%
        )`
      : "none",
  };

  return {
    ref,
    handlers: { onMouseMove, onMouseLeave, onTouchMove, onTouchEnd },
    cardStyle,
    shimmerStyle,
    active: s.active,
  };
}
