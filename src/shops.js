// Points de vente : "Nom|221XXXXXXXXX;Nom 2|221YYYYYYYYY" (variable SHOPS pour surcharger)
const DEFAULT_SHOPS = 'Thiès – Quartier Mbambara|221768645834;Grand Mbour|221769410074';
export const SHOPS = (process.env.SHOPS || DEFAULT_SHOPS).split(';').map((s) => {
  const [name, number] = s.split('|');
  const digits = (number || '').replace(/\D/g, '');
  const local = digits.startsWith('221') ? digits.slice(3) : digits;
  return { name: name.trim(), number: digits, display: `+221 ${local.replace(/(\d{2})(\d{3})(\d{2})(\d{2})/, '$1 $2 $3 $4')}` };
}).filter((s) => s.name && s.number);
