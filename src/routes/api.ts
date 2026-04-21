import bcrypt from 'bcryptjs'
import { endOfMonth, format, startOfMonth, startOfDay } from 'date-fns'
import type { NextFunction, Request, Response } from 'express'
import { Router } from 'express'
import mongoose from 'mongoose'
import { z } from 'zod'
import { sendAuthFailed, sendValidation } from '../lib/httpErrors.js'
import { emptyPatientMatch, staffCanAccessPatient, staffPatientScope } from '../lib/staffPatientScope.js'
import { signToken } from '../lib/jwt.js'
import { ddrFromDpa, trimestreDateRange } from '../lib/pregnancy.js'
import { normalizeTunisianPhone, tunisianMobileRegex } from '../lib/phone.js'
import { vaccinationResponse } from '../lib/vaccinationDefaults.js'
import { DEFAULT_DELIVERY, DEFAULT_NEWBORN } from '../lib/birthDefaults.js'
import { authMiddleware, requireRole } from '../middleware/auth.js'
import { Appointment } from '../models/Appointment.js'
import { Complication } from '../models/Complication.js'
import { Consultation } from '../models/Consultation.js'
import { Hospital } from '../models/Hospital.js'
import { Message } from '../models/Message.js'
import { Patient } from '../models/Patient.js'
import { PregnancyMonitoringVisit } from '../models/PregnancyMonitoringVisit.js'
import { User } from '../models/User.js'
import { hospitalServiceLabels, serviceBelongsToHospital } from '../services/hospital.js'
import {
  ageYears,
  dmy,
  humanSince,
  iso,
  patientComputed,
  userResourceWithPatient,
  userResource,
  ymd,
} from '../services/serializers.js'

const router = Router()

/** Dossier Patient : vérifie l’existence et que le staff exerce dans le même hôpital / service. */
async function patientForStaff(req: Request, res: Response, patientId: string) {
  if (!mongoose.isValidObjectId(patientId)) {
    res.status(404).json({ message: 'Not Found' })
    return null
  }
  const patient = await Patient.findById(patientId)
  if (!patient) {
    res.status(404).json({ message: 'Not Found' })
    return null
  }
  if (!staffCanAccessPatient(req.authUser!, patient)) {
    res.status(403).json({ message: 'Accès non autorisé à ce dossier.' })
    return null
  }
  return patient
}

function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

function zodErrors(err: z.ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {}
  for (const issue of err.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_'
    errors[key] = errors[key] ?? []
    errors[key].push(issue.message)
  }
  return errors
}

const passwordField = z.string().min(8, 'Le mot de passe doit contenir au moins 8 caractères.')

function appointmentShape(a: { _id: mongoose.Types.ObjectId; scheduled_at: Date; type: string; professional_name?: string | null; location?: string | null; notes?: string | null; recommendations?: string | null; status: string }) {
  return {
    id: String(a._id),
    scheduled_at: a.scheduled_at.toISOString(),
    date: format(a.scheduled_at, 'dd/MM/yyyy'),
    time: format(a.scheduled_at, 'HH:mm'),
    type: a.type,
    professional_name: a.professional_name,
    location: a.location,
    notes: a.notes,
    recommendations: a.recommendations,
    status: a.status,
  }
}

function visitShape(v: {
  _id: mongoose.Types.ObjectId
  visit_date: Date
  weeks_ga: string
  metrorragia: boolean
  leucorrhea: boolean
  ma?: string | null
  hu?: string | null
  bdc?: string | null
  presentation?: string | null
  ta?: string | null
  edema: boolean
  albuminuria?: string | null
  glycosuria?: string | null
  hb?: string | null
  medication?: string | null
  hospitalization?: string | null
}) {
  return {
    id: String(v._id),
    visitDate: format(v.visit_date, 'dd/MM/yyyy'),
    weeksGA: v.weeks_ga,
    metrorragia: v.metrorragia,
    leucorrhea: v.leucorrhea,
    ma: v.ma ?? '-',
    hu: v.hu,
    bdc: v.bdc,
    presentation: v.presentation,
    ta: v.ta,
    edema: v.edema,
    albuminuria: v.albuminuria,
    glycosuria: v.glycosuria,
    hb: v.hb,
    medication: v.medication,
    hospitalization: v.hospitalization ?? '-',
  }
}

function generalMonitoring(p: mongoose.Document | Record<string, unknown>) {
  const doc = p as Record<string, unknown>
  const height = doc.height_cm ? `${doc.height_cm} cm` : null
  return {
    gravida: String(doc.gravida ?? 1),
    parity: String(doc.para ?? 0),
    ddr: doc.ddr ? format(new Date(doc.ddr as Date), 'dd/MM/yyyy') : undefined,
    dpa: doc.dpa ? format(new Date(doc.dpa as Date), 'dd/MM/yyyy') : undefined,
    height: height ?? '—',
    previousBreastfeeding: (doc.previous_breastfeeding as string) ?? '—',
    deliveryPrognosis: (doc.delivery_prognosis as string) ?? 'Normal',
  }
}

router.get(
  '/hospitals',
  asyncHandler(async (_req, res) => {
    const hospitals = await Hospital.find().sort({ name: 1 }).lean()
    res.json({
      hospitals: hospitals.map((h) => ({
        id: String(h._id),
        name: h.name,
        services: (h.services as { _id: mongoose.Types.ObjectId; name: string }[]).map((s) => ({
          id: String(s._id),
          name: s.name,
        })),
      })),
    })
  })
)

router.get(
  '/complications',
  asyncHandler(async (req, res) => {
    const q: Record<string, unknown> = {}
    if (req.query.search && String(req.query.search).trim()) {
      const s = String(req.query.search)
      q.$or = [
        { title: new RegExp(s, 'i') },
        { description: new RegExp(s, 'i') },
        { symptoms: new RegExp(s, 'i') },
      ]
    }
    if (req.query.severity) q.severity = String(req.query.severity)
    const items = await Complication.find(q).sort({ order: 1, title: 1 }).lean()
    res.json({
      data: items.map((c) => ({
        id: String(c._id),
        slug: c.slug,
        title: c.title,
        description: c.description,
        symptoms: c.symptoms,
        actions: c.actions,
        severity: c.severity,
        avatar_icon: (c as { avatar_icon?: string }).avatar_icon ?? null,
      })),
    })
  })
)

router.get(
  '/complications/:slug',
  asyncHandler(async (req, res) => {
    const c = await Complication.findOne({ slug: req.params.slug }).lean()
    if (!c) return res.status(404).json({ message: 'Not Found' })
    res.json({
      id: String(c._id),
      slug: c.slug,
      title: c.title,
      description: c.description,
      symptoms: c.symptoms,
      actions: c.actions,
      severity: c.severity,
      avatar_icon: (c as { avatar_icon?: string }).avatar_icon ?? null,
    })
  })
)

const registerPatientSchema = z
  .object({
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(1),
    date_accouchement: z.string().optional().nullable(),
    hospital_id: z.string().min(1),
    service_id: z.string().min(1),
    password: passwordField,
    password_confirmation: z.string(),
  })
  .refine((d) => d.password === d.password_confirmation, { message: 'Les mots de passe ne correspondent pas.', path: ['password'] })

router.post(
  '/auth/register',
  asyncHandler(async (req, res) => {
    const parsed = registerPatientSchema.safeParse({
      ...req.body,
      phone: normalizeTunisianPhone(req.body?.phone),
    })
    if (!parsed.success) return sendValidation(res, zodErrors(parsed.error))
    const v = parsed.data
    if (!mongoose.isValidObjectId(v.hospital_id) || !mongoose.isValidObjectId(v.service_id)) {
      return sendValidation(res, { hospital_id: ['Invalid hospital or service.'] })
    }
    if (!(await serviceBelongsToHospital(v.hospital_id, v.service_id))) {
      return sendValidation(res, { service_id: ['Choisissez un hôpital et un service cohérents.'] })
    }
    const phone = v.phone ?? ''
    if (!tunisianMobileRegex.test(phone)) {
      return sendValidation(res, {
        phone: ['Le numéro doit être un mobile tunisien valide (+216 et 8 chiffres).'],
      })
    }
    const exists = await User.findOne({ email: v.email.toLowerCase() })
    if (exists) return sendValidation(res, { email: ['The email has already been taken.'] })

    const hash = await bcrypt.hash(v.password, 10)
    const user = await User.create({
      name: `${v.first_name} ${v.last_name}`,
      first_name: v.first_name,
      last_name: v.last_name,
      email: v.email.toLowerCase(),
      phone,
      password: hash,
      role: 'patient',
    })

    const dpa = v.date_accouchement ? new Date(v.date_accouchement) : null
    const ddr = dpa ? ddrFromDpa(dpa) : null
    const emailLower = v.email.toLowerCase()

    /** Dossier créé par le pro (sans compte) : liaison par même email + même hôpital / service. */
    const orphanByEmail = await Patient.findOne({ user_id: null, email: emailLower })
    if (orphanByEmail) {
      if (
        String(orphanByEmail.hospital_id) !== String(v.hospital_id) ||
        String(orphanByEmail.service_id) !== String(v.service_id)
      ) {
        await User.findByIdAndDelete(user._id)
        return sendValidation(res, {
          hospital_id: [
            'Un dossier médical existe déjà pour cet email dans un autre hôpital ou service. Sélectionnez le même établissement que celui enregistré par votre équipe.',
          ],
        })
      }
      orphanByEmail.user_id = user._id as unknown as typeof orphanByEmail.user_id
      if (!orphanByEmail.phone && phone) orphanByEmail.phone = phone
      if (!orphanByEmail.dpa && dpa) {
        orphanByEmail.dpa = dpa
        if (!orphanByEmail.ddr && ddr) orphanByEmail.ddr = ddr
      }
      await orphanByEmail.save()
    } else {
      const dossierNumber = `BABY-${String(user._id).slice(-8)}-${format(new Date(), 'yyyy')}`
      await Patient.create({
        user_id: user._id,
        dossier_number: dossierNumber,
        first_name: v.first_name,
        last_name: v.last_name,
        email: emailLower,
        phone,
        dpa,
        ddr,
        hospital_id: v.hospital_id,
        service_id: v.service_id,
        status: 'normal',
      })
    }

    const patient = await Patient.findOne({ user_id: user._id }).lean()
    const token = signToken({ sub: String(user._id), role: 'patient' })
    const fresh = await User.findById(user._id)
    if (!fresh) return res.status(500).json({ message: 'Erreur serveur' })
    res.status(201).json({
      user: await userResourceWithPatient(fresh, patient),
      token,
      token_type: 'Bearer',
    })
  })
)

const registerStaffSchema = z
  .object({
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().optional().nullable(),
    hospital_id: z.string().min(1),
    service_id: z.string().min(1),
    password: passwordField,
    password_confirmation: z.string(),
  })
  .refine((d) => d.password === d.password_confirmation, { message: 'Les mots de passe ne correspondent pas.', path: ['password'] })

router.post(
  '/auth/register-staff',
  asyncHandler(async (req, res) => {
    const parsed = registerStaffSchema.safeParse({
      ...req.body,
      phone: normalizeTunisianPhone(req.body?.phone),
    })
    if (!parsed.success) return sendValidation(res, zodErrors(parsed.error))
    const v = parsed.data
    if (!mongoose.isValidObjectId(v.hospital_id) || !mongoose.isValidObjectId(v.service_id)) {
      return sendValidation(res, { hospital_id: ['Invalid hospital or service.'] })
    }
    if (!(await serviceBelongsToHospital(v.hospital_id, v.service_id))) {
      return sendValidation(res, { service_id: ['Choisissez un hôpital et un service cohérents.'] })
    }
    if (v.phone && !tunisianMobileRegex.test(v.phone)) {
      return sendValidation(res, { phone: ['Le numéro doit être un mobile tunisien valide (+216 et 8 chiffres).'] })
    }
    const exists = await User.findOne({ email: v.email.toLowerCase() })
    if (exists) return sendValidation(res, { email: ['The email has already been taken.'] })

    const hash = await bcrypt.hash(v.password, 10)
    const user = await User.create({
      name: `${v.first_name} ${v.last_name}`,
      first_name: v.first_name,
      last_name: v.last_name,
      email: v.email.toLowerCase(),
      phone: v.phone || null,
      password: hash,
      role: 'staff',
      hospital_id: v.hospital_id,
      service_id: v.service_id,
    })

    const token = signToken({ sub: String(user._id), role: 'staff' })
    const fresh = await User.findById(user._id)
    if (!fresh) return res.status(500).json({ message: 'Erreur serveur' })
    res.status(201).json({
      user: await userResource(fresh),
      token,
      token_type: 'Bearer',
    })
  })
)

router.post(
  '/auth/login',
  asyncHandler(async (req, res) => {
    const parsed = z.object({ email: z.string().email(), password: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return sendValidation(res, zodErrors(parsed.error))
    const user = await User.findOne({ email: parsed.data.email.toLowerCase() })
    if (!user || !(await bcrypt.compare(parsed.data.password, user.password))) {
      return sendAuthFailed(res)
    }
    const token = signToken({ sub: String(user._id), role: user.role as 'patient' | 'staff' })
    const patient = user.role === 'patient' ? await Patient.findOne({ user_id: user._id }).lean() : null
    res.json({
      user: await userResourceWithPatient(user, patient),
      token,
      token_type: 'Bearer',
    })
  })
)

router.post(
  '/auth/forgot-password',
  asyncHandler(async (req, res) => {
    const parsed = z.object({ email: z.string().email() }).safeParse(req.body)
    if (!parsed.success) return sendValidation(res, zodErrors(parsed.error))
    res.json({ message: 'Lien de réinitialisation envoyé par email.' })
  })
)

router.use(authMiddleware)

router.post('/auth/logout', (_req, res) => {
  res.json({ message: 'Déconnexion réussie' })
})

router.get(
  '/auth/user',
  asyncHandler(async (req, res) => {
    const user = req.authUser!
    const patient = user.role === 'patient' ? await Patient.findOne({ user_id: user._id }).lean() : null
    res.json({ user: await userResourceWithPatient(user, patient) })
  })
)

router.put(
  '/auth/profile',
  asyncHandler(async (req, res) => {
    const parsed = z
      .object({
        hospital_id: z.string().min(1),
        service_id: z.string().min(1),
      })
      .safeParse(req.body)
    if (!parsed.success) return sendValidation(res, zodErrors(parsed.error))
    const { hospital_id, service_id } = parsed.data
    if (!mongoose.isValidObjectId(hospital_id) || !mongoose.isValidObjectId(service_id)) {
      return sendValidation(res, { hospital_id: ['Invalid.'] })
    }
    if (!(await serviceBelongsToHospital(hospital_id, service_id))) {
      return sendValidation(res, { service_id: ['Choisissez un hôpital et un service cohérents.'] })
    }
    const user = req.authUser!
    if (user.role === 'patient') {
      const p = await Patient.findOne({ user_id: user._id })
      if (!p) return res.status(404).json({ message: 'Dossier non trouvé' })
      p.hospital_id = hospital_id as unknown as typeof p.hospital_id
      p.service_id = service_id as unknown as typeof p.service_id
      await p.save()
    } else {
      user.hospital_id = hospital_id as unknown as typeof user.hospital_id
      user.service_id = service_id as unknown as typeof user.service_id
      await user.save()
    }
    const patient = user.role === 'patient' ? await Patient.findOne({ user_id: user._id }).lean() : null
    res.json({ user: await userResourceWithPatient(user, patient) })
  })
)

router.use('/maman', requireRole('patient'))

router.get(
  '/maman/dashboard',
  asyncHandler(async (req, res) => {
    const user = req.authUser!
    const patient = await Patient.findOne({ user_id: user._id })
    if (!patient) return res.status(404).json({ message: 'Dossier patient non trouvé' })

    const nextAppointment = await Appointment.findOne({
      patient_id: patient._id,
      scheduled_at: { $gte: new Date() },
      status: 'scheduled',
    })
      .sort({ scheduled_at: 1 })
      .lean()

    const unreadCount = await Message.countDocuments({
      patient_id: patient._id,
      sender_id: { $ne: user._id },
      read_at: null,
    })

    const recentActivity: { type: string; title: string; description: string; date: string }[] = []
    const lastConsult = await Consultation.findOne({ patient_id: patient._id }).sort({ consultation_date: -1 }).lean()
    if (lastConsult?.consultation_date) {
      const created = (lastConsult as { createdAt?: Date }).createdAt
      recentActivity.push({
        type: 'consultation',
        title: 'Rendez-vous complété',
        description: `Consultation du ${format(new Date(lastConsult.consultation_date), 'dd/MM/yyyy')}`,
        date: (created && humanSince(created)) || '',
      })
    }
    const lastMessage = await Message.findOne({ patient_id: patient._id, sender_id: { $ne: user._id } })
      .sort({ createdAt: -1 })
      .lean()
    if (lastMessage?.createdAt) {
      recentActivity.push({
        type: 'message',
        title: 'Nouveau message',
        description: "L'équipe médicale vous a envoyé un message",
        date: humanSince(lastMessage.createdAt as Date) ?? '',
      })
    }

    const c = patientComputed({ ddr: patient.ddr, dpa: patient.dpa })
    let daysToNextRdv: number | null = null
    if (nextAppointment?.scheduled_at) {
      daysToNextRdv = Math.round(
        (startOfDay(new Date(nextAppointment.scheduled_at as Date)).getTime() - startOfDay(new Date()).getTime()) /
          (86400 * 1000)
      )
    }

    res.json({
      patient: {
        first_name: patient.first_name,
        semaines_amenorrhee: c.semaines_amenorrhee,
        trimestre: c.trimestre,
        jours_avant_accouchement: c.jours_avant_accouchement,
        status: patient.status,
        dpa: ymd(patient.dpa),
      },
      next_appointment: nextAppointment
        ? {
            id: String(nextAppointment._id),
            scheduled_at: new Date(nextAppointment.scheduled_at as Date).toISOString(),
            date: format(new Date(nextAppointment.scheduled_at as Date), 'dd/MM/yyyy'),
            time: format(new Date(nextAppointment.scheduled_at as Date), 'HH:mm'),
            type: nextAppointment.type,
            professional_name: nextAppointment.professional_name,
            location: nextAppointment.location,
            days_until: daysToNextRdv,
          }
        : null,
      unread_messages_count: unreadCount,
      recent_activity: recentActivity.slice(0, 5),
    })
  })
)

async function dossierPayload(patient: mongoose.HydratedDocument<typeof Patient.prototype>) {
  const { hospital, service } = await hospitalServiceLabels(patient.hospital_id, patient.service_id)
  const consultations = await Consultation.find({ patient_id: patient._id }).sort({ consultation_date: -1 }).limit(50).lean()
  const c = patientComputed({ ddr: patient.ddr, dpa: patient.dpa })
  return {
    id: String(patient._id),
    dossier_number: patient.dossier_number,
    first_name: patient.first_name,
    last_name: patient.last_name,
    date_of_birth: ymd(patient.date_of_birth),
    age: ageYears(patient.date_of_birth),
    blood_group: patient.blood_group,
    allergies: patient.allergies,
    phone: patient.phone,
    email: patient.email,
    address: patient.address,
    emergency_contact: patient.emergency_contact,
    ddr: ymd(patient.ddr),
    dpa: ymd(patient.dpa),
    gravida: patient.gravida,
    para: patient.para,
    semaines_amenorrhee: c.semaines_amenorrhee,
    trimestre: c.trimestre,
    jours_avant_accouchement: c.jours_avant_accouchement,
    status: patient.status,
    hospital_id: String(patient.hospital_id),
    service_id: String(patient.service_id),
    hospital,
    service,
    antecedents_familiaux: patient.antecedents_familiaux ?? [],
    antecedents_medicaux: patient.antecedents_medicaux ?? [],
    antecedents_gyneo: patient.antecedents_gyneo ?? [],
    consultations: consultations.map((cRow) => ({
      id: String(cRow._id),
      consultation_date: ymd(cRow.consultation_date as Date),
      type: cRow.type,
      summary: cRow.summary,
      exam_data: cRow.exam_data,
      lab_results: cRow.lab_results,
      echography_data: cRow.echography_data,
      result_status: cRow.result_status,
      recommendations: cRow.recommendations,
    })),
  }
}

router.get(
  '/maman/dossier',
  asyncHandler(async (req, res) => {
    const patient = await Patient.findOne({ user_id: req.authUser!._id })
    if (!patient) return res.status(404).json({ message: 'Dossier non trouvé' })
    res.json({ patient: await dossierPayload(patient) })
  })
)

const mamanDossierAntecedentsSchema = z.object({
  antecedents_familiaux: z.union([z.array(z.string()), z.record(z.unknown())]).optional().nullable(),
  antecedents_medicaux: z.union([z.array(z.string()), z.record(z.unknown())]).optional().nullable(),
  antecedents_gyneo: z.union([z.array(z.string()), z.record(z.unknown())]).optional().nullable(),
})

router.put(
  '/maman/dossier',
  asyncHandler(async (req, res) => {
    const patient = await Patient.findOne({ user_id: req.authUser!._id })
    if (!patient) return res.status(404).json({ message: 'Dossier non trouvé' })
    const parsed = mamanDossierAntecedentsSchema.safeParse(req.body)
    if (!parsed.success) return sendValidation(res, zodErrors(parsed.error))
    const v = parsed.data
    if (
      v.antecedents_familiaux === undefined &&
      v.antecedents_medicaux === undefined &&
      v.antecedents_gyneo === undefined
    ) {
      return sendValidation(res, { body: ['Indiquez au moins un bloc d’antécédents à enregistrer.'] })
    }
    if (v.antecedents_familiaux !== undefined) {
      patient.antecedents_familiaux =
        v.antecedents_familiaux == null
          ? {}
          : Array.isArray(v.antecedents_familiaux)
            ? v.antecedents_familiaux
            : (v.antecedents_familiaux as Record<string, unknown>)
    }
    if (v.antecedents_medicaux !== undefined) {
      patient.antecedents_medicaux =
        v.antecedents_medicaux == null
          ? {}
          : Array.isArray(v.antecedents_medicaux)
            ? v.antecedents_medicaux
            : (v.antecedents_medicaux as Record<string, unknown>)
    }
    if (v.antecedents_gyneo !== undefined) {
      patient.antecedents_gyneo =
        v.antecedents_gyneo == null
          ? {}
          : Array.isArray(v.antecedents_gyneo)
            ? v.antecedents_gyneo
            : (v.antecedents_gyneo as Record<string, unknown>)
    }
    await patient.save()
    res.json({ patient: await dossierPayload(patient) })
  })
)

router.get(
  '/maman/rendez-vous',
  asyncHandler(async (req, res) => {
    const patient = await Patient.findOne({ user_id: req.authUser!._id })
    if (!patient) return res.status(404).json({ message: 'Dossier non trouvé' })
    const upcoming = await Appointment.find({
      patient_id: patient._id,
      scheduled_at: { $gte: new Date() },
      status: 'scheduled',
    })
      .sort({ scheduled_at: 1 })
      .lean()
    const past = await Appointment.find({
      patient_id: patient._id,
      $or: [{ scheduled_at: { $lt: new Date() } }, { status: 'completed' }],
    })
      .sort({ scheduled_at: -1 })
      .limit(50)
      .lean()
    res.json({
      upcoming: upcoming.map((a) => appointmentShape(a as Parameters<typeof appointmentShape>[0])),
      past: past.map((a) => appointmentShape(a as Parameters<typeof appointmentShape>[0])),
    })
  })
)

router.get(
  '/maman/rendez-vous/upcoming',
  asyncHandler(async (req, res) => {
    const patient = await Patient.findOne({ user_id: req.authUser!._id })
    if (!patient) return res.status(404).json({ message: 'Dossier non trouvé' })
    const items = await Appointment.find({
      patient_id: patient._id,
      scheduled_at: { $gte: new Date() },
      status: 'scheduled',
    })
      .sort({ scheduled_at: 1 })
      .limit(5)
      .lean()
    res.json({ data: items.map((a) => appointmentShape(a as Parameters<typeof appointmentShape>[0])) })
  })
)

router.get(
  '/maman/messages',
  asyncHandler(async (req, res) => {
    const patient = await Patient.findOne({ user_id: req.authUser!._id })
    if (!patient) return res.status(404).json({ message: 'Dossier non trouvé' })
    await Message.updateMany(
      { patient_id: patient._id, sender_id: { $ne: req.authUser!._id }, read_at: null },
      { $set: { read_at: new Date() } }
    )
    const messages = await Message.find({ patient_id: patient._id }).sort({ createdAt: 1 }).populate('sender_id').lean()
    res.json({
      messages: messages.map((m) => {
        const sender = m.sender_id as { _id: mongoose.Types.ObjectId; first_name?: string; name?: string; role?: string }
        return {
          id: String(m._id),
          body: m.body,
          attachment_path: m.attachment_path,
          sender_id: String(sender._id),
          is_from_me: String(sender._id) === String(req.authUser!._id),
          sender_name: sender.first_name ?? sender.name,
          read_at: iso(m.read_at as Date | null),
          created_at: iso(m.createdAt as Date)!,
        }
      }),
    })
  })
)

router.post(
  '/maman/messages',
  asyncHandler(async (req, res) => {
    const patient = await Patient.findOne({ user_id: req.authUser!._id })
    if (!patient) return res.status(404).json({ message: 'Dossier non trouvé' })
    const parsed = z
      .object({ body: z.string().min(1).max(5000), attachment_path: z.string().optional().nullable() })
      .safeParse(req.body)
    if (!parsed.success) return sendValidation(res, zodErrors(parsed.error))
    const msg = await Message.create({
      patient_id: patient._id,
      sender_id: req.authUser!._id,
      body: parsed.data.body,
      attachment_path: parsed.data.attachment_path ?? null,
    })
    res.status(201).json({
      message: 'Message envoyé',
      data: {
        id: String(msg._id),
        body: msg.body,
        is_from_me: true,
        created_at: msg.createdAt!.toISOString(),
      },
    })
  })
)

router.get(
  '/maman/surveillance-grossesse',
  asyncHandler(async (req, res) => {
    const patient = await Patient.findOne({ user_id: req.authUser!._id })
    if (!patient) return res.status(404).json({ message: 'Dossier non trouvé' })
    const visits = await PregnancyMonitoringVisit.find({ patient_id: patient._id }).sort({ visit_date: -1 }).lean()
    res.json({
      general: generalMonitoring(patient.toObject()),
      visits: visits.map((v) => visitShape(v as Parameters<typeof visitShape>[0])),
    })
  })
)

router.get(
  '/maman/accouchement',
  asyncHandler(async (req, res) => {
    const patient = await Patient.findOne({ user_id: req.authUser!._id })
    if (!patient) return res.status(404).json({ message: 'Dossier non trouvé' })
    const delivery = { ...DEFAULT_DELIVERY, ...(patient.birth_delivery as object) }
    const newborn = { ...DEFAULT_NEWBORN, ...(patient.birth_newborn as object) }
    res.json({ deliveryInfo: delivery, newbornInfo: newborn })
  })
)

router.get(
  '/maman/vaccination',
  asyncHandler(async (req, res) => {
    const patient = await Patient.findOne({ user_id: req.authUser!._id })
    if (!patient) return res.status(404).json({ message: 'Dossier non trouvé' })
    res.json(vaccinationResponse(patient.vaccination_mother, patient.vaccination_baby))
  })
)

router.put(
  '/maman/vaccination',
  asyncHandler(async (req, res) => {
    const patient = await Patient.findOne({ user_id: req.authUser!._id })
    if (!patient) return res.status(404).json({ message: 'Dossier non trouvé' })
    const parsed = z
      .object({
        mother: z.record(z.boolean()).optional(),
        baby: z.record(z.boolean()).optional(),
      })
      .safeParse(req.body)
    if (!parsed.success) return sendValidation(res, zodErrors(parsed.error))
    const motherMap: Record<string, boolean> = {}
    const babyMap: Record<string, boolean> = {}
    if (parsed.data.mother) for (const [k, v] of Object.entries(parsed.data.mother)) motherMap[String(k)] = Boolean(v)
    if (parsed.data.baby) for (const [k, v] of Object.entries(parsed.data.baby)) babyMap[String(k)] = Boolean(v)
    patient.vaccination_mother = motherMap
    patient.vaccination_baby = babyMap
    await patient.save()
    res.json(vaccinationResponse(patient.vaccination_mother, patient.vaccination_baby))
  })
)

router.use('/pro', requireRole('staff'))

router.get(
  '/pro/dashboard',
  asyncHandler(async (req, res) => {
    const scope = staffPatientScope(req.authUser!)
    const scopeFilter = scope ? { ...scope } : { ...emptyPatientMatch() }
    const scopedPatients = await Patient.find(scopeFilter).select('_id user_id').lean()
    const patientIds = scopedPatients.map((p) => p._id)
    const patientUserIds = scopedPatients
      .map((p) => p.user_id)
      .filter((id): id is mongoose.Types.ObjectId => id != null)

    const activePatients = await Patient.countDocuments(scopeFilter)
    const todayStart = startOfDay(new Date())
    const todayEnd = new Date(todayStart.getTime() + 86400 * 1000 - 1)
    const todayAppointments =
      patientIds.length > 0
        ? await Appointment.countDocuments({
            patient_id: { $in: patientIds },
            scheduled_at: { $gte: todayStart, $lte: todayEnd },
            status: 'scheduled',
          })
        : 0
    const unreadMessages =
      patientUserIds.length > 0 && patientIds.length > 0
        ? await Message.countDocuments({
            read_at: null,
            sender_id: { $in: patientUserIds },
            patient_id: { $in: patientIds },
          })
        : 0
    const monthFollowUps =
      patientIds.length > 0
        ? await Appointment.countDocuments({
            patient_id: { $in: patientIds },
            scheduled_at: { $gte: startOfMonth(new Date()), $lte: endOfMonth(new Date()) },
            status: 'scheduled',
          })
        : 0

    const recentPatients = await Patient.find(scopeFilter).sort({ createdAt: -1 }).limit(10).lean()
    const recent = await Promise.all(
      recentPatients.map(async (p) => {
        const lastVisit = await Consultation.findOne({ patient_id: p._id }).sort({ consultation_date: -1 }).lean()
        const nextRdv = await Appointment.findOne({
          patient_id: p._id,
          scheduled_at: { $gte: new Date() },
          status: 'scheduled',
        })
          .sort({ scheduled_at: 1 })
          .lean()
        const c = patientComputed({ ddr: p.ddr as Date, dpa: p.dpa as Date })
        return {
          id: String(p._id),
          dossier_number: p.dossier_number,
          first_name: p.first_name,
          last_name: p.last_name,
          age: ageYears(p.date_of_birth as Date),
          semaines_amenorrhee: c.semaines_amenorrhee,
          trimestre: c.trimestre,
          status: p.status,
          last_visit: lastVisit?.consultation_date ? format(new Date(lastVisit.consultation_date), 'dd/MM/yyyy') : null,
          next_rdv: nextRdv?.scheduled_at ? format(new Date(nextRdv.scheduled_at), 'dd/MM/yyyy') : null,
        }
      })
    )

    res.json({
      stats: {
        active_patients: activePatients,
        today_appointments: todayAppointments,
        unread_messages: unreadMessages,
        month_follow_ups: monthFollowUps,
      },
      recent_patients: recent,
      stats_by_status: {
        normal: await Patient.countDocuments({ ...scopeFilter, status: 'normal' }),
        a_surveiller: await Patient.countDocuments({ ...scopeFilter, status: 'a_surveiller' }),
        urgent: await Patient.countDocuments({ ...scopeFilter, status: 'urgent' }),
      },
    })
  })
)

router.get(
  '/pro/patients',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1)
    const perPage = 20
    const scope = staffPatientScope(req.authUser!)
    const filter: Record<string, unknown> = scope ? { ...scope } : { ...emptyPatientMatch() }
    if (req.query.search && String(req.query.search).trim()) {
      const s = String(req.query.search)
      filter.$or = [
        { dossier_number: new RegExp(s, 'i') },
        { first_name: new RegExp(s, 'i') },
        { last_name: new RegExp(s, 'i') },
      ]
    }
    if (req.query.status) filter.status = String(req.query.status)
    if (req.query.trimestre) {
      const tr = Number(req.query.trimestre)
      const r = trimestreDateRange(tr)
      const ddrFilter: Record<string, unknown> = { $ne: null, $exists: true }
      if (r.ddrGte) ddrFilter.$gte = r.ddrGte
      if (r.ddrLt) ddrFilter.$lt = r.ddrLt
      if (r.ddrGte2) ddrFilter.$gte = r.ddrGte2
      filter.ddr = ddrFilter
    }
    const total = await Patient.countDocuments(filter)
    const patients = await Patient.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * perPage)
      .limit(perPage)
      .lean()
    const statsBase = scope ? { ...scope } : { ...emptyPatientMatch() }
    const items = await Promise.all(
      patients.map(async (p) => {
        const lastVisit = await Consultation.findOne({ patient_id: p._id }).sort({ consultation_date: -1 }).lean()
        const nextRdv = await Appointment.findOne({
          patient_id: p._id,
          scheduled_at: { $gte: new Date() },
          status: 'scheduled',
        })
          .sort({ scheduled_at: 1 })
          .lean()
        const c = patientComputed({ ddr: p.ddr as Date, dpa: p.dpa as Date })
        return {
          id: String(p._id),
          dossier_number: p.dossier_number,
          first_name: p.first_name,
          last_name: p.last_name,
          age: ageYears(p.date_of_birth as Date),
          semaines_amenorrhee: c.semaines_amenorrhee,
          trimestre: c.trimestre,
          status: p.status,
          last_visit: lastVisit?.consultation_date ? ymd(lastVisit.consultation_date as Date) : null,
          next_rdv: nextRdv?.scheduled_at ? ymd(nextRdv.scheduled_at as Date) : null,
        }
      })
    )
    const lastPage = Math.max(1, Math.ceil(total / perPage))
    res.json({
      data: items,
      meta: { current_page: page, last_page: lastPage, per_page: perPage, total },
      stats: {
        normal: await Patient.countDocuments({ ...statsBase, status: 'normal' }),
        a_surveiller: await Patient.countDocuments({ ...statsBase, status: 'a_surveiller' }),
        urgent: await Patient.countDocuments({ ...statsBase, status: 'urgent' }),
        total: await Patient.countDocuments(statsBase),
      },
    })
  })
)

const initialMonitoringVisitCreateSchema = z
  .object({
    visit_date: z.string().optional().nullable(),
    weeks_ga: z.string().optional().nullable(),
    metrorragia: z.boolean().optional(),
    leucorrhea: z.boolean().optional(),
    ma: z.string().optional().nullable(),
    hu: z.string().optional().nullable(),
    bdc: z.string().optional().nullable(),
    presentation: z.string().optional().nullable(),
    ta: z.string().optional().nullable(),
    edema: z.boolean().optional(),
    albuminuria: z.string().optional().nullable(),
    glycosuria: z.string().optional().nullable(),
    hb: z.string().optional().nullable(),
    medication: z.string().optional().nullable(),
    hospitalization: z.string().optional().nullable(),
  })
  .optional()
  .nullable()

const storePatientSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  date_of_birth: z.string().optional().nullable(),
  blood_group: z.string().optional().nullable(),
  allergies: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.preprocess((val) => (val === '' || val === null ? undefined : val), z.string().email().optional()),
  address: z.string().optional().nullable(),
  emergency_contact: z.string().optional().nullable(),
  ddr: z.string().optional().nullable(),
  dpa: z.string().optional().nullable(),
  gravida: z.coerce.number().int().min(0).optional().nullable(),
  para: z.coerce.number().int().min(0).optional().nullable(),
  height_cm: z.preprocess((val) => {
    if (val === '' || val === null || val === undefined) return undefined
    const n = Number(val)
    return Number.isFinite(n) ? n : undefined
  }, z.number().int().min(120).max(220).optional()),
  previous_breastfeeding: z.string().max(80).optional().nullable(),
  delivery_prognosis: z.string().max(120).optional().nullable(),
  birth_delivery: z.record(z.unknown()).optional().nullable(),
  birth_newborn: z.record(z.unknown()).optional().nullable(),
  initial_monitoring_visit: initialMonitoringVisitCreateSchema,
  /** Objet ou tableau (même format que l’ancien front Laravel / formulaire pro). */
  antecedents_familiaux: z.union([z.array(z.string()), z.record(z.unknown())]).optional().nullable(),
  antecedents_medicaux: z.union([z.array(z.string()), z.record(z.unknown())]).optional().nullable(),
  antecedents_gyneo: z.union([z.array(z.string()), z.record(z.unknown())]).optional().nullable(),
  hospital_id: z.string().min(1),
  service_id: z.string().min(1),
})

router.post(
  '/pro/patients',
  asyncHandler(async (req, res) => {
    const parsed = storePatientSchema.safeParse(req.body)
    if (!parsed.success) return sendValidation(res, zodErrors(parsed.error))
    const v = parsed.data
    if (!mongoose.isValidObjectId(v.hospital_id) || !mongoose.isValidObjectId(v.service_id)) {
      return sendValidation(res, { hospital_id: ['Invalid.'] })
    }
    if (!(await serviceBelongsToHospital(v.hospital_id, v.service_id))) {
      return sendValidation(res, { service_id: ['Choisissez un hôpital et un service cohérents.'] })
    }
    const staff = req.authUser!
    let hospitalId = v.hospital_id
    let serviceId = v.service_id
    if (staff.hospital_id && staff.service_id) {
      hospitalId = String(staff.hospital_id)
      serviceId = String(staff.service_id)
    }
    const year = format(new Date(), 'yyyy')
    const yearStart = new Date(Number(year), 0, 1)
    const nextNum = (await Patient.countDocuments({ createdAt: { $gte: yearStart } })) + 1
    const dossierNumber = `${year}-${String(nextNum).padStart(6, '0')}`
    const emailNorm = v.email ? String(v.email).toLowerCase().trim() : null

    const hasNonEmptyValues = (inp: unknown): boolean => {
      if (!inp || typeof inp !== 'object') return false
      return Object.values(inp as Record<string, unknown>).some((val) => {
        if (val === undefined || val === null || val === '') return false
        if (typeof val === 'boolean') return true
        return String(val).trim() !== ''
      })
    }
    const birthDel =
      hasNonEmptyValues(v.birth_delivery) && typeof v.birth_delivery === 'object'
        ? { ...DEFAULT_DELIVERY, ...(v.birth_delivery as Record<string, unknown>) }
        : null
    const birthNb =
      hasNonEmptyValues(v.birth_newborn) && typeof v.birth_newborn === 'object'
        ? { ...DEFAULT_NEWBORN, ...(v.birth_newborn as Record<string, unknown>) }
        : null
    const patient = await Patient.create({
      first_name: v.first_name,
      last_name: v.last_name,
      date_of_birth: v.date_of_birth ? new Date(v.date_of_birth) : null,
      blood_group: v.blood_group ?? null,
      allergies: v.allergies ?? null,
      phone: v.phone ?? null,
      email: emailNorm,
      address: v.address ?? null,
      emergency_contact: v.emergency_contact ?? null,
      ddr: v.ddr ? new Date(v.ddr) : null,
      dpa: v.dpa ? new Date(v.dpa) : null,
      gravida: v.gravida ?? 1,
      para: v.para ?? 0,
      height_cm: v.height_cm ?? null,
      previous_breastfeeding: v.previous_breastfeeding ?? null,
      delivery_prognosis: v.delivery_prognosis ?? null,
      ...(birthDel ? { birth_delivery: birthDel } : {}),
      ...(birthNb ? { birth_newborn: birthNb } : {}),
      antecedents_familiaux: v.antecedents_familiaux ?? {},
      antecedents_medicaux: v.antecedents_medicaux ?? {},
      antecedents_gyneo: v.antecedents_gyneo ?? {},
      dossier_number: dossierNumber,
      status: 'normal',
      hospital_id: hospitalId,
      service_id: serviceId,
    })
    const iv = v.initial_monitoring_visit
    if (iv?.visit_date && String(iv.weeks_ga ?? '').trim()) {
      await PregnancyMonitoringVisit.create({
        patient_id: patient._id,
        visit_date: new Date(iv.visit_date),
        weeks_ga: String(iv.weeks_ga).trim(),
        metrorragia: iv.metrorragia ?? false,
        leucorrhea: iv.leucorrhea ?? false,
        ma: iv.ma ?? null,
        hu: iv.hu ?? null,
        bdc: iv.bdc ?? null,
        presentation: iv.presentation ?? null,
        ta: iv.ta ?? null,
        edema: iv.edema ?? false,
        albuminuria: iv.albuminuria ?? null,
        glycosuria: iv.glycosuria ?? null,
        hb: iv.hb ?? null,
        medication: iv.medication ?? null,
        hospitalization: iv.hospitalization ?? null,
      })
    }
    const c = patientComputed({ ddr: patient.ddr, dpa: patient.dpa })
    res.status(201).json({
      message: 'Dossier créé',
      patient: {
        id: String(patient._id),
        dossier_number: patient.dossier_number,
        first_name: patient.first_name,
        last_name: patient.last_name,
        semaines_amenorrhee: c.semaines_amenorrhee,
        trimestre: c.trimestre,
        status: patient.status,
      },
    })
  })
)

async function patientResourceFull(patient: mongoose.HydratedDocument<typeof Patient.prototype>) {
  const { hospital, service } = await hospitalServiceLabels(patient.hospital_id, patient.service_id)
  const upcoming = await Appointment.find({
    patient_id: patient._id,
    scheduled_at: { $gte: new Date() },
    status: 'scheduled',
  })
    .sort({ scheduled_at: 1 })
    .lean()
  const consultations = await Consultation.find({ patient_id: patient._id }).sort({ consultation_date: -1 }).limit(20).lean()
  const c = patientComputed({ ddr: patient.ddr, dpa: patient.dpa })
  const visitsCount = await PregnancyMonitoringVisit.countDocuments({ patient_id: patient._id })
  return {
    id: String(patient._id),
    dossier_number: patient.dossier_number,
    first_name: patient.first_name,
    last_name: patient.last_name,
    date_of_birth: ymd(patient.date_of_birth),
    age: ageYears(patient.date_of_birth),
    blood_group: patient.blood_group,
    allergies: patient.allergies,
    phone: patient.phone,
    email: patient.email,
    address: patient.address,
    emergency_contact: patient.emergency_contact,
    ddr: ymd(patient.ddr),
    dpa: ymd(patient.dpa),
    gravida: patient.gravida,
    para: patient.para,
    semaines_amenorrhee: c.semaines_amenorrhee,
    trimestre: c.trimestre,
    jours_avant_accouchement: c.jours_avant_accouchement,
    status: patient.status,
    hospital_id: String(patient.hospital_id),
    service_id: String(patient.service_id),
    hospital,
    service,
    antecedents_familiaux: patient.antecedents_familiaux ?? [],
    antecedents_medicaux: patient.antecedents_medicaux ?? [],
    antecedents_gyneo: patient.antecedents_gyneo ?? [],
    height_cm: patient.height_cm,
    previous_breastfeeding: patient.previous_breastfeeding,
    delivery_prognosis: patient.delivery_prognosis,
    upcoming_appointments: upcoming.map((a) => ({
      id: String(a._id),
      scheduled_at: new Date(a.scheduled_at as Date).toISOString(),
      type: a.type,
      professional_name: a.professional_name,
      location: a.location,
    })),
    consultations: consultations.map((cRow) => ({
      id: String(cRow._id),
      consultation_date: ymd(cRow.consultation_date as Date),
      type: cRow.type,
      summary: cRow.summary,
      exam_data: cRow.exam_data,
      lab_results: cRow.lab_results,
      result_status: cRow.result_status,
      recommendations: cRow.recommendations,
    })),
    deliveryInfo: { ...DEFAULT_DELIVERY, ...(patient.birth_delivery as object) },
    newbornInfo: { ...DEFAULT_NEWBORN, ...(patient.birth_newborn as object) },
    monitoring_visits_count: visitsCount,
  }
}

router.get(
  '/pro/patients/:patientId',
  asyncHandler(async (req, res) => {
    const patient = await patientForStaff(req, res, req.params.patientId)
    if (!patient) return
    res.json({ patient: await patientResourceFull(patient) })
  })
)

const updatePatientSchema = z.object({
  phone: z.string().optional().nullable(),
  email: z.preprocess((val) => (val === '' || val === null ? undefined : val), z.string().email().optional()),
  address: z.string().optional().nullable(),
  emergency_contact: z.string().optional().nullable(),
  allergies: z.string().optional().nullable(),
  height_cm: z.number().int().min(120).max(220).optional().nullable(),
  previous_breastfeeding: z.string().max(80).optional().nullable(),
  delivery_prognosis: z.string().max(120).optional().nullable(),
  gravida: z.number().int().min(0).max(30).optional().nullable(),
  para: z.number().int().min(0).max(30).optional().nullable(),
  ddr: z.string().optional().nullable(),
  dpa: z.string().optional().nullable(),
  status: z.enum(['normal', 'a_surveiller', 'urgent']).optional().nullable(),
  antecedents_familiaux: z.union([z.array(z.string()), z.record(z.unknown())]).optional().nullable(),
  antecedents_medicaux: z.union([z.array(z.string()), z.record(z.unknown())]).optional().nullable(),
  antecedents_gyneo: z.union([z.array(z.string()), z.record(z.unknown())]).optional().nullable(),
  hospital_id: z.string().optional().nullable(),
  service_id: z.string().optional().nullable(),
})

router.put(
  '/pro/patients/:patientId',
  asyncHandler(async (req, res) => {
    const patient = await patientForStaff(req, res, req.params.patientId)
    if (!patient) return
    const parsed = updatePatientSchema.safeParse(req.body)
    if (!parsed.success) return sendValidation(res, zodErrors(parsed.error))
    const v = parsed.data
    if (v.hospital_id !== undefined && v.hospital_id !== null && v.hospital_id !== '') {
      const hid = v.hospital_id
      const sid = v.service_id ?? String(patient.service_id)
      if (!mongoose.isValidObjectId(hid) || !mongoose.isValidObjectId(sid) || !(await serviceBelongsToHospital(hid, sid))) {
        return sendValidation(res, { service_id: ['Choisissez un hôpital et un service cohérents.'] })
      }
    } else if (v.service_id !== undefined && v.service_id !== null && v.service_id !== '') {
      const hid = String(patient.hospital_id)
      const sid = v.service_id
      if (!mongoose.isValidObjectId(sid) || !(await serviceBelongsToHospital(hid, sid))) {
        return sendValidation(res, { service_id: ['Choisissez un hôpital et un service cohérents.'] })
      }
    }
    const assign = Object.fromEntries(Object.entries(v).filter(([, val]) => val !== undefined)) as Record<string, unknown>
    if (v.ddr !== undefined) assign.ddr = v.ddr ? new Date(v.ddr) : null
    if (v.dpa !== undefined) assign.dpa = v.dpa ? new Date(v.dpa) : null
    patient.set(assign)
    await patient.save()
    res.json({ message: 'Dossier mis à jour', patient: await patientResourceFull(patient) })
  })
)

router.get(
  '/pro/patients/:patientId/appointments',
  asyncHandler(async (req, res) => {
    const patient = await patientForStaff(req, res, req.params.patientId)
    if (!patient) return
    const page = Math.max(1, Number(req.query.page) || 1)
    const perPage = 20
    const total = await Appointment.countDocuments({ patient_id: patient._id })
    const items = await Appointment.find({ patient_id: patient._id })
      .sort({ scheduled_at: -1 })
      .skip((page - 1) * perPage)
      .limit(perPage)
      .lean()
    res.json({
      data: items.map((a) => appointmentShape(a as Parameters<typeof appointmentShape>[0])),
      meta: { current_page: page, last_page: Math.max(1, Math.ceil(total / perPage)), total },
    })
  })
)

router.post(
  '/pro/patients/:patientId/appointments',
  asyncHandler(async (req, res) => {
    const patient = await patientForStaff(req, res, req.params.patientId)
    if (!patient) return
    const parsed = z
      .object({
        scheduled_at: z.string().min(1),
        type: z.string().min(1).max(100),
        professional_name: z.string().max(255).optional().nullable(),
        location: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
      })
      .safeParse(req.body)
    if (!parsed.success) return sendValidation(res, zodErrors(parsed.error))
    const a = await Appointment.create({
      patient_id: patient._id,
      scheduled_at: new Date(parsed.data.scheduled_at),
      type: parsed.data.type,
      professional_name: parsed.data.professional_name ?? null,
      location: parsed.data.location ?? null,
      notes: parsed.data.notes ?? null,
      status: 'scheduled',
    })
    res.status(201).json({ message: 'Rendez-vous créé', appointment: appointmentShape(a.toObject() as Parameters<typeof appointmentShape>[0]) })
  })
)

router.get(
  '/pro/patients/:patientId/consultations',
  asyncHandler(async (req, res) => {
    const patient = await patientForStaff(req, res, req.params.patientId)
    if (!patient) return
    const page = Math.max(1, Number(req.query.page) || 1)
    const perPage = 20
    const total = await Consultation.countDocuments({ patient_id: patient._id })
    const rows = await Consultation.find({ patient_id: patient._id })
      .sort({ consultation_date: -1 })
      .skip((page - 1) * perPage)
      .limit(perPage)
      .lean()
    res.json({
      data: rows.map((c) => ({
        id: String(c._id),
        consultation_date: ymd(c.consultation_date as Date),
        type: c.type,
        summary: c.summary,
        exam_data: c.exam_data,
        lab_results: c.lab_results,
        echography_data: c.echography_data,
        result_status: c.result_status,
        recommendations: c.recommendations,
      })),
      meta: { current_page: page, last_page: Math.max(1, Math.ceil(total / perPage)), total },
    })
  })
)

router.post(
  '/pro/patients/:patientId/consultations',
  asyncHandler(async (req, res) => {
    const patient = await patientForStaff(req, res, req.params.patientId)
    if (!patient) return
    const parsed = z
      .object({
        consultation_date: z.string().min(1),
        type: z.string().max(100).optional().nullable(),
        summary: z.string().optional().nullable(),
        exam_data: z.any().optional().nullable(),
        lab_results: z.any().optional().nullable(),
        echography_data: z.any().optional().nullable(),
        result_status: z.enum(['normal', 'a_surveiller', 'anormal']).optional().nullable(),
        recommendations: z.string().optional().nullable(),
      })
      .safeParse(req.body)
    if (!parsed.success) return sendValidation(res, zodErrors(parsed.error))
    const c = await Consultation.create({
      patient_id: patient._id,
      consultation_date: new Date(parsed.data.consultation_date),
      type: parsed.data.type ?? null,
      summary: parsed.data.summary ?? null,
      exam_data: parsed.data.exam_data ?? null,
      lab_results: parsed.data.lab_results ?? null,
      echography_data: parsed.data.echography_data ?? null,
      result_status: parsed.data.result_status ?? null,
      recommendations: parsed.data.recommendations ?? null,
    })
    res.status(201).json({
      message: 'Consultation enregistrée',
      consultation: {
        id: String(c._id),
        consultation_date: ymd(c.consultation_date),
        type: c.type,
        summary: c.summary,
        result_status: c.result_status,
      },
    })
  })
)

router.get(
  '/pro/patients/:patientId/messages',
  asyncHandler(async (req, res) => {
    const patient = await patientForStaff(req, res, req.params.patientId)
    if (!patient) return
    await Message.updateMany(
      { patient_id: patient._id, sender_id: { $ne: req.authUser!._id }, read_at: null },
      { $set: { read_at: new Date() } }
    )
    const messages = await Message.find({ patient_id: patient._id }).sort({ createdAt: 1 }).populate('sender_id').lean()
    const c = patientComputed({ ddr: patient.ddr, dpa: patient.dpa })
    res.json({
      patient: {
        id: String(patient._id),
        dossier_number: patient.dossier_number,
        first_name: patient.first_name,
        last_name: patient.last_name,
        semaines_amenorrhee: c.semaines_amenorrhee,
      },
      messages: messages.map((m) => {
        const sender = m.sender_id as { _id: mongoose.Types.ObjectId; first_name?: string; name?: string; role?: string }
        return {
          id: String(m._id),
          body: m.body,
          attachment_path: m.attachment_path,
          sender_id: String(sender._id),
          is_staff: sender.role === 'staff',
          sender_name: sender.first_name ?? sender.name,
          read_at: iso(m.read_at as Date | null),
          created_at: iso(m.createdAt as Date)!,
        }
      }),
    })
  })
)

router.post(
  '/pro/patients/:patientId/messages',
  asyncHandler(async (req, res) => {
    const patient = await patientForStaff(req, res, req.params.patientId)
    if (!patient) return
    const parsed = z
      .object({ body: z.string().min(1).max(5000), attachment_path: z.string().optional().nullable() })
      .safeParse(req.body)
    if (!parsed.success) return sendValidation(res, zodErrors(parsed.error))
    const msg = await Message.create({
      patient_id: patient._id,
      sender_id: req.authUser!._id,
      body: parsed.data.body,
      attachment_path: parsed.data.attachment_path ?? null,
    })
    res.status(201).json({
      message: 'Message envoyé',
      data: {
        id: String(msg._id),
        body: msg.body,
        is_staff: true,
        created_at: msg.createdAt!.toISOString(),
      },
    })
  })
)

router.get(
  '/pro/messages',
  asyncHandler(async (req, res) => {
    const staffId = req.authUser!._id

    const scope = staffPatientScope(req.authUser!)
    const patientQuery = scope ? Patient.find(scope) : Patient.find(emptyPatientMatch())
    const [patients, lastMsgs, unreadAgg] = await Promise.all([
      patientQuery.sort({ last_name: 1, first_name: 1 }).lean(),
      Message.aggregate<{ _id: mongoose.Types.ObjectId; doc: { body?: string; createdAt?: Date } }>([
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$patient_id', doc: { $first: '$$ROOT' } } },
      ]),
      Message.aggregate<{ _id: mongoose.Types.ObjectId; count: number }>([
        { $match: { read_at: null, sender_id: { $ne: staffId } } },
        { $group: { _id: '$patient_id', count: { $sum: 1 } } },
      ]),
    ])

    const lastMap = new Map(lastMsgs.map((x) => [String(x._id), x.doc]))
    const unreadMap = new Map(unreadAgg.map((x) => [String(x._id), x.count]))

    const list = patients.map((p) => {
      const pid = String(p._id)
      const last = lastMap.get(pid)
      const unreadCount = unreadMap.get(pid) ?? 0
      const c = patientComputed({ ddr: p.ddr as Date, dpa: p.dpa as Date })
      const body = last?.body ?? ''
      return {
        patient_id: pid,
        dossier_number: p.dossier_number,
        first_name: p.first_name,
        last_name: p.last_name,
        semaines_amenorrhee: c.semaines_amenorrhee,
        unread_count: unreadCount,
        last_message:
          last?.createdAt != null
            ? {
                body: body.length > 60 ? `${body.slice(0, 57)}...` : body,
                created_at: new Date(last.createdAt).toISOString(),
              }
            : null,
      }
    })

    list.sort((a, b) => {
      if (b.unread_count !== a.unread_count) return b.unread_count - a.unread_count
      const ta = a.last_message?.created_at ? new Date(a.last_message.created_at).getTime() : 0
      const tb = b.last_message?.created_at ? new Date(b.last_message.created_at).getTime() : 0
      if (tb !== ta) return tb - ta
      return `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`, 'fr')
    })

    res.json({ conversations: list })
  })
)

router.get(
  '/pro/patients/:patientId/monitoring-visits',
  asyncHandler(async (req, res) => {
    const patient = await patientForStaff(req, res, req.params.patientId)
    if (!patient) return
    const visits = await PregnancyMonitoringVisit.find({ patient_id: patient._id }).sort({ visit_date: -1 }).lean()
    res.json({
      general: generalMonitoring(patient.toObject()),
      visits: visits.map((v) => visitShape(v as Parameters<typeof visitShape>[0])),
    })
  })
)

router.post(
  '/pro/patients/:patientId/monitoring-visits',
  asyncHandler(async (req, res) => {
    const patient = await patientForStaff(req, res, req.params.patientId)
    if (!patient) return
    const parsed = z
      .object({
        visit_date: z.string().min(1),
        weeks_ga: z.string().max(20),
        metrorragia: z.boolean().optional(),
        leucorrhea: z.boolean().optional(),
        ma: z.string().max(50).optional().nullable(),
        hu: z.string().max(50).optional().nullable(),
        bdc: z.string().max(50).optional().nullable(),
        presentation: z.string().max(80).optional().nullable(),
        ta: z.string().max(20).optional().nullable(),
        edema: z.boolean().optional(),
        albuminuria: z.string().max(80).optional().nullable(),
        glycosuria: z.string().max(80).optional().nullable(),
        hb: z.string().max(30).optional().nullable(),
        medication: z.string().max(255).optional().nullable(),
        hospitalization: z.string().max(255).optional().nullable(),
      })
      .safeParse(req.body)
    if (!parsed.success) return sendValidation(res, zodErrors(parsed.error))
    const v = parsed.data
    const visit = await PregnancyMonitoringVisit.create({
      patient_id: patient._id,
      visit_date: new Date(v.visit_date),
      weeks_ga: v.weeks_ga,
      metrorragia: v.metrorragia ?? false,
      leucorrhea: v.leucorrhea ?? false,
      ma: v.ma ?? null,
      hu: v.hu ?? null,
      bdc: v.bdc ?? null,
      presentation: v.presentation ?? null,
      ta: v.ta ?? null,
      edema: v.edema ?? false,
      albuminuria: v.albuminuria ?? null,
      glycosuria: v.glycosuria ?? null,
      hb: v.hb ?? null,
      medication: v.medication ?? null,
      hospitalization: v.hospitalization ?? null,
    })
    res.status(201).json({ message: 'Visite enregistrée', visit: visitShape(visit.toObject() as Parameters<typeof visitShape>[0]) })
  })
)

router.put(
  '/pro/patients/:patientId/birth-record',
  asyncHandler(async (req, res) => {
    const patient = await patientForStaff(req, res, req.params.patientId)
    if (!patient) return
    const parsed = z
      .object({
        deliveryInfo: z.record(z.unknown()),
        newbornInfo: z.record(z.unknown()),
      })
      .safeParse(req.body)
    if (!parsed.success) return sendValidation(res, zodErrors(parsed.error))
    patient.birth_delivery = parsed.data.deliveryInfo
    patient.birth_newborn = parsed.data.newbornInfo
    await patient.save()
    const delivery = { ...DEFAULT_DELIVERY, ...(patient.birth_delivery as object) }
    const newborn = { ...DEFAULT_NEWBORN, ...(patient.birth_newborn as object) }
    res.json({
      message: "Données d'accouchement enregistrées",
      deliveryInfo: delivery,
      newbornInfo: newborn,
    })
  })
)

router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err)
  res.status(500).json({ message: 'Erreur serveur' })
})

export default router
