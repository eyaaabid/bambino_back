export function normalizeTunisianPhone(phone: unknown): string | null {
  if (phone === null || phone === undefined || phone === '') return null
  if (typeof phone !== 'string') return null
  const digits = phone.replace(/\D+/g, '')
  let local = digits
  if (local.startsWith('216')) local = local.slice(3)
  if (local.length === 8 && /^[2-9]\d{7}$/.test(local)) return `+216${local}`
  return phone
}

export const tunisianMobileRegex = /^\+216[2-9]\d{7}$/
