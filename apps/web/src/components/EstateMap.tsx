'use client';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import type { Locale } from '@/lib/i18n';

export interface MapProp { id: string; title: string; price: number; purpose: string; lat?: string; lng?: string }
export const validCoord = (lat?: string, lng?: string) => { const a = Number(lat), b = Number(lng); return !!lat && !!lng && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180; };

/** Interactive map (Leaflet + OpenStreetMap tiles) of the listings that have real coordinates. Listings without coordinates are never plotted, only counted by the caller. */
export function EstateMap({ rows, href, money, locale }: { rows: MapProp[]; href: (id: string) => string; money: (n: number) => string; locale: Locale }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const plotted = rows.filter((r) => validCoord(r.lat, r.lng)); if (!el.current) return; let map: import('leaflet').Map | undefined; let dead = false;
    void import('leaflet').then((L) => {
      if (dead || !el.current) return; map = L.map(el.current, { scrollWheelZoom: false }).setView([26.8, 30.8], 5); // Egypt overview until we fit the markers
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
      const pts: [number, number][] = [];
      for (const r of plotted) {
        const ll: [number, number] = [Number(r.lat), Number(r.lng)]; pts.push(ll);
        const m = L.marker(ll, { icon: L.divIcon({ className: 'est-pin', html: '<span></span>', iconSize: [22, 22], iconAnchor: [11, 22] }), title: r.title, alt: r.title, keyboard: true }).addTo(map);
        const box = document.createElement('div'); const a = document.createElement('a'); a.href = href(r.id); a.textContent = r.title; a.style.fontWeight = '700'; // built with DOM APIs: titles are owner text and must never be parsed as HTML
        const p = document.createElement('div'); p.textContent = `${r.purpose === 'rent' ? (locale === 'ar' ? 'إيجار' : 'Rent') : (locale === 'ar' ? 'بيع' : 'Sale')} · ${money(r.price)}`; box.append(a, p); m.bindPopup(box);
      }
      if (pts.length === 1) map.setView(pts[0], 14); else if (pts.length > 1) map.fitBounds(pts, { padding: [30, 30] });
    });
    return () => { dead = true; map?.remove(); };
  }, [rows, href, money, locale]);
  return <div ref={el} role="region" aria-label={locale === 'ar' ? 'خريطة العقارات' : 'Properties map'} data-testid="estate-map" style={{ height: 420, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }} />;
}
