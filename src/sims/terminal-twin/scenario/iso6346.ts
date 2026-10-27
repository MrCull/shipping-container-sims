/** ISO 6346 container ids: 3-letter owner code + equipment category + 6-digit serial + check digit. */

const LETTER_VALUES: Record<string, number> = (() => {
  const values: Record<string, number> = {}
  let v = 10
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    if (v % 11 === 0) v++ // skip multiples of 11
    values[ch] = v++
  }
  return values
})()

/** Check digit for the first 10 characters (e.g. "CSQU305438" → 3). */
export function iso6346CheckDigit(first10: string): number {
  let sum = 0
  for (let i = 0; i < 10; i++) {
    const ch = first10[i]
    const value = /[0-9]/.test(ch) ? Number(ch) : LETTER_VALUES[ch]
    sum += value * 2 ** i
  }
  return (sum % 11) % 10
}

export function makeIso6346Id(ownerPrefix: string, serial: number): string {
  const first10 = `${ownerPrefix}${String(serial).padStart(6, '0')}`
  return `${first10}${iso6346CheckDigit(first10)}`
}

export function isValidIso6346(id: string): boolean {
  return /^[A-Z]{3}[UJZ][0-9]{7}$/.test(id) && iso6346CheckDigit(id.slice(0, 10)) === Number(id[10])
}
