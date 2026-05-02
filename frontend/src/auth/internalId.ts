/**
 * Mirrors Java UUID.nameUUIDFromBytes(nameUtf8Bytes) for Telegram users.
 */
export function telegramInternalId(telegramId: number | string): string {
  if (telegramId === null || telegramId === undefined || `${telegramId}`.trim() === '') {
    throw new Error('telegramId cannot be empty');
  }

  const name = `burnedchats:telegram:${telegramId}`;
  const nameBytes = new TextEncoder().encode(name);
  const hash = md5(nameBytes);

  // UUID v3 (name-based MD5), RFC 4122 variant bits.
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;

  return toUuidString(hash);
}

function toUuidString(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Minimal MD5 implementation for deterministic UUID generation.
function md5(input: Uint8Array): Uint8Array {
  const state = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);

  const padded = pad(input);
  for (let offset = 0; offset < padded.length; offset += 64) {
    const block = new Uint32Array(16);
    for (let i = 0; i < 16; i += 1) {
      const base = offset + i * 4;
      block[i] =
        padded[base] |
        (padded[base + 1] << 8) |
        (padded[base + 2] << 16) |
        (padded[base + 3] << 24);
    }
    transform(state, block);
  }

  const out = new Uint8Array(16);
  for (let i = 0; i < 4; i += 1) {
    out[i * 4] = state[i] & 0xff;
    out[i * 4 + 1] = (state[i] >>> 8) & 0xff;
    out[i * 4 + 2] = (state[i] >>> 16) & 0xff;
    out[i * 4 + 3] = (state[i] >>> 24) & 0xff;
  }
  return out;
}

function pad(input: Uint8Array): Uint8Array {
  const bitLength = input.length * 8;
  const withOne = input.length + 1;
  const mod64 = withOne % 64;
  const zeroPadLength = mod64 <= 56 ? 56 - mod64 : 56 + (64 - mod64);
  const totalLength = withOne + zeroPadLength + 8;

  const result = new Uint8Array(totalLength);
  result.set(input, 0);
  result[input.length] = 0x80;

  const bitLengthLow = bitLength >>> 0;
  const bitLengthHigh = Math.floor(bitLength / 0x100000000) >>> 0;

  result[totalLength - 8] = bitLengthLow & 0xff;
  result[totalLength - 7] = (bitLengthLow >>> 8) & 0xff;
  result[totalLength - 6] = (bitLengthLow >>> 16) & 0xff;
  result[totalLength - 5] = (bitLengthLow >>> 24) & 0xff;
  result[totalLength - 4] = bitLengthHigh & 0xff;
  result[totalLength - 3] = (bitLengthHigh >>> 8) & 0xff;
  result[totalLength - 2] = (bitLengthHigh >>> 16) & 0xff;
  result[totalLength - 1] = (bitLengthHigh >>> 24) & 0xff;

  return result;
}

function leftRotate(value: number, shift: number): number {
  return (value << shift) | (value >>> (32 - shift));
}

function transform(state: Uint32Array, chunk: Uint32Array): void {
  let [a, b, c, d] = state;

  const s = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  const k = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ];

  for (let i = 0; i < 64; i += 1) {
    let f: number;
    let g: number;

    if (i < 16) {
      f = (b & c) | (~b & d);
      g = i;
    } else if (i < 32) {
      f = (d & b) | (~d & c);
      g = (5 * i + 1) % 16;
    } else if (i < 48) {
      f = b ^ c ^ d;
      g = (3 * i + 5) % 16;
    } else {
      f = c ^ (b | ~d);
      g = (7 * i) % 16;
    }

    const nextD = d;
    d = c;
    c = b;
    b = (b + leftRotate((a + f + k[i] + chunk[g]) >>> 0, s[i])) >>> 0;
    a = nextD;
  }

  state[0] = (state[0] + a) >>> 0;
  state[1] = (state[1] + b) >>> 0;
  state[2] = (state[2] + c) >>> 0;
  state[3] = (state[3] + d) >>> 0;
}
