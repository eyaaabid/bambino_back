import type { Types } from 'mongoose'
import { Hospital } from '../models/Hospital.js'

export async function hospitalServiceLabels(
  hospitalId: Types.ObjectId | string | null | undefined,
  serviceId: Types.ObjectId | string | null | undefined
): Promise<{
  hospital: { id: string; name: string } | null
  service: { id: string; name: string } | null
}> {
  if (!hospitalId || !serviceId) return { hospital: null, service: null }
  const h = await Hospital.findById(hospitalId).lean()
  if (!h) return { hospital: null, service: null }
  const sid = String(serviceId)
  const svc = (h.services as { _id: Types.ObjectId; name: string }[]).find((s) => String(s._id) === sid)
  return {
    hospital: { id: String(h._id), name: h.name },
    service: svc ? { id: String(svc._id), name: svc.name } : null,
  }
}

export async function serviceBelongsToHospital(
  hospitalId: Types.ObjectId | string,
  serviceId: Types.ObjectId | string
): Promise<boolean> {
  const h = await Hospital.findById(hospitalId).lean()
  if (!h) return false
  return (h.services as { _id: Types.ObjectId }[]).some((s) => String(s._id) === String(serviceId))
}
