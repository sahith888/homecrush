import { env } from 'cloudflare:workers';
export async function GET(){return Response.json({mode:(env as unknown as Record<string,string>).GEMINI_API_KEY?'gemma':'preview',model:'gemma-4-26b-a4b-it'},{headers:{'Cache-Control':'no-store'}});}
