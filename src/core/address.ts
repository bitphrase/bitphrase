/**
 * Crypto wallet addresses ↔ bytes: [network number][key or hash]. The address checksum is
 * not stored in the bytes — it is recomputed by the network's rules: base58check (Bitcoin,
 * Litecoin, Dogecoin, Tron, XRP), bech32/bech32m (SegWit, Taproot), EIP-55 (Ethereum letter
 * case), CRC-16 (TON). Solana has no checksum — the address is the 32-byte key itself.
 * The network is detected from the address itself; the checksum is verified on input.
 */
import { crc16, keccak256, sha256 } from './hash';
import { tr } from './i18n';

// --- base58 -------------------------------------------------------------------------

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const XRP58 = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';

function base58Decode(s: string, alpha: string): Uint8Array | null {
  let n = 0n;
  for (const c of s) {
    const v = alpha.indexOf(c);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  for (const c of s) {
    if (c !== alpha[0]) break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

function base58Encode(b: Uint8Array, alpha: string): string {
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);
  let out = '';
  while (n > 0n) {
    out = alpha[Number(n % 58n)]! + out;
    n /= 58n;
  }
  for (const x of b) {
    if (x) break;
    out = alpha[0]! + out;
  }
  return out;
}

const check4 = (payload: Uint8Array) => sha256(sha256(payload)).slice(0, 4);

/** base58check: [version][data][4 bytes of double SHA-256]. null — checksum mismatch. */
function b58checkDecode(s: string, alpha = B58): Uint8Array | null {
  const raw = base58Decode(s, alpha);
  if (!raw || raw.length < 5) return null;
  const payload = raw.slice(0, -4);
  const sum = check4(payload);
  return sum.every((x, i) => x === raw[raw.length - 4 + i]) ? payload : null;
}
const b58checkEncode = (payload: Uint8Array, alpha = B58) => base58Encode(Uint8Array.from([...payload, ...check4(payload)]), alpha);

// --- bech32 / bech32m (BIP-173, BIP-350) -------------------------------------------

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32 = 1;
const BECH32M = 0x2bc830a3;

function polymod(values: number[]): number {
  const gen = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i += 1) if ((top >>> i) & 1) chk ^= gen[i]!;
  }
  return chk >>> 0;
}
const hrpExpand = (hrp: string) => [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];

function convertBits(data: number[], from: number, to: number, pad: boolean): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const max = (1 << to) - 1;
  for (const v of data) {
    acc = (acc << from) | v;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & max);
    }
  }
  if (pad && bits) out.push((acc << (to - bits)) & max);
  else if (!pad && (bits >= from || ((acc << (to - bits)) & max))) return null;
  return out;
}

/** SegWit address → version and program (20 or 32 bytes); null — wrong address or checksum. */
function segwitDecode(hrp: string, addr: string): { version: number; program: Uint8Array } | null {
  if (addr !== addr.toLowerCase() && addr !== addr.toUpperCase()) return null;
  const s = addr.toLowerCase();
  const at = s.lastIndexOf('1');
  if (s.slice(0, at) !== hrp || s.length - at < 8) return null;
  const data = [...s.slice(at + 1)].map((c) => CHARSET.indexOf(c));
  if (data.some((v) => v < 0)) return null;
  const sum = polymod([...hrpExpand(hrp), ...data]);
  const version = data[0]!;
  if (sum !== (version === 0 ? BECH32 : BECH32M)) return null;
  const program = convertBits(data.slice(1, -6), 5, 8, false);
  if (!program || program.length < 2 || program.length > 40 || version > 16) return null;
  if (version === 0 && program.length !== 20 && program.length !== 32) return null;
  return { version, program: Uint8Array.from(program) };
}

function segwitEncode(hrp: string, version: number, program: Uint8Array): string {
  const data = [version, ...convertBits([...program], 8, 5, true)!];
  const mod = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ (version === 0 ? BECH32 : BECH32M);
  const sum = Array.from({ length: 6 }, (_, i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...sum].map((v) => CHARSET[v]).join('')}`;
}

// --- Ethereum: EIP-55 ---------------------------------------------------------------------

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

function eip55(addr20: Uint8Array): string {
  const lowerHex = hex(addr20);
  const h = hex(keccak256(new TextEncoder().encode(lowerHex)));
  return `0x${[...lowerHex].map((c, i) => (parseInt(h[i]!, 16) >= 8 ? c.toUpperCase() : c)).join('')}`;
}

// --- TON ------------------------------------------------------------------------------------

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_');
function b64decode(s: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
/** Flags of a "user-friendly" TON address: bounceable / non-bounceable, +0x80 — testnet. */
const TON_FLAGS = [0x11, 0x51, 0x91, 0xd1];

// --- networks -----------------------------------------------------------------------------

interface Net {
  name: string;
  /** Payload bytes (without the network number). */
  size: number;
  render(payload: Uint8Array): string;
}

const NETS: Net[] = [
  { name: 'Bitcoin (P2PKH, 1…)', size: 20, render: (p) => b58checkEncode(Uint8Array.from([0x00, ...p])) },
  { name: 'Bitcoin (P2SH, 3…)', size: 20, render: (p) => b58checkEncode(Uint8Array.from([0x05, ...p])) },
  { name: 'Bitcoin (SegWit, bc1q…)', size: 20, render: (p) => segwitEncode('bc', 0, p) },
  { name: 'Bitcoin (SegWit P2WSH, bc1q…)', size: 32, render: (p) => segwitEncode('bc', 0, p) },
  { name: 'Bitcoin (Taproot, bc1p…)', size: 32, render: (p) => segwitEncode('bc', 1, p) },
  {
    get name() {
      return tr('Ethereum и совместимые сети (BNB Chain, Polygon, Arbitrum…)', 'Ethereum and compatible networks (BNB Chain, Polygon, Arbitrum…)');
    },
    size: 20,
    render: eip55,
  },
  { name: 'Tron (TRX, USDT-TRC20)', size: 20, render: (p) => b58checkEncode(Uint8Array.from([0x41, ...p])) },
  { name: 'Solana', size: 32, render: (p) => base58Encode(p, B58) },
  { name: 'Litecoin (L…)', size: 20, render: (p) => b58checkEncode(Uint8Array.from([0x30, ...p])) },
  { name: 'Litecoin (M…)', size: 20, render: (p) => b58checkEncode(Uint8Array.from([0x32, ...p])) },
  { name: 'Litecoin (SegWit, ltc1q…)', size: 20, render: (p) => segwitEncode('ltc', 0, p) },
  { name: 'Litecoin (SegWit P2WSH, ltc1q…)', size: 32, render: (p) => segwitEncode('ltc', 0, p) },
  { name: 'Dogecoin (D…)', size: 20, render: (p) => b58checkEncode(Uint8Array.from([0x1e, ...p])) },
  { name: 'Dogecoin (P2SH)', size: 20, render: (p) => b58checkEncode(Uint8Array.from([0x16, ...p])) },
  { name: 'XRP (Ripple)', size: 20, render: (p) => b58checkEncode(Uint8Array.from([0x00, ...p]), XRP58) },
  {
    // [flags][workchain][32 bytes]; flags 0 — "raw" address 0:abcd…
    name: 'TON',
    size: 34,
    render: (p) => {
      const wc = p[1] === 0xff ? -1 : p[1]!;
      if (p[0] === 0) return `${wc}:${hex(p.slice(2))}`;
      const body = p.slice(0, 34);
      const c = crc16(body);
      return b64url(Uint8Array.from([...body, c >> 8, c & 0xff]));
    },
  },
];
const net = (id: number, payload: Uint8Array) => ({ id, payload });
const BASE58_VERSIONS: Record<number, number> = { 0x00: 0, 0x05: 1, 0x41: 6, 0x30: 8, 0x32: 9, 0x1e: 12, 0x16: 13 };

/** Address → network and payload, or an error message. */
function parse(input: string): { id: number; payload: Uint8Array } | string {
  const a = input.trim();
  if (/^0x[0-9a-f]{40}$/i.test(a)) {
    const bytes = Uint8Array.from(a.slice(2).match(/../g)!.map((x) => parseInt(x, 16)));
    const mixed = a.slice(2) !== a.slice(2).toLowerCase() && a.slice(2) !== a.slice(2).toUpperCase();
    if (mixed && eip55(bytes) !== a) return tr('Регистр букв адреса Ethereum не совпадает с контрольной суммой (EIP-55) — вероятно, ошибка в символе.', 'The letter case of the Ethereum address does not match its checksum (EIP-55) — probably a typo in a character.');
    return net(5, bytes);
  }
  const low = a.toLowerCase();
  for (const [hrp, v0short, v0long, v1] of [['bc', 2, 3, 4], ['ltc', 10, 11, -1]] as const) {
    if (!low.startsWith(`${hrp}1`)) continue;
    const w = segwitDecode(hrp, a);
    if (!w) return tr('Адрес SegWit не проходит проверку контрольной суммы (bech32) — вероятно, ошибка в символе.', 'The SegWit address fails the checksum (bech32) — probably a typo in a character.');
    if (w.version === 0) return net(w.program.length === 20 ? v0short : v0long, w.program);
    if (w.version === 1 && w.program.length === 32 && v1 >= 0) return net(v1, w.program);
    return tr('Такая версия SegWit-адреса пока не поддерживается.', 'This SegWit address version is not supported yet.');
  }
  const raw = /^(-1|0):([0-9a-f]{64})$/i.exec(a);
  if (raw) return net(15, Uint8Array.from([0, raw[1] === '-1' ? 0xff : 0, ...raw[2]!.match(/../g)!.map((x) => parseInt(x, 16))]));
  // 48 characters: longer than any base58 address here (≤ 44), so a TON address may use base58 letters only.
  if (/^[A-Za-z0-9_+/-]{48}$/.test(a)) {
    const b = b64decode(a);
    if (b && b.length === 36 && TON_FLAGS.includes(b[0]!) && (b[1] === 0 || b[1] === 0xff)) {
      return crc16(b.slice(0, 34)) === ((b[34]! << 8) | b[35]!) ? net(15, b.slice(0, 34)) : tr('Адрес TON не проходит проверку контрольной суммы — вероятно, ошибка в символе.', 'The TON address fails the checksum — probably a typo in a character.');
    }
  }
  if (/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(a)) {
    const p = b58checkDecode(a, XRP58);
    if (p && p.length === 21 && p[0] === 0) return net(14, p.slice(1));
  }
  if (/^[1-9A-HJ-NP-Za-km-z]{25,44}$/.test(a)) {
    const rawBytes = base58Decode(a, B58)!;
    if (rawBytes.length === 25) {
      const p = b58checkDecode(a);
      if (!p) return tr('Адрес не проходит проверку контрольной суммы (base58check) — вероятно, ошибка в символе.', 'The address fails the checksum (base58check) — probably a typo in a character.');
      const id = BASE58_VERSIONS[p[0]!];
      return id === undefined ? tr('Сеть этого адреса не поддерживается.', 'This address\'s network is not supported.') : net(id, p.slice(1));
    }
    if (rawBytes.length === 32) return net(7, rawBytes);
  }
  return tr('Не похоже на адрес поддерживаемой сети: Bitcoin, Ethereum (и BNB Chain, Polygon…), Tron, Solana, Litecoin, Dogecoin, XRP, TON.', 'Does not look like an address of a supported network: Bitcoin, Ethereum (and BNB Chain, Polygon…), Tron, Solana, Litecoin, Dogecoin, XRP, TON.');
}

export type AddressResult = { ok: true; bytes: Uint8Array; note: string } | { ok: false; error: string };

export function addressToBytes(input: string): AddressResult {
  const r = parse(input);
  if (typeof r === 'string') return { ok: false, error: r };
  const name = NETS[r.id]!.name;
  const note =
    r.id === 7
      ? tr('у адресов Solana нет контрольной суммы — проверьте символы', 'Solana addresses have no checksum — double-check the characters')
      : tr('контрольная сумма верна (в байты не входит — восстанавливается)', 'checksum is valid (not stored in the bytes — it is restored)');
  return { ok: true, bytes: Uint8Array.from([r.id, ...r.payload]), note: `${name}: ${note}.` };
}

export function addressFromBytes(b: Uint8Array): { ok: true; value: string; note: string } | { ok: false; error: string } {
  const n = NETS[b[0] ?? 255];
  if (!n || b.length !== n.size + 1) return { ok: false, error: tr('Эти байты — не адрес криптокошелька.', 'These bytes are not a crypto wallet address.') };
  return { ok: true, value: n.render(b.slice(1)), note: n.name };
}

/** A random address of a random network — for the "Example" button. */
export function addressExample(): string {
  const id = [0, 2, 4, 5, 5, 6, 6, 7, 8, 12, 14, 15][Math.floor(Math.random() * 12)]!;
  const payload = crypto.getRandomValues(new Uint8Array(NETS[id]!.size));
  if (id === 15) {
    payload[0] = 0x11;
    payload[1] = 0;
  }
  return NETS[id]!.render(payload);
}

export const _internal = { NETS, base58Decode, base58Encode, segwitDecode, eip55 };
