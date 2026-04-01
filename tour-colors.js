const GUIDE_BASE_COLORS = {
  "guide-color-1": "#2fa14f",
  "guide-color-2": "#1f4f8f",
  "guide-color-3": "#c04a8b",
  "guide-color-4": "#6f42b5",
  "guide-color-5": "#7a4a21",
};

function normalizeHex(hex) {
  const clean = String(hex || "").trim().replace(/^#/, "");
  if (clean.length !== 6 || /[^a-fA-F0-9]/.test(clean)) return null;
  return `#${clean.toLowerCase()}`;
}

function hexToRgb(hex) {
  const value = normalizeHex(hex);
  if (!value) return null;
  return {
    r: parseInt(value.slice(1, 3), 16),
    g: parseInt(value.slice(3, 5), 16),
    b: parseInt(value.slice(5, 7), 16),
  };
}

function toHexComponent(value) {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}

function rgbToHex(rgb) {
  if (!rgb) return "#000000";
  return `#${toHexComponent(rgb.r)}${toHexComponent(rgb.g)}${toHexComponent(rgb.b)}`;
}

function mixHex(hexA, hexB, ratio) {
  const left = hexToRgb(hexA);
  const right = hexToRgb(hexB);
  if (!left || !right) return normalizeHex(hexA) || "#000000";
  const t = Math.max(0, Math.min(1, Number(ratio) || 0));
  return rgbToHex({
    r: left.r + (right.r - left.r) * t,
    g: left.g + (right.g - left.g) * t,
    b: left.b + (right.b - left.b) * t,
  });
}

function toneFromTourType(tourTypeName) {
  const normalized = String(tourTypeName || "").trim().toLowerCase();
  if (!normalized) return "base";
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash * 31) + normalized.charCodeAt(index)) >>> 0;
  }
  const tones = ["light", "base", "dark"];
  return tones[hash % tones.length];
}

function contrastTextForHex(backgroundHex) {
  const rgb = hexToRgb(backgroundHex);
  if (!rgb) return "#ffffff";
  const yiq = ((rgb.r * 299) + (rgb.g * 587) + (rgb.b * 114)) / 1000;
  return yiq >= 150 ? "#1a1a1a" : "#ffffff";
}

export function getAcceptedTourStyle({ guideColorClass, tourTypeName, isPast = false } = {}) {
  const safeGuideClass = GUIDE_BASE_COLORS[guideColorClass] ? guideColorClass : "guide-color-1";
  const tone = toneFromTourType(tourTypeName);

  const baseBackground = GUIDE_BASE_COLORS[safeGuideClass] || GUIDE_BASE_COLORS["guide-color-1"];
  let background = baseBackground;
  if (tone === "light") background = mixHex(baseBackground, "#ffffff", 0.52);
  if (tone === "dark") background = mixHex(baseBackground, "#000000", 0.5);

  return {
    backgroundColor: background,
    borderColor: mixHex(background, "#000000", 0.4),
    color: contrastTextForHex(background),
  };
}

export function applyAcceptedTourStyle(element, options) {
  if (!element) return;
  const style = getAcceptedTourStyle(options);
  element.style.backgroundColor = style.backgroundColor;
  element.style.borderColor = style.borderColor;
  element.style.color = style.color;
}
