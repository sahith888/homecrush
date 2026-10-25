import { z } from 'zod';
import { HouseSchema, ROOM_IDS, ROOMS, type House, type RoomId } from './schema';
export const MatchRequestSchema=z.object({house:HouseSchema,favorites:z.array(z.enum(ROOM_IDS)).max(8).default([]),description:z.string().trim().min(5).max(600),location:z.string().trim().max(100).default(''),intent:z.enum(['either','buy','rent']).default('either'),maxPrice:z.number().positive().max(100000000).optional()});
export type MatchRequest=z.infer<typeof MatchRequestSchema>;
export type Trait={label:string;pattern:RegExp;weight:number};
export function dreamDescription(house:House,favorites:RoomId[]=[]){
  const selected=favorites.length?favorites.map(id=>house.rooms[id]):Object.values(house.rooms);
  const counts=(key:'style'|'floorKind')=>{const c:Record<string,number>={};for(const r of selected)c[r[key]]=(c[r[key]]||0)+1;return Object.keys(c).sort((a,b)=>c[b]-c[a])[0];};
  const style={warm:'a warm, cozy atmosphere',minimal:'a clean, minimalist interior',coastal:'a light, coastal feel',moody:'a rich, intimate atmosphere'}[counts('style')]||'a welcoming interior';
  const floor=counts('floorKind');const details=[style,`${floor==='oak'||floor==='walnut'?floor+' wood':floor} floors`];
  if(selected.some(r=>r.windows==='tall'))details.push('large windows and natural light');
  if(house.rooms.kitchen.island)details.push('a kitchen island');
  if(selected.some(r=>r.lighting==='warm'))details.push('warm lighting');
  if(selected.some(r=>r.decor==='layered'))details.push('layered, welcoming details');
  return `A two-story home with ${details.join(', ')}.${favorites.length?' Especially important: '+favorites.map(id=>ROOMS[id].name.toLowerCase()).join(', ')+'.':''}`;
}
const definitions:[string,RegExp,RegExp][]=[
  ['Two stories',/two.story|two.floor|2.story|2.floor/i,/two.story|two.level|2.story|2.level|stories[^\d]{0,8}2|upstairs|second floor/i],
  ['Wood floors',/wood|oak|walnut/i,/hardwood|wood floor|oak floor|walnut floor|plank floor/i],
  ['Large windows & light',/window|light|bright/i,/large windows|oversized windows|floor.to.ceiling|walls of glass|natural light|light.filled|two story windows|abundant sunlight/i],
  ['Kitchen island',/island/i,/kitchen island|large island|center island|centre island|central island|island kitchen/i],
  ['Warm, cozy character',/warm|cozy|cosy/i,/warm|cozy|cosy|fireplace|wood.burning|timbered|wood accents/i],
  ['Minimal style',/minimal|clean/i,/minimalist|minimal|clean lines|modern design|contemporary/i],
  ['Coastal character',/coastal|beach|ocean/i,/coastal|ocean|beach|waterfront|sea view/i],
  ['Rich, intimate spaces',/moody|intimate|dark/i,/intimate|rich|dark wood|wood.panel|library|fireplace/i],
  ['Layered details',/layered|decoration|decor|details/i,/bookcases|built.in|paneled|panelling|beams|custom cabinetry/i]
];
export function desiredTraits(description:string):Trait[]{return definitions.filter(([,query])=>query.test(description)).map(([label,,pattern])=>({label,pattern,weight:label==='Two stories'?2:1}));}
export type Listing={id:string;url:string;title:string;location:string;price:number|null;intent:'buy'|'rent';status:string;beds:number|null;baths:number|null;sqft:number|null;images:string[];photoNote:string;source:string;description:string;matches:string[];unconfirmed:string[];score:number;checkedAt:string};
export type MatchResponse={listings:Listing[];mode:'web'|'collection';notice:string;searched:number;checkedAt:string;description:string;searchUrl:string;searchWidget?:string};
