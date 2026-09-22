// Exécuter : node --test backend/tests/hippique.test.cjs (depuis la racine).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relativePath) {
  const filename = path.resolve(__dirname, relativePath);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports }, { filename });
  return exports;
}

const { renderHippiqueSms } = load('../src/lib/hippique-sms.ts');
const { pronosticCoverage } = load('../../frontend/src/lib/pronostic-coverage.ts');
const values = { date: '31/07/2026', hippodrome: 'CABOURG', nums: '13 - 12 - 14 - 6 - 3', score: 54.88 };

test('un ancien modèle SMS affiche le nouveau score sans faux pourcentage', () => {
  const text = renderHippiqueSms('PMUB {date} {hippodrome} : {nums} (Confiance : {confidence}%)', values);
  assert.match(text, /score de sélection : 54\.88\/100/);
  assert.ok(text.includes(values.nums));
  assert.ok(!text.includes('%'));
  assert.ok(!text.includes('{'));
});

test('les valeurs anciennes et les nouveaux modèles restent utilisables', () => {
  assert.match(renderHippiqueSms(undefined, { ...values, score: undefined, confidence: 82 }), /82%/);
  assert.equal(renderHippiqueSms('{date} / {date} : {score}/100', values), '31/07/2026 / 31/07/2026 : 54.88/100');
  assert.match(renderHippiqueSms(undefined, values), /Score de sélection : 54\.88\/100/);
});

const proposals = [
  { id: 'prono_du_jour', source: 'consensus_v1', nums: [13, 12, 14, 6, 3] },
  { id: 'consensus_02', source: 'consensus_v1', nums: [13, 12, 14, 6, 4] },
];

test('une alternative couvre le désordre même si la principale manque un cheval', () => {
  const result = pronosticCoverage(proposals, [4, 6, 14, 12, 13]);
  assert.equal(result.mainHits, 4);
  assert.equal(result.bestHits, 5);
  assert.equal(result.covered, true);
});

test('une arrivée tronquée ou invalide ne produit pas un succès', () => {
  for (const arrival of [[13, 12, 14], [13, 12, 14, 6, 6], [13, 12, 14, 6, 0]]) {
    const result = pronosticCoverage(proposals, arrival);
    assert.equal(result.complete, false);
    assert.equal(result.covered, false);
  }
  assert.equal(pronosticCoverage(proposals, [13, 12, 14, 6, 16]).covered, false);
});

test('les anciens pronostics et les listes de taille incorrecte ne gonflent pas la couverture', () => {
  const old = [
    { id: 'prono_du_jour', nums: [1, 2, 3, 4] },
    { id: 'hist_01', nums: [1, 2, 3, 5] },
  ];
  assert.equal(pronosticCoverage(old, [5, 3, 2, 1]).covered, false);
  assert.equal(pronosticCoverage(old, [4, 3, 2, 1]).covered, true);
  const malformed = [...proposals, { id: 'invalid', source: 'consensus_v1', nums: [13, 12, 14, 6, 16, 17] }];
  assert.equal(pronosticCoverage(malformed, [13, 12, 14, 6, 16]).covered, false);
});
