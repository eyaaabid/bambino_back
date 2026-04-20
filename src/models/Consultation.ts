import mongoose from 'mongoose'

const ConsultationSchema = new mongoose.Schema(
  {
    patient_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    consultation_date: { type: Date, required: true },
    type: { type: String, default: null },
    summary: { type: String, default: null },
    exam_data: { type: mongoose.Schema.Types.Mixed, default: null },
    lab_results: { type: mongoose.Schema.Types.Mixed, default: null },
    echography_data: { type: mongoose.Schema.Types.Mixed, default: null },
    result_status: { type: String, default: null },
    recommendations: { type: String, default: null },
  },
  { timestamps: true }
)

export const Consultation = mongoose.model('Consultation', ConsultationSchema)
