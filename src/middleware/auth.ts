import type { NextFunction, Request, Response } from 'express'
import { verifyToken } from '../lib/jwt.js'
import { User } from '../models/User.js'

export async function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization
  if (!h?.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthenticated.' })
  }
  try {
    const payload = verifyToken(h.slice(7))
    const user = await User.findById(payload.sub)
    if (!user || user.role !== payload.role) {
      return res.status(401).json({ message: 'Unauthenticated.' })
    }
    req.authUser = user
    next()
  } catch {
    return res.status(401).json({ message: 'Unauthenticated.' })
  }
}

export function requireRole(role: 'patient' | 'staff') {
  return (req: Request, res: Response, next: NextFunction) => {
    const u = req.authUser
    if (!u || u.role !== role) {
      return res.status(403).json({ message: 'Forbidden.' })
    }
    next()
  }
}
