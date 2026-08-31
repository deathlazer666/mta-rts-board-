"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { resolveStationFromQr } from "@/lib/qr-station";
import type { Station } from "@/lib/stations";

type Props = {
  open: boolean;
  onClose: () => void;
  onStation: (station: Station) => void;
};

// Scans standard QR codes with the device camera and resolves MTA stations.
// Note: MTA's colorful NaviLens codes are proprietary and can't be decoded by a
// standard QR reader — this reads NaviLens GO / station-info / any standard QR.
export default function QrScanner({ open, onClose, onStation }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  const doneRef = useRef(false);
  const [status, setStatus] = useState("Point the camera at an MTA station code");
  const [foundName, setFoundName] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) return;
    doneRef.current = false;
    setFoundName(null);
    setFatal(null);
    setStatus("Point the camera at an MTA station code");
    let cancelled = false;

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera is not supported on this device.");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        const tick = () => {
          if (doneRef.current) return;
          rafRef.current = requestAnimationFrame(tick);
          const canvas = canvasRef.current;
          const v = videoRef.current;
          const ctx = canvas?.getContext("2d", { willReadFrequently: true });
          if (!canvas || !v || !ctx || v.videoWidth === 0) return;
          // Downscale for fast decoding.
          const scale = Math.min(1, 640 / v.videoWidth);
          const w = Math.round(v.videoWidth * scale);
          const h = Math.round(v.videoHeight * scale);
          if (canvas.width !== w) {
            canvas.width = w;
            canvas.height = h;
          }
          ctx.drawImage(v, 0, 0, w, h);
          const img = ctx.getImageData(0, 0, w, h);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
          if (code?.data) {
            doneRef.current = true;
            stop();
            const station = resolveStationFromQr(code.data);
            if (station) {
              setFoundName(station.name);
              setStatus(`Station set to ${station.name}`);
              onStation(station);
            } else {
              setStatus(`Couldn't identify a station in that code (${code.data.slice(0, 60)}…)`);
            }
          }
        };
        tick();
      } catch (e) {
        if (!cancelled) {
          setFatal((e as Error).message || "Camera unavailable. Check permissions.");
        }
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [open, onStation, stop]);

  // Auto-close briefly after a successful scan.
  useEffect(() => {
    if (!open || !foundName) return;
    const t = setTimeout(onClose, 1800);
    return () => clearTimeout(t);
  }, [open, foundName, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />
        {/* Scanning frame */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-64 h-64 border-2 border-[#ffd23f] shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
        </div>
        <button
          onClick={onClose}
          aria-label="Close scanner"
          className="absolute top-4 right-4 rounded-full bg-black/70 text-white w-11 h-11 text-2xl leading-none hover:bg-black"
        >
          ×
        </button>
      </div>
      <div className="px-5 py-4 text-center space-y-1 bg-black border-t border-white/10">
        <p className="text-sm font-bold" style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}>
          {foundName ? `Station set to ${foundName}` : "Scan an MTA station code"}
        </p>
        <p className={`text-xs ${fatal ? "text-red-400" : "text-white/50"}`}>
          {fatal ?? status}
        </p>
        {fatal && (
          <button
            onClick={onClose}
            className="mt-2 px-4 py-2 rounded bg-white/10 text-sm font-bold"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}
