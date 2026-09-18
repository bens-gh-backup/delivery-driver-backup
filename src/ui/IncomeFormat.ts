/** Preserve fractional-cent rewards while avoiding unnecessary trailing digits. */
export function formatIncomeRate(value: number): string {
  return value.toFixed(6).replace(/(\.\d{2}.*?)0+$/, "$1");
}
