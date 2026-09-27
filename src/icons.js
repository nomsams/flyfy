// Small inline SVG icons (stroke = currentColor), so the page needs no image files or icon fonts.
const svg = (body, vb = 24) => `<svg viewBox="0 0 ${vb} ${vb}" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  stripes: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 3v18M12 3v18M16 3v18"/>'),
  faint: svg('<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 3v18M12 3v18M16 3v18" stroke-dasharray="1.5 2.5"/>'),
  spot: svg('<rect x="3" y="3" width="18" height="18" rx="3" stroke-dasharray="2 2"/><rect x="13" y="6" width="6" height="6" rx="1"/><path d="M15 6v6M17 6v6"/>'),
  face: svg('<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="0.8" fill="currentColor"/><circle cx="15" cy="10" r="0.8" fill="currentColor"/><path d="M8.5 15c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M18 5l2-2M20 7h2"/>'),
  target: svg('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>'),
  edges: svg('<path d="M4 20L12 4l8 16z"/><path d="M8 20l4-8 4 8" opacity=".5"/>'),
  drop: svg('<path d="M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z"/><path d="M9.5 14.5a2.5 2.5 0 002.5 2.5"/>'),
  layers: svg('<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17.5l9 5 9-5" opacity=".5"/>'),
  dial: svg('<circle cx="12" cy="12" r="9"/><path d="M12 12l4-4"/><path d="M12 3v2M21 12h-2M12 21v-2M3 12h2"/>'),
  wires: svg('<circle cx="5" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 6c5 0 6 6 10 6M7 18c4 0 6-3 8-5" /><path d="M7 18c5 0 6-6 10-6" stroke-dasharray="2 2" opacity=".6"/>'),
  play: svg('<path d="M7 4l13 8-13 8z" fill="currentColor"/>'),
  pause: svg('<path d="M7 4h3v16H7zM14 4h3v16h-3z" fill="currentColor"/>'),
  bolt: svg('<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>'),
  dna: svg('<path d="M7 3c0 6 10 6 10 12s-10 6-10 6M17 3c0 6-10 6-10 12"/><path d="M8 7h8M8 17h8M9.5 12h5"/>'),
  exam: svg('<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>'),
  save: svg('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7V3M8 21v-7h8v7"/>'),
  open: svg('<path d="M3 7h6l2 2h10v10H3z"/>'),
  reset: svg('<path d="M4 4v6h6"/><path d="M4.5 15a8 8 0 102-8.5L4 10"/>'),
  scales: svg('<path d="M12 3v18M7 21h10M4 7h16"/><path d="M4 7l-2.5 6a3 3 0 005 0zM20 7l-2.5 6a3 3 0 005 0z"/>'),
  brain: svg('<path d="M9 4a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 002 5 3 3 0 003 3h1V4zM15 4a3 3 0 013 3 3 3 0 012 5 3 3 0 01-2 5 3 3 0 01-3 3h-1V4z"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
  fly: svg('<ellipse cx="12" cy="14" rx="3" ry="5"/><circle cx="12" cy="7.5" r="2"/><path d="M9.5 12C6 9 3 9.5 3 11.5S6.5 14 9.5 13M14.5 12c3.5-3 6.5-2.5 6.5-.5S17.5 14 14.5 13"/><path d="M9.5 17l-3 3M14.5 17l3 3"/>'),
};
