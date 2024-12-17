import { type InputHTMLAttributes, type DetailedHTMLProps } from "react";

export interface InputFieldProps extends DetailedHTMLProps<InputHTMLAttributes<HTMLInputElement>, HTMLInputElement> {
  label: string;
  error?: string | null;
  className?: string;
  inputClassName?: string;
}

export function InputField({
  id,
  label,
  error,
  className,
  inputClassName,
  ref,
  ...props
}: InputFieldProps) {
  return (
    <div className={className}>
      <label
        htmlFor={id}
        className="block text-sm/6 font-semibold text-gray-900"
      >
        {label}
      </label>
      <div className="mt-2.5">
        <input
          id={id}
          type="text"
          ref={ref}
          className={inputClassName ?? "block w-full rounded-md bg-white px-3.5 py-2 text-base text-gray-900 outline outline-1 -outline-offset-1 outline-gray-300 placeholder:text-gray-400 focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-indigo-600"}
          aria-invalid={error ? true : undefined}
          aria-errormessage={error ? "title-error" : undefined}
          {...props}
        />
      </div>
      {error ? (
        <span className="pt-1 text-red-700" id="title-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
