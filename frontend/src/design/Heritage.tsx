import type { ReactNode } from 'react';
import type { Poi } from '../features/poi/types';
import type { ContentLanguage } from '../features/poi/api';
import { apiMediaUrl } from '../services/apiConfig';

export type HeritageLanguage = 'vi' | 'en' | 'zh';
export function getUrlLanguage(): string {
  const lang = new URLSearchParams(window.location.search).get('lang');
  if (lang && /^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,6})?$/.test(lang)) return lang;
  try { return window.localStorage.getItem('gth-language') || 'vi'; } catch { return 'vi'; }
}

export function interfaceLanguage(lang: string): HeritageLanguage {
  return lang === 'en' || lang === 'zh' ? lang : 'vi';
}

export function saveLanguage(lang: string) {
  try { window.localStorage.setItem('gth-language', lang); } catch { /* storage unavailable */ }
  const url = new URL(window.location.href);
  url.searchParams.set('lang', lang);
  window.history.replaceState(null, '', url);
}

const paths = {
  mark: 'M2 19h20M4 15l5-7 4 5 3-3 4 5M5 19v-3m14 3v-3M17 5h.01',
  qr: 'M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3zM15 15h3v3h3v3h-6zM12 5v4m0 3h4m4 0h1m-9 5v4',
  route: 'M6 7v8a4 4 0 0 0 4 4h6m2-2V9a4 4 0 0 0-4-4h-2M8 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM20 19a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  pin: 'M19 10c0 5-7 10-7 10S5 15 5 10a7 7 0 1 1 14 0zM14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z',
  play: 'M9 5l11 7-11 7z',
  stop: 'M7 7h10v10H7z',
  pause: 'M9 5v14m6-14v14',
  wave: 'M2 10v4m4-7v10m4-14v18m4-15v12m4-10v8m4-6v4',
  search: 'M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0ZM16 16l4 4',
  camera: 'M3 7h4l2-3h6l2 3h4v13H3zM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  map: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15',
  arrow: 'M4 12h15m-6-6 6 6-6 6',
  back: 'M20 12H5m6-6-6 6 6 6',
  add: 'M12 5v14M5 12h14',
  check: 'm5 12 4 4L19 6',
  gps: 'M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-5 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM12 2v3m0 14v3M2 12h3m14 0h3',
  chart: 'M4 4v16h16M8 15l4-4 3 2 5-6',
  grid: 'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z',
  users: 'M12 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM3 20v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2m1-15a3 3 0 1 1 0 6m1 3a4 4 0 0 1 4 4v2',
  shield: 'M12 3l8 3v5c0 6-4 8-8 10-4-2-8-4-8-10V6zM9 12l2 2 4-4',
};
export type IconName = keyof typeof paths;

export function Icon({ name }: { name: IconName }) {
  return <svg className="heritage-icon" aria-hidden="true" viewBox="0 0 24 24" fill={name === 'play' || name === 'stop' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}

export function Brand() {
  return <a className="heritage-brand" href="/"><span className="heritage-mark"><Icon name="mark" /></span>Go to Horizon</a>;
}

export function LanguageSelect({ value, onChange, languages }: { value: string; onChange: (value: string) => void; languages: ContentLanguage[] }) {
  const labels = { vi: 'Ngôn ngữ', en: 'Language', zh: '语言' };
  return <select className="heritage-language" value={value} aria-label={labels[interfaceLanguage(value)]} disabled={!languages.length} onChange={(event) => onChange(event.currentTarget.value)}>
    {!languages.some(({ code }) => code === value) && <option value={value}>{value.toUpperCase()}</option>}
    {languages.map(({ code, name }) => <option key={code} value={code} lang={code}>{code.toUpperCase()} · {name}</option>)}
  </select>;
}

export function PoiPhoto({ poi, eager = false }: { poi: Poi; eager?: boolean }) {
  const source = poi.images[0] ? apiMediaUrl(poi.images[0]) : null;
  if (!source) return <div className="heritage-photo-placeholder" aria-hidden="true"><Icon name="mark" /></div>;
  return <img className="heritage-photo" src={source} alt={poi.content.name} loading={eager ? 'eager' : 'lazy'} decoding="async" />;
}

export function AudioControl({ title, subtitle, playing, onPress }: { title: string; subtitle: string; playing: boolean; onPress: () => void }) {
  return <button className="heritage-audio" type="button" onClick={onPress}>
    <span className="heritage-play"><Icon name={playing ? 'pause' : 'play'} /></span>
    <span><strong>{title}</strong><small>{subtitle}</small></span><Icon name="wave" />
  </button>;
}

export function HeritageHeader({ children }: { children?: ReactNode }) {
  return <header className="heritage-top"><div className="heritage-top-inner"><Brand />{children}</div></header>;
}
