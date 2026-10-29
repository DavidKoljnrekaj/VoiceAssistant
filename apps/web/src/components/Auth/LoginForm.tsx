import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type SignInErrorCode, useAuth } from '../../contexts/AuthContext'
import Alert from '../ui/Alert'
import Button from '../ui/Button'
import Input from '../ui/Input'

export default function LoginForm() {
  const { t } = useTranslation()
  const { signIn, authError } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [formError, setFormError] = useState<SignInErrorCode | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = email.trim()
    setEmailError(trimmed ? null : t('auth.email_required'))
    setPasswordError(password ? null : t('auth.password_required'))
    if (!trimmed || !password) return
    setLoading(true)
    setFormError(null)
    const result = await signIn(trimmed, password)
    setLoading(false)
    if (!result.ok) setFormError(result.code)
  }

  const shownError = formError ?? authError

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          {t('auth.email')}
        </label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          value={email}
          invalid={emailError !== null}
          onChange={(e) => {
            setEmail(e.target.value)
            setEmailError(null)
          }}
        />
        {emailError && <p className="mt-1 text-xs text-red-600">{emailError}</p>}
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          {t('auth.password')}
        </label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          invalid={passwordError !== null}
          onChange={(e) => {
            setPassword(e.target.value)
            setPasswordError(null)
          }}
        />
        {passwordError && <p className="mt-1 text-xs text-red-600">{passwordError}</p>}
      </div>
      {shownError && <Alert variant="error">{t(`auth.error_${shownError}`)}</Alert>}
      <Button type="submit" loading={loading} className="w-full">
        {loading ? t('auth.signing_in') : t('auth.sign_in')}
      </Button>
    </form>
  )
}
