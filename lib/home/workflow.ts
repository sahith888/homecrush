import { Annotation, StateGraph, START, END } from '@langchain/langgraph';
import { PlanSchema, previewPlan, validatePatches, type DesignRequest, type Plan, type House } from './schema';

export class DesignError extends Error {
  constructor(public code:string,message:string,public status=502,public retryable=true){super(message);this.name='DesignError';}
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
At most 20 patches; message under 600 characters; question under 180 characters. For changes across the whole house, use one or two patches per room. Do not change unrelated settings. Do not claim unsupported geometry or object changes; explain what can be adjusted or ask one useful question with patches=[]. Answer questions without editing if no edit was requested. This is a visual concept, not a construction plan. Never output executable code.`;

type ModelResponse={candidates?:{finishReason?:string;content?:{parts?:{text?:string;thought?:boolean}[]}}[]};
export function parseModelPlan(raw:string):Plan {
  const trimmed=raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  const start=trimmed.indexOf('{'),end=trimmed.lastIndexOf('}');
  if(start<0||end<start)throw new Error('No complete edit plan.');
  return PlanSchema.parse(JSON.parse(trimmed.slice(start,end+1)));
}
const State=Annotation.Root({
  input:Annotation<DesignRequest>(),plan:Annotation<Plan>(),house:Annotation<House>(),
  mode:Annotation<'preview'|'gemma'>(),issue:Annotation<string>(),attempts:Annotation<number>(),
  steps:Annotation<string[]>({reducer:(a,b)=>a.concat(b),default:()=>[]}),
});
export async function runDesign(input:DesignRequest,apiKey?:string,fetcher:typeof fetch=fetch){
  const started=Date.now();
  async function askGemma(repair?:string):Promise<string>{
    const remaining=75000-(Date.now()-started);
    if(remaining<1000)throw new DesignError('TIMEOUT','Gemma took too long to reply. Your house is unchanged. Retry this edit.',504);
    let res:Response;
    try{
      res=await fetcher('https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent',{
        method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey!},
        body:JSON.stringify({systemInstruction:{parts:[{text:SYSTEM}]},contents:[{role:'user',parts:[{text:JSON.stringify({selectedRoom:input.room,house:input.house,history:input.history,request:input.prompt,...(repair?{correction:repair}:{})})}]}],generationConfig:{temperature:0.25,maxOutputTokens:2048,thinkingConfig:{thinkingLevel:'minimal'}}}),
        signal:AbortSignal.timeout(Math.min(60000,remaining)),
      });
    }catch(error){
      if(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name))throw new DesignError('TIMEOUT','Gemma took too long to reply. Your house is unchanged. Retry this edit.',504);
      throw new DesignError('CONNECTION','The connection to Gemma was interrupted. Your house is unchanged. Retry this edit.',503);
    }
    if(res.status===429)throw new DesignError('RATE_LIMIT','Gemma is busy or the API quota has been reached. Wait a moment, then retry this edit.',429);
    if(res.status===401||res.status===403)throw new DesignError('AUTH','The Gemma connection needs attention. The site’s API key or model access must be checked.',503,false);
    if(!res.ok)throw new DesignError('UPSTREAM','Gemma could not respond just now. Your house is unchanged. Retry this edit.',503);
    const data=await res.json() as ModelResponse;
    return data.candidates?.[0]?.content?.parts?.filter(p=>!p.thought).map(p=>p.text||'').join('')||'';
  }
  const graph=new StateGraph(State)
    .addNode('understand',async state=>{
      if(!apiKey)return {plan:previewPlan(state.input),mode:'preview' as const,attempts:1,issue:'',steps:['Understand request']};
      const raw=await askGemma();
      try{return {plan:parseModelPlan(raw),mode:'gemma' as const,attempts:1,issue:'',steps:['Understand request with Gemma']};}
      catch{return {mode:'gemma' as const,attempts:1,issue:'Return a complete valid JSON object using exactly the documented patch keys and value types.',steps:['Repair incomplete edit plan']};}
    })
    .addNode('validate',state=>{
      try{validatePatches(state.input.house,state.plan.patches);return {issue:'',steps:['Validate room settings']};}
      catch{return {issue:'The proposed settings are invalid. Use only documented room IDs, keys, enum values, six-digit hex colors, booleans, and plant counts 0..5. Use an empty plan and explain when a request is unsupported.',steps:['Check proposed settings again']};}
    })
    .addNode('repair',async state=>{
      const raw=await askGemma(state.issue);
      try{return {plan:parseModelPlan(raw),issue:'',attempts:state.attempts+1,steps:['Refine edit plan']};}
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
