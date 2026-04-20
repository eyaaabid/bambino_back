import { differenceInYears, format, formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import type { Document, Types } from 'mongoose'
import { joursAvantAccouchement, semainesAmenorrhee, trimestreFromSa } from '../lib/pregnancy.js'
import type { IUser } from '../types/models.js'
import { hospitalServiceLabels } from './hospital.js'

export function ymd(d: Date | null | undefined): string | null {
  if (!d) return null
  return format(d, 'yyyy-MM-dd')
}

export function dmy(d: Date | null | undefined): string | null {
  if (!d) return null
  return format(d, 'dd/MM/yyyy')
}

export function iso(d: Date | null | undefined): string | null {
  if (!d) return null
  return d.toISOString()
}

export function humanSince(d: Date | null | undefined): string | null {
  if (!d) return null
  return formatDistanceToNow(d, { addSuffix: true, locale: fr })
}

export function ageYears(dob: Date | null | undefined): number | null {
  if (!dob) return null
  return differenceInYears(new Date(), dob)
}

export function patientComputed(p: { ddr?: Date | null; dpa?: Date | null }) {
  const sa = semainesAmenorrhee(p.ddr ?? null)
  return {
    semaines_amenorrhee: sa,
    trimestre: trimestreFromSa(sa),
    jours_avant_accouchement: joursAvantAccouchement(p.dpa ?? null),
  }
}

export async function userResource(user: Document & IUser) {
  const data: Record<string, unknown> = {
    id: String(user._id),
    name: user.name,
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    phone: user.phone,
    role: user.role,
  }

  if (user.role === 'staff') {
    const { hospital, service } = await hospitalServiceLabels(user.hospital_id ?? null, user.service_id ?? null)
    data.hospital_id = user.hospital_id ? String(user.hospital_id) : null
    data.service_id = user.service_id ? String(user.service_id) : null
    data.hospital = hospital
    data.service = service
  }

  return data
}

export async function userResourceWithPatient(user: Document & IUser, patient: Record<string, unknown> | null) {
  const base = await userResource(user)
  if (user.role === 'patient' && patient) {
    const { hospital, service } = await hospitalServiceLabels(
      patient.hospital_id as Types.ObjectId,
      patient.service_id as Types.ObjectId
    )
    const c = patientComputed({ ddr: patient.ddr as Date, dpa: patient.dpa as Date })
    base.patient = {
      id: String(patient._id),
      dossier_number: patient.dossier_number,
      semaines_amenorrhee: c.semaines_amenorrhee,
      trimestre: c.trimestre,
      dpa: ymd(patient.dpa as Date),
      jours_avant_accouchement: c.jours_avant_accouchement,
      status: patient.status,
      hospital_id: patient.hospital_id ? String(patient.hospital_id) : null,
      service_id: patient.service_id ? String(patient.service_id) : null,
      hospital,
      service,
    }
  }
  return base
}
