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
