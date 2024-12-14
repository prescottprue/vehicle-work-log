import { useRef, type InputHTMLAttributes } from "react";

export interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string | null
}

export function InputField({ name, label, error, ...props }: InputFieldProps) {
  const fieldRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex w-full flex-col">
      <label className="flex w-full flex-col gap-1">
        <span>{label}</span>
        <input
          ref={fieldRef}
          name={name}
          className="flex-1 rounded-md border-2 border-blue-500 px-3 text-lg leading-loose"
          aria-invalid={error ? true : undefined}
          aria-errormessage={
            error ? `${name}-error` : undefined
          }
          {...props}
        />
      </label>
      {error ? (
        <div className="pt-1 text-red-700" id={`${name}-error`}>
          {error}
        </div>
      ) : null}
    </div>
  )
}