import mongoose from 'mongoose'

const MessageSchema = new mongoose.Schema(
  {
    patient_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    sender_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true },
    attachment_path: { type: String, default: null },
    read_at: { type: Date, default: null },
  },
  { timestamps: true }
)

export const Message = mongoose.model('Message', MessageSchema)
