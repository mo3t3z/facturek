// Tailwind class lists shared by buttons and button-looking links, so every screen gets
// the same touch target size (phone first) and the same visible focus ring.
const base =
  'inline-flex items-center justify-center rounded-md px-4 py-2.5 text-base font-medium focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:opacity-60'

export const primaryButton = `${base} bg-blue-700 text-white hover:bg-blue-800`
export const secondaryButton = `${base} border border-slate-300 bg-white text-slate-700 hover:bg-slate-100`
export const dangerButton = `${base} bg-red-700 text-white hover:bg-red-800`
