export interface Skin {id:string;name:string;subtitle:string;bpm:number;key:number;palette:[string,string,string,string];accent:string;back:string;material:string;level:number;}
export const skins:Skin[]=[
  {id:'ignition',name:'IGNITION',subtitle:'the first spark',bpm:116,key:0,palette:['#fa577e','#f9b64a','#5be0c2','#9a91ff'],accent:'#ff6287',back:'#0e101a',material:'enamel',level:1},
  {id:'afterglow',name:'AFTERGLOW',subtitle:'paint the horizon',bpm:122,key:2,palette:['#fa835d','#f3d998','#86dbc6','#b3a3ea'],accent:'#ff996f',back:'#171421',material:'glass',level:2},
  {id:'neon-rush',name:'NEON RUSH',subtitle:'city pulse',bpm:132,key:5,palette:['#ff579c','#ffe05c','#64ddf3','#ac81ff'],accent:'#e65bff',back:'#0c1020',material:'phosphor',level:3},
  {id:'fracture',name:'FRACTURE',subtitle:'break the signal',bpm:144,key:7,palette:['#ff5a65','#e6b565','#61e5d0','#e3b5fa'],accent:'#ff676e',back:'#1a111b',material:'stone',level:4},
  {id:'stillwater',name:'STILLWATER',subtitle:'between the beats',bpm:108,key:9,palette:['#62afda','#c7d5c6','#68b6a9','#bba4d4'],accent:'#8bc6e8',back:'#101b22',material:'crystal',level:5},
  {id:'coda',name:'CODA',subtitle:'play it by ear',bpm:120,key:11,palette:['#e7c6b4','#c9ad8e','#c5d1cc','#b5bdd8'],accent:'#d0baa3',back:'#181819',material:'obsidian',level:6}
];
export function mastery(score:number):string{return score>=55000?'RESONANT':score>=26000?'PLATINUM':score>=12000?'GOLD':score>=5000?'SILVER':'BRONZE';}
