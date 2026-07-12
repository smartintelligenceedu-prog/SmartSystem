<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Language-ready UI text (zh now, en later)

The system is Chinese-only today, but new modules must not hardcode UI strings in components. Instead:

- Add the string to `/locales/zh.json` (flat, dot-namespaced keys, e.g. `"customer.create": "新增客户"`) and add the same key to `/locales/en.json` (English value optional for now — an empty/missing translation is fine, but the key must exist).
- Call it from code with `t("customer.create")` — see `src/lib/i18n.ts`. `t()` always resolves to `zh.json` for now; there is no language switcher yet.
- This applies to every UI-facing string in new modules: menu/sidebar items, buttons, form labels, page titles, notifications, error messages, status badges, dialogs, toasts, validation messages.
- Database content (customer names, addresses, remarks, anything a user typed in) is never translated — this is UI-only.
- Existing modules built before this convention (Registration, Portal shell, Dashboard, Customers, Sales Orders, Finance, Reports, Commission, Team, etc.) were NOT retrofitted — their strings stay hardcoded until/unless a future task specifically asks for that. Don't silently "fix" them as a side effect of unrelated work.
- Don't build a real i18n library, locale-switching UI, or per-request locale detection yet — that's future scope (planned to live under Profile → Language once the whole system is feature-complete). Keep this to the minimal key-lookup scaffolding described above.
