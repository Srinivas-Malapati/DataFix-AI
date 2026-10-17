"use client";

import { useEffect } from "react";
import type { Notification } from "./state.ts";

const SUCCESS_DISMISS_MS = 4_500;

/** Success toasts dismiss themselves; progress and errors stay until replaced or closed. */
export function Toast({ notification, onDismiss }: { notification: Notification | null; onDismiss: () => void }) {
  useEffect(() => {
    if (notification?.kind !== "success") return;
    const timer = window.setTimeout(onDismiss, SUCCESS_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [notification, onDismiss]);

  if (!notification) return null;
  const mark = notification.kind === "success" ? "✓" : notification.kind === "error" ? "!" : "";
  return (
    <div
      className={`operation-toast ${notification.kind}`}
      role={notification.kind === "error" ? "alert" : "status"}
      aria-live={notification.kind === "error" ? "assertive" : "polite"}
    >
      <span className="toast-mark" aria-hidden="true">{mark}</span>
      <div><b>{notification.title}</b><small>{notification.message}</small></div>
      <button type="button" onClick={onDismiss} aria-label="Dismiss notification">×</button>
    </div>
  );
}
