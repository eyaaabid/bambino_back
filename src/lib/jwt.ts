import jwt from 'jsonwebtoken'
import { env } from '../config/env.js'

export type JwtPayload = { sub: string; role: 'patient' | 'staff' }

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: '30d' })
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, env.jwtSecret) as JwtPayload
  return decoded
}
