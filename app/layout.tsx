import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'HomeCrush — Your Dream Home Studio',description:'Build a home that feels like you. Refine every detail with Gemma, then walk through both floors.',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
