import { env } from 'cloudflare:workers';
import { MatchRequestSchema } from '@/lib/home/match-profile';
import { findMatches } from '@/lib/home/matching';
export async function POST(request:Request){
  if(request.headers.get('origin')&&request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'Please search from HomeCrush.'},{status:403});
  try{
    const text=await request.text();if(text.length>40000)return Response.json({error:'Search request too large.'},{status:413});
    let input:unknown;try{input=JSON.parse(text);}catch{return Response.json({error:'Invalid search request.'},{status:400});}
    const parsed=MatchRequestSchema.safeParse(input);if(!parsed.success)return Response.json({error:'Check your search description and optional filters.'},{status:400});
    const key=(env as unknown as Record<string,string>).GEMINI_API_KEY;
    return Response.json(await findMatches(parsed.data,key),{headers:{'Cache-Control':'private, no-store'}});
  }catch{console.error(JSON.stringify({event:'match_search_failed'}));return Response.json({error:'We couldn’t check the listing sites. Try again in a moment.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
