/**
 * Russian adjective declension (src/lang/ru/morph.ts) against the whole reference
 * data/morph/verified_adj.tsv — OpenCorpora forms cross-checked with Wiktionary.
 *
 * The rules must: 1) give exactly the same set of mismatches as their Python prototype
 * (data/exceptions/adj_rule_mismatches.tsv — possessives like "божий");
 * 2) match in every cell for every adjective of the app's dictionary.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checker, load, root } from '../tools/load.mjs';

const { decline } = await load('lang/ru/morph');
const { check, done } = checker();

const tsv = async (path) => {
  const [head, ...rows] = (await readFile(join(root, path), 'utf8')).trimEnd().split('\n');
  const cols = head.split('\t');
  return rows.map((line) => Object.fromEntries(line.split('\t').map((v, i) => [cols[i], v])));
};
const strip = (s) => s.replace(/[́̀]/g, '');

const reference = await tsv('data/morph/verified_adj.tsv');
const cells = Object.keys(reference[0]).filter((c) => /^(masc|neut|femn|plur):/.test(c));
const mismatched = new Set();
let checked = 0;
for (const r of reference) {
  const forms = decline(r.lemma);
  if (!forms) continue;
  checked += 1;
  for (const c of cells) {
    const ref = r[c];
    if (!ref || ref.startsWith('?') || ref.startsWith('!')) continue;
    if (!ref.split('/').map(strip).includes(forms[c])) mismatched.add(`${r.lemma}\t${r.oc_para_id}`);
  }
}
const python = new Set((await tsv('data/exceptions/adj_rule_mismatches.tsv')).map((r) => `${r.lemma}\t${r.oc_para_id}`));
check('adjectives checked', checked > 10000, true);
check('the mismatches are the same as the Python prototype\'s', [...mismatched].sort(), [...python].sort());
console.log(`  ${checked} adjectives, ${checked - mismatched.size} match in all ${cells.length} cells`);

const dict = JSON.parse(await readFile(join(root, 'src/lang/ru/dict.json'), 'utf8'));
const byLemma = new Map(reference.map((r) => [r.lemma, r]));
const bad = dict.adj.filter((lemma) => {
  const r = byLemma.get(lemma);
  return !r || mismatched.has(`${lemma}\t${r.oc_para_id}`);
});
check('every adjective of the dictionary declines correctly', bad, []);

// Reference forms from Plan_1 §6.1.
const sample = decline('хороший');
check('хороший', [sample['masc:gent'], sample['neut:nomn'], sample['femn:ablt'], sample['plur:datv']], ['хорошего', 'хорошее', 'хорошей', 'хорошим']);
const big = decline('большой');
check('большой', [big['masc:gent'], big['neut:nomn'], big['masc:ablt'], big['plur:accs:anim']], ['большого', 'большое', 'большим', 'больших']);
const blue = decline('синий');
check('синий', [blue['femn:nomn'], blue['femn:accs'], blue['neut:nomn']], ['синяя', 'синюю', 'синее']);
check('a possessive — outside the rules, no crash', decline('лисий') !== null, true);
check('not an adjective', decline('стол'), null);

done('morph');
