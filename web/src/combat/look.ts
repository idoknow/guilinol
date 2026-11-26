// IDOK-423 打击特效观感（sg claude 定稿）。纸色闪光 + 细冲击环 + 尘屑；重击多一圈朱砂环。
export const look = {
  flash: 'rgba(251,248,240,.95)', // 中心闪光（纸白，径向渐隐，不是实心圆片）
  ring: 'rgba(244,239,226,.85)', // 冲击环线色
  heavyRing: 'rgba(208,105,76,.75)', // 重击第二圈（朱砂）
  dust: '#d9cfb6', // 尘屑
  duration: 240, // 轻击时长 ms；重击 ×1.5
  radius: 26, // 闪光基准直径 px（再乘 0.55 + 强度）
  sparks: 5, // 轻击尘屑数；重击 +3
  dustSize: 3,
  shake: 3, // 自己挨打的屏震幅度 px（乘强度）
}
