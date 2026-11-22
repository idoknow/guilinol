// URL parameters that ask for a specific scene rather than an ordinary visit. A deep link skips the
// title screen (entry.ts) and pins the opening frame (main.ts, IDOK-105), so the two must agree on
// this list rather than each keeping a copy.
export const DEEP_LINK_KEYS = ['verify','spawn','view','mode','cam','feedback','play','slot','story'] as const

export const isDeepLink = (params:URLSearchParams) => DEEP_LINK_KEYS.some(key => params.has(key))
