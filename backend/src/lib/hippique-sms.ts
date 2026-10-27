interface HippiqueSmsValues {
  date: string;
  hippodrome: string;
  nums: string;
}

export function renderHippiqueSms(template: string | undefined, values: HippiqueSmsValues): string {
  const text = template ?? 'Prono du {date} - {hippodrome} : {nums}';
  const replacements: Record<string, string> = {
    date: values.date,
    hippodrome: values.hippodrome,
    nums: values.nums,
  };
  return text.replace(/\{(date|hippodrome|nums)\}/g, (_, key: string) => replacements[key]);
}
