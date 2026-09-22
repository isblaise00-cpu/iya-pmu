interface HippiqueSmsValues {
  date: string;
  hippodrome: string;
  nums: string;
  score?: number;
  confidence?: number;
}

export function renderHippiqueSms(template: string | undefined, values: HippiqueSmsValues): string {
  const isSelectionScore = typeof values.score === 'number';
  let text = template ?? (isSelectionScore
    ? 'Prono PMUB {date} - {hippodrome} : {nums} (Score de sélection : {score}/100)'
    : 'Prono PMUB {date} - {hippodrome} : {nums} (Confiance : {confidence}%)');
  // Compatibilité avec les modèles SMS déjà enregistrés avant le consensus.
  if (isSelectionScore) {
    text = text.replace(/confiance/gi, 'score de sélection')
      .replace(/\{confidence\}\s*%/g, '{score}/100')
      .replace(/\{confidence\}/g, '{score}/100')
      .replace(/\{score\}\s*%/g, '{score}/100');
  }
  const replacements: Record<string, string> = {
    date: values.date, hippodrome: values.hippodrome, nums: values.nums,
    score: String(values.score ?? values.confidence ?? 0),
    confidence: String(values.confidence ?? 0),
  };
  return text.replace(/\{(date|hippodrome|nums|score|confidence)\}/g, (_, key: string) => replacements[key]);
}
