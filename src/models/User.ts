import mongoose from 'mongoose'

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    first_name: { type: String, required: true },
    last_name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, default: null },
    password: { type: String, required: true },
    role: { type: String, enum: ['patient', 'staff'], required: true },
    hospital_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Hospital', default: null },
    service_id: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true }
)

export const User = mongoose.model('User', UserSchema)
