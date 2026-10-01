import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { CollageSpec } from "./schema";
import { SampleMedia } from "./SampleMedia";
import { referenceTime, revealAt, scrapbookPhotoAt } from "./referenceMotion";

type Print = { x: number; y: number; w: number; h: number; rotation: number };
const REFERENCE_PRINTS: Print[] = [
  { x: 10, y: 10, w: 39, h: 43, rotation: -4.5 },
  { x: 47, y: 10, w: 41, h: 39, rotation: 4.5 },
  { x: 10, y: 55, w: 38.5, h: 34, rotation: 0 },
  { x: 50, y: 47.5, w: 38, h: 40, rotation: 2 },
];
const position = (print: Print): React.CSSProperties => ({ position: "absolute", left: `${print.x}%`, top: `${print.y}%`, width: `${print.w}%`, height: `${print.h}%`, boxSizing: "border-box" });

const LeafSprig: React.FC<{ style: React.CSSProperties }> = ({ style }) => <svg aria-hidden="true" viewBox="0 0 100 200" style={{ position: "absolute", ...style }}>
  <path d="M55 195 Q41 125 54 5" fill="none" stroke="#dae3b8" strokeWidth="2.2" />
  {[25,67,107,143].map((y,index) => <g key={y}>
    <path d={`M50 ${y+33} C18 ${y+20} 11 ${y-8} 6 ${y-16} C36 ${y-9} 47 ${y+5} 50 ${y+33}Z`} fill={index % 2 ? "#93a16b" : "#84935f"} stroke="#dce5bc" strokeWidth="1.8" />
    <path d={`M50 ${y+46} C71 ${y+38} 85 ${y+16} 95 ${y+1} C68 ${y+5} 55 ${y+22} 50 ${y+46}Z`} fill="#93a16b" stroke="#dce5bc" strokeWidth="1.8" />
    <path d={`M50 ${y+33} L20 ${y-2} M50 ${y+46} L84 ${y+12}`} fill="none" stroke="#dce5bc" strokeWidth="1.1" />
  </g>)}
</svg>;

const FlowerSprig: React.FC<{ style: React.CSSProperties }> = ({ style }) => <svg aria-hidden="true" viewBox="0 0 110 220" style={{ position: "absolute", ...style }}>
  <path d="M42 216 C69 170 38 115 63 48" fill="none" stroke="#dce5bc" strokeWidth="2.5" />
  <path d="M49 157 C14 139 6 110 8 89 C40 103 52 123 49 157Z M47 176 C79 161 94 132 96 108 C62 125 46 145 47 176Z M51 126 C71 103 93 90 96 65 C66 82 51 101 51 126Z" fill="#8f9d6b" stroke="#dce5bc" strokeWidth="2" />
  <path d="M49 157 L17 108 M47 176 L85 128 M51 126 L85 86" fill="none" stroke="#dce5bc" strokeWidth="1.3" />
  <path d="M34 58 C18 53 17 36 29 31 C23 15 40 7 50 16 C59 0 78 6 80 19 C99 13 109 29 99 42 C113 55 96 74 81 67 C64 79 46 69 34 58Z" fill="#99a677" stroke="#dce5bc" strokeWidth="2" />
  <path d="M52 22 Q64 43 73 60 M32 31 Q48 43 53 56 M83 22 Q74 37 81 52 M38 52 Q58 47 67 65" fill="none" stroke="#dce5bc" strokeWidth="1.5" />
</svg>;

const DriedFlower: React.FC<{ style: React.CSSProperties }> = ({ style }) => <svg aria-hidden="true" viewBox="0 0 100 160" style={{ position: "absolute", ...style }}>
  <path d="M65 154 L43 55" stroke="#a18650" strokeWidth="3" />
  <path d="M53 112 Q23 106 15 80 Q46 84 53 112 M57 129 Q76 104 91 101 Q90 124 57 129" fill="#bda269" stroke="#e5ce99" strokeWidth="1.5" />
  {[[31,28],[45,23],[56,30],[22,40],[36,40],[51,40],[65,41],[31,53],[46,55],[57,52]].map(([x,y],i) => <g key={i}><ellipse cx={x} cy={y} rx="11" ry="8" transform={`rotate(${i*27} ${x} ${y})`} fill={i%2 ? "#cbb16f" : "#d6c186"} stroke="#e9d8aa" strokeWidth="1" /><circle cx={x} cy={y} r="2" fill="#a58d58" /></g>)}
</svg>;

const Tape: React.FC<{ style: React.CSSProperties; orange?: boolean }> = ({ style, orange }) => <div style={{ position: "absolute", background: orange ? "repeating-linear-gradient(80deg,#c7946088 0 1px,transparent 1px 3px),#dca26fdd" : "repeating-linear-gradient(85deg,#9b7c4733 0 1px,transparent 1px 3px),#c8ab74dd", clipPath: "polygon(0 8%,4% 0,10% 6%,17% 0,25% 5%,36% 0,45% 5%,57% 0,68% 4%,80% 0,94% 5%,100% 0,100% 95%,92% 100%,79% 94%,68% 100%,55% 95%,40% 100%,27% 94%,12% 100%,0 93%)", ...style }} />;

export const BotanicalScrapbook: React.FC<{ spec: CollageSpec; sources?: Record<string, string> }> = ({ spec, sources }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const seconds = frame / fps;
  const time = referenceTime(seconds, spec.durationSec);
  const filterId = `scrapbook-paper-${spec.seed.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const count = spec.slots.length;
  const prints = count <= 4 ? REFERENCE_PRINTS.slice(0,count) : Array.from({ length: count }, (_,i): Print => ({ x: 10 + i%2*40, y: 9 + Math.floor(i/2)*25, w: 39, h: 25, rotation: i%2 ? 3 : -3 }));
  const show = (start: number, span = .45) => revealAt(time, start, span);
  const text = spec.caption?.headline ?? spec.caption?.place ?? "";
  const headline = text.slice(0,Math.floor(text.length*Math.max(0,Math.min(1,(time-1.1)/1.5))));
  const sparkle = (start: number, phase: number): React.CSSProperties => {
    const pulse = Math.sin(time * Math.PI * 1.3 + phase) ** 2;
    return { opacity: show(start,.25) * (.4 + .6*pulse), transform: `scale(${.55+.45*pulse})` };
  };
  return <AbsoluteFill style={{ containerType: "inline-size", overflow: "hidden", background: "#e7c9a8" }}>
    <svg aria-hidden="true" width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
      <defs><filter id={filterId}><feTurbulence type="fractalNoise" baseFrequency=".07 .7" numOctaves="3" seed="7" /><feColorMatrix type="saturate" values="0" /></filter><radialGradient id={`${filterId}-light`}><stop stopColor="#f5e1c9" /><stop offset="1" stopColor="#e3be97" /></radialGradient></defs>
      <rect width="100%" height="100%" fill={`url(#${filterId}-light)`} /><rect width="100%" height="100%" filter={`url(#${filterId})`} opacity=".11" style={{ mixBlendMode: "multiply" }} />
    </svg>
    <div style={{ position: "absolute", left: "84%", top: "39%", width: "22%", height: "28%", zIndex: 1, background: "#f5eee0", clipPath: "polygon(0 5%,12% 3%,24% 5%,35% 2%,46% 4%,60% 1%,72% 4%,86% 2%,100% 5%,100% 96%,85% 99%,70% 97%,56% 100%,40% 97%,27% 99%,10% 96%,0 98%)", opacity: show(1.75), transform: `translateX(${(1-show(1.75))*75}%) rotate(2deg)` }} />
    {spec.slots.map((slot,index) => {
      const print = prints[index];
      const motion = scrapbookPhotoAt(seconds,index,spec.durationSec);
      const paperDelay = [0,.08,.28,.45][index] ?? .45;
      const paper = show(paperDelay,.55);
      const exit = seconds > spec.durationSec-.4 ? Math.max(0,(spec.durationSec-seconds)/.4) : 1;
      const translate = motion.translateY / print.h * 100;
      return <React.Fragment key={slot.slotId}>
        <div style={{ ...position(print), zIndex: 3+index*2, background: "#fffdf7", boxShadow: "0 2px 4px #88654218", opacity: paper*exit, transform: `translateY(${(1-paper)*-18}%) rotate(${print.rotation}deg)` }} />
        <div style={{ ...position(print), zIndex: 4+index*2, opacity: motion.opacity, transform: `translateY(${translate}%) rotate(${print.rotation}deg)`, padding: "1.2cqw" }}><div style={{ width: "100%", height: "100%", overflow: "hidden" }}><SampleMedia slot={slot} sources={sources} /></div></div>
      </React.Fragment>;
    })}
    <div style={{ position: "absolute", inset: 0, zIndex: 30, pointerEvents: "none" }}>
      <DriedFlower style={{ left: "5%", top: "36%", width: "13%", height: "18%", opacity: show(.35), transform: `rotate(-16deg) scale(${.7+.3*show(.35)})` }} />
      <Tape orange style={{ left: "7%", top: "47%", width: "12%", height: "3%", opacity: show(.45), transform: "rotate(18deg)" }} />
      <LeafSprig style={{ left: "37%", top: "25%", width: "14%", height: "29%", opacity: show(.9), transform: `rotate(-11deg) scale(${.65+.35*show(.9)})` }} />
      <LeafSprig style={{ left: "2%", top: "70%", width: "12%", height: "17%", opacity: show(.7), transform: `rotate(-24deg) scale(${.65+.35*show(.7)})` }} />
      <FlowerSprig style={{ left: "80%", top: "53%", width: "15%", height: "28%", opacity: show(.55), transform: `rotate(8deg) scale(${.65+.35*show(.55)})` }} />
      <Tape style={{ left: "41%", top: "9%", width: "14%", height: "4%", opacity: show(1.6,.3), transform: `rotate(-8deg) scaleX(${show(1.6,.3)})` }} />
      <Tape style={{ left: "38%", top: "46%", width: "14%", height: "4%", opacity: show(1.8,.3), transform: `rotate(-7deg) scaleX(${show(1.8,.3)})` }} />
      <Tape style={{ left: "8%", top: "86%", width: "14%", height: "3.2%", opacity: show(1.5,.3), transform: `rotate(15deg) scaleX(${show(1.5,.3)})` }} />
      <Tape style={{ left: "86%", top: "41%", width: "4%", height: "9%", opacity: show(1.8,.3), transform: "rotate(-9deg)" }} />
      {[{ left:"10%",top:"9%",start:0,phase:0 },{ left:"78%",top:"72%",start:.75,phase:1.2 }].map((star,i) => <svg key={i} aria-hidden="true" viewBox="0 0 100 100" style={{ position: "absolute", left: star.left, top: star.top, width: "9%", height: "9%", ...sparkle(star.start,star.phase) }}><path d="M50 0 Q55 44 100 50 Q55 56 50 100 Q45 56 0 50 Q45 44 50 0" fill="#fffdf7" /></svg>)}
      <div style={{ position: "absolute", left: "49%", top: "81%", width: "43%", minHeight: "9%", padding: "1.5% 3%", boxSizing: "border-box", background: "#b18a61", color: "#f6e9d3", clipPath: "polygon(0 4%,7% 0,15% 5%,23% 1%,34% 4%,45% 0,57% 4%,70% 1%,82% 5%,94% 1%,100% 5%,98% 97%,91% 100%,80% 96%,70% 100%,57% 96%,45% 100%,32% 96%,20% 99%,10% 95%,0 99%)", opacity: show(.7), transform: "rotate(2deg)", display: "flex", alignItems: "center", fontFamily: '"Pinyon Script", cursive', fontSize: width > height ? "2.3cqw" : "3.9cqw", fontWeight: 400, lineHeight: 1.2, overflowWrap: "anywhere" }}>{headline || "\u00a0"}</div>
    </div>
  </AbsoluteFill>;
};
