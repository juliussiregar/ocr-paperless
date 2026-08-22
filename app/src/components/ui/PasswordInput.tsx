"use client";

import {
  useState,
  type InputHTMLAttributes,
  type Ref,
} from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

type PasswordInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  /** Visual style: auth pages vs app forms */
  variant?: "auth" | "field";
  inputRef?: Ref<HTMLInputElement>;
};

export function PasswordInput({
  className,
  variant = "field",
  inputRef,
  disabled,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        {...props}
        ref={inputRef}
        type={visible ? "text" : "password"}
        disabled={disabled}
        className={cn(
          variant === "auth" ? "auth-input auth-input-password" : "input-field pr-10",
          className
        )}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={() => setVisible((v) => !v)}
        className={cn(
          "absolute right-0 top-1/2 -translate-y-1/2 rounded p-2 text-[var(--auth-ink)]/45 transition hover:text-[var(--auth-teal)] disabled:opacity-40",
          variant === "field" &&
            "right-1 text-slate-400 hover:text-teal-700"
        )}
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
      >
        {visible ? <EyeOff size={16} strokeWidth={2} /> : <Eye size={16} strokeWidth={2} />}
      </button>
    </div>
  );
}
