function isGb18030TwoByte(code) {
  if (code >= 0x4e00 && code <= 0x9fa5) return true;
  if (code >= 0xe000 && code <= 0xe864) return true;
  if (code >= 0xf900 && code <= 0xfa2d) return true;
  if (code >= 0x3000 && code <= 0x303f) return true;
  if (code >= 0x3040 && code <= 0x312f) return true;
  if (code >= 0xff01 && code <= 0xff5e) return true;
  if (code >= 0xffe0 && code <= 0xffe5) return true;
  if (code >= 0x0400 && code <= 0x045f) return true;
  if (code >= 0x0391 && code <= 0x03c9) return true;
  if (code >= 0x2500 && code <= 0x2595) return true;
  if (code >= 0x2160 && code <= 0x216b) return true;
  if (code >= 0x2460 && code <= 0x249b) return true;
  if (code >= 0x2200 && code <= 0x223d) return true;
  if (code >= 0x2010 && code <= 0x203b) return true;
  if (code === 0x00a4 || code === 0x00a7 || code === 0x00a8 || code === 0x00b0 ||
      code === 0x00b1 || code === 0x00b7 || code === 0x00d7 || code === 0x00f7 ||
      (code >= 0x00e0 && code <= 0x00e1) || (code >= 0x00e8 && code <= 0x00ea) ||
      (code >= 0x00ec && code <= 0x00ed) || (code >= 0x00f2 && code <= 0x00f3) ||
      (code >= 0x00f9 && code <= 0x00fa) || code === 0x00fc) {
    return true;
  }
  return false;
}

function getGb18030Length(str) {
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0x7f) {
      count += 1;
    } else if (code === 0x20ac) {
      count += 1;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length && str.charCodeAt(i + 1) >= 0xdc00 && str.charCodeAt(i + 1) <= 0xdfff) {
      count += 4;
      i++;
    } else if (isGb18030TwoByte(code)) {
      count += 2;
    } else {
      count += 4;
    }
  }
  return count;
}

console.log('Length of U+0080 in GB18030:', getGb18030Length('\u0080')); // MUST BE 4!
console.log('Length of Chinese char in GB18030:', getGb18030Length('\u4E2D')); // MUST BE 2!
console.log('Length of Euro in GB18030:', getGb18030Length('\u20AC')); // MUST BE 1!
console.log('Length of surrogate in GB18030:', getGb18030Length('\uD840\uDC00')); // MUST BE 4!
