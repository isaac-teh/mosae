import React from "react";
import { AbsoluteFill, Composition, registerRoot, staticFile } from "remotion";
import { Collage } from "./Collage";
import { COLLAGE_LAYOUTS, type CollageSpec } from "./schema";
import { TRIP_PHOTO_FILES } from "../../gallery/src/tripPhotos";
import { createCollageSpec, PLACEHOLDER_PHOTOS } from "./fixtures";
const WIDTH=720, HEIGHT=1280, FPS=30, FRAMES=150;
const sampleSources=process.env.MOSAE_COLLAGE_STILL_PLACEHOLDERS==="1"?PLACEHOLDER_PHOTOS.map((file)=>staticFile(file.replace(/^\//,""))):TRIP_PHOTO_FILES.map((file)=>staticFile(file));
export function specForLayout(layoutId:CollageSpec["layoutId"], motionId:CollageSpec["motionId"]="print-drop", effectId:CollageSpec["effectId"]=null):CollageSpec {
  const base=createCollageSpec(layoutId);
  return createCollageSpec(layoutId,{motionId,effectId,seed:`library-${layoutId}`,durationSec:5,caption:{place:"Kyoto · Japan",date:"AUTUMN 2026",headline:"Postcards from Kyoto",subline:"A small collection of places"},slots:base.slots.map((slot,index)=>({slotId:slot.slotId,src:sampleSources[index%sampleSources.length]}))});
}
const StillCard:React.FC<{layoutId:CollageSpec["layoutId"];index:number}>=({layoutId,index})=>{
  const left=30+(index%4)*285, top=68+Math.floor(index/4)*494;
  return <><div style={{position:"absolute",left,top:top-23,width:260,height:18,color:"#14283a",font:"600 14px Figtree,sans-serif",letterSpacing:".08em"}}>{COLLAGE_LAYOUTS.find((x)=>x.id===layoutId)?.label.toUpperCase()}</div><div style={{position:"absolute",left,top,width:260,height:462,overflow:"hidden",backgroundColor:"#14283a"}}><Collage spec={specForLayout(layoutId,"print-drop",null)}/></div></>;
};
const ContactSheet:React.FC=()=> <AbsoluteFill style={{background:"#eee9df"}}><div style={{position:"absolute",left:30,top:15,color:"#14283a",font:"600 21px Literata,serif"}}>Mosaé · Collage forms / 9:16</div>{COLLAGE_LAYOUTS.map((layout,index)=><StillCard key={layout.id} layoutId={layout.id} index={index}/>)}</AbsoluteFill>;
const Sample:React.FC<{layoutId:CollageSpec["layoutId"];motionId:CollageSpec["motionId"];effectId:CollageSpec["effectId"]}>=({layoutId,motionId,effectId})=><Collage spec={specForLayout(layoutId,motionId,effectId)}/>;
const Root:React.FC=()=> <>
  {COLLAGE_LAYOUTS.map((layout)=><Composition key={layout.id} id={`Collage-${layout.id}`} component={Collage} defaultProps={{spec:specForLayout(layout.id,"overhead-settle")}} durationInFrames={FRAMES} fps={FPS} width={WIDTH} height={HEIGHT}/>)}
  <Composition id="CollageContactSheet" component={ContactSheet} defaultProps={{}} durationInFrames={FRAMES} fps={FPS} width={1180} height={1580}/>
  <Composition id="SamplePhotoTable" component={Sample} defaultProps={{layoutId:"photo-table",motionId:"print-drop",effectId:"warm-grade"}} durationInFrames={FRAMES} fps={FPS} width={WIDTH} height={HEIGHT}/>
  <Composition id="SampleJournal" component={Sample} defaultProps={{layoutId:"travel-journal",motionId:"page-turn",effectId:"light-leak"}} durationInFrames={FRAMES} fps={FPS} width={WIDTH} height={HEIGHT}/>
  <Composition id="SampleFilm" component={Sample} defaultProps={{layoutId:"film-negative",motionId:"parallax-glide",effectId:"film-grain"}} durationInFrames={FRAMES} fps={FPS} width={WIDTH} height={HEIGHT}/>
</>;
registerRoot(Root);
