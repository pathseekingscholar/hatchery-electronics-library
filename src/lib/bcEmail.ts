/** Accounts are limited to Boston College addresses (enforced again in the database). */
export const ALLOWED_DOMAIN = 'bc.edu'

export function isAllowedEmail(email: string): boolean {
  return /^[^@\s]+@bc\.edu$/i.test(email.trim())
}
