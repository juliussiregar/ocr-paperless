"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ToastData {
  id: string;
  message: string;
  type: "success" | "error";
}

let toastListeners: Array<(toast: ToastData) => void> = [];

export function showToast(message: string, type: "success" | "error" = "success") {
  const toast: ToastData = {
    id: Math.random().toString(36).slice(2),
    message,
    type,
  };
  toastListeners.forEach((fn) => fn(toast));
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  useEffect(() => {
    const listener = (toast: ToastData) => {
      setToasts((prev) => [...prev, toast]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== toast.id));
      }, 4000);
    };
    toastListeners.push(listener);
    return () => {
      toastListeners = toastListeners.filter((fn) => fn !== listener);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-4 z-[100] flex flex-col gap-2 sm:right-6">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "animate-slide-up flex items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg",
            toast.type === "success"
              ? "border-teal-200 bg-white text-teal-800"
              : "border-red-200 bg-white text-red-700"
          )}
        >
          {toast.type === "success" ? (
            <CheckCircle2 size={16} className="shrink-0 text-teal-600" />
          ) : (
            <AlertCircle size={16} className="shrink-0 text-red-500" />
          )}
          <span className="flex-1">{toast.message}</span>
          <button
            onClick={() =>
              setToasts((prev) => prev.filter((t) => t.id !== toast.id))
            }
            className="shrink-0 text-slate-400 hover:text-slate-600"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
