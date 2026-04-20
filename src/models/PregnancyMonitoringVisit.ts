import mongoose from 'mongoose'

const VisitSchema = new mongoose.Schema(
  {
    patient_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    visit_date: { type: Date, required: true },
    weeks_ga: { type: String, required: true },
    metrorragia: { type: Boolean, default: false },
    leucorrhea: { type: Boolean, default: false },
    ma: { type: String, default: null },
    hu: { type: String, default: null },
    bdc: { type: String, default: null },
    presentation: { type: String, default: null },
    ta: { type: String, default: null },
    edema: { type: Boolean, default: false },
    albuminuria: { type: String, default: null },
    glycosuria: { type: String, default: null },
    hb: { type: String, default: null },
    medication: { type: String, default: null },
    hospitalization: { type: String, default: null },
  },
  { timestamps: true }
)

export const PregnancyMonitoringVisit = mongoose.model('PregnancyMonitoringVisit', VisitSchema)
