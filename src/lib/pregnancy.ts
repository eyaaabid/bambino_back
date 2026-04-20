import { differenceInCalendarDays, differenceInWeeks, startOfDay, subWeeks } from 'date-fns'

export function semainesAmenorrhee(ddr: Date | null | undefined): number | null {
  if (!ddr) return null
  return differenceInWeeks(startOfDay(new Date()), startOfDay(ddr))
}

export function trimestreFromSa(sa: number | null): number | null {
  if (sa === null || sa === undefined) return null
  if (sa < 15) return 1
  if (sa < 29) return 2
  return 3
}

export function joursAvantAccouchement(dpa: Date | null | undefined): number | null {
  if (!dpa) return null
  return differenceInCalendarDays(startOfDay(dpa), startOfDay(new Date()))
}

export function ddrFromDpa(dpa: Date): Date {
  return subWeeks(startOfDay(dpa), 41)
}

/** Trimestre filter on patient list (matches Laravel logic). */
export function trimestreDateRange(trimestre: number): { ddrGte?: Date; ddrLt?: Date; ddrGte2?: Date } {
  const now = new Date()
  if (trimestre === 1) return { ddrGte: subWeeks(now, 15) }
  if (trimestre === 2) return { ddrLt: subWeeks(now, 15), ddrGte2: subWeeks(now, 29) }
  if (trimestre === 3) return { ddrLt: subWeeks(now, 29) }
  return {}
}
