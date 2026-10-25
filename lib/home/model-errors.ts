export class ModelServiceError extends Error {
  constructor(
    public code:string,
    message:string,
    public status:number,
    public retryable:boolean,
    public retryAfterSeconds?:number,
  ) { super(message); this.name='ModelServiceError'; }
}

type ErrorRecord=Record<string,unknown>;
function record(value:unknown):ErrorRecord|undefined {
  return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as ErrorRecord:undefined;
}
function seconds(value:number):number|undefined {
  return Number.isFinite(value)&&value>=0?Math.max(1,Math.min(86400,Math.ceil(value))):undefined;
}
function headerDelay(response:Response):number|undefined {
  const value=response.headers.get('Retry-After')?.trim();
  if(!value)return undefined;
  return /^\d+(?:\.\d+)?$/.test(value)?seconds(Number(value)):seconds((Date.parse(value)-Date.now())/1000);
}
function durationDelay(value:unknown):number|undefined {
  if(typeof value==='string'&&/^\d+(?:\.\d+)?s$/.test(value))return seconds(Number(value.slice(0,-1)));
  const duration=record(value);
  if(!duration||!['string','number'].includes(typeof duration.seconds)||typeof duration.seconds==='string'&&!duration.seconds.trim())return undefined;
  const whole=Number(duration.seconds),nanos=duration.nanos===undefined?0:Number(duration.nanos);
  if(!Number.isFinite(whole)||!Number.isFinite(nanos)||nanos<0||nanos>=1e9)return undefined;
  return seconds(whole+nanos/1e9);
}
async function errorData(response:Response):Promise<ErrorRecord|undefined> {
  const reader=response.body?.getReader();
  if(!reader)return undefined;
  const decoder=new TextDecoder();let text='',remaining=16384;
  try {
    while(remaining>0){
      const chunk=await reader.read();if(chunk.done)break;
      const bytes=chunk.value.subarray(0,remaining);remaining-=bytes.byteLength;
      text+=decoder.decode(bytes,{stream:true});
      if(chunk.value.byteLength>bytes.byteLength)break;
    }
    text+=decoder.decode();
    return record(record(JSON.parse(text))?.error);
  } catch { return undefined; }
  finally { await reader.cancel().catch(()=>{}); }
}

export async function classifyModelError(response:Response):Promise<ModelServiceError> {
  const error=await errorData(response);
  const details=Array.isArray(error?.details)?error.details.map(record).filter((detail):detail is ErrorRecord=>!!detail):[];
  const retryInfo=details.find(detail=>typeof detail['@type']==='string'&&detail['@type'].endsWith('google.rpc.RetryInfo'));
  const retryAfterSeconds=headerDelay(response)??durationDelay(retryInfo?.retryDelay);
  if(response.status===429){
    const quotaFailures=details.filter(detail=>typeof detail['@type']==='string'&&detail['@type'].endsWith('google.rpc.QuotaFailure'));
    const violations=quotaFailures.flatMap(detail=>Array.isArray(detail.violations)?detail.violations.map(record).filter((violation):violation is ErrorRecord=>!!violation):[]);
    const message=typeof error?.message==='string'?error.message:'';
    const zeroQuota=violations.some(violation=>(typeof violation.quotaValue==='number'||typeof violation.quotaValue==='string'&&violation.quotaValue.trim()!=='')&&Number(violation.quotaValue)===0)
      ||/\bquota\b[\s\S]*\blimit\s*:\s*0(?:\s|[,;]|$)/i.test(message);
    const dailyQuota=violations.some(violation=>[violation.quotaId,violation.quotaMetric,violation.description].some(value=>typeof value==='string'&&/(?:per[\s_-]?day|daily)/i.test(value)))
      ||/(?:daily\s+(?:request\s+|token\s+)?quota|quota[^\n]*per[\s_-]?day|(?:requests|tokens)perday)/i.test(message);
    if(zeroQuota)return new ModelServiceError('QUOTA_EXHAUSTED','Gemma has no quota available in this Google AI project. Your house is unchanged. Check the model quota or billing before retrying.',429,false);
    if(dailyQuota)return new ModelServiceError('QUOTA_EXHAUSTED','Gemma’s daily quota is exhausted. Your house is unchanged. Try after the quota resets, or check the Google AI project’s quota.',429,false);
    const wait=retryAfterSeconds??30;
    return new ModelServiceError('RATE_LIMIT',`Gemma’s request limit was reached. Your house is unchanged. Wait ${wait} seconds, then retry.`,429,true,wait);
  }
  if(response.status===401||response.status===403)return new ModelServiceError('AUTH','The Gemma connection needs attention. The site’s API key or model access must be checked.',503,false);
  const retryable=response.status>=500||response.status===408;
  return new ModelServiceError('UPSTREAM',retryable?'Gemma is temporarily unavailable. Your house is unchanged. Please retry in a moment.':'The Gemma service could not accept this request. Your house is unchanged. The model connection needs attention.',retryable?503:502,retryable,retryable?retryAfterSeconds:undefined);
}
