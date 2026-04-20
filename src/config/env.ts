import 'dotenv/config'

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback
  if (!v) throw new Error(`Missing env: ${name}`)
  return v
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  mongoUri: required('MONGODB_URI', 'mongodb://127.0.0.1:27017/bambino'),
  jwtSecret: required('JWT_SECRET', 'dev-only-change-in-production'),
  corsOrigins: (
    process.env.CORS_ORIGINS ??
    'http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
}
