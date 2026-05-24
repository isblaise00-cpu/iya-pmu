const xofFormatter = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'XOF',
  maximumFractionDigits: 0,
});

export const formatXOF = (n: number) => xofFormatter.format(Math.round(n || 0));
