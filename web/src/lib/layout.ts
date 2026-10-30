/** Height in px of the fixed header + tab bar (published by Layout as the CSS variable --header-h). */
export function headerHeight(): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h"));
  return Number.isFinite(v) ? v : 96;
}
