"use client";

import { startTransition } from "react";

// React resets every uncontrolled field in a <form> — including file inputs,
// which can never be programmatically restored once cleared — after ANY
// Server Action submission via `<form action={fn}>` completes, success or
// not. That's tied specifically to the browser-native form-action binding,
// not to useActionState itself: calling the dispatch function directly
// (which useActionState's docs explicitly support, e.g. from a button
// onClick) bypasses that auto-reset entirely. This wraps that call as a
// plain onSubmit handler so a failed submission — a validation error, a
// duplicate check, anything — leaves every field exactly as the user typed
// it, instead of forcing a full re-fill (and, for file inputs, forcing them
// to reselect the photo from scratch).
export function submitWithoutReset(dispatch: (formData: FormData) => void) {
  return (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(() => {
      dispatch(formData);
    });
  };
}

// Vercel's platform-level request body cap (~4.5MB) cuts the connection
// before a Server Action's own code — and thus its own graceful validation —
// ever runs, surfacing as a raw browser connection error instead of a normal
// in-app message. compress-image.ts's client-side recompression is the
// primary defense; this is the last-resort backstop for the rare case where
// compression didn't help enough (a PDF, a decode failure that fell back to
// the original file, etc.) — catching it here means a friendly message
// instead of the same crash the compression was meant to prevent.
export function totalFileSize(formData: FormData, fieldNames: string[]): number {
  return fieldNames.reduce((sum, name) => {
    const value = formData.get(name);
    return sum + (value instanceof File ? value.size : 0);
  }, 0);
}
