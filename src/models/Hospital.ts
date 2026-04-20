import mongoose from 'mongoose'

const ServiceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
  },
  { _id: true }
)

const HospitalSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    services: [ServiceSchema],
  },
  { timestamps: true }
)

export type HospitalDoc = mongoose.InferSchemaType<typeof HospitalSchema> & { _id: mongoose.Types.ObjectId }
export const Hospital = mongoose.model('Hospital', HospitalSchema)
