const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Opens a small print window (thermal-printer friendly, 80 mm) with already-escaped HTML lines and prints it. */
export function printSlip(title: string, rows: { left: string; right?: string; bold?: boolean }[], dir: 'rtl' | 'ltr' = 'rtl') {
  const w = window.open('', '_blank', 'width=360,height=640'); if (!w) return false;
  const body = rows.map((r) => `<div class="r${r.bold ? ' b' : ''}"><span>${esc(r.left)}</span><span>${esc(r.right ?? '')}</span></div>`).join('');
  w.document.write(`<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page{size:80mm auto;margin:4mm}body{font:13px/1.5 system-ui,Arial,sans-serif;width:72mm;margin:0}h1{font-size:15px;text-align:center;margin:0 0 6px}.r{display:flex;justify-content:space-between;gap:8px;border-bottom:1px dashed #999;padding:2px 0}.b{font-weight:700}</style></head><body><h1>${esc(title)}</h1>${body}<script>window.onload=function(){window.print();setTimeout(function(){window.close()},300)}</script></body></html>`);
  w.document.close(); return true;
}
