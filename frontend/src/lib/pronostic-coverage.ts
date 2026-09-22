type Selection = { id: string; nums: number[]; source?: string };

export type HorseCoverage = {
  num: number;
  inMain: boolean;        // présent dans le prono principal
  inBest: boolean;        // présent dans la meilleure combinaison
  proposalCount: number;  // nombre de combinaisons qui incluent ce cheval
  totalProposals: number;
};

export type PronosticCoverage = {
  complete: boolean;
  arrivalSize: number;
  mainHits: number;
  bestHits: number;
  bestCombinationId: string | null;
  covered: boolean;
  horseCoverage: HorseCoverage[];
};

/** Normalise les nums d'une combinaison en entiers (robuste face aux strings JSON) */
function toNums(p: Selection): number[] {
  return Array.isArray(p.nums) ? p.nums.map(Number) : [];
}

function isValidGroup(p: Selection): boolean {
  const nums = toNums(p);
  return nums.length >= 3
    && nums.every(n => Number.isFinite(n) && n > 0)
    && new Set(nums).size === nums.length;
}

export function pronosticCoverage(proposals: Selection[], arrival: number[]): PronosticCoverage {
  const main = proposals.find(p => p.id === 'prono_du_jour');
  const official: number[] = Array.isArray(arrival)
    ? arrival.map(Number).filter(n => Number.isFinite(n) && n > 0)
    : [];
  const arrivalSize = official.length;

  const complete = !!main && isValidGroup(main) && arrivalSize >= 3;

  const mainNums = toNums(main ?? { id: '', nums: [] });
  const mainHits = official.filter(n => mainNums.includes(n)).length;

  // Toutes les combinaisons valides (les 20 consensus + prono principal)
  const allGroups = proposals.filter(isValidGroup);

  // Hits par combinaison : combien de chevaux arrivants sont dans la combi
  const hitsPerGroup = allGroups.map(p => {
    const nums = toNums(p);
    return official.filter(n => nums.includes(n)).length;
  });

  const bestHits = Math.max(0, ...hitsPerGroup);

  // Meilleure combinaison (première avec le max de hits)
  const bestIdx = hitsPerGroup.indexOf(bestHits);
  const bestGroup = bestIdx >= 0 && bestHits > 0 ? allGroups[bestIdx] : null;
  const bestCombinationId = bestGroup?.id ?? null;
  const bestNums = bestGroup ? toNums(bestGroup) : [];

  const horseCoverage: HorseCoverage[] = official.map(num => ({
    num,
    inMain: mainNums.includes(num),
    inBest: bestNums.includes(num),
    proposalCount: allGroups.filter(p => toNums(p).includes(num)).length,
    totalProposals: allGroups.length,
  }));

  return {
    complete,
    arrivalSize,
    mainHits,
    bestHits,
    bestCombinationId,
    covered: complete && bestHits >= arrivalSize,
    horseCoverage,
  };
}
