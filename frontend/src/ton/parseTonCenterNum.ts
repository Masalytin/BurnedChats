/** Parse Ton Center v2 stack `num` string (signed hex, unsigned hex, or decimal). */
export function parseTonCenterNum(raw: string): bigint {
  const s = raw.trim();

  if (s.startsWith('-0x') || s.startsWith('-0X')) {
    return -BigInt(`0x${s.slice(3)}`);
  }

  if (/^-\d+$/.test(s)) {
    return BigInt(s);
  }

  if (s.startsWith('0x') || s.startsWith('0X')) {
    return BigInt(s);
  }

  return BigInt(`0x${s}`);
}
