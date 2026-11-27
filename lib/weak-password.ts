const bases = ['password','welcome','admin','qwerty','letmein','iloveyou','football','baseball','dragon','monkey','master','sunshine','princess','superman','computer','guilin','abc123','changeme','default','secret','login','guest','passw0rd','qwertyuiop']
const endings = ['', '1', '12', '123', '1234', '12345', '123456', '01', '001', '007', '!', '!!', '@123', '123!', '2024', '2025', '2026']
const weakForms = new Set(bases.flatMap(base => endings.map(ending => base+ending)).filter(form=>form.length>=8))
export const weakFormCount = weakForms.size
export function weakPassword(value:string) {
  const form=value.normalize('NFKC').trim().toLowerCase()
  return weakForms.has(form) || /^\d+$/.test(form) || /^(.{1,4})\1+$/u.test(form) || /^(?:19|20)\d\d[-/.](?:0?[1-9]|1[012])[-/.](?:0?[1-9]|[12]\d|3[01])$/.test(form) || ['qwertyuiop','asdfghjkl','zxcvbnm','1qaz2wsx3edc'].some(row=>form.length>=8 && (row.includes(form)||[...row].reverse().join('').includes(form)))
}
