/**
 * Value formats (src/core/formats.ts) and hashes (src/core/hash.ts): reference vectors
 * for SHA-256, CRC-32 and BIP39, the Luhn check, round trip of every format,
 * input errors.
 */
import { createHash, randomBytes } from 'node:crypto';
import { checker, load } from '../tools/load.mjs';

const F = await load('core/formats', 'core/hash');
const A = await load('core/address');
const { check, done } = checker();
const hex = (b) => Buffer.from(b).toString('hex');
const round = (id, sub, value) => {
  const b = F.toBytes(id, sub, value);
  if (!b.ok) return `error: ${b.error}`;
  const v = F.fromBytes(id, sub, b.bytes);
  return v.ok ? v.value : `error: ${v.error}`;
};

// --- hashes
for (const n of [0, 3, 55, 56, 64, 1000]) {
  const data = randomBytes(n);
  check(`SHA-256 ${n} bytes`, hex(F.sha256(data)), createHash('sha256').update(data).digest('hex'));
}
check('SHA-256("abc")', hex(F.sha256(new TextEncoder().encode('abc'))), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
check('CRC-32("123456789")', F.crc32(new TextEncoder().encode('123456789')).toString(16), 'cbf43926');

// --- BIP39: reference vectors from BIP-0039
const W = (s) => s.split(' ');
const VECTORS = [
  ['00000000000000000000000000000000', 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'],
  ['7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f', 'legal winner thank year wave sausage worth useful legal winner thank yellow'],
  ['80808080808080808080808080808080', 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above'],
  ['ffffffffffffffffffffffffffffffff', 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong'],
  ['0000000000000000000000000000000000000000000000000000000000000000', `${'abandon '.repeat(23)}art`],
];
for (const [entropy, phrase] of VECTORS) {
  const b = F.toBytes('seed', 'bip39', phrase);
  check(`BIP39 → bytes: ${W(phrase).length} words, ${phrase.slice(0, 20)}…`, b.ok && hex(b.bytes), entropy);
  check(`bytes → BIP39: ${entropy.slice(0, 8)}…`, F.fromBytes('seed', 'bip39', Buffer.from(entropy, 'hex')).value, phrase);
}
check('BIP39: bad checksum is an error', F.toBytes('seed', 'bip39', `${'abandon '.repeat(11)}abandon`).ok, false);
check('BIP39: first 4 letters of each word', round('seed', 'bip39', 'lega winn than year wave saus wort usef lega winn than yell'), VECTORS[1][1]);
check('BIP39 list: 2048 words', F._internal.BIP39.length, 2048);
let okSeeds = 0;
for (let i = 0; i < 100; i += 1) {
  const len = [16, 20, 24, 28, 32][i % 5];
  const phrase = F.fromBytes('seed', 'bip39', randomBytes(len)).value;
  okSeeds += round('seed', 'bip39', phrase) === phrase;
}
check('BIP39: 100 random phrases of 12–24 words', okSeeds, 100);
const electrum = F.example('seed', 'bip39-raw');
check('BIP39 words without checksum: 12 words', electrum.split(' ').length, 12);
check('BIP39 words without checksum: round trip', round('seed', 'bip39-raw', electrum), electrum);
check('BIP39 words without checksum: 13 words', round('seed', 'bip39-raw', `${electrum} zoo`), `${electrum} zoo`);

// --- Monero
check('Monero list: 1626 words', F._internal.MONERO.length, 1626);
let okMonero = 0;
for (let i = 0; i < 50; i += 1) {
  const phrase = F.fromBytes('seed', 'monero', randomBytes(32)).value;
  okMonero += phrase.split(' ').length === 25 && round('seed', 'monero', phrase) === phrase;
}
check('Monero: 50 random keys, 25 words', okMonero, 50);
const xmr = F.fromBytes('seed', 'monero', randomBytes(32)).value.split(' ');
check('Monero: 24 words without the checksum word', round('seed', 'monero', xmr.slice(0, 24).join(' ')), xmr.join(' '));
const badXmr = [...xmr];
badXmr[24] = xmr.find((w) => w.slice(0, 3) !== xmr[24].slice(0, 3));
check('Monero: bad checksum word is an error', F.toBytes('seed', 'monero', badXmr.join(' ')).ok, false);

// --- card
check('Luhn: Visa, Mastercard, Discover test cards', ['411111111111111', '555555555555444', '601111111111111'].map(F.luhnDigit), [1, 4, 7]);
check('card: round trip', round('card', '', '4111 1111 1111 1111'), '4111 1111 1111 1111');
check('card: 16 digits = 7 bytes', F.toBytes('card', '', '4111111111111111').bytes.length, 7);
check('card: bad check digit is an error', F.toBytes('card', '', '4111 1111 1111 1112').ok, false);
check('card: Amex 15 digits', round('card', '', '378282246310005'), '3782 822463 10005');
check('card: Mir', F.toBytes('card', '', '2200 0000 0000 0004').note?.startsWith('Мир'), true);
let okCards = 0;
for (let i = 0; i < 100; i += 1) {
  const c = F.example('card', '');
  okCards += round('card', '', c) === c;
}
check('card: 100 random', okCards, 100);
check('card: leading zeros', round('card', '', '000000000000'), '0000 0000 0000');

// --- phone
check('phone: +7 with spaces', round('phone', '', '+7 912 345-67-89'), '+7 (912) 345-67-89');
check('phone: 8 → +7', round('phone', '', '8 (912) 345 67 89'), '+7 (912) 345-67-89');
check('phone: 10 digits starting with 9 → +7', round('phone', '', '9123456789'), '+7 (912) 345-67-89');
check('phone: another country', round('phone', '', '+44 20 7946 0958'), '+442079460958');
check('phone: Russian number = 5 bytes', F.toBytes('phone', '', '+79123456789').bytes.length, 5);
check('phone: letters are an error', F.toBytes('phone', '', '+7 912 ABC').ok, false);

// --- license plate
check('plate: round trip', round('plate', 'ru', 'А123ВС 77'), 'А123ВС 77');
check('plate: Latin letters and 3-digit region', round('plate', 'ru', 'a123bc777'), 'А123ВС 777');
check('plate: region 02', round('plate', 'ru', 'Х001ХХ 02'), 'Х001ХХ 02');
check('plate: 4 bytes', F.toBytes('plate', 'ru', 'М999МН199').bytes.length, 4);
check('plate: disallowed letter is an error', F.toBytes('plate', 'ru', 'Б123ВС77').ok, false);
check('plate: other format as text', round('plate', 'any', 'AB 1234 CD'), 'AB 1234 CD');

// --- password / text
for (const t of ['Tr0ub4dor&3', 'Мурзик_2024!', 'пароль', 'a', ' ', 'ЁжикЁ ё', '😀 emoji', 'ü-umlaut', 'AAAA', '\t tab']) check(`text: "${t}"`, round('text', '', t), t);
check('text: Latin denser than UTF-8', F.toBytes('text', '', 'Tr0ub4dor&3').bytes.length, 10);
check('text: Cyrillic denser than UTF-8', F.toBytes('text', '', 'Мурзик_2024!').bytes.length < new TextEncoder().encode('Мурзик_2024!').length, true);

// --- crypto wallet addresses
check('Keccak-256("")', hex(F.keccak256(new Uint8Array())), 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
check('Keccak-256("abc")', hex(F.keccak256(new TextEncoder().encode('abc'))), '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
check('CRC-16/XMODEM("123456789")', F.crc16(new TextEncoder().encode('123456789')).toString(16), '31c3');
const ADDRESSES = [
  // [address, network, payload in hex]: Bitcoin genesis, BIP-173/BIP-350/EIP-55 examples, XRP root account, Solana system program
  ['1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa', 'Bitcoin (P2PKH, 1…)', '62e907b15cbf27d5425399ebf6f0fb50ebb88f18'],
  ['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4', 'Bitcoin (SegWit, bc1q…)', '751e76e8199196d454941c45d1b3a323f1433bd6'],
  ['bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0', 'Bitcoin (Taproot, bc1p…)', '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'],
  ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', 'Ethereum', '5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'],
  ['0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359', 'Ethereum', 'fb6916095ca1df60bb79ce92ce3ea74c37c5d359'],
  ['0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB', 'Ethereum', 'dbf03b407c01e7cd3cbea99509d93f8dddc8c6fb'],
  ['0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb', 'Ethereum', 'd1220a0cf47c7b9be7a2e6ba89f429762e7b9adb'],
  ['rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh', 'XRP (Ripple)', null],
  ['11111111111111111111111111111111', 'Solana', '0000000000000000000000000000000000000000000000000000000000000000'],
];
for (const [addr, name, payload] of ADDRESSES) {
  const b = F.toBytes('address', '', addr);
  const back = b.ok ? F.fromBytes('address', '', b.bytes) : null;
  check(`address ${addr.slice(0, 14)}…: network`, back?.note?.startsWith(name), true);
  if (payload) check(`address ${addr.slice(0, 14)}…: key/hash`, b.ok && hex(b.bytes.slice(1)), payload);
  check(`address ${addr.slice(0, 14)}…: same on the way back`, back?.value, addr);
}
check('Ethereum lowercase → checksum case', round('address', '', '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed'), '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
check('Ethereum: wrong case is an error', F.toBytes('address', '', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD').ok, false);
check('Bitcoin: typo in a character is an error', F.toBytes('address', '', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb').ok, false);
check('SegWit: typo in a character is an error', F.toBytes('address', '', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5').ok, false);
check('Bitcoin and Ethereum = 21 bytes', [F.toBytes('address', '', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa').bytes.length, F.toBytes('address', '', '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359').bytes.length], [21, 21]);
check('TON: "raw" address', round('address', '', `0:${'ab'.repeat(32)}`), `0:${'ab'.repeat(32)}`);
let okAddr = 0;
const nets = new Set();
for (let id = 0; id < A._internal.NETS.length; id += 1) {
  for (let i = 0; i < 20; i += 1) {
    const payload = randomBytes(A._internal.NETS[id].size);
    if (id === 15) {
      payload[0] = [0x11, 0x51][i % 2];
      payload[1] = i % 3 ? 0 : 0xff;
    }
    const addr = A._internal.NETS[id].render(payload);
    const back = round('address', '', addr);
    if (back === addr) okAddr += 1;
    else if (nets.size < 5) nets.add(`${A._internal.NETS[id].name}: ${addr} → ${back}`);
  }
}
if (nets.size) console.log(`  mismatched:\n    ${[...nets].join('\n    ')}`);
check(`addresses: all ${A._internal.NETS.length} networks x 20 random`, okAddr, A._internal.NETS.length * 20);
let okEx = 0;
for (let i = 0; i < 40; i += 1) {
  const e = F.example('address', '');
  okEx += round('address', '', e) === e;
}
check('addresses: 40 examples', okEx, 40);

// --- HEX and Base64
check('HEX: round trip', round('hex', '', '0x01 23:45-67'), '01234567');
check('Base64: round trip', round('base64', '', 'ASNFZ4mrze8='), 'ASNFZ4mrze8=');
check('Base64: without = and url-safe', hex(F.toBytes('base64', '', '-_8').bytes), 'fbff');
check('Base64: garbage is an error', F.toBytes('base64', '', 'ab$c').ok, false);
check('more than 100 bytes is an error', F.toBytes('hex', '', 'ab'.repeat(101)).ok, false);

done('formats');
