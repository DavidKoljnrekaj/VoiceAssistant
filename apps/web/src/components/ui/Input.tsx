import { forwardRef, type InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, className = '', ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={`w-full rounded-md border bg-white px-3 py-2 text-sm text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-blue-500 disabled:opacity-60 dark:bg-gray-800 dark:text-gray-100 ${
        invalid ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'
      } ${className}`}
      {...rest}
    />
  )
})

export default Input
