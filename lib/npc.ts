export const npcDefaults={classes:['trunk','primary','secondary'],carMin:1,carMax:3,personMin:4,personMax:8,horn:true,mutter:true,bubble:true,volume:.65,bumpSpeed:1.5,bubbleSeconds:2.5,
  bumpLines:['走路不看路啊？','搞哪样哦！','你眼睛长后脑壳啦？','慢点咯，赶着去嗦粉啊？','撞到人了晓得不？','哎哟，痛死我了！','开车看着点嘛！','莫挤莫挤！'],
  mutterLines:['今天好热哦','等下去嗦碗米粉','这个天要落雨了','菜又涨价了','走快点，要迟到了','晚上去两江四湖走一圈','东西街人好多哦','油茶还没喝呢']}
export function validNpc(input:unknown):input is typeof npcDefaults{
  if(!input||typeof input!=='object')return false
  const rules=input as typeof npcDefaults
  return Array.isArray(rules.classes)&&rules.classes.length>0&&rules.classes.every(value=>['trunk','primary','secondary','tertiary'].includes(value))&&
    [rules.carMin,rules.carMax,rules.personMin,rules.personMax].every(value=>Number.isInteger(value)&&value>=1&&value<=20)&&rules.carMin<=rules.carMax&&rules.personMin<=rules.personMax&&
    [rules.horn,rules.mutter,rules.bubble].every(value=>typeof value==='boolean')&&Number.isFinite(rules.volume)&&rules.volume>=0&&rules.volume<=1&&Number.isFinite(rules.bumpSpeed)&&rules.bumpSpeed>=0&&rules.bumpSpeed<=30&&Number.isFinite(rules.bubbleSeconds)&&rules.bubbleSeconds>.1&&rules.bubbleSeconds<=15&&
    [rules.bumpLines,rules.mutterLines].every(lines=>Array.isArray(lines)&&lines.length>0&&lines.length<=64&&lines.every(line=>typeof line==='string'&&line.trim()&&line.length<=80))
}
