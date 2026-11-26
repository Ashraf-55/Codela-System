'use client';
import { useEffect, useRef, useState } from 'react';

const RATIOS: [string, number][] = [['1:1', 1], ['4:3', 4 / 3], ['16:9', 16 / 9], ['3:4', 3 / 4], ['1.91:1', 1.91]];
/** Real crop dialog: pick the ratio, zoom and pan (drag, sliders or arrow keys), see the exact result, then save a NEW cropped image file that the caller uploads. */
export function ImageCrop({ file, aspect = 1, locale, onCancel, onDone }: { file: File; aspect?: number; locale: 'ar' | 'en'; onCancel: () => void; onDone: (cropped: File) => void }) {
  const t = (ar: string, en: string) => (locale === 'ar' ? ar : en);
  const [img, setImg] = useState<HTMLImageElement | null>(null); const [ratio, setRatio] = useState(aspect); const [zoom, setZoom] = useState(1); const [px, setPx] = useState(0); const [py, setPy] = useState(0);
  const [err, setErr] = useState(''); const canvas = useRef<HTMLCanvasElement>(null); const dlg = useRef<HTMLDivElement>(null); const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  useEffect(() => { const url = URL.createObjectURL(file); const i = new Image(); i.onload = () => setImg(i); i.onerror = () => setErr(t('تعذّر قراءة الصورة', 'Could not read this image')); i.src = url; return () => URL.revokeObjectURL(url); }, [file]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const prev = document.activeElement as HTMLElement | null; dlg.current?.querySelector<HTMLElement>('input,button')?.focus(); return () => prev?.focus(); }, []);
  /** Source rectangle for the current ratio / zoom / pan, in source pixels. px,py are -1..1 (0 = centred). */
  const rect = (i: HTMLImageElement) => { const fit = Math.min(i.naturalWidth / ratio, i.naturalHeight); const sh = fit / zoom; const sw = sh * ratio; return { sw, sh, sx: (i.naturalWidth - sw) / 2 * (1 + px), sy: (i.naturalHeight - sh) / 2 * (1 + py) }; };
  const paint = (c: HTMLCanvasElement, i: HTMLImageElement, w: number) => { const r = rect(i); c.width = Math.round(w); c.height = Math.round(w / ratio); const g = c.getContext('2d')!; g.imageSmoothingQuality = 'high'; g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(i, r.sx, r.sy, r.sw, r.sh, 0, 0, c.width, c.height); };
  useEffect(() => { if (img && canvas.current) paint(canvas.current, img, 360); }, [img, ratio, zoom, px, py]); // eslint-disable-line react-hooks/exhaustive-deps
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  function save() {
    if (!img) return; const c = document.createElement('canvas'); const r = rect(img); paint(c, img, Math.min(1400, Math.max(200, Math.round(r.sw))));
    const png = file.type === 'image/png'; c.toBlob((b) => { if (!b) return setErr(t('تعذّر حفظ الصورة', 'Could not save the image')); onDone(new File([b], `cropped-${file.name.replace(/\.[^.]+$/, '')}.${png ? 'png' : 'jpg'}`, { type: png ? 'image/png' : 'image/jpeg' })); }, png ? 'image/png' : 'image/jpeg', 0.9);
  }
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="crop-title" ref={dlg} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'grid', placeItems: 'center', zIndex: 80, padding: 12 }}>
      <div className="card stack" style={{ maxWidth: 440, width: '100%', maxHeight: '95dvh', overflow: 'auto' }}>
        <h3 id="crop-title" style={{ margin: 0 }}>{t('قصّ الصورة', 'Crop image')}</h3>
        {err && <div className="alert error" role="alert">{err}</div>}
        <div style={{ display: 'grid', placeItems: 'center', background: 'var(--surface-2)', borderRadius: 10, padding: 8 }}>
          <canvas ref={canvas} aria-label={t('معاينة الصورة بعد القص', 'Preview of the cropped image')} data-testid="crop-preview" style={{ maxWidth: '100%', height: 'auto', touchAction: 'none', cursor: 'grab', borderRadius: 6 }}
            onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, px, py }; }}
            onPointerMove={(e) => { const d = drag.current; if (!d || !img) return; const r = rect(img); const cw = (e.target as HTMLElement).getBoundingClientRect().width; const spanX = (img.naturalWidth - r.sw) / 2, spanY = (img.naturalHeight - r.sh) / 2; // canvas px -> source px -> pan units
              if (spanX > 0) setPx(clamp(d.px - ((e.clientX - d.x) * (r.sw / cw)) / spanX)); if (spanY > 0) setPy(clamp(d.py - ((e.clientY - d.y) * (r.sw / cw)) / spanY)); }}
            onPointerUp={() => { drag.current = null; }} />
        </div>
        <label className="field">{t('نسبة الأبعاد', 'Aspect ratio')}<select value={ratio} onChange={(e) => setRatio(Number(e.target.value))}>{RATIOS.map(([n, v]) => <option key={n} value={v}>{n}</option>)}</select></label>
        <label className="field">{t('تكبير', 'Zoom')}<input type="range" min={1} max={4} step={0.05} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /></label>
        <label className="field">{t('تحريك أفقي', 'Pan horizontally')}<input type="range" min={-1} max={1} step={0.02} value={px} onChange={(e) => setPx(Number(e.target.value))} /></label>
        <label className="field">{t('تحريك رأسي', 'Pan vertically')}<input type="range" min={-1} max={1} step={0.02} value={py} onChange={(e) => setPy(Number(e.target.value))} /></label>
        <div className="row"><button className="btn primary" onClick={save} disabled={!img}>{t('حفظ الصورة المقصوصة', 'Save cropped image')}</button><button className="btn" onClick={onCancel}>{t('إلغاء', 'Cancel')}</button></div>
      </div>
    </div>
  );
}
