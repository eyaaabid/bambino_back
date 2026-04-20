import cors from 'cors'
import express from 'express'
import mongoose from 'mongoose'
import { env } from './config/env.js'
import apiRouter from './routes/api.js'
import { Hospital } from './models/Hospital.js'

await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 10_000 })
const dbName = mongoose.connection.db?.databaseName
if (dbName) console.log(`MongoDB database: "${dbName}"`)
const hospitalCount = await Hospital.countDocuments()
if (hospitalCount === 0) {
  console.warn(
    `[bambino-api] Aucun document dans "hospitals". Si tu as déjà fait le seed dans Atlas, vérifie que MONGODB_URI utilise le même nom de base (ex. …/test?… ou …/bambino?…), puis npm run seed et redémarrage.`
  )
}

const app = express()
const localDevOrigin =
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true)
      if (env.corsOrigins.includes(origin)) return callback(null, true)
      if (process.env.NODE_ENV !== 'production' && localDevOrigin.test(origin)) {
        return callback(null, true)
      }
      callback(null, false)
    },
    credentials: true,
  })
)
app.use(express.json({ limit: '2mb' }))
app.use('/api', apiRouter)

app.listen(env.port, () => {
  console.log(`Bambino API listening on http://localhost:${env.port}/api`)
})
