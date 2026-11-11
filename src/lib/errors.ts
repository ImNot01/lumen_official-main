export const USERNAME_RE = /^[a-z0-9_.]{3,24}$/

export function mapAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Email or password is incorrect.'
  if (m.includes('email not confirmed')) return 'Confirm your email first. Check your inbox for the link.'
  if (m.includes('already registered')) return 'An account with this email already exists.'
  if (m.includes('rate limit') || m.includes('too many')) return 'Too many attempts. Wait a few minutes and try again.'
  if (m.includes('database error')) return 'That username was just taken. Pick another one.'
  if (m.includes('failed to fetch') || m.includes('network')) return 'Cannot reach the server. Check your internet connection.'
  if (m.includes('invalid email') || m.includes('unable to validate email')) return 'Enter a valid email address.'
  if (m.includes('same password') || m.includes('different from the old')) return 'Choose a password different from your current one.'
  return message
}
