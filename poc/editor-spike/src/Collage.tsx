import React from 'react';
import {AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

export type Props = {layout:'triptych'|'hero'; motion:'slide'|'zoom'|'kenburns'; effect:boolean; photos:string[]};
const layoutStyles: Record<Props['layout'], React.CSSProperties[]> = {
  triptych:[{left:'0%',top:'0%',width:'33.33%',height:'100%'},{left:'33.33%',top:'0%',width:'33.34%',height:'100%'},{left:'66.67%',top:'0%',width:'33.33%',height:'100%'}],
  hero:[{left:'0%',top:'0%',width:'66.67%',height:'100%'},{left:'66.67%',top:'0%',width:'33.33%',height:'50%'},{left:'66.67%',top:'50%',width:'33.33%',height:'50%'}],
};
export const Collage: React.FC<Props> = ({layout,motion,effect,photos}) => {
  const frame=useCurrentFrame(); const {durationInFrames}=useVideoConfig();
  return <AbsoluteFill style={{background:'#16131b',overflow:'hidden'}}>{photos.slice(0,3).map((src,i)=>{
    const progress=interpolate(frame,[0,durationInFrames],[0,1],{extrapolateRight:'clamp'});
    const transform=motion==='zoom'?`scale(${1+progress*.16})`:motion==='kenburns'?`scale(${1+progress*.2}) translate(${progress*-3+i*1}%,${progress*2-i}%)`:`translateX(${(1-progress)*(i%2?14:-14)}%)`;
    return <div key={i} style={{position:'absolute',...layoutStyles[layout][i],padding:5,boxSizing:'border-box'}}><div style={{width:'100%',height:'100%',overflow:'hidden',borderRadius:10,border:'1px solid #ffffff36'}}><Img src={src} style={{width:'100%',height:'100%',objectFit:'cover',transform}} /></div></div>
  })}{effect&&<AbsoluteFill style={{pointerEvents:'none',background:'linear-gradient(135deg,transparent 30%,#f3b96a22 70%),radial-gradient(ellipse,#0000 42%,#0008)',mixBlendMode:'screen'}}/>}</AbsoluteFill>;
};
