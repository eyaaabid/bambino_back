import type { Types } from 'mongoose'

/** Aucun document ne correspond (filtre MongoDB sûr). */
export function emptyPatientMatch(): { _id: { $in: Types.ObjectId[] } } {
  return { _id: { $in: [] } }
}

export type StaffScopeUser = {
  hospital_id?: Types.ObjectId | null
  service_id?: Types.ObjectId | null
}

/**
 * Filtre Patient pour un membre du personnel : même hôpital et même service que son profil.
 * Si l’hôpital / service ne sont pas renseignés sur le compte staff, aucun dossier n’est visible.
 */
export function staffPatientScope(staff: StaffScopeUser): Record<string, unknown> | null {
  if (staff.hospital_id && staff.service_id) {
    return { hospital_id: staff.hospital_id, service_id: staff.service_id }
  }
  return null
}

export function staffCanAccessPatient(
  staff: StaffScopeUser,
  patient: { hospital_id: Types.ObjectId; service_id: Types.ObjectId }
): boolean {
  const scope = staffPatientScope(staff)
  if (!scope) return false
  return (
    String(patient.hospital_id) === String(scope.hospital_id) &&
    String(patient.service_id) === String(scope.service_id)
  )
}
