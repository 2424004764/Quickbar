/**
 * 颜色互转：HEX / RGB / HSL
 */

/**
 * @param {number} n
 * @param {number} min
 * @param {number} max
 */
function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/**
 * @param {number} r 0-255
 * @param {number} g 0-255
 * @param {number} b 0-255
 * @returns {{ h: number, s: number, l: number }}
 */
export function rgbToHsl(r, g, b) {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l: Math.round(l * 1000) / 10 };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rr) {
    h = (gg - bb) / d + (gg < bb ? 6 : 0);
  } else if (max === gg) {
    h = (bb - rr) / d + 2;
  } else {
    h = (rr - gg) / d + 4;
  }
  h /= 6;
  return {
    h: Math.round(h * 3600) / 10,
    s: Math.round(s * 1000) / 10,
    l: Math.round(l * 1000) / 10,
  };
}

/**
 * @param {number} h 0-360
 * @param {number} s 0-100
 * @param {number} l 0-100
 * @returns {{ r: number, g: number, b: number }}
 */
export function hslToRgb(h, s, l) {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 100) / 100;
  const ll = clamp(l, 0, 100) / 100;
  if (ss === 0) {
    const v = Math.round(ll * 255);
    return { r: v, g: v, b: v };
  }
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const hk = hh / 360;
  const hue2rgb = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return {
    r: Math.round(hue2rgb(hk + 1 / 3) * 255),
    g: Math.round(hue2rgb(hk) * 255),
    b: Math.round(hue2rgb(hk - 1 / 3) * 255),
  };
}

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string}
 */
export function rgbToHex(r, g, b) {
  const h = [r, g, b]
    .map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0"))
    .join("");
  return `#${h}`;
}

/**
 * @param {string} input
 * @returns {{ ok: true, hex: string, r: number, g: number, b: number, h: number, s: number, l: number, rgb: string, hsl: string }
 *   | { ok: false, error: string }}
 */
export function parseColor(input) {
  const raw = String(input ?? "").trim();
  if (!raw) {
    return { ok: false, error: "请输入颜色值" };
  }

  let r;
  let g;
  let b;

  const hexMatch = raw.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    let h = hexMatch[1];
    if (h.length === 3) {
      h = h.split("").map((c) => c + c).join("");
    }
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  } else {
    const rgbMatch = raw.match(
      /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*[0-9.]+\s*)?\)$/i,
    );
    const hslMatch = raw.match(
      /^hsla?\(\s*([0-9.]+)\s*,\s*([0-9.]+)%\s*,\s*([0-9.]+)%(?:\s*,\s*[0-9.]+\s*)?\)$/i,
    );
    if (rgbMatch) {
      r = clamp(Math.round(Number(rgbMatch[1])), 0, 255);
      g = clamp(Math.round(Number(rgbMatch[2])), 0, 255);
      b = clamp(Math.round(Number(rgbMatch[3])), 0, 255);
    } else if (hslMatch) {
      const rgb = hslToRgb(
        Number(hslMatch[1]),
        Number(hslMatch[2]),
        Number(hslMatch[3]),
      );
      r = rgb.r;
      g = rgb.g;
      b = rgb.b;
    } else {
      return {
        ok: false,
        error: "支持 #RGB / #RRGGBB、rgb()、hsl()",
      };
    }
  }

  const hsl = rgbToHsl(r, g, b);
  const hex = rgbToHex(r, g, b);
  return {
    ok: true,
    hex,
    r,
    g,
    b,
    h: hsl.h,
    s: hsl.s,
    l: hsl.l,
    rgb: `rgb(${r}, ${g}, ${b})`,
    hsl: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
  };
}
