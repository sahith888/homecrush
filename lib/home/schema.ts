import { z } from 'zod';

export const ROOM_IDS = ['living', 'kitchen', 'studio', 'bedroom', 'guest', 'bathroom', 'hallway', 'upperHallway'] as const;
export type RoomId = typeof ROOM_IDS[number];
export const ROOMS: Record<RoomId, { name: string; floor: number; x: number; z: number; width: number; depth: number }> = {
  living: { name: 'Living room', floor: 0, x: -4.2, z: 2.9, width: 7.2, depth: 5.6 },
  kitchen: { name: 'Kitchen & dining', floor: 0, x: -4.2, z: -3, width: 7.2, depth: 5.4 },
  studio: { name: 'Creative studio', floor: 0, x: 5.5, z: 0, width: 4.4, depth: 11.6 },
  bedroom: { name: 'Primary bedroom', floor: 1, x: -4.2, z: 2.9, width: 7.2, depth: 5.6 },
  guest: { name: 'Guest room', floor: 1, x: -4.2, z: -3, width: 7.2, depth: 5.4 },
  bathroom: { name: 'Spa bathroom', floor: 1, x: 5.5, z: 0, width: 4.4, depth: 11.6 },
  hallway: { name: 'Central hallway', floor: 0, x: 1.3, z: 0, width: 3.2, depth: 11.6 },
  upperHallway: { name: 'Upstairs landing', floor: 1, x: 1.3, z: 0, width: 3.2, depth: 11.6 },
};
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const RoomSchema = z.object({
  wall: color, floorColor: color, floorKind: z.enum(['oak','walnut','stone','tile']),
  accent: color, cabinet: color, windows: z.enum(['standard','tall']),
  plants: z.number().int().min(0).max(5), rug: z.boolean(), lamp: z.boolean(),
  lighting: z.enum(['warm','neutral','cool']).default('neutral'), decor: z.enum(['minimal','layered']).default('minimal'),
  furniture: z.boolean(), island: z.boolean(), style: z.enum(['warm','minimal','coastal','moody']),
});
export type RoomConfig = z.infer<typeof RoomSchema>;
const base:RoomConfig = { wall:'#e9e3d6', floorColor:'#ba916a', floorKind:'oak', accent:'#7c8c65', cabinet:'#e2d5bd', windows:'tall', plants:2, rug:true, lamp:true, furniture:true, island:true, style:'warm',lighting:'neutral',decor:'minimal' };
const hallDefault:RoomConfig={...base,plants:0,rug:true,lamp:false};
export const HouseSchema = z.object({
  version: z.literal(1), revision: z.number().int().min(0).max(10000),
  time: z.enum(['day','golden','night']),
  rooms: z.object({ living: RoomSchema, kitchen: RoomSchema, studio: RoomSchema, bedroom: RoomSchema, guest: RoomSchema, bathroom: RoomSchema, hallway:RoomSchema.default(hallDefault), upperHallway:RoomSchema.default({...hallDefault,plants:1}) }),
});
export type House = z.infer<typeof HouseSchema>;
export const DEFAULT_HOUSE:House = { version:1, revision:0, time:'day', rooms:{
  hallway:{...hallDefault},upperHallway:{...hallDefault,plants:1},
  living:{...base}, kitchen:{...base,accent:'#b78161',cabinet:'#8f9b7c',rug:false},
  studio:{...base,wall:'#e1e5db',accent:'#b47d5d',plants:3},
  bedroom:{...base,wall:'#e8dfd5',accent:'#b27e66'},
  guest:{...base,wall:'#dee5e4',accent:'#839c9e',plants:1},
  bathroom:{...base,wall:'#dddcd1',floorKind:'stone',floorColor:'#bcbcaf',accent:'#98a18a',rug:false,plants:2},
}};
export const PatchSchema = z.object({ room:z.enum([...ROOM_IDS,'house']), key:z.string().max(30), value:z.union([z.string().max(30),z.boolean(),z.number()]) }).strict();
export const MAX_PATCHES = 128;
export const PlanSchema = z.object({ patches:z.array(PatchSchema).max(MAX_PATCHES), message:z.string().max(1000), question:z.string().max(250).nullish().transform(v=>v||undefined) });
export type Patch = z.infer<typeof PatchSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export function validatePatches(house:House, patches:Patch[]):House {
  const next=HouseSchema.parse(house);
  for(const p of patches){
    if(p.room==='house') { if(p.key!=='time')throw new Error('Only lighting can be changed at house level.'); (next as unknown as Record<string,unknown>)[p.key]=p.value; }
    else {if(!Object.hasOwn(next.rooms,p.room))throw new Error('This space is not supported.');if((p.room==='hallway'||p.room==='upperHallway')&&['windows','island','furniture'].includes(p.key))throw new Error('This hallway setting is not supported.');if(!Object.hasOwn(RoomSchema.shape,p.key))throw new Error('This room setting is not supported.'); (next.rooms[p.room] as unknown as Record<string,unknown>)[p.key]=p.value;}
  }
  if(patches.length)next.revision+=1;
  return HouseSchema.parse(next);
}

export const RequestSchema = z.object({ prompt:z.string().trim().min(1).max(2000), room:z.enum(ROOM_IDS), house:HouseSchema, history:z.array(z.object({role:z.enum(['user','assistant']),text:z.string().max(2000)})).max(12).default([]) });
export type DesignRequest = z.infer<typeof RequestSchema>;

export function previewPlan(input:DesignRequest):Plan {
  const text=input.prompt.toLowerCase();
  let room:RoomId=input.room;
  const aliases: [RegExp,RoomId][]=[[/upstairs.*hall|upper.*hall|landing/,'upperHallway'],[/hallway|hall|corridor/,'hallway'],[/living|lounge/,'living'],[/kitchen|dining/,'kitchen'],[/studio|office/,'studio'],[/guest/,'guest'],[/bedroom|primary|master/,'bedroom'],[/bath|spa/,'bathroom']];
  for(const [re,id] of aliases)if(re.test(text)){room=id;break;}
  const patches:Patch[]=[];const add=(key:string,value:Patch['value'])=>patches.push({room,key,value});
  const palette: [string,string][]=[['sage','#a5b293'],['forest','#365b44'],['green','#809b76'],['terracotta','#b97556'],['pink','#d2a1a3'],['blush','#d2a1a3'],['blue','#7a9da9'],['navy','#354e69'],['cream','#eee4ce'],['white','#f4f0e7'],['beige','#d5c5ac'],['black','#393b39'],['gray','#9b9e9a'],['grey','#9b9e9a'],['yellow','#dec58a'],['purple','#a08bb0'],['red','#af635c']];
  const hex=text.match(/#[0-9a-f]{6}\b/)?.[0];
  const col=hex||palette.find(([name])=>text.includes(name))?.[1];
  const remove=/remove|less|no |without|hide/.test(text);
  if(/coastal|beach/.test(text)){add('style','coastal');add('wall','#e9f0eb');add('accent','#769ca4');add('floorColor','#ceba96');}
  else if(/moody|dark cozy|dramatic/.test(text)){add('style','moody');add('wall','#48554e');add('accent','#b98664');add('floorColor','#755442');}
  else if(/minimal|cleaner|simpler/.test(text)){add('style','minimal');add('wall','#efeee7');add('accent','#c0b6a6');add('plants',1);}
  else if(/warm|cozy|cosy|scandinavian/.test(text)){add('style','warm');add('wall','#e9dfcc');add('accent','#b18363');add('floorColor','#bd956e');add('lamp',true);}
  if(/warm light|warm lighting|cozy|cosy/.test(text))add('lighting','warm');
  if(/neutral light/.test(text))add('lighting','neutral');
  if(/cool light/.test(text))add('lighting','cool');
  if(/decorat|decor|artwork|accessori/.test(text)){add('decor',remove?'minimal':'layered');if(!remove){add('plants',Math.min(5,input.house.rooms[room].plants+2));add('lamp',true);}}
  if(col) add(/cabinet/.test(text)?'cabinet':/sofa|couch|bed|accent|chair/.test(text)?'accent':/floor/.test(text)?'floorColor':'wall',col);
  if(/walnut/.test(text)){add('floorKind','walnut');add('floorColor','#805d44');}
  else if(/oak|wood floor/.test(text)){add('floorKind','oak');add('floorColor','#c59c72');}
  else if(/stone|marble/.test(text)){add('floorKind','stone');add('floorColor','#c8c7bb');}
  else if(/tile/.test(text)){add('floorKind','tile');add('floorColor','#c5c8bd');}
  if(/plant|greenery/.test(text))add('plants',remove?0:Math.min(5,input.house.rooms[room].plants+2));
  if(/rug|carpet/.test(text))add('rug',!remove);
  if(/lamp|pendant/.test(text))add('lamp',!remove);
  if(/island/.test(text)){room='kitchen';patches.push({room,key:'island',value:!remove});}
  if(/empty|remove (the )?furniture/.test(text))add('furniture',false);
  if(/furnish|bring.*furniture|add.*furniture/.test(text)&&!remove)add('furniture',true);
  if(/window|more light|brighter/.test(text))add('windows',/small|standard/.test(text)?'standard':'tall');
  if(/sunset|golden|evening/.test(text))patches.push({room:'house',key:'time',value:'golden'});
  else if(/night/.test(text))patches.push({room:'house',key:'time',value:'night'});
  else if(/daylight|morning|daytime/.test(text))patches.push({room:'house',key:'time',value:'day'});
  const unique=patches.filter((p,i)=>patches.findLastIndex(q=>q.room===p.room&&q.key===p.key)===i);
  if(!unique.length)return {patches:[],message:'Preview mode can change room colors, wood or stone floors, style, windows, plants, rugs, lamps, furniture, the kitchen island, and time of day.',question:'Try “sage walls and walnut floors” or “make the bedroom coastal”.'};
  const target=unique.every(p=>p.room==='house')?'the house':ROOMS[room].name.toLowerCase();
  return {patches:unique,message:`I updated ${target} and kept the rest of your design. Walk around to see how it feels.`,question:unique.some(p=>p.key==='wall')?'Would you like to adjust the flooring or furniture color next?':'What detail should we refine next?'};
}
