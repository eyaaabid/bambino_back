/**
 * Import data from a Laravel SQL database (SQLite or MySQL) into MongoDB
 * used by the Node API (same logical model as Eloquent).
 *
 * Usage:
 *   npm run migrate:laravel                      # dry-run: counts only
 *   npm run migrate:laravel -- --execute --clear # wipe API collections, then import
 *
 * Env: see backend-node/.env.example (LARAVEL_DB_DRIVER, LARAVEL_SQLITE_PATH or LARAVEL_MYSQL_*).
 */

import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import type { Database } from 'sql.js'
import mongoose from 'mongoose'
import { env } from '../config/env.js'
import { Appointment } from '../models/Appointment.js'
import { Complication } from '../models/Complication.js'
import { Consultation } from '../models/Consultation.js'
import { Hospital } from '../models/Hospital.js'
import { Message } from '../models/Message.js'
import { Patient } from '../models/Patient.js'
import { PregnancyMonitoringVisit } from '../models/PregnancyMonitoringVisit.js'
import { User } from '../models/User.js'

type Row = Record<string, unknown>

function parseArgs() {
  const argv = process.argv.slice(2)
  return {
    execute: argv.includes('--execute'),
    clear: argv.includes('--clear'),
  }
}

function parseJson<T>(v: unknown): T | null {
  if (v == null || v === '') return null
  if (typeof v === 'object') return v as T
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T
    } catch {
      return null
    }
  }
  return null
}

function toDate(v: unknown): Date | null {
  if (v == null || v === '') return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function toBool(v: unknown, fallback = false): boolean {
  if (v === true || v === 1 || v === '1') return true
  if (v === false || v === 0 || v === '0') return false
  return fallback
}

function str(v: unknown): string | null {
  if (v == null) return null
  const s = String(v)
  return s === '' ? null : s
}

interface SqlSource {
  all<T extends Row>(sql: string, params?: unknown[]): Promise<T[]>
  close(): Promise<void>
}

function sqlJsExecToRows(db: Database, sql: string): Row[] {
  const res = db.exec(sql)
  if (!res.length) return []
  const { columns, values } = res[0]
  return values.map((val: (string | number | Uint8Array | null)[]) => {
    const row: Row = {}
    columns.forEach((col: string, i: number) => {
      row[col] = val[i] as unknown
    })
    return row
  })
}

function sqlJsAll(db: Database, sql: string, params?: unknown[]): Row[] {
  if (!params?.length) return sqlJsExecToRows(db, sql)
  const stmt = db.prepare(sql)
  stmt.bind(params as (string | number | Uint8Array | null)[])
  const out: Row[] = []
  while (stmt.step()) {
    out.push(stmt.getAsObject() as Row)
  }
  stmt.free()
  return out
}

async function createSqlSource(): Promise<SqlSource> {
  const driver = (process.env.LARAVEL_DB_DRIVER ?? 'sqlite').toLowerCase()

  if (driver === 'sqlite') {
    const initSqlJs = (await import('sql.js')).default
    const wasmPath = path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
    const SQL = await initSqlJs({ locateFile: () => wasmPath })
    const rel = process.env.LARAVEL_SQLITE_PATH ?? path.join('..', 'backend', 'database', 'database.sqlite')
    const abs = path.isAbsolute(rel) ? rel : path.resolve(process.cwd(), rel)
    const buf = fs.readFileSync(abs)
    const db = new SQL.Database(buf)
    return {
      all<T extends Row>(sql: string, params?: unknown[]) {
        return Promise.resolve(sqlJsAll(db, sql, params) as T[])
      },
      close() {
        db.close()
        return Promise.resolve()
      },
    }
  }

  if (driver === 'mysql') {
    const mysql = await import('mysql2/promise')
    const conn = await mysql.createConnection({
      host: process.env.LARAVEL_MYSQL_HOST ?? '127.0.0.1',
      port: Number(process.env.LARAVEL_MYSQL_PORT ?? 3306),
      user: process.env.LARAVEL_MYSQL_USER ?? 'root',
      password: process.env.LARAVEL_MYSQL_PASSWORD ?? '',
      database: process.env.LARAVEL_MYSQL_DATABASE ?? 'bambino',
    })
    return {
      async all<T extends Row>(sql: string, params?: unknown[]) {
        const [rows] = await conn.query(sql, params)
        return rows as T[]
      },
      async close() {
        await conn.end()
      },
    }
  }

  throw new Error(`Unsupported LARAVEL_DB_DRIVER="${driver}". Use sqlite or mysql.`)
}

function safeSqlIdent(name: string): string | null {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) return null
  return name
}

async function tableExists(sql: SqlSource, name: string): Promise<boolean> {
  const driver = (process.env.LARAVEL_DB_DRIVER ?? 'sqlite').toLowerCase()
  if (driver === 'sqlite') {
    const safe = safeSqlIdent(name)
    if (!safe) return false
    // sql.js positional bind is unreliable for some builds; identifiers are whitelisted above.
    const rows = await sql.all<{ n: number }>(
      `SELECT 1 AS n FROM sqlite_master WHERE type='table' AND name='${safe}' LIMIT 1`
    )
    return rows.length > 0
  }
  const rows = await sql.all<{ c: bigint | number }>(
    'SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
    [name]
  )
  const c = rows[0]?.c ?? 0
  return Number(c) > 0
}

async function clearMongoCollections() {
  await PregnancyMonitoringVisit.deleteMany({})
  await Message.deleteMany({})
  await Appointment.deleteMany({})
  await Consultation.deleteMany({})
  await Patient.deleteMany({})
  await User.deleteMany({})
  await Hospital.deleteMany({})
  await Complication.deleteMany({})
}

function maskMongoUri(uri: string): string {
  try {
    const u = new URL(uri)
    if (u.password) u.password = '***'
    return u.toString()
  } catch {
    return uri.replace(/:[^:@]+@/, ':***@')
  }
}

async function dryRun(sql: SqlSource) {
  const driver = process.env.LARAVEL_DB_DRIVER ?? 'sqlite'
  console.log(`Laravel SQL driver: ${driver}`)
  console.log('If Laravel uses MySQL, set LARAVEL_DB_DRIVER=mysql and LARAVEL_MYSQL_* in backend-node/.env.\n')

  if (driver.toLowerCase() === 'sqlite') {
    const rel = process.env.LARAVEL_SQLITE_PATH ?? path.join('..', 'backend', 'database', 'database.sqlite')
    const abs = path.isAbsolute(rel) ? rel : path.resolve(process.cwd(), rel)
    const exists = fs.existsSync(abs)
    console.log(`SQLite file: ${abs}`)
    console.log(`Exists: ${exists}${exists ? `, size: ${fs.statSync(abs).size} bytes` : ''}`)
    if (exists) {
      const allTables = await sql.all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite*' ORDER BY name`
      )
      const names = allTables.map((t) => t.name)
      console.log(`Tables in file (${names.length}): ${names.length ? names.join(', ') : '(none)'}`)
      if (names.length === 0) {
        console.log(
          '\nNo tables in this SQLite file. Laravel may be using MySQL: copy DB_HOST, DB_PORT, DB_DATABASE, DB_USERNAME, DB_PASSWORD from backend/.env into LARAVEL_MYSQL_* here and set LARAVEL_DB_DRIVER=mysql.\n'
        )
      }
    }
    console.log('')
  } else {
    console.log(
      `MySQL: ${process.env.LARAVEL_MYSQL_HOST ?? '127.0.0.1'} / ${process.env.LARAVEL_MYSQL_DATABASE ?? 'bambino'}\n`
    )
  }

  const tables = [
    'hospitals',
    'services',
    'users',
    'patients',
    'appointments',
    'consultations',
    'messages',
    'pregnancy_monitoring_visits',
    'complications',
  ] as const
  console.log('Dry run — row counts from Laravel SQL:\n')
  for (const t of tables) {
    if (!(await tableExists(sql, t))) {
      console.log(`  ${t}: (table missing)`)
      continue
    }
    const rows = await sql.all<{ n: number }>(`SELECT COUNT(*) AS n FROM \`${t}\``)
    const n = Number((rows[0] as { n?: number })?.n ?? 0)
    console.log(`  ${t}: ${n}`)
  }
  console.log('\nTo import into MongoDB, run:')
  console.log('  npm run migrate:laravel -- --execute --clear')
  console.log('(--clear drops existing API collections in the target Mongo database first.)\n')
}

async function migrateData(sql: SqlSource) {
  const hospitalSqlIdToMongoId = new Map<number, mongoose.Types.ObjectId>()
  const serviceSqlIdToMongoId = new Map<number, mongoose.Types.ObjectId>()
  const userSqlIdToMongoId = new Map<number, mongoose.Types.ObjectId>()
  const patientSqlIdToMongoId = new Map<number, mongoose.Types.ObjectId>()

  if (await tableExists(sql, 'hospitals')) {
    const hospitals = await sql.all<Row>('SELECT * FROM `hospitals` ORDER BY id ASC')
    const allServices = (await tableExists(sql, 'services'))
      ? await sql.all<Row>('SELECT * FROM `services` ORDER BY hospital_id ASC, id ASC')
      : []

    for (const h of hospitals) {
      const hid = Number(h.id)
      const servicesForH = allServices.filter((s) => Number(s.hospital_id) === hid)
      const created = await Hospital.create({
        name: String(h.name),
        services: servicesForH.map((s) => ({ name: String(s.name) })),
      })
      hospitalSqlIdToMongoId.set(hid, created._id as mongoose.Types.ObjectId)
      const embedded = created.services as { _id: mongoose.Types.ObjectId; name: string }[]
      for (let i = 0; i < servicesForH.length; i++) {
        const sid = Number(servicesForH[i].id)
        const sub = embedded[i]
        if (sub?._id) serviceSqlIdToMongoId.set(sid, sub._id)
      }
    }
    console.log(`Hospitals migrated: ${hospitals.length}`)
  }

  const users = (await tableExists(sql, 'users')) ? await sql.all<Row>('SELECT * FROM `users` ORDER BY id ASC') : []
  for (const u of users) {
    const uid = Number(u.id)
    const role = str(u.role) === 'staff' ? 'staff' : 'patient'
    const first = str(u.first_name) ?? String(u.name ?? 'User').split(/\s+/)[0] ?? 'User'
    const last =
      (str(u.last_name) ?? String(u.name ?? 'User').split(/\s+/).slice(1).join(' ')) || '—'
    const hospitalId = toNum(u.hospital_id)
    const serviceId = toNum(u.service_id)
    const doc = await User.create({
      name: String(u.name ?? `${first} ${last}`),
      first_name: first,
      last_name: last,
      email: String(u.email).toLowerCase(),
      phone: str(u.phone),
      password: String(u.password),
      role: role as 'patient' | 'staff',
      hospital_id:
        role === 'staff' && hospitalId && hospitalSqlIdToMongoId.has(hospitalId)
          ? hospitalSqlIdToMongoId.get(hospitalId)!
          : null,
      service_id:
        role === 'staff' && serviceId && serviceSqlIdToMongoId.has(serviceId) ? serviceSqlIdToMongoId.get(serviceId)! : null,
    })
    userSqlIdToMongoId.set(uid, doc._id as mongoose.Types.ObjectId)
  }
  console.log(`Users migrated: ${users.length}`)

  const patients = (await tableExists(sql, 'patients')) ? await sql.all<Row>('SELECT * FROM `patients` ORDER BY id ASC') : []
  let skippedPatients = 0
  for (const p of patients) {
    const hid = toNum(p.hospital_id)
    const sid = toNum(p.service_id)
    if (!hid || !sid || !hospitalSqlIdToMongoId.has(hid) || !serviceSqlIdToMongoId.has(sid)) {
      skippedPatients++
      console.warn(`Skipping patient id=${p.id}: missing hospital_id/service_id mapping`)
      continue
    }
    const userId = toNum(p.user_id)
    const doc = await Patient.create({
      user_id: userId && userSqlIdToMongoId.has(userId) ? userSqlIdToMongoId.get(userId)! : null,
      hospital_id: hospitalSqlIdToMongoId.get(hid)!,
      service_id: serviceSqlIdToMongoId.get(sid)!,
      dossier_number: String(p.dossier_number),
      first_name: String(p.first_name),
      last_name: String(p.last_name),
      date_of_birth: toDate(p.date_of_birth),
      blood_group: str(p.blood_group),
      allergies: str(p.allergies),
      phone: str(p.phone),
      email: str(p.email),
      address: str(p.address),
      emergency_contact: str(p.emergency_contact),
      ddr: toDate(p.ddr),
      dpa: toDate(p.dpa),
      gravida: toNum(p.gravida) ?? 1,
      para: toNum(p.para) ?? 0,
      antecedents_familiaux: parseJson<string[]>(p.antecedents_familiaux) ?? [],
      antecedents_medicaux: parseJson<string[]>(p.antecedents_medicaux) ?? [],
      antecedents_gyneo: parseJson<string[]>(p.antecedents_gyneo) ?? [],
      status: (str(p.status) as 'normal' | 'a_surveiller' | 'urgent') || 'normal',
      photo_path: str(p.photo_path),
      height_cm: toNum(p.height_cm),
      previous_breastfeeding: str(p.previous_breastfeeding),
      delivery_prognosis: str(p.delivery_prognosis),
      birth_delivery: parseJson<Record<string, unknown>>(p.birth_delivery) ?? undefined,
      birth_newborn: parseJson<Record<string, unknown>>(p.birth_newborn) ?? undefined,
      vaccination_mother: parseJson<Record<string, boolean>>(p.vaccination_mother) ?? {},
      vaccination_baby: parseJson<Record<string, boolean>>(p.vaccination_baby) ?? {},
    })
    patientSqlIdToMongoId.set(Number(p.id), doc._id as mongoose.Types.ObjectId)
  }
  console.log(`Patients migrated: ${patients.length - skippedPatients} (skipped ${skippedPatients})`)

  if (await tableExists(sql, 'appointments')) {
    const rows = await sql.all<Row>('SELECT * FROM `appointments` ORDER BY id ASC')
    let skipped = 0
    for (const r of rows) {
      const pid = Number(r.patient_id)
      const at = toDate(r.scheduled_at)
      if (!patientSqlIdToMongoId.has(pid) || !at) {
        skipped++
        continue
      }
      await Appointment.create({
        patient_id: patientSqlIdToMongoId.get(pid)!,
        scheduled_at: at,
        type: String(r.type),
        professional_name: str(r.professional_name),
        location: str(r.location),
        notes: str(r.notes),
        recommendations: str(r.recommendations),
        status: str(r.status) ?? 'scheduled',
      })
    }
    console.log(`Appointments migrated: ${rows.length - skipped} (skipped ${skipped})`)
  }

  if (await tableExists(sql, 'consultations')) {
    const rows = await sql.all<Row>('SELECT * FROM `consultations` ORDER BY id ASC')
    let skipped = 0
    for (const r of rows) {
      const pid = Number(r.patient_id)
      const cd = toDate(r.consultation_date)
      if (!patientSqlIdToMongoId.has(pid) || !cd) {
        skipped++
        continue
      }
      await Consultation.create({
        patient_id: patientSqlIdToMongoId.get(pid)!,
        consultation_date: cd,
        type: str(r.type),
        summary: str(r.summary),
        exam_data: parseJson(r.exam_data) ?? undefined,
        lab_results: parseJson(r.lab_results) ?? undefined,
        echography_data: parseJson(r.echography_data) ?? undefined,
        result_status: str(r.result_status),
        recommendations: str(r.recommendations),
      })
    }
    console.log(`Consultations migrated: ${rows.length - skipped} (skipped ${skipped})`)
  }

  if (await tableExists(sql, 'messages')) {
    const rows = await sql.all<Row>('SELECT * FROM `messages` ORDER BY id ASC')
    let skipped = 0
    for (const r of rows) {
      const pid = Number(r.patient_id)
      const sid = Number(r.sender_id)
      if (!patientSqlIdToMongoId.has(pid) || !userSqlIdToMongoId.has(sid)) {
        skipped++
        continue
      }
      await Message.create({
        patient_id: patientSqlIdToMongoId.get(pid)!,
        sender_id: userSqlIdToMongoId.get(sid)!,
        body: String(r.body),
        attachment_path: str(r.attachment_path),
        read_at: toDate(r.read_at),
      })
    }
    console.log(`Messages migrated: ${rows.length - skipped} (skipped ${skipped})`)
  }

  if (await tableExists(sql, 'pregnancy_monitoring_visits')) {
    const rows = await sql.all<Row>('SELECT * FROM `pregnancy_monitoring_visits` ORDER BY id ASC')
    let skipped = 0
    for (const r of rows) {
      const pid = Number(r.patient_id)
      const vd = toDate(r.visit_date)
      if (!patientSqlIdToMongoId.has(pid) || !vd) {
        skipped++
        continue
      }
      await PregnancyMonitoringVisit.create({
        patient_id: patientSqlIdToMongoId.get(pid)!,
        visit_date: vd,
        weeks_ga: String(r.weeks_ga),
        metrorragia: toBool(r.metrorragia, false),
        leucorrhea: toBool(r.leucorrhea, false),
        ma: str(r.ma),
        hu: str(r.hu),
        bdc: str(r.bdc),
        presentation: str(r.presentation),
        ta: str(r.ta),
        edema: toBool(r.edema, false),
        albuminuria: str(r.albuminuria),
        glycosuria: str(r.glycosuria),
        hb: str(r.hb),
        medication: str(r.medication),
        hospitalization: str(r.hospitalization),
      })
    }
    console.log(`Pregnancy monitoring visits migrated: ${rows.length - skipped} (skipped ${skipped})`)
  }

  if (await tableExists(sql, 'complications')) {
    const rows = await sql.all<Row>('SELECT * FROM `complications` ORDER BY `order` ASC, id ASC')
    for (const r of rows) {
      await Complication.findOneAndUpdate(
        { slug: String(r.slug) },
        {
          $set: {
            slug: String(r.slug),
            title: String(r.title),
            description: str(r.description) ?? '',
            symptoms: str(r.symptoms) ?? '',
            actions: str(r.actions) ?? '',
            severity: str(r.severity) ?? 'moderate',
            order: toNum(r.order) ?? 0,
            avatar_icon: str(r.avatar_icon),
          },
        },
        { upsert: true }
      )
    }
    console.log(`Complications upserted: ${rows.length}`)
  }

  console.log('\nMigration finished. Users must log in again (JWT; old Sanctum tokens are not migrated).\n')
}

async function main() {
  const { execute, clear } = parseArgs()
  let sql: SqlSource | null = null
  try {
    sql = await createSqlSource()
  } catch (e) {
    console.error('Could not open Laravel SQL database:', e)
    process.exitCode = 1
    return
  }

  try {
    if (!execute) {
      await dryRun(sql)
      return
    }

    if (!clear) {
      console.error('Refusing --execute without --clear (prevents accidental duplicate import).')
      console.error('Run: npm run migrate:laravel -- --execute --clear')
      process.exitCode = 1
      return
    }

    try {
      await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 15_000 })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('ECONNREFUSED') || msg.includes('Server selection timed out')) {
        console.error('\nCould not connect to MongoDB.')
        console.error(`  MONGODB_URI (masked): ${maskMongoUri(env.mongoUri)}`)
        console.error('  Start MongoDB locally (mongod), or set MONGODB_URI to a reachable host (e.g. MongoDB Atlas).\n')
      }
      throw e
    }
    console.log('Clearing MongoDB collections used by the API…')
    await clearMongoCollections()
    await migrateData(sql)
    await mongoose.disconnect()
  } finally {
    await sql?.close()
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect()
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
