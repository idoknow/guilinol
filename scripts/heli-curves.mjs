import sharp from 'sharp'
import {mkdir} from 'node:fs/promises'
import {services} from '../lib/helicopter-clock.ts'
import {aircraftPose} from '../web/src/helicopter/flight.ts'

const directory=process.argv[2]??'captures/flight';await mkdir(directory,{recursive:true})
for(const [mode,plan] of Object.entries(services)){
  const seconds=.05,rows=[];let last,velocity=0,roll=0,pitch=0,speed=0,acceleration=0,reversal=0
  for(let tick=0;tick<=plan.total/seconds;tick++){
    const pose=aircraftPose((tick*seconds-plan.start)*1000,0,mode),next=last?(pose.y-last.y)/seconds:0,change=(next-velocity)/seconds
    rows.push([tick*seconds,pose.y,change]);last=pose;velocity=next
    roll=Math.max(roll,Math.abs(pose.roll)*180/Math.PI);pitch=Math.max(pitch,Math.abs(pose.pitch)*180/Math.PI);speed=Math.max(speed,Math.abs(next));acceleration=Math.max(acceleration,Math.abs(change))
  }
  for(let span=3;span<=10;span+=.5){const width=Math.round(span/seconds);for(let start=0;start<rows.length-width;start+=5){const center=rows[start+Math.round(width/2)][1],left=center-rows[start][1],right=center-rows[start+width][1];if(left*right>0)reversal=Math.max(reversal,Math.min(Math.abs(left),Math.abs(right)))}}
  console.log(mode,{roll,pitch,speed,acceleration,reversal});if(mode==='dynamic'&&reversal>2)throw Error('short-period reversal above 2m')
  for(const [index,title,low,high] of [[1,'Altitude (m)',150,510],[2,'Vertical acceleration (m/s²)',-1.6,1.6]]){
    const plotX=time=>80+720*time/plan.total,plotY=value=>240-190*(value-low)/(high-low)
    const path=rows.filter((_,row)=>row%4===0).map(([time,...values],row)=>`${row?'L':'M'}${plotX(time).toFixed(1)},${plotY(values[index-1]).toFixed(1)}`).join(' ')
    let grid='';for(let line=0;line<=4;line++){const time=plan.total*line/4,value=low+(high-low)*line/4;grid+=`<path d="M80 ${plotY(value)}H800 M${plotX(time)} 50V240" stroke="#ddd"/><text x="22" y="${plotY(value)+4}">${value.toFixed(1)}</text><text x="${plotX(time)-14}" y="265">${time.toFixed(0)} s</text>`}
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="850" height="285"><rect width="100%" height="100%" fill="white"/><g font-family="sans-serif" fill="#253742"><text x="80" y="28" font-size="20">${mode} · ${title}</text>${grid}<path d="${path}" fill="none" stroke="#137e79" stroke-width="2"/></g></svg>`
    await sharp(Buffer.from(svg)).png().toFile(`${directory}/${mode}-${index===1?'altitude':'acceleration'}.png`)
  }
}
