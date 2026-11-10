const paths: Record<string, string> = {
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  'wall-snap': '<path d="M3 3v18M7 5h14v14H7m10-7H7m4-4-4 4 4 4"/>',
  circulation:
    '<rect x="9" y="8" width="6" height="8"/><path d="M3 12h4m10 0h4M5 9.5 2.5 12 5 14.5M19 9.5 21.5 12 19 14.5"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  house: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/><path d="M9 21v-8h6v8"/>',
  cube: '<path d="m12 3 9 5v8l-9 5-9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v8M7.5 5.5l9 5"/>',
  plan: '<path d="M3 3h18v18H3Z"/><path d="M3 10h7V3m0 7v11m0-6h11"/>',
  headset:
    '<path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-4l-3-3-3 3H5a2 2 0 0 1-2-2Z"/><circle cx="8" cy="11" r="1.5"/><circle cx="16" cy="11" r="1.5"/>',
  walk: '<circle cx="14" cy="4" r="2"/><path d="m7 21 3-6-1-5 4-3 3 5 4 1M10 15l6 6m-7-11-4 3"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  import: '<path d="M12 16V3m-5 5 5-5 5 5M4 14v6h16v-6"/>',
  export: '<path d="M12 3v13m-5-5 5 5 5-5M4 14v6h16v-6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  bulb: '<path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1.5 1.2-1 3-1 4H9c0-1 .5-2.8-1-4Z"/>',
  roof: '<path d="m3 12 9-8 9 8M5 10v9h14v-9M9 15h6"/>',
  ruler: '<path d="m3 16 13-13 5 5L8 21Z"/><path d="m7 12 3 3m1-7 3 3m1-7 3 3"/>',
  label: '<path d="M20 13 11 22l-9-9V2h11l9 9Z"/><circle cx="7" cy="7" r="1"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3v1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  door: '<path d="M4 21h16M6 21V3h12v18M6 3l9 3v15M11 12v1"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  layers: '<path d="m12 3 10 6-10 6L2 9Zm-9 11 9 5 9-5M3 18l9 5 9-5"/>',
  mouse: '<rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 2v7"/>',
  'mouse-left':
    '<path d="M12 2a6 6 0 0 0-6 6v2h6Z" fill="currentColor" fill-opacity=".45" stroke="none"/><rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 2v8H6m6 0h6"/>',
  'mouse-right':
    '<path d="M12 2a6 6 0 0 1 6 6v2h-6Z" fill="currentColor" fill-opacity=".45" stroke="none"/><rect x="6" y="2" width="12" height="20" rx="6"/><path d="M12 2v8H6m6 0h6"/>',
  'mouse-wheel':
    '<rect x="6" y="2" width="12" height="20" rx="6"/><rect x="11" y="4" width="2" height="6" rx="1" fill="currentColor"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-3 5-5 3 3-5Z"/>',
  edit: '<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
};
export function icon(name: string, size = 20) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.cube}</svg>`;
}
