import mongoose from 'mongoose'

const PatientSchema = new mongoose.Schema(
  {
    user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    hospital_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', required: true },
    service_id: { type: mongoose.Schema.Types.ObjectId, required: true },
    dossier_number: { type: String, required: true, unique: true },
    first_name: { type: String, required: true },
    last_name: { type: String, required: true },
    date_of_birth: { type: Date, default: null },
    blood_group: { type: String, default: null },
    allergies: { type: String, default: null },
    phone: { type: String, default: null },
    email: { type: String, default: null },
    address: { type: String, default: null },
    emergency_contact: { type: String, default: null },
    ddr: { type: Date, default: null },
    dpa: { type: Date, default: null },
    gravida: { type: Number, default: 1 },
    para: { type: Number, default: 0 },
    antecedents_familiaux: { type: mongoose.Schema.Types.Mixed, default: {} },
    antecedents_medicaux: { type: mongoose.Schema.Types.Mixed, default: {} },
    antecedents_gyneo: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ['normal', 'a_surveiller', 'urgent'], default: 'normal' },
    photo_path: { type: String, default: null },
    height_cm: { type: Number, default: null },
    previous_breastfeeding: { type: String, default: null },
    delivery_prognosis: { type: String, default: null },
    birth_delivery: { type: mongoose.Schema.Types.Mixed, default: null },
    birth_newborn: { type: mongoose.Schema.Types.Mixed, default: null },
    vaccination_mother: { type: mongoose.Schema.Types.Mixed, default: {} },
    vaccination_baby: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
)

export const Patient = mongoose.model('Patient', PatientSchema)
