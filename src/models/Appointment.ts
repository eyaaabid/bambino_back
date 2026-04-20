import mongoose from 'mongoose'

const AppointmentSchema = new mongoose.Schema(
  {
    patient_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    scheduled_at: { type: Date, required: true },
    type: { type: String, required: true },
    professional_name: { type: String, default: null },
    location: { type: String, default: null },
    notes: { type: String, default: null },
    recommendations: { type: String, default: null },
    status: { type: String, default: 'scheduled' },
  },
  { timestamps: true }
)

export const Appointment = mongoose.model('Appointment', AppointmentSchema)
