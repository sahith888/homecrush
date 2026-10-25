import { env } from 'cloudflare:workers';
import { RequestSchema } from '@/lib/home/schema';
import { DesignError, runDesign } from '@/lib/home/workflow';
export async function POST(request:Request){
  const started=Date.now();const requestId=crypto.randomUUID();
  try{
    if(Number(request.headers.get('content-length')||0)>40000)return Response.json({error:'Request too large.'},{status:413});
    const text=await request.text();if(text.length>40000)return Response.json({error:'Request too large.'},{status:413});
    let body:unknown;try{body=JSON.parse(text);}catch{return Response.json({error:'The design request was not valid JSON.'},{status:400});}
    const parsed=RequestSchema.safeParse(body);
    if(!parsed.success)return Response.json({error:'The saved design could not be read. Reload the site, then retry your edit.'},{status:400});
    const key=(env as unknown as Record<string,string>).GEMINI_API_KEY;
    return Response.json(await runDesign(parsed.data,key),{headers:{'Cache-Control':'no-store'}});
  }catch(error){
    const known=error instanceof DesignError;
    // Log diagnostics only: never API keys, user prompts, model output, or the house contents.
    console.error(JSON.stringify({event:'design_failed',requestId,code:known?error.code:'INTERNAL',elapsedMs:Date.now()-started}));
    return Response.json({error:known?error.message:'The edit service hit an unexpected problem. Your house is unchanged. Retry this edit.',code:known?error.code:'INTERNAL',retryable:known?error.retryable:true,requestId},{status:known?error.status:500,headers:{'Cache-Control':'no-store'}});
  }
}
