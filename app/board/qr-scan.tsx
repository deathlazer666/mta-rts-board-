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

type ScanResult = { name?: string; text: string };

// Scans standard QR codes with the device camera and resolves MTA stations.
// Every successful decode produces a visible centered confirmation — either
// "Station set to X" (and the board's station is updated) or a "couldn't
// identify" card with a retry. Note: MTA's colorful NaviLens codes are
// proprietary and can't be decoded by a standard QR reader; this reads
// NaviLens GO / station-info / any standard QR.
export default function QrScanner({ open, onClose, onStation }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);
  const doneRef = useRef(false);
  const [scanKey, setScanKey] = useState(0);
  const [status, setStatus] = useState("Point the camera at an MTA station code");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);

  // Keep the latest callbacks in refs so the effect only depends on `open` and
  // `scanKey`. Otherwise a parent re-render (e.g. the board's 1s clock tick)
  // would tear down and restart the camera stream, making the feed flicker.
  const onStationRef = useRef(onStation);
  onStationRef.current = onStation;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const rescan = useCallback(() => {
    setResult(null);
    setFatal(null);
    setStatus("Point the camera at an MTA station code");
    doneRef.current = false;
    setScanKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!open) return;
    doneRef.current = false;
    setResult(null);
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
        try {
          await video.play();
        } catch {
          // Ignore play() rejection; the frame loop will pick up frames when ready.
        }

        let frame = 0;
        const tick = () => {
          if (doneRef.current) return;
          rafRef.current = requestAnimationFrame(tick);
          // Decode every 4th frame (~15 fps) to keep the live feed smooth on
          // low-end Android devices; full-rate getImageData can stall the camera.
          if (++frame % 4 !== 0) return;
          const canvas = canvasRef.current;
          const v = videoRef.current;
          const ctx = canvas?.getContext("2d", { willReadFrequently: true });
          if (!canvas || !v || !ctx || v.videoWidth === 0) return;
          try {
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
                navigator.vibrate?.(80);
                setResult({ name: station.name, text: code.data });
                setStatus(`Station set to ${station.name}`);
                onStationRef.current(station);
              } else {
                setResult({ text: code.data });
                setStatus("Couldn't identify a station in that code");
              }
            }
          } catch {
            // A bad frame must never kill the scan loop — keep going.
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
  }, [open, scanKey, stop]);

  // Auto-close after a successful scan so the confirmation is still visible.
  useEffect(() => {
    if (!open || !result?.name) return;
    const t = setTimeout(() => onCloseRef.current(), 2500);
    return () => clearTimeout(t);
  }, [open, result]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="relative flex-1 overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />

        {result ? (
          // Centered confirmation / feedback card.
          <div className="absolute inset-0 bg-black/70 flex items-center justify-center p-6">
            <div className="w-full max-w-sm bg-[#141a22] border-2 border-[#ffd23f] px-6 py-8 text-center">
              {result.name ? (
                <>
                  <p className="text-5xl text-[#5fd45f] leading-none mb-4">✓</p>
                  <p
                    className="text-lg font-bold text-[#ffd23f]"
                    style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
                  >
                    Station set to
                  </p>
                  <p
                    className="text-2xl font-bold text-white mt-1"
                    style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
                  >
                    {result.name}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-5xl text-[#ed0a02] leading-none mb-4">✕</p>
                  <p
                    className="text-lg font-bold text-[#ffd23f]"
                    style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
                  >
                    Couldn't identify a station
                  </p>
                  <p className="text-xs text-white/50 mt-2 break-all line-clamp-3">{result.text}</p>
                </>
              )}
              <div className="flex gap-3 mt-6 justify-center">
                {!result.name && (
                  <button
                    onClick={rescan}
                    className="px-5 py-2.5 rounded bg-[#ffd23f] text-black text-sm font-bold"
                    style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
                  >
                    Scan another
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="px-5 py-2.5 rounded bg-white/10 text-white text-sm font-bold"
                  style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>
      <div className="px-5 py-4 text-center space-y-1 bg-black border-t border-white/10">
        <p
          className="text-sm font-bold"
          style={{ fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
        >
          {result?.name ? `Station set to ${result.name}` : result ? "Scan another code to try again" : "Scan an MTA station code"}
        </p>
        <p className={`text-xs ${fatal ? "text-red-400" : "text-white/50"}`}>{fatal ?? status}</p>
        {fatal && (
          <button
            onClick={rescan}
            className="mt-2 px-4 py-2 rounded bg-white/10 text-sm font-bold"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
