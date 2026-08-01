"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// NotificationsBell lives in the shared (protected) layout, not a page —
// Next's Partial Rendering model only re-fetches the page segment that
// changed on client-side navigation, so a plain server-rendered bell stays
// frozen at whatever count it had when the layout last mounted (e.g. at
// login), even though a fresh visit to the page it links to (e.g.
// /admin/registrations) would show the real, current count. This was
// reported directly: a new registration submission sent its back-office
// email immediately, but the bell kept showing the pre-submission count
// until a hard refresh. router.refresh() re-fetches every Server Component
// on the current route, including the layout, so re-running it on tab
// focus (the moment someone is actually looking again) and on a periodic
// fallback keeps the bell honest without needing a websocket/real-time layer.
const REFRESH_INTERVAL_MS = 60_000;

export function NotificationsAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    function refresh() {
      if (document.visibilityState === "visible") router.refresh();
    }

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);

    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(interval);
    };
  }, [router]);

  return null;
}
