export const escapeHtml = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export const number = (value: number, digits = 2) =>
  value.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const area = (value: number) => `${number(value)} m²`;
/** A plan length given in metres, shown in centimetres to the millimetre: « 420 cm », « 12,5 cm ». */
export const centimetres = (metres: number) =>
  `${(Math.round(metres * 1000) / 10).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} cm`;
