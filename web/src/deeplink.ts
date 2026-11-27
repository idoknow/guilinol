// URL parameters that ask for a specific scene rather than an ordinary visit. A deep link skips the
// title screen (entry.ts) and pins the opening frame (main.ts, IDOK-105), so the two must agree on
// this list rather than each keeping a copy.
export const DEEP_LINK_KEYS = ['verify','spawn','view','mode','cam','feedback','play','slot','solo'] as const

export const isDeepLink = (params:URLSearchParams) => DEEP_LINK_KEYS.some(key => params.has(key))

// Developer readouts (FPS / 网速 / 在线人数 / 渲染范围 / 测试画面声明) stay off the player HUD; `?verify` and `?debug`
// switch them on through body[data-debug], set once in entry.ts. CSS keys off the same attribute (IDOK-468).
export const debugHud = () => document.body.dataset.debug !== undefined
