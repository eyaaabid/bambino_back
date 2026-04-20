import type { Types } from 'mongoose'

export type IUser = {
  name: string
  first_name: string
  last_name: string
  email: string
  phone?: string | null
  role: 'patient' | 'staff'
  hospital_id?: Types.ObjectId | null
  service_id?: Types.ObjectId | null
  password: string
}
