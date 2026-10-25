import { HouseSchema, PlanSchema, type House, type Plan } from './schema';

export type DesignResponse = { house:House; plan:Plan; mode:'preview'|'gemma'; steps:string[] };

export class DesignRequestError extends Error {
  constructor(
    message:string,
    public code:string,
    public status:number,
    public retryable=true,
    public retryAfterSeconds?:number,
    public requestId?:string,
  ) { super(message); this.name='DesignRequestError'; }
}

function retryDelay(value:unknown):number|undefined {
  const seconds=typeof value==='number'?value:typeof value==='string'&&value.trim()?Number(value):NaN;
  return Number.isFinite(seconds)&&seconds>0?Math.min(86400,Math.ceil(seconds)):undefined;
}

function retryHeader(response:Response):number|undefined {
  const value=response.headers.get('Retry-After');
  if(!value)return undefined;
  return retryDelay(value)??retryDelay((Date.parse(value)-Date.now())/1000);
}

export async function readDesignResponse(response:Response):Promise<DesignResponse> {
  const text=await response.text();
  let data:Record<string,unknown>|undefined;
  try { const parsed=JSON.parse(text); if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))data=parsed; } catch {}
  if(!response.ok){
    const code=typeof data?.code==='string'?data.code:response.status===429?'RATE_LIMIT':'HOSTING_ERROR';
    const retryAfterSeconds=retryDelay(data?.retryAfterSeconds)??retryHeader(response);
    const requestId=typeof data?.requestId==='string'?data.requestId:undefined;
    const retryable=data?.retryable!==false;
    if(!data&&/(?:\b1102\b|worker exceeded resource limits|cpu time limit|exceeded (?:its |the )?cpu)/i.test(text)){
      throw new DesignRequestError('HomeCrush hit its hosting processing limit. Your house is unchanged. Try this edit again; repeated failures need a server fix.','HOSTING_LIMIT',response.status,true,retryAfterSeconds);
    }
    const fallback=code==='RATE_LIMIT'
      ?'The edit service reached its request limit. Your house is unchanged. Wait a moment, then retry.'
      :'The edit service could not complete the request. Your house is unchanged. Please retry in a moment.';
    const message=typeof data?.error==='string'&&data.error.trim()?data.error:fallback;
    throw new DesignRequestError(message,code,response.status,retryable,retryAfterSeconds,requestId);
  }
  const house=HouseSchema.safeParse(data?.house);
  const plan=PlanSchema.safeParse(data?.plan);
  if(!house.success||!plan.success||(data?.mode!=='preview'&&data?.mode!=='gemma')){
    throw new DesignRequestError('The edit service returned an incomplete response. Your house is unchanged. Please retry this edit.','INVALID_RESPONSE',response.status);
  }
  return {house:house.data,plan:plan.data,mode:data.mode,steps:Array.isArray(data.steps)?data.steps.filter((step):step is string=>typeof step==='string'):[]};
}
