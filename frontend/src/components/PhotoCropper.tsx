import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Loader2, ZoomIn, ZoomOut } from "lucide-react";

/* Crop a chosen photo to a square before it is uploaded.

   The picked file opens in a window with a fixed frame. Drag the photo
   to move it, use the slider (or the + and - keys) to zoom, and the
   frame always stays covered, so the result never has empty edges. The
   corners are rounded only to show how the app will draw it; what is
   handed back is a plain square image.

   The photo is decoded straight from the file and drawn on a canvas,
   never loaded through a blob: or data: image link, so a Content
   Security Policy with a strict img-src can't block it.

   `file`     the photo to crop; the window is open while this is set.
   `onDone`   gets the cropped image (PNG stays PNG, anything else is a
              JPEG) once the person presses Use photo.
   `onCancel` closes without doing anything. */

const STAGE = 320;
const MAX_ZOOM = 4;
const STEP = 10;

type Source = ImageBitmap | HTMLImageElement;

interface Props {
  file: File | null;
  title?: string;
  shape?: "rounded" | "round";
  outputSize?: number;
  busy?: boolean;
  onCancel: () => void;
  onDone: (blob: Blob) => void | Promise<void>;
}

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--card))]";

/* Decode without any image URL: createImageBitmap reads the file
   directly (and applies the photo's rotation). Browsers without it fall
   back to reading the file as a data URL. */
async function decode(file: File): Promise<Source> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      /* fall through to the reader */
    }
  }
  const dataUrl: string = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("decode failed"));
    el.src = dataUrl;
  });
}

export default function PhotoCropper({
  file, title = "Adjust your photo", shape = "rounded", outputSize = 512, busy = false, onCancel, onDone,
}: Props) {
  const [img, setImg] = useState<Source | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const [working, setWorking] = useState(false);
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);
  const stage = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setImg(null);
    setFailed(false);
    setZoom(1);
    setOff({ x: 0, y: 0 });
    if (!file) return;
    /* In development React runs this effect twice; only the latest run
       may set the photo or the error. */
    let cancelled = false;
    decode(file)
      .then((s) => { if (!cancelled) setImg(s); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [file]);

  const nw = img ? img.width : 1;
  const nh = img ? img.height : 1;
  /* At zoom 1 the photo just covers the frame. */
  const base = Math.max(STAGE / nw, STAGE / nh);
  const scale = base * zoom;
  const w = nw * scale;
  const h = nh * scale;
  const left = STAGE / 2 - w / 2 + off.x;
  const top = STAGE / 2 - h / 2 + off.y;

  /* Redraw the frame whenever the photo, zoom or position changes. */
  useEffect(() => {
    const c = stage.current;
    if (!c || !img) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = STAGE * dpr;
    c.height = STAGE * dpr;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#E6E3D6";
    ctx.fillRect(0, 0, STAGE, STAGE);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, left, top, w, h);
  }, [img, left, top, w, h]);

  const clamp = (o: { x: number; y: number }, s: number) => {
    const mx = Math.max(0, (nw * s - STAGE) / 2);
    const my = Math.max(0, (nh * s - STAGE) / 2);
    return { x: Math.min(mx, Math.max(-mx, o.x)), y: Math.min(my, Math.max(-my, o.y)) };
  };

  const zoomTo = (z: number) => {
    const nz = Math.min(MAX_ZOOM, Math.max(1, z));
    const ratio = nz / zoom;
    setOff(clamp({ x: off.x * ratio, y: off.y * ratio }, base * nz));
    setZoom(nz);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!img) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, ox: off.x, oy: off.y };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setOff(clamp({ x: d.ox + (e.clientX - d.px), y: d.oy + (e.clientY - d.py) }, scale));
  };
  const onPointerUp = () => { drag.current = null; };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const move = (dx: number, dy: number) => { e.preventDefault(); setOff(clamp({ x: off.x + dx, y: off.y + dy }, scale)); };
    if (e.key === "ArrowLeft") move(STEP, 0);
    else if (e.key === "ArrowRight") move(-STEP, 0);
    else if (e.key === "ArrowUp") move(0, STEP);
    else if (e.key === "ArrowDown") move(0, -STEP);
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomTo(zoom + 0.2); }
    else if (e.key === "-") { e.preventDefault(); zoomTo(zoom - 0.2); }
  };

  const handleDone = () => {
    if (!img || working || busy) return;
    setWorking(true);
    const canvas = document.createElement("canvas");
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext("2d");
    if (!ctx) { setWorking(false); setFailed(true); return; }
    const type = file?.type === "image/png" ? "image/png" : "image/jpeg";
    if (type === "image/jpeg") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, outputSize, outputSize); }
    ctx.imageSmoothingQuality = "high";
    /* The part of the photo under the frame, in the photo's own pixels. */
    ctx.drawImage(img, -left / scale, -top / scale, STAGE / scale, STAGE / scale, 0, 0, outputSize, outputSize);
    canvas.toBlob(async (blob) => {
      if (!blob) { setWorking(false); setFailed(true); return; }
      try { await onDone(blob); } finally { setWorking(false); }
    }, type, 0.92);
  };

  const disabled = !img || working || busy;

  return (
    <Dialog open={!!file} onOpenChange={(o) => { if (!o && !busy && !working) onCancel(); }}>
      <DialogContent className="max-w-[440px] gap-0 rounded-[28px] border-2 border-[hsl(var(--card-border))] bg-[hsl(var(--card))] p-7 [&>button]:hidden">
        <DialogTitle className="text-[24px] font-bold leading-[30px] tracking-[-.01em]">{title}</DialogTitle>
        <DialogDescription className="mt-1 text-[15px] text-[hsl(var(--muted-foreground))]">
          Drag the photo to move it. Use the slider to zoom.
        </DialogDescription>

        <div
          role="group"
          tabIndex={0}
          aria-label="Photo frame. Use the arrow keys to move the photo, and plus or minus to zoom."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          className={`relative mx-auto mt-5 select-none overflow-hidden bg-[#E6E3D6] ring-2 ring-[hsl(var(--primary))] ${FOCUS_RING}`}
          style={{
            width: STAGE,
            height: STAGE,
            maxWidth: "100%",
            borderRadius: shape === "round" ? "50%" : "29%",
            cursor: img ? "grab" : "default",
            touchAction: "none",
          }}
        >
          {img && (
            <canvas
              ref={stage}
              aria-hidden="true"
              style={{ position: "absolute", left: 0, top: 0, width: STAGE, height: STAGE, pointerEvents: "none" }}
            />
          )}
          {!img && !failed && (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--primary))]" aria-hidden="true" />
            </div>
          )}
          {failed && !img && (
            <p role="alert" className="absolute inset-0 flex items-center justify-center px-8 text-center text-[15px] font-semibold text-[hsl(var(--destructive))]">
              That image couldn&apos;t be opened. Choose a different photo.
            </p>
          )}
          {img && (
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              <span className="absolute inset-y-0 left-1/3 w-px bg-white/40" />
              <span className="absolute inset-y-0 left-2/3 w-px bg-white/40" />
              <span className="absolute inset-x-0 top-1/3 h-px bg-white/40" />
              <span className="absolute inset-x-0 top-2/3 h-px bg-white/40" />
            </div>
          )}
        </div>

        <div className="mx-auto mt-5 flex w-full items-center gap-3" style={{ maxWidth: STAGE }}>
          <button
            type="button"
            onClick={() => zoomTo(zoom - 0.25)}
            disabled={disabled || zoom <= 1}
            aria-label="Zoom out"
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-40 ${FOCUS_RING}`}
          >
            <ZoomOut size={20} aria-hidden="true" />
          </button>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            disabled={disabled}
            onChange={(e) => zoomTo(parseFloat(e.target.value))}
            aria-label="Zoom"
            className="h-2 min-w-0 flex-1 cursor-pointer accent-[hsl(var(--primary))] disabled:opacity-40"
          />
          <button
            type="button"
            onClick={() => zoomTo(zoom + 0.25)}
            disabled={disabled || zoom >= MAX_ZOOM}
            aria-label="Zoom in"
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-40 ${FOCUS_RING}`}
          >
            <ZoomIn size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="mt-7 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy || working}
            className={`flex h-12 items-center justify-center rounded-full border-[1.5px] border-[hsl(var(--primary))] bg-[hsl(var(--card))] px-6 text-[16px] font-bold text-[hsl(var(--primary))] transition hover:bg-[hsl(var(--muted))] disabled:opacity-40 ${FOCUS_RING}`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDone}
            disabled={disabled}
            className={`flex h-12 items-center justify-center gap-2 rounded-full border-[1.5px] border-transparent bg-[hsl(var(--primary))] px-6 text-[16px] font-bold text-[hsl(var(--primary-foreground))] shadow-[0_6px_16px_rgb(5_31_66/.26)] transition hover:opacity-90 disabled:bg-[#E6E3D6] disabled:text-[hsl(var(--muted-foreground))] disabled:shadow-none ${FOCUS_RING}`}
          >
            {working || busy ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Saving…</> : "Use photo"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
