// Inline Lucide-style icons (MIT). No CDN · kept local for offline + zero render-block.
const P: Record<string, string> = {
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pencil: '<path d="M21.17 6.81a1 1 0 0 0-3.98-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  radar: '<path d="M19.07 4.93A10 10 0 0 0 6.99 3.34"/><path d="M4 6h.01"/><path d="M2.29 9.62A10 10 0 1 0 21.31 8.35"/><path d="M16.24 7.76A6 6 0 1 0 8.23 16.67"/><path d="M12 18h.01"/><circle cx="12" cy="12" r="2"/><path d="m13.41 10.59 5.66-5.66"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  send: '<path d="M14.54 21.69a.5.5 0 0 0 .93-.02l6.5-19a.5.5 0 0 0-.63-.64l-19 6.5a.5.5 0 0 0-.02.94l7.93 3.18a2 2 0 0 1 1.11 1.11z"/><path d="m21.85 2.15-10.94 10.94"/>',
  cCheck: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  cX: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
  tri: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  cPause: '<circle cx="12" cy="12" r="10"/><line x1="10" x2="10" y1="9" y2="15"/><line x1="14" x2="14" y1="9" y2="15"/>',
  oct: '<path d="M7.86 2h8.28L22 7.86v8.28L16.14 22H7.86L2 16.14V7.86z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  dashed: '<path d="M10.1 2.18a10 10 0 0 1 3.8 0"/><path d="M13.9 21.82a10 10 0 0 1-3.8 0"/><path d="M20.02 17.85a10 10 0 0 1-2.7 2.7"/><path d="M2.18 13.9a10 10 0 0 1 0-3.8"/><path d="M21.82 10.1a10 10 0 0 1 0 3.8"/><path d="M3.98 6.15a10 10 0 0 1 2.7-2.7"/><path d="M6.15 20.02a10 10 0 0 1-2.7-2.7"/><path d="M17.85 3.98a10 10 0 0 1 2.7 2.7"/>',
  dash: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  siren: '<path d="M7 18v-6a5 5 0 1 1 10 0v6"/><path d="M5 21a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1z"/><path d="M21 12h1M18.5 4.5 18 5M3 12H2"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9"/>',
  bell: '<path d="M10.27 21a2 2 0 0 0 3.46 0"/><path d="M3.26 15.33A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.67C19.41 13.96 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.41 5.96-2.74 7.33"/>',
  bellOff: '<path d="M10.27 21a2 2 0 0 0 3.46 0"/><path d="M17 17H4a1 1 0 0 1-.74-1.67C4.59 13.96 6 12.5 6 8a6 6 0 0 1 .26-1.74"/><path d="m2 2 20 20"/><path d="M8.67 3.01A6 6 0 0 1 18 8c0 2.69.77 4.65 1.71 6.05"/>',
  cloud: '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
};

export type IconName = keyof typeof P;

export function Icon({ n, s = 15, cls, style }: { n: IconName; s?: number; cls?: string; style?: React.CSSProperties }) {
  return (
    <svg
      className={`ico${cls ? ' ' + cls : ''}`}
      width={s}
      height={s}
      viewBox="0 0 24 24"
      style={style}
      dangerouslySetInnerHTML={{ __html: P[n] }}
    />
  );
}
