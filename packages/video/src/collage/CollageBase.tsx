import React from "react";
import { AbsoluteFill, Img, OffthreadVideo, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { CollageSpec, CollageSlot } from "./schema";

export type CollageProps = { spec: CollageSpec; sources?: Record<string, string> };
const WOOD = ["radial-gradient(75% 55% at 32% 26%,rgba(255,238,205,.2),transparent 60%)", "radial-gradient(110% 85% at 50% 45%,transparent 35%,rgba(24,14,6,.42))", "repeating-linear-gradient(92deg,rgba(20,10,2,.05) 0 2px,transparent 4px 17px)", "linear-gradient(163deg,#96704a,#7d5a3a 45%,#5f422a)"].join(",");
const PAPER = ["radial-gradient(ellipse at 16% 10%,rgba(255,255,255,.68),transparent 56%)", "repeating-linear-gradient(0deg,rgba(82,64,42,.035) 0 1px,transparent 1px 5px)", "#eee3cc"].join(",");
const layouts = [
  { id:"photo-table", bg:WOOD, pos:[[.33,.25,.43],[.67,.25,.42],[.34,.51,.41],[.68,.51,.40],[.34,.77,.41],[.68,.77,.4]] },
  { id:"torn-paper", bg:PAPER, pos:[[.34,.28,.49],[.69,.43,.48],[.34,.68,.50],[.68,.79,.44],[.52,.51,.42]] },
  { id:"polaroid-garland", bg:`radial-gradient(ellipse at 50% 20%,#f4d7a6,transparent 65%),linear-gradient(145deg,#b7c7bf,#e7d5b8 55%,#d49c76)`, pos:[[.32,.28,.52],[.68,.35,.52],[.32,.64,.53],[.68,.69,.52],[.50,.51,.51]] },
  { id:"film-negative", bg:"linear-gradient(135deg,#16232c,#344653 50%,#18252d)", pos:[[.50,.17,.76],[.50,.35,.76],[.50,.53,.76],[.50,.71,.76],[.50,.85,.76]] },
  { id:"postcard-stack", bg:`radial-gradient(circle at 12% 8%,rgba(92,75,55,.09) 0 1px,transparent 2px),${PAPER}`, pos:[[.48,.20,.68],[.39,.40,.64],[.62,.51,.62],[.49,.67,.61],[.50,.57,.58]] },
  { id:"route-map", bg:`repeating-linear-gradient(28deg,transparent 0 52px,rgba(94,121,106,.12) 53px 55px),repeating-linear-gradient(112deg,transparent 0 78px,rgba(94,121,106,.10) 79px 81px),#e4e7d4`, pos:[[.28,.28,.47],[.72,.43,.47],[.33,.66,.46],[.72,.78,.42],[.52,.52,.41]] },
] as const;
type LayoutId = typeof layouts[number]["id"];
const getLayout = (id: LayoutId) => layouts.find((item) => item.id === id)!;
export function focusRelayInputRange(index: number, count: number): [number, number, number] {
  const start = Math.max(0, index / count - 0.16);
  const middle = Math.min(1, index / count + 0.2);
  return [start, middle >= 1 ? Math.max(start + 0.01, 0.88) : middle, 1];
}
const sourceFor = (slot: CollageSlot, sources?: Record<string,string>) => slot.src ?? (slot.shotId ? sources?.[slot.shotId] : undefined);
const placement = (id: LayoutId, index: number, count: number, seed: string, wide: boolean): React.CSSProperties => {
  const layout = getLayout(id); const raw = layout.pos[index % layout.pos.length];
  const jitter = id === "photo-table" || id === "postcard-stack" || id === "torn-paper" || id === "polaroid-garland";
  const x = (raw[0] + (jitter ? (random(`${seed}:${index}:x`)-.5)*.045 : 0)) * (wide ? 1.65 : 1);
  const y = raw[1] + (jitter ? (random(`${seed}:${index}:y`)-.5)*.035 : 0);
  const w = raw[2] * (wide ? .74 : 1);
  const h = w * (id === "film-negative" ? .42 : .77) * (wide ? .73 : .56);
  return { left:`${x*100}%`, top:`${y*100}%`, width:`${w*100}%`, height:`${h*100}%`, marginLeft:`-${w*50}%`, marginTop:`-${h*50}%` };
};
const Cell: React.FC<{spec:CollageSpec;slot:CollageSlot;index:number;sources?:Record<string,string>}> = ({spec,slot,index,sources}) => {
  const frame=useCurrentFrame(); const {fps,width,height}=useVideoConfig();
  const begin=Math.round(index*fps*(spec.motionId==="stack-deal"?.34:.13)); const span=Math.max(1,Math.round(spec.durationSec*fps)-begin);
  const progress=interpolate(frame-begin,[0,span],[0,1],{extrapolateLeft:"clamp",extrapolateRight:"clamp"});
  const eased=spring({frame:frame-begin,fps,config:{damping:15,mass:.75,stiffness:105},durationInFrames:30});
  const seed=spec.seed; const rotate=(random(`${seed}:${index}:r`)-.5)*(spec.layoutId==="film-negative"?1:15);
  let transform=`rotate(${rotate}deg) scale(1)`; let opacity=1;
  switch(spec.motionId){
    case "print-drop": case "stack-deal": case "tape-slap": transform=`translateY(${(1-eased)*-height*.18}px) rotate(${rotate+(1-eased)*-9}deg) scale(${.88+eased*.12})`; opacity=interpolate(eased,[0,.24],[0,1],{extrapolateRight:"clamp"});break;
    case "page-turn": transform=`perspective(1000px) rotateY(${(1-eased)*-78}deg) rotate(${rotate}deg)`;opacity=interpolate(eased,[0,.18],[0,1],{extrapolateRight:"clamp"});break;
    case "crash-zoom": {const hit=interpolate(progress,[0,.16,.23,1],[.55,1.10,.98,1]);transform=`scale(${hit}) rotate(${rotate*(1-progress)}deg)`;break;}
    case "focus-relay": {const focus=interpolate(progress,focusRelayInputRange(index,spec.slots.length),[.91,1.15,1]);transform=`scale(${focus})`;break;}
  }
  const src=sourceFor(slot,sources); const id=spec.layoutId as LayoutId;
  const print=id==="photo-table"||id==="postcard-stack"||id==="polaroid-garland"||id==="torn-paper";
  const frameColor=id==="film-negative"?"#10171a":"#fffdf7";
  const mask=id==="torn-paper"?"polygon(0 2%,5% 0,9% 2%,14% 0,19% 2%,23% 0,29% 2%,34% 0,40% 2%,46% 0,52% 2%,59% 0,65% 2%,72% 0,79% 2%,86% 0,93% 2%,100% 0,98% 100%,92% 98%,86% 100%,80% 98%,74% 100%,68% 98%,61% 100%,54% 98%,47% 100%,40% 98%,33% 100%,26% 98%,19% 100%,12% 98%,6% 100%,0 98%)":"none";
  const photoPad=print?"3.5% 3.5% 15%":id==="film-negative"?"8% 8%":"2.2%";
  return <div style={{position:"absolute",boxSizing:"border-box",...placement(id,index,spec.slots.length,seed,width>height),zIndex:10+Math.floor(random(`${seed}:${index}:z`)*30),transform,opacity,filter:"drop-shadow(3px 8px 8px rgba(20,22,24,.34))"}}>
    <div style={{position:"absolute",inset:0,background:frameColor,padding:photoPad,boxSizing:"border-box",overflow:"hidden",border:id==="film-negative"?"2px solid #d7ca9f":"1px solid rgba(65,54,40,.12)",boxShadow:print?"2px 4px 8px rgba(21,16,12,.26), 9px 18px 25px rgba(18,12,7,.2)":"0 5px 18px rgba(16,22,24,.2)",clipPath:mask}}>
      {src?(slot.kind==="video"?<OffthreadVideo src={src} muted style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:slot.crop?`${slot.crop.x*100}% ${slot.crop.y*100}%`:"center",display:"block"}}/>:<Img src={src} style={{width:"100%",height:"100%",objectFit:"cover",objectPosition:slot.crop?`${slot.crop.x*100}% ${slot.crop.y*100}%`:"center",display:"block"}}/>):<div style={{height:"100%",background:"linear-gradient(145deg,#a5b8b1,#c97756 52%,#304858)"}} />}
      {id==="film-negative"&&<div style={{position:"absolute",inset:"0 0 auto",height:"6%",background:"repeating-linear-gradient(90deg,#e9debd 0 8px,transparent 8px 16px)"}}/>}
    </div>
    {spec.motionId==="tape-slap"&&(index===0||index%2===0)&&<div style={{position:"absolute",zIndex:2,width:"36%",height:"11%",top:"-4%",left:"32%",transform:`rotate(${rotate*.45}deg)`,background:"linear-gradient(100deg,rgba(214,191,143,.84),rgba(246,230,188,.88),rgba(205,180,131,.86))",boxShadow:"0 2px 4px rgba(30,20,10,.16)"}}/>}
  </div>;
};
const Caption: React.FC<{spec:CollageSpec}> = ({spec}) => {
  const id=spec.layoutId;
  const place=spec.caption?.place??"KYOTO · JAPAN";
  const date=spec.caption?.date??"AUTUMN 2026";
  const footerColor=id==="film-negative"?"#f5e8c9":"#203b48";
  const footerSurface=id==="film-negative"?"rgba(20,40,58,.92)":"rgba(250,250,247,.94)";
  return <div style={{position:"absolute",zIndex:80,bottom:"2.5%",left:"11%",width:"78%",boxSizing:"border-box",padding:"1.4% 3% 1.1%",borderRadius:3,background:footerSurface,color:footerColor,textAlign:"center",boxShadow:"0 2px 9px rgba(18,26,30,.18)",fontFamily:"Figtree,sans-serif",fontSize:12,fontWeight:600,lineHeight:1.25,letterSpacing:".13em",textTransform:"uppercase"}}>
    <div>{place}</div><div style={{marginTop:2,fontSize:10,fontWeight:400,letterSpacing:".17em",opacity:.84}}>{date}</div>
  </div>;
};
const Decoration: React.FC<{id:LayoutId}> = ({id}) => {
  if(id==="route-map") return <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",opacity:.46}} viewBox="0 0 100 180" preserveAspectRatio="none"><path d="M15 14 C75 26 22 54 75 67 S23 99 66 122 S28 149 81 166" fill="none" stroke="#c15d42" strokeWidth=".8" strokeDasharray="2 1.5"/><circle cx="15" cy="14" r="2" fill="#c15d42"/><circle cx="81" cy="166" r="2.5" fill="#c15d42"/></svg>;
  if(id==="polaroid-garland") return <svg style={{position:"absolute",inset:"12% 0 auto",width:"100%",height:"30%"}} viewBox="0 0 100 30" preserveAspectRatio="none"><path d="M0 7 Q50 26 100 6" fill="none" stroke="#f3e7cf" strokeWidth=".8"/><path d="M0 8 Q50 27 100 7" fill="none" stroke="rgba(30,35,30,.25)" strokeWidth=".3"/></svg>;
  if(id==="film-negative") return <div style={{position:"absolute",zIndex:50,inset:"0 0 auto",height:"3.6%",background:"repeating-linear-gradient(90deg,#ede1c5 0 10px,transparent 10px 20px)"}}/>;
  if(id==="postcard-stack") return <div style={{position:"absolute",zIndex:0,right:"8%",top:"7%",width:"18%",height:"10%",border:"1px solid rgba(174,82,60,.55)",color:"#a74e3d",font:"600 8px Figtree,sans-serif",display:"grid",placeItems:"center",transform:"rotate(9deg)"}}>MOSAE · POST</div>;
  return null;
};
const Effect: React.FC<{id:NonNullable<CollageSpec["effectId"]>;seed:string}> = ({id,seed}) => {
  if(id==="vignette")return <AbsoluteFill style={{pointerEvents:"none",background:"radial-gradient(ellipse,transparent 42%,rgba(7,17,24,.48) 100%)"}}/>;
  if(id==="warm-grade")return <AbsoluteFill style={{pointerEvents:"none",background:"rgba(222,143,83,.17)",mixBlendMode:"soft-light"}}/>;
  if(id==="film-grain")return <AbsoluteFill style={{pointerEvents:"none",opacity:.11,backgroundImage:`repeating-radial-gradient(circle at ${random(`${seed}:gx`)*100}% ${random(`${seed}:gy`)*100}%,rgba(255,255,255,.4) 0 1px,transparent 1px 3px)`,backgroundSize:"5px 5px",mixBlendMode:"overlay"}}/>;
  return <AbsoluteFill style={{pointerEvents:"none",background:`linear-gradient(${110+random(`${seed}:leak`)*35}deg,transparent 18%,rgba(255,174,96,.26) 47%,transparent 72%)`,mixBlendMode:"screen"}}/>;
};
export const Collage: React.FC<CollageProps> = ({spec,sources}) => {
  const {width,height}=useVideoConfig(); const id=spec.layoutId as LayoutId;
  return <AbsoluteFill style={{background:getLayout(id).bg,overflow:"hidden",fontFamily:"Figtree,sans-serif"}}>
    <Decoration id={id}/>
    {spec.slots.map((slot,index)=><Cell key={slot.slotId} spec={spec} slot={slot} index={index} sources={sources}/>)}
    <Caption spec={spec}/>
    {spec.effectId&&<Effect id={spec.effectId} seed={spec.seed}/>}
  </AbsoluteFill>;
};
