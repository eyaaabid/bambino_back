import type { Response } from 'express'

export function sendValidation(res: Response, errors: Record<string, string[]>, message = 'The given data was invalid.') {
  return res.status(422).json({ message, errors })
}

export function sendAuthFailed(res: Response) {
  return sendValidation(res, { email: ['These credentials do not match our records.'] })
}
