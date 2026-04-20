import mongoose from 'mongoose'

const ComplicationSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    symptoms: { type: String, required: true },
    actions: { type: String, required: true },
    severity: { type: String, required: true },
    order: { type: Number, default: 0 },
    avatar_icon: { type: String, default: null },
  },
  { timestamps: true }
)

export const Complication = mongoose.model('Complication', ComplicationSchema)
