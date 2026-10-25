import type { Metadata } from 'next';
import './globals.css';
import './workspace.css';
import './enhancements.css';
import 'katex/dist/katex.min.css';
export const metadata:Metadata={title:'算法训练工作台 · AlgoNotes',description:'让每一次思考都有迹可循。你的题单、STL、笔记与练习记录。',icons:{icon:'/favicon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>}
