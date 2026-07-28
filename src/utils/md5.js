/**
 * 精简 MD5（UTF-8 文本 → 小写 hex），供本地 Hash 工具使用
 * @param {string} input
 * @returns {string}
 */
export function md5Hex(input) {
  const msg = unescape(encodeURIComponent(String(input ?? "")));
  const n = msg.length;
  const words = [];
  for (let i = 0; i < n; i += 1) {
    words[i >> 2] |= msg.charCodeAt(i) << ((i % 4) * 8);
  }
  words[n >> 2] |= 0x80 << ((n % 4) * 8);
  words[(((n + 8) >> 6) << 4) + 14] = n * 8;

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = new Array(64);
  for (let i = 0; i < 64; i += 1) {
    K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296) >>> 0;
  }

  function rotl(x, c) {
    return (x << c) | (x >>> (32 - c));
  }

  for (let i = 0; i < words.length; i += 16) {
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let j = 0; j < 64; j += 1) {
      let f;
      let g;
      if (j < 16) {
        f = (b & c) | (~b & d);
        g = j;
      } else if (j < 32) {
        f = (d & b) | (~d & c);
        g = (5 * j + 1) % 16;
      } else if (j < 48) {
        f = b ^ c ^ d;
        g = (3 * j + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * j) % 16;
      }
      const tmp = d;
      d = c;
      c = b;
      const x = (words[i + g] || 0) >>> 0;
      b = (b + rotl((a + f + K[j] + x) >>> 0, S[j])) >>> 0;
      a = tmp;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  function hex(n) {
    let s = "";
    for (let i = 0; i < 4; i += 1) {
      s += ((n >> (i * 8)) & 0xff).toString(16).padStart(2, "0");
    }
    return s;
  }
  return hex(a0) + hex(b0) + hex(c0) + hex(d0);
}
