export type MotherRow = { id: number; timing: string; vaccine: string; done: boolean }
export type BabyRow = { id: number; age: string; vaccines: string[]; done: boolean }

export function motherRows(): MotherRow[] {
  return [
    { id: 1, timing: '7e mois (27 SA)', vaccine: 'dTCa (Diphtérie, Tétanos, Coqueluche)', done: false },
    { id: 2, timing: '8e mois (32 SA)', vaccine: 'dTCa (si non fait à 7 mois)', done: false },
    { id: 3, timing: 'Post-partum immédiat (à la maternité)', vaccine: 'Rubéole (si non immunisée)', done: false },
  ]
}

export function babyRows(): BabyRow[] {
  return [
    { id: 1, age: 'À la naissance', vaccines: ['BCG', 'HBV-0'], done: false },
    { id: 2, age: '2 mois', vaccines: ['Pentavalent-1', 'VPI-1', 'PCV1'], done: false },
    { id: 3, age: '3 mois', vaccines: ['Pentavalent-2', 'VPI-2'], done: false },
    { id: 4, age: '4 mois', vaccines: ['PCV2'], done: false },
    { id: 5, age: '6 mois', vaccines: ['Pentavalent-3', 'VPI-3'], done: false },
    { id: 6, age: '11 mois', vaccines: ['PCV3'], done: false },
    { id: 7, age: '12 mois', vaccines: ['RR-1'], done: false },
    { id: 8, age: '18 mois', vaccines: ['DTC4', 'VPO', 'RR-2'], done: false },
  ]
}

export function mergeMother(saved: Record<string, boolean> | null | undefined): MotherRow[] {
  const s = saved ?? {}
  return motherRows().map((row) => ({
    ...row,
    done: Object.prototype.hasOwnProperty.call(s, String(row.id)) ? Boolean(s[String(row.id)]) : row.done,
  }))
}

export function mergeBaby(saved: Record<string, boolean> | null | undefined): BabyRow[] {
  const s = saved ?? {}
  return babyRows().map((row) => ({
    ...row,
    done: Object.prototype.hasOwnProperty.call(s, String(row.id)) ? Boolean(s[String(row.id)]) : row.done,
  }))
}

export function vaccinationResponse(motherSaved: unknown, babySaved: unknown) {
  const m = mergeMother(motherSaved as Record<string, boolean> | null)
  const b = mergeBaby(babySaved as Record<string, boolean> | null)
  const motherDone = m.filter((r) => r.done).length
  const babyDone = b.filter((r) => r.done).length
  const motherN = Math.max(m.length, 1)
  const babyN = Math.max(b.length, 1)
  return {
    motherVaccinations: m,
    babyVaccinations: b,
    motherDone,
    babyDone,
    motherPct: Math.round((motherDone / motherN) * 100),
    babyPct: Math.round((babyDone / babyN) * 100),
  }
}
