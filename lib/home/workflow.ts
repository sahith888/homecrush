import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { PlanSchema, RoomSchema, MAX_PATCHES, previewPlan, validatePatches, type DesignRequest, type Plan, type House } from './schema';
import { ModelServiceError, classifyModelError } from './model-errors';

export class DesignError extends ModelServiceError {
  constructor(code:string,message:string,status=502,retryable=true){super(code,message,status,retryable);this.name='DesignError';}
}
const SYSTEM=`You are the HomeCrush home design guide. Iteratively edit the supplied house, preserving earlier choices. Return ONLY one JSON object: {"patches":[{"room":"living","key":"lighting","value":"warm"}],"message":"Briefly describe the actual changes.","question":"An optional short follow-up"}.
Rooms: living, kitchen, studio, bedroom, guest, bathroom, hallway (central ground-floor hallway), upperHallway (upstairs landing). Use the selected room for ambiguous requests. "Middle hallway" means hallway; use upperHallway if upstairs is specified. The house has two permanent floors and connected stairs.
Allowed room keys and values:
wall, floorColor, accent, cabinet: six-digit hex color strings.
floorKind: oak|walnut|stone|tile. windows: standard|tall. plants: integer 0..5.
rug, lamp, furniture, island: boolean. island applies only to kitchen.
style: warm|minimal|coastal|moody. lighting: warm|neutral|cool. decor: minimal|layered.
Global patches use room=house, key=time, value=day|golden|night.
For cozy warm lighting, set lighting=warm and lamp=true and choose appropriate warm room colors. For more hallway decoration, set decor=layered, add plants and a lamp, and optionally a rug; keep the stair route clear. All hallway settings are supported except windows, island and furniture.
Output rules: each patch has exactly room, key, value. One setting per patch. For example, walnut floors and more plants in living is {"patches":[{"room":"living","key":"floorKind","value":"walnut"},{"room":"living","key":"floorColor","value":"#805d44"},{"room":"living","key":"plants","value":4}],"message":"Updated the living room's walnut flooring and plants."}.
The room "house" supports ONLY time, never floorKind, plants, lighting or style. Repeat room patches for each room when the user explicitly requests the whole house. Otherwise change ONLY the named room(s), or selectedRoom when no room is named. A request about the central hallway does NOT include the upstairs landing.
At most ${MAX_PATCHES} patches; message under 600 characters; question under 180 characters. Do not change unrelated settings. Do not claim unsupported geometry or object changes; explain what can be adjusted or ask one useful question with patches=[]. Answer questions without editing if no edit was requested. This is a visual concept, not a construction plan. Never output executable code.`;

type ModelResponse={promptFeedback?:{blockReason?:string};candidates?:{finishReason?:string;content?:{parts?:{text?:string;thought?:boolean}[]}}[]};
export function parseModelPlan(raw:string):Plan {
  const trimmed=raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  const start=trimmed.indexOf('{'),end=trimmed.lastIndexOf('}');
  if(start<0||end<start)throw new Error('No complete edit plan.');
  const data=JSON.parse(trimmed.slice(start,end+1));
  // Gemma sometimes groups several valid room settings in one object. Normalize
  // that representation without accepting unknown keys or weakening validation.
  if(Array.isArray(data?.patches))data.patches=data.patches.flatMap((patch:unknown)=>{
    if(!patch||typeof patch!=='object'||Array.isArray(patch))return [patch];
    const p=patch as Record<string,unknown>;
    if(Object.hasOwn(p,'key')||Object.hasOwn(p,'value'))return [p];
    const grouped=Object.hasOwn(p,'set')?p.set:Object.fromEntries(Object.entries(p).filter(([key])=>key!=='room'));
    if(Object.hasOwn(p,'set')&&Object.keys(p).some(key=>key!=='room'&&key!=='set'))throw new Error('Grouped patches permit only room and set.');
    if(!grouped||typeof grouped!=='object'||Array.isArray(grouped)||!Object.keys(grouped).length)throw new Error('Each patch needs a room and settings.');
    return Object.entries(grouped).map(([key,value])=>{
      if(key!=='time'&&!Object.hasOwn(RoomSchema.shape,key))throw new Error(`Unsupported setting: ${key}.`);
      return {room:p.room,key,value};
    });
  });
  if(Array.isArray(data?.patches))data.patches=data.patches.map((patch:Record<string,unknown>)=>{
    if(!patch||typeof patch!=='object')return patch;
    if(patch.key==='plants'&&typeof patch.value==='string'&&/^[0-5]$/.test(patch.value))return {...patch,value:Number(patch.value)};
    if(['rug','lamp','furniture','island'].includes(String(patch.key))&&(patch.value==='true'||patch.value==='false'))return {...patch,value:patch.value==='true'};
    return patch;
  });
  return PlanSchema.parse(data);
}
function planIssue(house:House,plan:Plan):string {
  for(const [index,p] of plan.patches.entries()){
    const label=`patches[${index}] (${p.room}.${p.key})`;
    if(p.room==='house'){
      if(p.key!=='time')return `${label}: house permits only time. Apply ${p.key} to individual rooms instead.`;
      if(!['day','golden','night'].includes(String(p.value)))return `${label}: time must be day, golden, or night.`;
    }else{
      if((p.room==='hallway'||p.room==='upperHallway')&&['windows','island','furniture'].includes(p.key))return `${label}: hallways do not support this setting. Remove that patch; use decor, plants, lamp, rug or colors.`;
      const field=RoomSchema.shape[p.key as keyof typeof RoomSchema.shape];
      if(!Object.hasOwn(RoomSchema.shape,p.key)||!field)return `${label}: unknown setting. Use only the documented room keys.`;
      const parsed=field.safeParse(p.value);
      if(!parsed.success)return `${label}: ${parsed.error.issues.map(i=>i.message).join('; ')}.`;
    }
  }
  try{validatePatches(house,plan.patches);return '';}catch{return 'The final house must satisfy all documented room settings.';}
}
const State=Annotation.Root({
  input:Annotation<DesignRequest>(),plan:Annotation<Plan>(),house:Annotation<House>(),
  mode:Annotation<'preview'|'gemma'>(),issue:Annotation<string>(),raw:Annotation<string>(),attempts:Annotation<number>(),
  steps:Annotation<string[]>({reducer:(a,b)=>a.concat(b),default:()=>[]}),
});
export async function runDesign(input:DesignRequest,apiKey?:string,fetcher:typeof fetch=fetch){
  const started=Date.now();let transientRetries=0;
  async function askGemma(repair?:string,previousOutput?:string):Promise<string>{
    const remaining=75000-(Date.now()-started);
    if(remaining<1000)throw new DesignError('TIMEOUT','Gemma took too long to reply. Your house is unchanged. Retry this edit.',504);
    let res:Response;
    try{
      res=await fetcher('https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent',{
        method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey!},
        body:JSON.stringify({systemInstruction:{parts:[{text:SYSTEM}]},contents:[{role:'user',parts:[{text:JSON.stringify({selectedRoom:input.room,house:input.house,history:input.history,request:input.prompt,...(repair?{correction:repair,previousOutput:previousOutput?.slice(0,16000),instruction:'Return the complete corrected plan, not a diff. Fix the stated error and preserve the original request scope.'}:{})})}]}],generationConfig:{temperature:0.1,maxOutputTokens:repair?8192:4096,thinkingConfig:{thinkingLevel:'minimal'}}}),
        signal:AbortSignal.timeout(Math.min(60000,remaining)),
      });
    }catch(error){
      if(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name))throw new DesignError('TIMEOUT','Gemma took too long to reply. Your house is unchanged. Retry this edit.',504);
      throw new DesignError('CONNECTION','The connection to Gemma was interrupted. Your house is unchanged. Retry this edit.',503);
    }
    if(!res.ok){
      const failure=await classifyModelError(res);
      const delay=Math.max(500,(failure.retryAfterSeconds||0)*1000);
      if(res.status>=500&&transientRetries<1&&delay<=5000&&Date.now()-started+delay<60000){transientRetries++;await new Promise(resolve=>setTimeout(resolve,delay));return askGemma(repair,previousOutput);}
      throw failure;
    }
    let data:ModelResponse;
    try{data=await res.json() as ModelResponse;}catch{throw new DesignError('UPSTREAM','Gemma returned an unreadable response. Your house is unchanged. Retry this edit.',503);}
    if(!data||typeof data!=='object'||Array.isArray(data))throw new DesignError('UPSTREAM','Gemma returned an unreadable response. Your house is unchanged. Retry this edit.',503);
    if(data.promptFeedback?.blockReason||['SAFETY','RECITATION','PROHIBITED_CONTENT','BLOCKLIST'].includes(data.candidates?.[0]?.finishReason||''))throw new DesignError('BLOCKED','Gemma could not answer that request. Your house is unchanged. Try describing the room colors, lighting, floors or decor differently.',422,false);
    return data.candidates?.[0]?.content?.parts?.filter(p=>!p.thought).map(p=>p.text||'').join('')||'';
  }
  const graph=new StateGraph(State)
    .addNode('understand',async state=>{
      if(!apiKey)return {plan:previewPlan(state.input),mode:'preview' as const,attempts:1,issue:'',steps:['Understand request']};
      const raw=await askGemma();
      try{return {plan:parseModelPlan(raw),raw,mode:'gemma' as const,attempts:1,issue:'',steps:['Understand request with Gemma']};}
      catch(error){return {raw,mode:'gemma' as const,attempts:1,issue:`Return complete JSON with patches, message, and optional question. Use exactly room/key/value in each patch. Validation: ${error instanceof Error?error.message.slice(0,1200):'Invalid plan'}`,steps:['Repair incomplete edit plan']};}
    })
    .addNode('validate',state=>{
      const issue=planIssue(state.input.house,state.plan);
      return {issue,steps:[issue?'Check proposed settings again':'Validate room settings']};
    })
    .addNode('repair',async state=>{
      const raw=await askGemma(state.issue,state.raw);
      try{return {plan:parseModelPlan(raw),raw,issue:'',attempts:state.attempts+1,steps:['Refine edit plan']};}
      catch{throw new DesignError('INVALID_PLAN','Gemma’s edit plan was incomplete. Your house is unchanged. Retry this edit.');}
    })
    .addNode('apply',state=>({house:validatePatches(state.input.house,state.plan.patches),steps:[state.plan.patches.length?'Apply scene changes':'Keep current scene']}))
    .addNode('respond',()=>({steps:['Save design revision']}))
    .addNode('reject',()=>{throw new DesignError('INVALID_PLAN','Gemma proposed a setting this house cannot apply. Your house is unchanged. Try a room color, lighting, plants, or decor.');})
    .addEdge(START,'understand')
    .addConditionalEdges('understand',s=>s.issue?'repair':'validate',{repair:'repair',validate:'validate'})
    .addEdge('repair','validate')
    .addConditionalEdges('validate',s=>!s.issue?'apply':s.attempts<2&&apiKey?'repair':'reject',{apply:'apply',repair:'repair',reject:'reject'})
    .addEdge('apply','respond').addEdge('respond',END).addEdge('reject',END).compile();
  const result=await graph.invoke({input});
  return {house:result.house,plan:result.plan,mode:result.mode,steps:result.steps};
}
