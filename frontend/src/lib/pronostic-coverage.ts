type Selection = { id: string; nums: number[]; source?: string };

export function pronosticCoverage(proposals: Selection[], arrival: number[]) {
  const main = proposals.find(p => p.id === 'prono_du_jour');
  const size = main?.nums?.length ?? 0;
  const official = Array.isArray(arrival) ? arrival.slice(0, size).map(Number) : [];
  const validGroup = (p: Selection) => Array.isArray(p.nums) && p.nums.length === size
    && new Set(p.nums).size === size && p.nums.every(n => Number.isInteger(n) && n > 0);
  const complete = !!main && validGroup(main) && size >= 3 && size <= 5 && official.length === size && new Set(official).size === size
    && official.every(n => Number.isInteger(n) && n > 0);
  const mainHits = new Set((main?.nums ?? []).filter(n => official.includes(n))).size;
  const consensus = proposals.filter(p => p.source === 'consensus_v1');
  const groups = consensus.length ? consensus : main ? [main] : [];
  const hits = groups.filter(validGroup).map(p => new Set(p.nums.filter(n => official.includes(n))).size);
  const bestHits = Math.max(0, ...hits);
  return { complete, size, mainHits, bestHits, covered: complete && bestHits === size };
}
