// Selected icons from lucide-static 1.47.0. ISC / MIT notices are embedded in the rendered document.
const paths: Record<string, string> = {
  bird: '<path d="M16 7h.01" />\n  <path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20" />\n  <path d="m20 7 2 .5-2 .5" />\n  <path d="M10 18v3" />\n  <path d="M14 17.75V21" />\n  <path d="M7 18a6 6 0 0 0 3.84-10.61" />',
  "layout-dashboard":
    '<rect width="7" height="9" x="3" y="3" rx="1" />\n  <rect width="7" height="5" x="14" y="3" rx="1" />\n  <rect width="7" height="9" x="14" y="12" rx="1" />\n  <rect width="7" height="5" x="3" y="16" rx="1" />',
  "list-checks":
    '<path d="M13 5h8" />\n  <path d="M13 12h8" />\n  <path d="M13 19h8" />\n  <path d="m3 17 2 2 4-4" />\n  <path d="m3 7 2 2 4-4" />',
  "chart-no-axes-combined":
    '<path d="M12 16v5" />\n  <path d="M16 14.639V21" />\n  <path d="M20 10.656V21" />\n  <path d="m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15" />\n  <path d="M4 18.463V21" />\n  <path d="M8 14.656V21" />',
  workflow:
    '<rect width="8" height="8" x="3" y="3" rx="2" />\n  <path d="M7 11v4a2 2 0 0 0 2 2h4" />\n  <rect width="8" height="8" x="13" y="13" rx="2" />',
  "shield-check":
    '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />\n  <path d="m9 12 2 2 4-4" />',
  sparkles:
    '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />\n  <path d="M20 2v4" />\n  <path d="M22 4h-4" />\n  <circle cx="4" cy="20" r="2" />',
  history:
    '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />\n  <path d="M3 3v5h5" />\n  <path d="M12 7v5l4 2" />',
  "refresh-cw":
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />\n  <path d="M21 3v5h-5" />\n  <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />\n  <path d="M8 16H3v5" />',
  "arrow-up-right": '<path d="M7 7h10v10" />\n  <path d="M7 17 17 7" />',
  "arrow-right": '<path d="M5 12h14" />\n  <path d="m12 5 7 7-7 7" />',
  download:
    '<path d="M12 15V3" />\n  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />\n  <path d="m7 10 5 5 5-5" />',
  search: '<path d="m21 21-4.34-4.34" />\n  <circle cx="11" cy="11" r="8" />',
  check: '<path d="M20 6 9 17l-5-5" />',
  "circle-check": '<circle cx="12" cy="12" r="10" />\n  <path d="m16 9-5.5 5.5L8 12" />',
  "triangle-alert":
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />\n  <path d="M12 9v4" />\n  <path d="M12 17h.01" />',
  "loader-circle": '<path d="M21 12a9 9 0 1 1-6.219-8.56" />',
  x: '<path d="M18 6 6 18" />\n  <path d="m6 6 12 12" />',
  "clock-3": '<circle cx="12" cy="12" r="10" />\n  <path d="M12 6v6h4" />',
  activity:
    '<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2" />',
  "circle-dashed":
    '<path d="M10.1 2.182a10 10 0 0 1 3.8 0" />\n  <path d="M13.9 21.818a10 10 0 0 1-3.8 0" />\n  <path d="M17.609 3.721a10 10 0 0 1 2.69 2.7" />\n  <path d="M2.182 13.9a10 10 0 0 1 0-3.8" />\n  <path d="M20.279 17.609a10 10 0 0 1-2.7 2.69" />\n  <path d="M21.818 10.1a10 10 0 0 1 0 3.8" />\n  <path d="M3.721 6.391a10 10 0 0 1 2.7-2.69" />\n  <path d="M6.391 20.279a10 10 0 0 1-2.69-2.7" />',
  terminal: '<path d="M12 19h8" />\n  <path d="m4 17 6-6-6-6" />',
  "folder-open":
    '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />',
  "chevron-down": '<path d="m6 9 6 6 6-6" />',
  power: '<path d="M12 2v10" />\n  <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />',
  "file-json":
    '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />\n  <path d="M14 2v5a1 1 0 0 0 1 1h5" />\n  <path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1" />\n  <path d="M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1" />',
  "file-text":
    '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />\n  <path d="M14 2v5a1 1 0 0 0 1 1h5" />\n  <path d="M10 9H8" />\n  <path d="M16 13H8" />\n  <path d="M16 17H8" />',
  "code-xml": '<path d="m18 16 4-4-4-4" />\n  <path d="m6 8-4 4 4 4" />\n  <path d="m14.5 4-5 16" />',
  target: '<circle cx="12" cy="12" r="10" />\n  <circle cx="12" cy="12" r="6" />\n  <circle cx="12" cy="12" r="2" />',
  "move-up-right": '<path d="M13 5H19V11" />\n  <path d="M19 5L5 19" />',
};
const license =
  'ISC License\n\nCopyright (c) 2026 Lucide Icons and Contributors\n\nPermission to use, copy, modify, and/or distribute this software for any\npurpose with or without fee is hereby granted, provided that the above\ncopyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES\nWITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF\nMERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR\nANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES\nWHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN\nACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF\nOR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.\n\n---\n\nThe following Lucide icons are derived from the Feather project:\n\nairplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out\n\nThe MIT License (MIT) (for the icons listed above)\n\nCopyright (c) 2013-present Cole Bemis\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n';
export function iconMarkup(name: string): string {
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><use href="#canary-icon-${name}"/></svg>`;
}
export function iconSprite(): string {
  return `<!-- ${license.replaceAll("--", "—")} --><svg class="icon-sprite" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><defs>${Object.entries(
    paths,
  )
    .map(([name, body]) => `<symbol id="canary-icon-${name}" viewBox="0 0 24 24">${body}</symbol>`)
    .join("")}</defs></svg>`;
}
export const iconClient = String.raw`
function uiIcon(name){const ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg"),use=document.createElementNS(ns,"use");for(const [k,v] of Object.entries({class:"ui-icon",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":"1.7","stroke-linecap":"round","stroke-linejoin":"round","aria-hidden":"true",focusable:"false"}))svg.setAttribute(k,v);use.setAttribute("href","#canary-icon-"+name);svg.append(use);return svg}
`;
