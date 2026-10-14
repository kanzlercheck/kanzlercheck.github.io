(async function(){
"use strict";
const $=s=>document.querySelector(s),NS="http://www.w3.org/2000/svg",DAY=864e5;
const fmt=(n,d=1)=>(Math.round(n*10**d)/10**d).toFixed(d);
// text measuring so labels can size their box to the text (no squeezed/stretched glyphs): shrink the font a little, then truncate with an ellipsis as a last resort
const _mc=document.createElement("canvas").getContext("2d");
const tw=(t,fs,w=700)=>{_mc.font=`${w} ${fs}px "IBM Plex Sans",-apple-system,"Segoe UI",Arial,sans-serif`;return _mc.measureText(t).width;};
function fitLabel(t,fs,max,min=8.5){let f=fs;while(f>min&&tw(t,f)>max)f-=.5;let x=t;if(tw(x,f)>max){while(x.length>1&&tw(x+"\u2026",f)>max)x=x.slice(0,-1);x=x.trimEnd()+"\u2026";}return{t:x,fs:f};}
const sgn=n=>(n>0?"+":n<0?"\u2212":"")+fmt(Math.abs(n));
const fmtDate=t=>new Date(t).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"});
const isOther=p=>/sonstige|others?|andere/i.test(p);
const META=/^(datum|date|institut|institute|pollster|befragungsmethode|method|befragungsstart|fieldwork ?start|befragungsende|fieldwork ?end|befragtenanzahl|sample ?size|n|quelle|source|befragte)$/i;


// ---------- theme ----------
const redraw=[];
const CW=()=>matchMedia("(max-width:600px)").matches?500:1200; // chart canvas width: narrower on phones so text and lines render larger
// zoom steps tried by fitOv (same sequence as before: 1.30, 1.28, ... down to ~0.45)
const ZS=[];let ZEND=1.3;for(;ZEND>.45;ZEND-=.02)ZS.push(ZEND);
function setDark(d){document.body.classList.toggle("dark",d);$("#dark-toggle").checked=d;const lg=$("#logo");if(lg)lg.src=d?"img/logo-dark.png":"img/logo.png";redraw.forEach(f=>f());}
// default = dark; the switch overrides it and the choice is remembered
const schemeMQ=matchMedia("(prefers-color-scheme: dark)");
let saved=null;try{saved=localStorage.getItem("theme");}catch(e){}
setDark(saved?saved==="dark":true);
$("#dark-toggle").onchange=e=>{setDark(e.target.checked);try{localStorage.setItem("theme",e.target.checked?"dark":"light");}catch(_){}};

// ---------- CSV ----------
function parseCSV(text){
  text=text.replace(/^\uFEFF/,"").trim();
  const first=text.split(/\r?\n/)[0];
  const delim=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?";":",";
  let rows=[];
  if(text.indexOf('"')<0)rows=text.replace(/\r/g,"").split("\n").map(l=>l.split(delim));
  else{
  let row=[],cur="",q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(q){if(c=='"'){if(text[i+1]=='"'){cur+='"';i++;}else q=false;}else cur+=c;}
    else if(c=='"')q=true;
    else if(c==delim){row.push(cur);cur="";}
    else if(c=="\n"){row.push(cur);rows.push(row);row=[];cur="";}
    else if(c!="\r")cur+=c;
  }
  row.push(cur);rows.push(row);
  }
  const head=rows.shift().map(h=>h.trim());
  return rows.filter(r=>r.some(x=>x.trim())).map(r=>Object.fromEntries(head.map((h,i)=>[h,(r[i]||"").trim()])));
}
const num=v=>{if(v==null||v==="")return null;const n=parseFloat(String(v).replace("%","").replace(",","."));return isNaN(n)?null:n;};
function parseDate(v){
  let m=v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);if(m)return new Date(Date.UTC(+m[3],+m[2]-1,+m[1]));
  m=v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(m)return new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));
  const d=new Date(v);return isNaN(d)?null:d;
}
const findKey=(o,names)=>Object.keys(o).find(k=>names.includes(k.toLowerCase()));
// one shared request per URL; "no-cache" = always revalidate (fresh data, but a 304 when nothing changed)
const rawCache=new Map();
function fetchRaw(url){let p=rawCache.get(url);if(!p){p=fetch(url,{cache:"no-cache"}).then(async r=>({ok:r.ok,status:r.status,text:r.ok?await r.text():""}));rawCache.set(url,p);}return p;}
async function load(path){const r=await fetchRaw(path);if(!r.ok)throw new Error("Could not load "+path+" ("+r.status+")");return parseCSV(r.text);}
function showErr(m){const e=$("#error");e.hidden=false;e.textContent=m;}


let cfg;
try{
  const r=await fetch("config.json");
  if(!r.ok)throw new Error("HTTP "+r.status);
  cfg=await r.json();
}catch(e){showErr("config.json could not be loaded ("+e.message+"). Serve the site over http(s) \u2014 opening index.html as a local file will not work \u2014 and make sure config.json sits next to index.html.");return;}
[cfg.pollsCsv,cfg.approvalCsv,"data/chancellor_approval.csv",cfg.negativeCsv,...(cfg.pollTabs||[]).map(t=>t.csv),cfg.statesMap,"data/election2025.json",
  ...Object.values(cfg.stateFiles||{}).map(slug=>`${cfg.stateFolder}/${slug}.csv`)].forEach(u=>{if(u)fetchRaw(u).catch(()=>{});});
document.title=cfg.siteTitle;$("#site-title").textContent=cfg.siteTitle;
// faction keys look like "F:<id>" so they can stand in for a party key anywhere a party key is used
let FAC=[];
const isFac=p=>typeof p==="string"&&p.startsWith("F:");
const facById=id=>FAC.find(f=>f.id===id);
const lab=p=>{if(isFac(p)){const f=facById(p.slice(2));return f?f.name:p;}return (cfg.labels||{})[p]||p;};
const FALLBACK=["#1C4E9C","#C62828","#2E7D32","#F9A825","#6A1B9A","#00838F","#8D6E63","#546E7A"];
const colorOf=(p,i=0)=>isFac(p)?((facById(p.slice(2))||{}).color||"#888888"):cfg.colors[p]||cfg.colors[p==="Union"?"CDU/CSU":p]||FALLBACK[i%FALLBACK.length];
const lum=c=>{const n=parseInt(c.slice(1),16);return((n>>16)&255)*.299+((n>>8)&255)*.587+(n&255)*.114;};
const dark=c=>/^#[0-9a-f]{6}$/i.test(c)&&lum(c)<60;
const contrast=c=>/^#[0-9a-f]{6}$/i.test(c)&&lum(c)>=140?"#15181C":"#ffffff";
const lighten=(hex,a)=>{const c=hex.replace("#","");if(c.length!==6)return hex;const ch=i=>{const v=parseInt(c.substr(i,2),16);return Math.round(v+(255-v)*a).toString(16).padStart(2,"0");};return"#"+ch(0)+ch(2)+ch(4);};
const monthAgo=t=>{const d=new Date(t);d.setUTCMonth(d.getUTCMonth()-1);return +d;};
const isDarkMode=()=>document.body.classList.contains("dark");

// ---------- analytics (GoatCounter): count each tab / state view as its own page view ----------
let lastTrack="";
function track(path,title){
  if(path===lastTrack)return;
  const ref=lastTrack?location.origin+lastTrack:undefined;lastTrack=path;
  let tries=0;
  const send=()=>{
    if(window.goatcounter&&typeof window.goatcounter.count==="function"){
      const d={path,title};if(ref)d.referrer=ref;
      try{window.goatcounter.count(d);}catch(e){}
    }else if(tries++<20)setTimeout(send,300);
  };
  send();
}

// ---------- tabs ----------
function goTab(t,target){
  const b=document.querySelector(`.tab-btn[data-tab="${t}"]`);if(!b)return;
  track("/"+t,b.textContent.trim());
  document.querySelectorAll(".tab-btn").forEach(x=>x.classList.toggle("active",x===b));
  document.querySelectorAll(".pane").forEach(p=>p.classList.toggle("active",p.id==="tab-"+t));
  history.replaceState(null,"","#"+t);scrollTo(0,0);
  if(typeof fitOv==="function")fitOv();
  if(target)requestAnimationFrame(()=>{const e=document.getElementById(target);if(e)e.scrollIntoView();});
}
document.querySelectorAll(".tab-btn").forEach(b=>b.onclick=()=>goTab(b.dataset.tab));
document.querySelectorAll("[data-go]").forEach(b=>{b.onclick=()=>goTab(b.dataset.go,b.dataset.scroll);if(b.classList.contains("clickable"))b.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();goTab(b.dataset.go,b.dataset.scroll);}};});
if(location.hash)goTab(location.hash.slice(1));
try{if(!document.querySelector(`.tab-btn[data-tab="${location.hash.slice(1)}"]`)&&!/^#state-/.test(location.hash))track("/overview","Overview");}catch(e){track("/overview","Overview");}

// ---------- SVG helpers ----------
const LP={"BW":[188.4,642.9],"BY":[364.7,614.4],"BE":[457.6,248.3],"BB":[488.0,304.8],"HB":[176.9,189.3],"HH":[251.8,144.9],"HE":[196.3,430.7],"MV":[422.0,125.9],"NI":[242.7,215.8],"NW":[98.0,345.8],"RP":[78.9,490.2],"SL":[65.8,549.6],"ST":[352.8,312.9],"SN":[449.7,393.5],"SH":[239.9,100.1],"TH":[306.1,408.7]};
function el(tag,attrs,parent,text){const e=document.createElementNS(NS,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);if(text!=null)e.textContent=text;if(parent)parent.appendChild(e);return e;}
const tip=$("#tip");
const TIPC={};
function tipColor(n){
  if(!Object.keys(TIPC).length){[...Object.keys(cfg.colors),"Freie Wähler","Sonstige"].forEach(k=>{TIPC[k]=TIPC[lab(k)]=colorOf(k);});TIPC["Free Voters"]=colorOf("Freie Wähler");TIPC["Others"]=colorOf("Sonstige");TIPC.SSW="#003C8F";}
  return TIPC[n]||null;
}
const tipCol=c=>c?(isDarkMode()&&dark(c)?"#7A808A":c):null;
function showTip(ev,html){
  const strip=x=>x.replace(/<[^>]*>/g,"").trim(),parts=html.split("<br>");
  let head=parts.shift()||"",hv="";
  const hm=head.match(/^<b>(.*?)<\/b>:\s*(.*)$/);
  if(hm){head="<b>"+hm[1]+"</b>";hv=hm[2];}
  let hc=null;strip(head).split(" \u00B7 ").some(n=>(hc=tipColor(n)));
  const rows=parts.map(r=>{
    let c=null;const m=r.match(/^<span style="color:([^"]+)">.*?<\/span>\s*/);
    if(m){c=m[1];r=r.slice(m[0].length);}
    const i=r.indexOf(": ");if(i<0)return{note:r};
    const k=r.slice(0,i),v=r.slice(i+2);return{k,v,c:c||tipColor(strip(k)),pct:/^[\d.]+%$/.test(strip(v))?parseFloat(strip(v)):null};
  });
  const bars=rows.filter(r=>r.c&&r.pct!=null),mx=Math.max(0,...bars.map(r=>r.pct));
  if(!hc){const f=rows.find(r=>r.c);hc=f?f.c:null;}
  hc=tipCol(hc)||"var(--accent)";
  let body=rows.map(r=>{
    if(r.note!=null)return`<div class="tn">${r.note}</div>`;
    const c=tipCol(r.c),bar=c&&r.pct!=null&&mx>0?`<div class="tb"><u style="width:${(r.pct/mx*100).toFixed(1)}%;background:${c}"></u></div>`:"";
    return`<div class="tr"><span class="tk">${c?`<i style="background:${c}"></i>`:""}${r.k}</span><b class="tv">${r.v}</b>${bar}</div>`;
  }).join("");
  const lead=bars.filter(r=>!isOther(strip(r.k))&&strip(r.k)!=="Others").sort((a,b)=>b.pct-a.pct);
  if(lead.length>1&&bars.length===rows.filter(r=>r.k!=null).length){
    const d=lead[0].pct-lead[1].pct;
    body+=`<div class="tf"><b style="color:${tipCol(lead[0].c)}">${strip(lead[0].k)}</b> ${d<.05?"is level with":"leads"} ${strip(lead[1].k)}${d<.05?"":` by <b>${fmt(d)}</b> pts`}</div>`;
  }
  tip.hidden=false;
  tip.style.setProperty("--tc",hc);
  tip.innerHTML=`<div class="th"><span>${head}</span>${hv?`<b class="thv">${hv}</b>`:""}</div>${body?`<div class="tbody">${body}</div>`:""}`;
  const w=tip.offsetWidth,h=tip.offsetHeight;
  let x=ev.clientX+16,y=ev.clientY+16;
  if(x+w>innerWidth-8)x=ev.clientX-w-16;if(x<8)x=8;
  if(y+h>innerHeight-8)y=Math.max(8,ev.clientY-h-16);
  tip.style.left=x+"px";tip.style.top=y+"px";
}
const hideTip=()=>{tip.hidden=true;};
const dlt=n=>Math.abs(n)<.05?"0.0":sgn(n);
// federal events plus the events of one state (config.json stateEvents), as fresh objects each call
const EVENTS_FOR=id=>[...(cfg.events||[]).filter(e=>!e.federalOnly),...(((cfg.stateEvents||{})[id])||[])].map(e=>({label:e.label||"",desc:e.desc||"",date:e.date,t:Date.parse(e.date+"T00:00:00Z")})).filter(e=>!isNaN(e.t)).sort((a,b)=>a.t-b.t);
const EVENTS=()=>(cfg.events||[]).map(e=>({label:e.label||"",desc:e.desc||"",date:e.date,t:Date.parse(e.date+"T00:00:00Z")})).filter(e=>!isNaN(e.t)).sort((a,b)=>a.t-b.t);
const evDate=t=>new Date(t).toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit",year:"2-digit",timeZone:"UTC"});
let selGid=0;
function selFill(svg){ // soft neutral tint that fades toward the top
  const id="selg"+(++selGid),g=el("linearGradient",{id,x1:0,y1:0,x2:0,y2:1},el("defs",{},svg));
  el("stop",{offset:"0%",style:"stop-color:var(--cink);stop-opacity:.02"},g);el("stop",{offset:"100%",style:"stop-color:var(--cink);stop-opacity:.11"},g);
  return `url(#${id})`;
}

function frame(host,o){
  host.innerHTML="";
  const W=o.W||1200,H=o.H,svg=el("svg",{viewBox:`0 0 ${W} ${H}`,role:"img"},host);
  el("rect",{class:"bg",x:0,y:0,width:W,height:H},svg);
  el("text",{class:"ink serif",x:26,y:52,"font-size":W<1000?24:28,"font-weight":700},svg,o.title);
  if(o.sub)el("text",{class:"mut",x:26,y:84,"font-size":W<1000?12.5:15},svg,o.sub);
  el("line",{class:"fl",x1:0,y1:H-56,x2:W,y2:H-56,"stroke-width":1},svg);
  if(o.source){const t=el("text",{class:"mut",x:26,y:H-26,"font-size":12.5},svg);
    if(o.boldSource){el("tspan",{class:"ink","font-weight":700},t,"Source: ");t.appendChild(document.createTextNode(o.source));}else t.textContent=o.source;}
  return svg;
}

function lineChart(host,o){
  const W=CW(),H=o.H||720,X0=46,X1=W-(W<1000?152:120),Y0=186,Y1=H-100;
  const svg=frame(host,{...o,W}),F=n=>W<1000?Math.round(n*1.25*10)/10:n;
  const selBg=el("rect",{y:Y0,height:Y1-Y0,fill:selFill(svg),visibility:"hidden"},svg);
  const all=o.series.flatMap(s=>s.points.map(p=>p.t));
  const t0=Math.min(...all),t1=Math.max(...all),span=Math.max(1,t1-t0);
  const x=t=>X0+(t-t0)/span*(X1-X0),y=v=>Y1-(v-o.yMin)/(o.yMax-o.yMin)*(Y1-Y0);
  if(o.threshold){const yt=y(o.threshold);
    el("rect",{class:"band",x:X0,y:yt,width:X1-X0,height:Y1-yt},svg);
    el("line",{class:"gl",x1:X0,y1:yt,x2:X1,y2:yt,"stroke-width":1},svg);}
  for(let v=o.yMin;v<=o.yMax+.001;v+=o.step){
    el("line",{class:"gl",x1:X0,y1:y(v),x2:X1,y2:y(v),"stroke-width":1},svg);
    if(v>0)el("text",{class:"mut",x:X0-10,y:y(v)+4,"text-anchor":"end","font-size":F(12)},svg,fmt(v,0)+"%");
  }
  if(o.half&&50>o.yMin&&50<o.yMax)el("line",{class:"dash",x1:X0,y1:y(50),x2:X1,y2:y(50),"stroke-width":1.4},svg);
  const y0=new Date(t0).getUTCFullYear(),y1=new Date(t1).getUTCFullYear();
  for(let yr=y0;yr<=y1;yr++){
    const j=Date.UTC(yr,0,1);if(j<t0||j>t1)continue;
    el("line",{class:"gl",x1:x(j),y1:Y0,x2:x(j),y2:Y1,"stroke-width":1,"stroke-dasharray":"2,3"},svg);
    if(!(W<1000&&y1-y0>4&&(yr-y0)%2))el("text",{class:"mut",x:x(j),y:Y1+20,"font-size":F(12)},svg,String(yr));
  }
  if(o.months){
    const ML0=Array.isArray(o.months)?o.months:[3,6,9],ML=W<1000?((t1-t0)/(365*DAY)>2.2?[]:ML0.filter(m=>m===6)):ML0;
    for(let yr=y0;yr<=y1;yr++)for(const m of ML){const j=Date.UTC(yr,m,1);if(j>t0&&j<t1)el("text",{class:"mut",x:x(j),y:Y1+20,"text-anchor":"middle","font-size":F(12)},svg,new Date(j).toLocaleDateString("en-GB",{month:"short",timeZone:"UTC"}));}
    el("text",{class:"mut",x:X0,y:Y1+40,"font-size":F(11)},svg,`${fmtDate(t0)} \u2013 ${fmtDate(t1)}`);
  }
  if(o.rasterDots&&(o.dots||[]).length){
    // thousands of individual poll dots are painted once onto a canvas and inserted as one image: same look, far lighter to redraw while hovering
    const S=Math.min(3,Math.max(2,Math.ceil((devicePixelRatio||1)*1.3))),bx=X0-4,by=Y0-4,bw=X1-X0+8,bh=Y1-Y0+8,cv=document.createElement("canvas");
    cv.width=Math.round(bw*S);cv.height=Math.round(bh*S);
    const c2=cv.getContext("2d"),dm=isDarkMode();c2.globalAlpha=.2;let last=null;
    o.dots.forEach(d=>{const col=dm&&dark(d.color)?"#7A808A":d.color;if(col!==last){c2.fillStyle=col;last=col;}c2.beginPath();c2.arc((x(d.t)-bx)*S,(y(d.v)-by)*S,2.1*S,0,6.2832);c2.fill();});
    const im=el("image",{x:bx,y:by,width:bw,height:bh,preserveAspectRatio:"none"},svg);
    cv.toBlob(b=>im.setAttribute("href",b?URL.createObjectURL(b):cv.toDataURL("image/png")),"image/png");
  }else(o.dots||[]).forEach(d=>el("circle",{class:dark(d.color)?"dk":"",cx:x(d.t).toFixed(2),cy:y(d.v).toFixed(2),r:2.1,fill:d.color,opacity:.2},svg));
  // notable events: dashed line + label + date above the plot (staggered so they do not overlap)
  const evs=o.events?(o.eventList||EVENTS()).filter(e=>e.t>=t0&&e.t<=t1):[];
  {const HALO="paint-order:stroke;stroke:var(--cbg);stroke-width:4px;stroke-linejoin:round",ivs=[[],[],[],[],[]];
    evs.forEach(e=>{
      e.ex=x(e.t);const w=Math.max(e.label.length*6.6,58)*(W<1000?1.15:1)+8;
      const opts=[["middle",e.ex-w/2],["start",e.ex],["end",e.ex-w]].filter(([a,l])=>l>=X0-30&&l+w<=W-8);
      e.row=-1;
      outer:for(let k=0;k<=(e.ex<380?1:(W<1000?2:4));k++)for(const[a,l]of opts)if(ivs[k].every(([a0,b0])=>l+w+4<=a0||l>=b0+4)){e.row=k;e.anc=a;ivs[k].push([l,l+w]);break outer;}
    });
    evs.forEach(e=>{
      const dy=Y0-12-Math.max(e.row,0)*(W<1000?40:30),top=e.row>=0?dy-27:Y0-6;
      el("line",{x1:e.ex,x2:e.ex,y1:top,y2:Y1,style:"stroke:var(--cink);opacity:.35","stroke-width":1.6,"stroke-dasharray":"2,3"},svg);
    });
    evs.forEach(e=>{if(e.row<0)return;const dy=Y0-12-e.row*(W<1000?40:30);
      el("text",{class:"mut",x:e.ex,y:dy-14,"text-anchor":e.anc,"font-size":F(10.5),style:HALO},svg,e.label);
      el("text",{class:"ink",x:e.ex,y:dy,"text-anchor":e.anc,"font-size":F(11),"font-weight":700,style:HALO},svg,evDate(e.t));
    });}
  const ends=[];
  o.series.forEach(s=>{
    let d="",drawing=false,last=null;
    s.points.forEach(p=>{if(p.v==null){drawing=false;return;}d+=(drawing?"L":"M")+x(p.t).toFixed(2)+" "+y(p.v).toFixed(2)+" ";drawing=true;last=p;});
    if(d)el("path",{class:dark(s.color)?"dk":"",d:d.trim(),fill:"none",stroke:s.color,"stroke-width":2.6,"stroke-linejoin":"round","stroke-linecap":"round"},svg);
    if(last)ends.push({s,v:last.v,y:y(last.v),ty:y(last.v),ex:x(last.t)});
  });
  evs.forEach(e=>o.series.forEach(s=>{const v=nearV(s,e.t);if(v==null)return;
    const cx=e.ex,cy=y(v),r=3.3,d=`M${(cx-r).toFixed(1)} ${(cy-r).toFixed(1)}L${(cx+r).toFixed(1)} ${(cy+r).toFixed(1)}M${(cx-r).toFixed(1)} ${(cy+r).toFixed(1)}L${(cx+r).toFixed(1)} ${(cy-r).toFixed(1)}`;
    el("path",{d,fill:"none",style:"stroke:var(--cbg)","stroke-width":3.2,"stroke-linecap":"round"},svg);
    el("path",{class:dark(s.color)?"dk":"",d,fill:"none",stroke:s.color,"stroke-width":1.7,"stroke-linecap":"round"},svg);}));
  if(o.marker!=null&&o.marker>=t0&&o.marker<=t1){
    const mx=x(o.marker);
    el("line",{class:"dash",x1:mx,x2:mx,y1:Y0-6,y2:Y1,"stroke-width":1.4},svg);
    el("text",{class:"ink",x:mx,y:Y0-12,"text-anchor":mx>X1-80?"end":mx<X0+80?"start":"middle","font-size":F(12),"font-weight":700},svg,fmtDate(o.marker));
    o.series.forEach(s=>{let b=null;s.points.forEach(p=>{if(p.v!=null&&(!b||Math.abs(p.t-o.marker)<Math.abs(b.t-o.marker)))b=p;});
      if(b)el("circle",{cx:mx,cy:y(b.v),r:6,style:"fill:var(--cbg)",stroke:s.color,"stroke-width":3},svg);});
  }
  ends.sort((a,b)=>a.y-b.y);
  for(let i=1;i<ends.length;i++)if(ends[i].y-ends[i-1].y<22)ends[i].y=ends[i-1].y+22;
  if(ends.length){const ov=ends[ends.length-1].y-(Y1+8);if(ov>0)ends.forEach(l=>l.y-=ov);}
  ends.forEach(l=>{
    const k=dark(l.s.color)?"dk":"";
    // label pushed away from the real line end (to avoid overlaps): tie it back to the line with a thin curve + a dot on the true end
    if(Math.abs(l.y-l.ty)>2&&l.ex>=X1-1){
      el("path",{class:k,d:`M${X1.toFixed(2)} ${l.ty.toFixed(2)}C${(X1+8).toFixed(2)} ${l.ty.toFixed(2)},${X1.toFixed(2)} ${l.y.toFixed(2)},${(X1+8).toFixed(2)} ${l.y.toFixed(2)}`,fill:"none",stroke:l.s.color,"stroke-width":1.6,"stroke-linecap":"round",opacity:.6},svg);
      el("circle",{class:k,cx:l.ex.toFixed(2),cy:l.ty.toFixed(2),r:3.4,fill:l.s.color,style:"stroke:var(--cbg)","stroke-width":1.5},svg);
    }
    el("circle",{class:k,cx:(X1+8).toFixed(2),cy:l.y.toFixed(2),r:3.2,fill:l.s.color},svg);
    el("text",{class:k,x:(X1+18).toFixed(2),y:(l.y+4.5).toFixed(2),"font-size":F(13),"font-weight":700,fill:l.s.color},svg,o.endLabel(l.v,l.s.name));
  });
  (o.results||[]).forEach(r=>el("circle",{class:dark(r.color)?"dkr":"",cx:x(t1).toFixed(2),cy:y(r.v).toFixed(2),r:6.5,fill:"none",stroke:r.color,"stroke-width":3},svg));
  const band=el("rect",{y:Y0,width:16,height:Y1-Y0,style:"fill:var(--cink);opacity:.08",visibility:"hidden"},svg);
  const cross=el("line",{y1:Y0,y2:Y1,style:"stroke:var(--cink);opacity:.75","stroke-width":2,visibility:"hidden"},svg);
  const hdots=o.series.map(s=>el("circle",{r:6,fill:s.color,style:"stroke:var(--cbg)","stroke-width":3,visibility:"hidden"},svg));
  // drag-to-compare: hold left-click and drag to compare the values at two dates
  const veil=[0,1].map(()=>el("rect",{y:Y0,height:Y1-Y0,style:"fill:var(--cbg);opacity:.5",visibility:"hidden"},svg));
  const selL=[0,1].map(()=>el("line",{y1:Y0,y2:Y1,style:"stroke:var(--cink);opacity:.4","stroke-width":1.5,visibility:"hidden"},svg));
  const selT=[0,1].map(()=>el("text",{class:"ink",y:Y0-10,"font-size":13,"font-weight":700,visibility:"hidden"},svg));
  const selD=o.series.map(s=>[0,1].map(()=>el("circle",{r:6,fill:s.color,style:"stroke:var(--cbg)","stroke-width":3,visibility:"hidden"},svg)));
  function nearV(s,t){let b=null;s.points.forEach(p=>{if(p.v!=null&&(!b||Math.abs(p.t-t)<Math.abs(b.t-t)))b=p;});return b&&Math.abs(b.t-t)<60*DAY?b.v:null;}
  // snap to a notable event when a selection edge comes close to its marker
  const SNAP=26;
  const snapX=px=>{let b=null;evs.forEach(e=>{const d=Math.abs(e.ex-px);if(d<SNAP&&(!b||d<b.d))b={d,e};});return b?{px:b.e.ex,ev:b.e}:{px,ev:null};};
  let drag=null,dragEv=null;
  const pxOf=e=>{const r=svg.getBoundingClientRect();return Math.max(X0,Math.min(X1,(e.clientX-r.left)/r.width*W));};
  const clearSel=()=>{[selBg,...veil,...selL,...selT].forEach(n=>n.setAttribute("visibility","hidden"));selD.forEach(r=>r.forEach(d=>d.setAttribute("visibility","hidden")));};
  function dragMove(e){
    const s1=snapX(pxOf(e)),fwd=drag<=s1.px,lo=fwd?[drag,dragEv]:[s1.px,s1.ev],hi=fwd?[s1.px,s1.ev]:[drag,dragEv],pa=lo[0],pb=hi[0],ta=t0+(pa-X0)/(X1-X0)*span,tb=t0+(pb-X0)/(X1-X0)*span;
    selBg.setAttribute("x",pa);selBg.setAttribute("width",pb-pa);selBg.setAttribute("visibility","visible");
    veil[0].setAttribute("x",X0);veil[0].setAttribute("width",pa-X0);veil[1].setAttribute("x",pb);veil[1].setAttribute("width",X1-pb);veil.forEach(v=>v.setAttribute("visibility","visible"));
    [pa,pb].forEach((px,j)=>{selL[j].setAttribute("x1",px);selL[j].setAttribute("x2",px);selL[j].setAttribute("visibility","visible");
      const T_=selT[j],room=j===0?px>X0+100:px<X1-100,dir=room?(j===0?-1:1):(j===0?1:-1);T_.textContent=fmtDate(j?tb:ta);T_.setAttribute("text-anchor",dir<0?"end":"start");T_.setAttribute("x",px+dir*6);T_.setAttribute("visibility","visible");});
    const rows=[];
    o.series.forEach((s,i)=>{const v=[nearV(s,ta),nearV(s,tb)];
      v.forEach((val,j)=>{const d=selD[i][j];if(val==null){d.setAttribute("visibility","hidden");return;}d.setAttribute("cx",[pa,pb][j]);d.setAttribute("cy",y(val));d.setAttribute("visibility","visible");});
      if(v[0]!=null&&v[1]!=null)rows.push({n:s.name,a:v[0],b:v[1]});});
    rows.sort((m,n)=>n.b-m.b);
    showTip(e,`<b>${fmtDate(ta)} \u2192 ${fmtDate(tb)}</b><br>`+rows.map(r=>`${r.n}: ${fmt(r.a)}% \u2192 ${fmt(r.b)}% (${dlt(r.b-r.a)})`).join("<br>")+[lo[1],hi[1]].filter(Boolean).map(ev=>`<br>\u25B8 ${ev.label}`).join(""));
  }
  const hit=el("rect",{x:X0,y:Y0,width:X1-X0,height:Y1-Y0,fill:"transparent"},svg);
  hit.addEventListener("mousedown",e=>{
    if(e.button!==0)return;e.preventDefault();
    const s0=snapX(pxOf(e));drag=s0.px;dragEv=s0.ev;hideTip();cross.setAttribute("visibility","hidden");band.setAttribute("visibility","hidden");hdots.forEach(d=>d.setAttribute("visibility","hidden"));
    const up=()=>{removeEventListener("mousemove",dragMove);removeEventListener("mouseup",up);drag=null;clearSel();hideTip();};
    addEventListener("mousemove",dragMove);addEventListener("mouseup",up);
  });
  hit.addEventListener("mousemove",e=>{
    if(drag!=null)return;
    const r=svg.getBoundingClientRect(),px0=(e.clientX-r.left)/r.width*W,hv=evs.find(v=>Math.abs(v.ex-px0)<9),px=hv?hv.ex:px0,t=hv?hv.t:t0+(px-X0)/(X1-X0)*span;
    cross.setAttribute("x1",px);cross.setAttribute("x2",px);cross.setAttribute("visibility","visible");band.setAttribute("x",px-8);band.setAttribute("visibility","visible");
    o.series.forEach((s,i)=>{let b=null;s.points.forEach(p=>{if(p.v!=null&&(!b||Math.abs(p.t-t)<Math.abs(b.t-t)))b=p;});const d=hdots[i];if(b&&Math.abs(b.t-t)<60*DAY){d.setAttribute("cx",px);d.setAttribute("cy",y(b.v));d.setAttribute("visibility","visible");}else d.setAttribute("visibility","hidden");});
    const rows=o.series.map(s=>{let b=null;s.points.forEach(p=>{if(p.v!=null&&(!b||Math.abs(p.t-t)<Math.abs(b.t-t)))b=p;});return b&&Math.abs(b.t-t)<60*DAY?{n:s.name,v:b.v}:null;}).filter(Boolean).sort((a,b)=>b.v-a.v);
    showTip(e,`<b>${fmtDate(t)}</b><br>`+rows.map(r=>`${r.n}: ${fmt(r.v)}%`).join("<br>")+(hv?`<br>\u25B8 ${hv.label}<br>${hv.desc}`:""));
  });
  hit.addEventListener("mouseleave",()=>{if(drag!=null)return;hideTip();cross.setAttribute("visibility","hidden");band.setAttribute("visibility","hidden");hdots.forEach(d=>d.setAttribute("visibility","hidden"));});
}

function smoothedValueAt(recs,key,xMs,bwDays){
  const bw=Math.max(1,bwDays)*DAY;let w=0,s=0;
  let lo=0,hi=recs.length;const from=xMs-3*bw;while(lo<hi){const m=(lo+hi)>>1;if(recs[m].t<from)lo=m+1;else hi=m;}
  for(let i=lo;i<recs.length;i++){
    const v=recs[i].v[key];if(v==null)continue;
    const dx=(recs[i].t-xMs)/bw;
    if(dx<-3)continue;if(dx>3)break;
    const k=Math.exp(-.5*dx*dx);w+=k;s+=k*v;
  }
  return w>0?s/w:null;
}
function sainteLague(pct,seats){
  const keys=Object.keys(pct),res={};keys.forEach(k=>res[k]=0);
  for(let s=0;s<seats&&keys.length;s++){let best=null,bq=-1;keys.forEach(k=>{const q=pct[k]/(2*res[k]+1);if(q>bq){bq=q;best=k;}});res[best]++;}
  return res;
}
const SPEC=cfg.spectrum||[],spec=p=>{if(isFac(p)){const f=facById(p.slice(2));if(f&&f.id==="other")return SPEC.length;const v=f?f.members.map(m=>SPEC.indexOf(m)).filter(i=>i>=0):[];return v.length?v.reduce((a,b)=>a+b,0)/v.length:SPEC.length;}const i=SPEC.indexOf(p);return i<0?SPEC.length:i;};
const pt=(cx,cy,r,deg)=>{const a=deg*Math.PI/180;return[cx+r*Math.cos(a),cy-r*Math.sin(a)];};

// ---------- federal polls ----------
let polls=[],parties=[];
try{
  const rows=await load(cfg.pollsCsv);
  if(!rows.length)throw new Error("germanpolls.csv is empty - run update_data.cmd.");
  const kD=findKey(rows[0],["datum","date"]),kI=findKey(rows[0],["institut","institute","institution","pollster"]);
  if(!kD)throw new Error("germanpolls.csv needs a 'Datum' (or 'Date') column.");
  parties=Object.keys(rows[0]).filter(k=>k&&!META.test(k)&&!(cfg.hiddenParties||[]).includes(k));
  polls=rows.map(r=>({t:+parseDate(r[kD]),inst:kI?r[kI]:"",v:Object.fromEntries(parties.map(p=>[p,num(r[p])]))})).filter(r=>!isNaN(r.t)).sort((a,b)=>a.t-b.t);
}catch(e){showErr(e.message);}

// ---------- approval series (same smoothing as the original trend app) ----------
let apData=[];
const AC=cfg.approvalColors||{approve:"#2E7D32",disapprove:"#C62828"};
try{
  const rows=await load(cfg.approvalCsv);
  const kD=findKey(rows[0],["datum","date"]);
  const kA=Object.keys(rows[0]).find(k=>/zufrieden|approv|satisf/i.test(k)&&!/^un|dis|dissatisf/i.test(k));
  const kB=Object.keys(rows[0]).find(k=>/unzufrieden|disapprov|dissatisf/i.test(k));
  if(!kD||!kA)throw new Error("government_approval.csv needs the columns 'Datum' and 'Zufrieden' (optional: 'Unzufrieden').");
  apData=rows.map(r=>({t:+parseDate(r[kD]),a:num(r[kA]),b:kB?num(r[kB]):null})).filter(r=>!isNaN(r.t)&&r.a!=null).sort((x,y)=>x.t-y.t);
}catch(e){showErr(e.message);}
function apSeries(N=200,bw=30,cols){
  const d=isDarkMode(),B=cols||AC;
  const S=[{name:"Approve",c:B.approve,k:"a"},{name:"Disapprove",c:B.disapprove,k:"b"}].filter(s=>apData.some(r=>r[s.k]!=null))
    .map(s=>({...s,col:d?lighten(s.c,.32):s.c,pts:apData.filter(r=>r[s.k]!=null).map(r=>({t:r.t,v:r[s.k]}))}));
  const sm=(s,t)=>{const sg=bw*DAY/2;let sw=0,sum=0;for(const p of s.pts){const q=(p.t-t)/sg;if(q>3||q<-3)continue;const w=Math.exp(-.5*q*q);sw+=w;sum+=w*p.v;}return sw>1e-6?sum/sw:null;};
  let tmin=apData[0].t,tmax=apData[apData.length-1].t;if(tmax-tmin<30*DAY){tmin-=15*DAY;tmax+=15*DAY;}
  const samples=S.map(s=>Array.from({length:N+1},(_,k)=>{const t=tmin+(tmax-tmin)*k/N;return{t,v:sm(s,t)};}));
  return{S,samples,latest:S.map(s=>sm(s,apData[apData.length-1].t)),tmin,tmax};
}
const MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function niceStep(range){const target=range/5,p=Math.pow(10,Math.floor(Math.log10(target))),f=target/p;return(f<=1?1:f<=2?2:f<=5?5:10)*p;}
function timeTicks(tmin,tmax,maxN){
  const a=new Date(tmin),b=new Date(tmax),months=(b.getUTCFullYear()-a.getUTCFullYear())*12+(b.getUTCMonth()-a.getUTCMonth())+1;
  let step=1;for(const st of[1,2,3,6,12,24,60]){step=st;if(Math.ceil(months/st)<=maxN)break;}
  const ticks=[];let y=a.getUTCFullYear(),m=a.getUTCMonth();m=Math.floor((y*12+m)/step)*step-y*12;
  for(let i=0;i<400;i++){const t=Date.UTC(y,m+i*step,1);if(t>tmax)break;if(t>=tmin)ticks.push({t,step});}
  return ticks;
}

// the original approval chart, ported 1:1 (940 wide, headline numbers, gap shading, 50% line)
function approvalChart(opt){
  const o=opt||{};
  const host=$(o.host||"#approval-chart");if(!apData.length){host.innerHTML="";return;}
  const W=CW(),plotH=380,plotL=58,plotR=W-112,{S,samples,latest,tmin,tmax}=apSeries(200,30,o.cols);
  const dm=isDarkMode();
  let lo=Infinity,hi=-Infinity;apData.forEach(r=>S.forEach(s=>{const v=r[s.k];if(v!=null){lo=Math.min(lo,v);hi=Math.max(hi,v);}}));
  lo=Math.min(lo,50);hi=Math.max(hi,50);
  const step=niceStep(Math.max(1,hi-lo)),ymin=Math.floor((lo-.01)/step)*step,ymax=Math.ceil((hi+.01)/step)*step,yStep=niceStep(ymax-ymin);
  const statsTop=106,plotTop=statsTop+112+14,plotBottom=plotTop+plotH,H=Math.round(plotBottom+52+56);
  const X=t=>plotL+(t-tmin)/(tmax-tmin)*(plotR-plotL),Y=v=>plotBottom-(v-ymin)/(ymax-ymin)*plotH;
  host.innerHTML="";const svg=el("svg",{viewBox:`0 0 ${W} ${H}`,role:"img"},host);
  const T=(x,y,s,o)=>{o=o||{};const a={x:x.toFixed(1),y:y.toFixed(1),class:o.cls||"ink","font-size":(o.size||13)*(W<1000&&!o.nz&&(o.size||13)<=15?1.2:1),"font-weight":o.weight||400};if(o.anchor)a["text-anchor"]=o.anchor;if(o.fill){a.fill=o.fill;a.class="";}return el("text",a,svg,s);};
  el("rect",{class:"bg",x:0,y:0,width:W,height:H},svg);
  const selBg=el("rect",{y:plotTop,height:plotBottom-plotTop,fill:selFill(svg),visibility:"hidden"},svg);
  T(26,52,o.headline||cfg.approvalHeadline,{size:W<1000?24:28,weight:700,cls:"ink serif"});
  T(26,84,o.subline||cfg.approvalSubline,{size:W<1000?11.5:15,cls:"mut2",nz:1});
  if(o.img&&W>=1000)el("image",{href:o.img,x:810,y:112,width:110,height:90,preserveAspectRatio:"xMidYMid meet"},svg);
  const [s0,s1]=S;
  T(26,statsTop+16,s0.name,{size:14,weight:700,fill:s0.col});
  T(26,statsTop+62,latest[0]!=null?fmt(latest[0])+"%":"",{size:46,weight:700,fill:s0.col});
  if(s1){
    T(W-26,statsTop+16,s1.name,{size:14,weight:700,fill:s1.col,anchor:"end"});
    T(W-26,statsTop+62,latest[1]!=null?fmt(latest[1])+"%":"",{size:46,weight:700,fill:s1.col,anchor:"end"});
    if(latest[0]!=null&&latest[1]!=null){const df=latest[0]-latest[1];
      T(W/2,statsTop+16,"Net approval",{size:13,cls:"mut2",anchor:"middle"});
      T(W/2,statsTop+60,sgn(df),{size:34,weight:700,fill:df>=0?s0.col:s1.col,anchor:"middle"});
      T(W/2,statsTop+84,"Trend as of "+fmtDate(apData[apData.length-1].t),{size:12,cls:"mut2",anchor:"middle"});}
  }
  for(let v=ymin;v<=ymax+1e-9;v+=yStep){el("line",{class:"g2",x1:plotL,x2:plotR,y1:Y(v).toFixed(1),y2:Y(v).toFixed(1),"stroke-width":1},svg);T(plotL-10,Y(v)+4,(Math.round(v*100)/100)+"%",{size:12,cls:"mut2",anchor:"end"});}
  if(50>ymin&&50<ymax)el("line",{class:"dash",x1:plotL,x2:plotR,y1:Y(50).toFixed(1),y2:Y(50).toFixed(1),"stroke-width":1.4},svg);
  timeTicks(tmin,tmax,Math.max(3,Math.floor((plotR-plotL)/95))).forEach((tk,i)=>{const d=new Date(tk.t),xx=X(tk.t);
    el("line",{class:"ax",x1:xx.toFixed(1),x2:xx.toFixed(1),y1:plotBottom,y2:plotBottom+5,"stroke-width":1},svg);
    T(xx,plotBottom+22,tk.step>=12?String(d.getUTCFullYear()):(d.getUTCMonth()===0||i===0)?MON[d.getUTCMonth()]+" "+d.getUTCFullYear():MON[d.getUTCMonth()],{size:12,cls:"mut2",anchor:"middle"});});
  el("line",{class:"ax",x1:plotL,x2:plotR,y1:plotBottom,y2:plotBottom,"stroke-width":1.3},svg);
  if(s1){ // gap shading, one shape per stretch where the same line leads
    const runs=[],N=samples[0].length-1;
    for(let k=0;k<N;k++){const a0=samples[0][k],a1=samples[0][k+1],b0=samples[1][k],b1=samples[1][k+1];
      if([a0.v,a1.v,b0.v,b1.v].some(v=>v==null)){runs.push(null);continue;}
      const lead=((a0.v-b0.v)+(a1.v-b1.v))>=0?s0.col:s1.col;let run=runs[runs.length-1];
      if(!run||run.color!==lead){run={color:lead,top:[]};runs.push(run);run.top.push([a0,b0]);}run.top.push([a1,b1]);}
    runs.forEach(run=>{if(!run)return;const f=run.top.map(([a])=>`${X(a.t).toFixed(1)},${Y(a.v).toFixed(1)}`),b=run.top.slice().reverse().map(([,c])=>`${X(c.t).toFixed(1)},${Y(c.v).toFixed(1)}`);
      el("path",{d:`M${f.join(" L")} L${b.join(" L")} Z`,fill:run.color,"fill-opacity":.16},svg);});
  }
  apData.forEach(r=>S.forEach(s=>{if(r[s.k]!=null)el("circle",{cx:X(r.t).toFixed(1),cy:Y(r[s.k]).toFixed(1),r:2.8,fill:s.col,"fill-opacity":.35},svg);}));
  S.forEach((s,si)=>{let d="",pen=false;samples[si].forEach(p=>{if(p.v==null){pen=false;return;}d+=(pen?"L":"M")+X(p.t).toFixed(1)+","+Y(p.v).toFixed(1)+" ";pen=true;});
    el("path",{d,fill:"none",stroke:s.col,"stroke-width":3.2,"stroke-linecap":"round","stroke-linejoin":"round"},svg);});
  const ends=S.map((s,i)=>latest[i]==null?null:{s,v:latest[i],y:Y(latest[i])}).filter(Boolean).sort((a,b)=>a.y-b.y);
  for(let i=1;i<ends.length;i++)if(ends[i].y-ends[i-1].y<34)ends[i].y=ends[i-1].y+34;
  ends.forEach(e=>{T(X(tmax)+10,e.y+4,fmt(e.v)+"%",{size:15,weight:700,fill:e.s.col});T(X(tmax)+10,e.y+19,e.s.name,{size:11.5,cls:"mut2"});});
  el("line",{class:"fl",x1:0,y1:H-56,x2:W,y2:H-56,"stroke-width":1},svg);
  const st=el("text",{class:"mut2",x:26,y:H-26,"font-size":12.5},svg);el("tspan",{class:"ink","font-weight":700},st,"Source: ");st.appendChild(document.createTextNode(o.source||"INSA, YouGov, FG Wahlen, Infratest dimap, Ipsos"));
  // hover: crosshair + values at the cursor
  const NS_=samples[0].length-1,xh=el("line",{style:"stroke:var(--cink);opacity:.75",y1:plotTop,y2:plotBottom,"stroke-width":2,visibility:"hidden"},svg);
  const hd=S.map(s=>el("circle",{r:5.5,fill:s.col,style:"stroke:var(--cbg)","stroke-width":2.5,visibility:"hidden"},svg));
  // drag-to-compare: hold left-click and drag to compare the values at two dates
  const veil=[0,1].map(()=>el("rect",{y:plotTop,height:plotBottom-plotTop,style:"fill:var(--cbg);opacity:.5",visibility:"hidden"},svg));
  const selL=[0,1].map(()=>el("line",{y1:plotTop,y2:plotBottom,style:"stroke:var(--cink);opacity:.4","stroke-width":1.5,visibility:"hidden"},svg));
  const selT=[0,1].map(()=>el("text",{class:"ink",y:plotTop-8,"font-size":13,"font-weight":700,visibility:"hidden"},svg));
  const selD=S.map(s=>[0,1].map(()=>el("circle",{r:5.5,fill:s.col,style:"stroke:var(--cbg)","stroke-width":2.5,visibility:"hidden"},svg)));
  let drag=null;
  const kOf=e=>{const r=svg.getBoundingClientRect(),px=(e.clientX-r.left)/r.width*W;return Math.max(0,Math.min(NS_,Math.round((px-plotL)/(plotR-plotL)*NS_)));};
  const clearSel=()=>{[selBg,...veil,...selL,...selT].forEach(n=>n.setAttribute("visibility","hidden"));selD.forEach(r=>r.forEach(d=>d.setAttribute("visibility","hidden")));};
  function dragMove(e){
    const k1=kOf(e),ka=Math.min(drag,k1),kb=Math.max(drag,k1),ks=[ka,kb],xs=ks.map(k=>X(samples[0][k].t));
    selBg.setAttribute("x",xs[0]);selBg.setAttribute("width",xs[1]-xs[0]);selBg.setAttribute("visibility","visible");
    veil[0].setAttribute("x",plotL);veil[0].setAttribute("width",xs[0]-plotL);veil[1].setAttribute("x",xs[1]);veil[1].setAttribute("width",plotR-xs[1]);veil.forEach(v=>v.setAttribute("visibility","visible"));
    xs.forEach((xx,j)=>{selL[j].setAttribute("x1",xx);selL[j].setAttribute("x2",xx);selL[j].setAttribute("visibility","visible");
      const T_=selT[j],room=j===0?xx>plotL+100:xx<plotR-100,dir=room?(j===0?-1:1):(j===0?1:-1);T_.textContent=fmtDate(samples[0][ks[j]].t);T_.setAttribute("text-anchor",dir<0?"end":"start");T_.setAttribute("x",xx+dir*6);T_.setAttribute("visibility","visible");});
    const va=S.map((s,i)=>samples[i][ka].v),vb=S.map((s,i)=>samples[i][kb].v);
    S.forEach((s,i)=>[va[i],vb[i]].forEach((v,j)=>{const d=selD[i][j];if(v==null){d.setAttribute("visibility","hidden");return;}d.setAttribute("cx",xs[j]);d.setAttribute("cy",Y(v));d.setAttribute("visibility","visible");}));
    showTip(e,`<b>${fmtDate(samples[0][ka].t)} \u2192 ${fmtDate(samples[0][kb].t)}</b><br>`+S.map((s,i)=>va[i]==null||vb[i]==null?"":`<span style="color:${s.col}">\u25CF</span> ${s.name}: ${fmt(va[i])}% \u2192 ${fmt(vb[i])}% (${dlt(vb[i]-va[i])})`).filter(Boolean).join("<br>")+(S.length>1&&va[0]!=null&&va[1]!=null&&vb[0]!=null&&vb[1]!=null?`<br>Net approval: ${sgn(va[0]-va[1])} \u2192 ${sgn(vb[0]-vb[1])} (${dlt((vb[0]-vb[1])-(va[0]-va[1]))})`:""));
  }
  const hit=el("rect",{x:plotL,y:plotTop,width:plotR-plotL,height:plotBottom-plotTop,fill:"transparent"},svg);
  hit.addEventListener("mousedown",e=>{
    if(e.button!==0)return;e.preventDefault();
    drag=kOf(e);hideTip();xh.setAttribute("visibility","hidden");hd.forEach(c=>c.setAttribute("visibility","hidden"));
    const up=()=>{removeEventListener("mousemove",dragMove);removeEventListener("mouseup",up);drag=null;clearSel();hideTip();};
    addEventListener("mousemove",dragMove);addEventListener("mouseup",up);
  });
  hit.addEventListener("mousemove",e=>{
    if(drag!=null)return;
    const r=svg.getBoundingClientRect(),px=(e.clientX-r.left)/r.width*W,k=Math.max(0,Math.min(NS_,Math.round((px-plotL)/(plotR-plotL)*NS_))),t=samples[0][k].t,xx=X(t).toFixed(1);
    xh.setAttribute("x1",xx);xh.setAttribute("x2",xx);xh.setAttribute("visibility","visible");
    const vs=S.map((s,i)=>samples[i][k].v);
    hd.forEach((c,i)=>{if(vs[i]==null){c.setAttribute("visibility","hidden");return;}c.setAttribute("cx",xx);c.setAttribute("cy",Y(vs[i]).toFixed(1));c.setAttribute("visibility","visible");});
    showTip(e,`<b>${fmtDate(t)}</b><br>`+S.map((s,i)=>vs[i]==null?"":`<span style="color:${s.col}">\u25CF</span> ${s.name}: ${fmt(vs[i])}%`).filter(Boolean).join("<br>")+(vs.length>1&&vs[0]!=null&&vs[1]!=null?`<br>Net approval: ${sgn(vs[0]-vs[1])}`:""));
  });
  hit.addEventListener("mouseleave",()=>{if(drag!=null)return;hideTip();xh.setAttribute("visibility","hidden");hd.forEach(c=>c.setAttribute("visibility","hidden"));});
}
if(apData.length){approvalChart();redraw.push(approvalChart);}

function pollTableHtml(recs,plist){
  const recent=recs.slice(-15).reverse(),cand=plist.filter(p=>!isOther(p));
  return `<table><thead><tr><th>Date</th><th>Pollster</th>${plist.map(p=>`<th class="${dark(colorOf(p))?"dk":""}" style="border-bottom-color:${colorOf(p,parties.indexOf(p))}">${lab(p)}</th>`).join("")}</tr></thead><tbody>`+
    recent.map(r=>{const top=Math.max(...cand.map(p=>r.v[p]??-1));
      return `<tr><td>${fmtDate(r.t)}</td><td>${r.inst||r.i||""}</td>${plist.map(p=>`<td class="${r.v[p]===top&&!isOther(p)?"lead":""}">${r.v[p]!=null?fmt(r.v[p])+"%":"\u2013"}</td>`).join("")}</tr>`;}).join("")+`</tbody></table>`;
}
// ---------- POLLS TAB ----------
let tMin=0,tMax=0,BW=cfg.smoothingDays||30;
const active=new Set(parties);
const RANGES=[["6m","6 months",6],["1y","1 year",12],["2y","2 years",24],["5y","5 years",60],["10y","10 years",120],["all","All time",0]];
let pollRange="all";
function rangeStart(){if(pollRange==="all")return tMin;const m=RANGES.find(r=>r[0]===pollRange)[2],d=new Date(tMax);d.setUTCMonth(d.getUTCMonth()-m);return Math.max(tMin,+d);}
const smoothCache=new Map(),viewCache=new Map();
function smoothedPoints(p,ts,N,src=polls,tag=""){const k=pollRange+"|"+tag+p;let pts=smoothCache.get(k);if(!pts){pts=Array.from({length:N+1},(_,i)=>{const t=ts+(tMax-ts)*i/N;return{t,v:smoothedValueAt(src,p,t,BW)};});smoothCache.set(k,pts);}return pts;}

// ---------- factions (poll average + Bundestag projection; off by default, editable in the Polls tab) ----------
const escF=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const facKey=id=>"F:"+id;
const facOfParty=p=>FAC.find(f=>f.members.includes(p))||null;
let faOn={poll:false,parl:false},facVer=0,activeF=new Set(),vpCache=null,vpVer=-1,PM=null,baseM=null;
// the chart units: each faction (if it has members) plus every party not in a faction
function unitsOf(){
  const inF=new Set(FAC.flatMap(f=>f.members));
  const fk=FAC.filter(f=>f.members.some(p=>parties.includes(p))).map(f=>facKey(f.id));
  return [...fk,...parties.filter(p=>!inF.has(p))];
}
// the polls with one extra column per faction: the sum of its member parties in that poll
function viewPolls(){
  if(vpVer===facVer&&vpCache)return vpCache;
  vpCache=polls.map(r=>{const v={...r.v};FAC.forEach(f=>{const xs=f.members.map(p=>r.v[p]).filter(x=>x!=null);v[facKey(f.id)]=xs.length?xs.reduce((a,b)=>a+b,0):null;});return{t:r.t,inst:r.inst,v};});
  vpVer=facVer;return vpCache;
}
// projection model for the faction view (same method as the party model)
function buildPM(){
  if(!faOn.parl||!baseM){PM=baseM;return;}
  const src=viewPolls(),order=[...unitsOf()].sort((a,b)=>spec(a)-spec(b)),pct={},seats={};
  order.forEach(p=>pct[p]=smoothedValueAt(src,p,tMax,BW));
  const elig=order.filter(p=>pct[p]!=null&&pct[p]>=thr&&!isOther(p));
  const sl=sainteLague(Object.fromEntries(elig.map(p=>[p,pct[p]])),N);
  order.forEach(p=>seats[p]=sl[p]||0);
  PM={order,pct,seats,elig};
}
function defaultFactions(){
  const L=["Grüne","Linke","SPD"].filter(p=>parties.includes(p)),R=["CDU/CSU","AfD","FDP","Freie Wähler"].filter(p=>parties.includes(p));
  const used=new Set([...L,...R]);
  return [
    {id:"left",name:"Left-wing",color:"#C8102E",members:L},
    {id:"right",name:"Right-wing",color:"#2B2B30",members:R},
    {id:"other",name:"Others",color:"#C9A227",members:parties.filter(p=>!used.has(p))}
  ];
}
function loadFac(){
  let d=null;try{d=JSON.parse(localStorage.getItem("kc-factions")||"null");}catch(e){}
  if(d&&Array.isArray(d.factions)){
    const seen=new Set();
    FAC=d.factions.map(f=>({id:String(f.id),name:String(f.name||"Faction"),color:/^#[0-9a-f]{6}$/i.test(f.color)?f.color:"#888888",members:(f.members||[]).filter(p=>parties.includes(p))}));
    FAC.forEach(f=>{f.members=f.members.filter(p=>{if(seen.has(p))return false;seen.add(p);return true;});});
    if(d.faOn)faOn={poll:!!d.faOn.poll,parl:!!d.faOn.parl};
  }else FAC=defaultFactions();
}
function saveFac(){try{localStorage.setItem("kc-factions",JSON.stringify({factions:FAC,faOn}));}catch(e){}}
function syncFacUI(){const a=$("#fac-poll"),b=$("#fac-parl");if(a)a.checked=faOn.poll;if(b)b.checked=faOn.parl;}
function moveParty(p,fid){FAC.forEach(f=>f.members=f.members.filter(m=>m!==p));const t=fid?facById(fid):null;if(t)t.members.push(p);factionsChanged();}
function renderFacEditor(){
  const boxes=document.querySelectorAll(".fac-ed");if(!boxes.length)return;
  const ps=[...parties].sort((x,y)=>spec(x)-spec(y));
  const chip=p=>{const c=colorOf(p,parties.indexOf(p));return `<button type="button" class="faction-chip fac-pc${dark(c)?" dkb":""}" draggable="true" data-p="${escF(p)}" title="Drag to a faction, or tap to send it to the next one"><i style="background:${c}"></i>${escF(lab(p))}</button>`;};
  const col=(f,i)=>`<div class="fac-col${dark(f.color)?" dkb":""}" data-f="${f.id}" style="--fc:${f.color}"><div class="fac-ch"><input type="color" value="${f.color}" data-i="${i}" data-role="color" aria-label="Faction colour"><input type="text" value="${escF(f.name)}" data-i="${i}" data-role="name" aria-label="Faction name"><button type="button" class="fac-x" data-i="${i}" data-role="del" title="Remove faction" aria-label="Remove faction">\u00D7</button></div><div class="fac-cb">${ps.filter(p=>facOfParty(p)===f).map(chip).join("")}</div></div>`;
  const html=`<div class="fac-board">${FAC.map(col).join("")}<div class="fac-col fac-none" data-f=""><div class="fac-ch"><span class="fac-nt">Unassigned</span></div><div class="fac-cb">${ps.filter(p=>!facOfParty(p)).map(chip).join("")}</div></div></div><div class="fac-foot"><button type="button" class="link fac-add">+ Add faction</button><span class="fac-hint">Drag a party into a faction, or tap it to send it to the next one. Unassigned parties show on their own.</span></div>`;
  boxes.forEach(b=>{b.innerHTML=html;});
}
function factionsChanged(){
  facVer++;vpVer=-1;saveFac();
  activeF=new Set(unitsOf());
  renderFacEditor();
  if(faOn.poll){drawPolls();renderChips();}
  if(faOn.parl){sel.clear();buildPM();drawParl();renderCoalitions();}
}
function setFacMode(which,on){
  faOn[which]=on;saveFac();
  if(which==="poll"){activeF=new Set(unitsOf());drawPolls();renderChips();}
  else{sel.clear();buildPM();drawParl();renderCoalitions();}
}
function bindFactions(){
  $("#fac-poll").addEventListener("change",e=>setFacMode("poll",e.target.checked));
  $("#fac-parl").addEventListener("change",e=>setFacMode("parl",e.target.checked));
  const FED=[...document.querySelectorAll(".fac-ed")],on=(t,f)=>FED.forEach(x=>x.addEventListener(t,f));
  let dragP=null;const ed={addEventListener:on};
  ed.addEventListener("dragstart",e=>{const c=e.target.closest(".fac-pc");if(!c)return;dragP=c.dataset.p;e.dataTransfer.effectAllowed="move";try{e.dataTransfer.setData("text/plain",dragP);}catch(_){}});
  ed.addEventListener("dragover",e=>{const col=e.target.closest(".fac-col");if(!col||dragP==null)return;e.preventDefault();col.classList.add("over");});
  ed.addEventListener("dragleave",e=>{const col=e.target.closest(".fac-col");if(col&&!col.contains(e.relatedTarget))col.classList.remove("over");});
  ed.addEventListener("drop",e=>{const col=e.target.closest(".fac-col");if(!col||dragP==null)return;e.preventDefault();const p=dragP;dragP=null;moveParty(p,col.dataset.f);});
  ed.addEventListener("dragend",()=>{dragP=null;document.querySelectorAll(".fac-ed .over").forEach(x=>x.classList.remove("over"));});
  [["#fac-edit-btn","#fac-panel"],["#fac-edit-btn-parl","#fac-panel-parl"]].forEach(([bs,ps])=>{const eb=$(bs),fp=$(ps);if(!eb||!fp)return;eb.addEventListener("click",()=>{const open=fp.hidden;fp.hidden=!open;eb.setAttribute("aria-expanded",String(open));});});
  on("click",e=>{
    if(e.target.closest(".fac-add")){FAC.push({id:"f"+Date.now().toString(36),name:"New faction",color:"#7A808A",members:[]});factionsChanged();return;}
    const del=e.target.closest("[data-role=del]");
    if(del){FAC.splice(+del.dataset.i,1);factionsChanged();return;}
    const chip=e.target.closest(".fac-pc");
    if(chip){const p=chip.dataset.p,cur=facOfParty(p),ids=[...FAC.map(f=>f.id),""],nx=ids[(ids.indexOf(cur?cur.id:"")+1)%ids.length];moveParty(p,nx);}
  });
  on("change",e=>{
    const i=+e.target.dataset.i;if(!FAC[i])return;
    if(e.target.dataset.role==="name")FAC[i].name=e.target.value.trim()||"Faction";
    else if(e.target.dataset.role==="color")FAC[i].color=e.target.value;
    else return;
    factionsChanged();
  });
}
if(polls.length){loadFac();activeF=new Set(unitsOf());bindFactions();renderFacEditor();syncFacUI();}

function drawPolls(){
  const N=220,host=$("#poll-chart"),ts=rangeStart(),fm=faOn.poll;
  const src=fm?viewPolls():polls,tag=fm?"F"+facVer+"|":"";
  const units=fm?unitsOf():parties,vset=fm?activeF:active;
  const vis=units.filter(p=>vset.has(p));
  const viewKey=tag+pollRange+"|"+vis.join(",")+"|"+(isDarkMode()?"d":"l")+"|"+CW(),cachedView=viewCache.get(viewKey);
  if(cachedView){viewCache.delete(viewKey);viewCache.set(viewKey,cachedView);host.replaceChildren(...cachedView);return;}
  const series=vis.map(p=>({name:lab(p),color:colorOf(p,parties.indexOf(p)),points:smoothedPoints(p,ts,N,src,tag)}));
  const dots=[];vis.forEach(p=>src.forEach(r=>{if(r.t>=ts&&r.v[p]!=null)dots.push({t:r.t,v:r.v[p],color:colorOf(p,parties.indexOf(p))});}));
  const mx=Math.max(0,...dots.map(d=>d.v)),yMax=Math.ceil(Math.max(10,mx*1.12)/5)*5;
  let step=1;[1,2,5,10,20,25,50,100].forEach(s=>{if(s<=yMax/6*1.4)step=s;});
  lineChart(host,{H:720,rasterDots:true,events:true,months:pollRange==="6m"||pollRange==="1y"?[1,2,3,4,5,6,7,8,9,10,11]:pollRange==="2y"||undefined,title:cfg.pollHeadline,sub:cfg.pollSubline,source:"Source: "+cfg.sourceName,series,dots,yMin:0,yMax,step,threshold:cfg.threshold,endLabel:(v,n)=>`${fmt(v)} % ${n}`});
  viewCache.set(viewKey,Array.from(host.childNodes));if(viewCache.size>14)viewCache.delete(viewCache.keys().next().value);
}
function renderChips(){
  $("#party-filters").innerHTML=(faOn.poll?unitsOf():parties).map(p=>{const c=colorOf(p,parties.indexOf(p)),on=(faOn.poll?activeF:active).has(p);return`<button type="button" class="faction-chip pc${dark(c)?" dkb":""} ${on?"on":""}" data-p="${p}" style="border-color:${c};${on?`background:${c};color:${contrast(c)}`:""}">${lab(p)}</button>`;}).join("")
;
  $("#range-filters").innerHTML=RANGES.map(r=>`<button type="button" class="faction-chip ${pollRange===r[0]?"on":""}" data-r="${r[0]}">${r[1]}</button>`).join("");
}
if(polls.length){
  tMin=polls[0].t;tMax=polls[polls.length-1].t;
  $("#party-filters").onclick=$("#range-filters").onclick=e=>{
    const b=e.target.closest(".faction-chip");if(!b)return;
    if(b.dataset.r){pollRange=b.dataset.r;drawPolls();renderChips();return;}
    if(!b.dataset.p)return;
    const p=b.dataset.p,vset=faOn.poll?activeF:active;
    if(vset.has(p)){if(vset.size>1)vset.delete(p);}else vset.add(p);
    drawPolls();renderChips();
  };
  drawPolls();renderChips();redraw.push(drawPolls);

  $("#poll-table").innerHTML=pollTableHtml(polls,parties);
}

// ---------- BUNDESTAG ----------
const thr=cfg.threshold,N=cfg.seats,maj=Math.floor(N/2)+1;
const order=[...parties].sort((a,b)=>spec(a)-spec(b)),pct={},sel=new Set();
let seats={},elig=[];
if(polls.length){
  order.forEach(p=>pct[p]=smoothedValueAt(polls,p,tMax,BW));
  elig=order.filter(p=>pct[p]!=null&&pct[p]>=thr&&!isOther(p));
  const sl=sainteLague(Object.fromEntries(elig.map(p=>[p,pct[p]])),N);
  order.forEach(p=>seats[p]=sl[p]||0);
}
baseM={order,pct,seats,elig};PM=baseM;buildPM();
function layoutSeats(cx,cy,rIn,rOut){
  let k=2;while(k<80){const pitch=(rOut-rIn)/(k-1),d=Math.PI*k*(rIn+rOut)/(2*N);if(d>=pitch)break;k++;}
  const pitch=(rOut-rIn)/(k-1),radii=Array.from({length:k},(_,i)=>rIn+i*pitch);
  const circs=radii.map(r=>Math.PI*r),cs=circs.reduce((a,b)=>a+b,0),raw=circs.map(c=>c/cs*N),fl=raw.map(Math.floor);
  const rem=N-fl.reduce((a,b)=>a+b,0),ord=raw.map((v,i)=>({i,f:v-fl[i]})).sort((a,b)=>b.f-a.f);
  for(let j=0;j<rem;j++)fl[ord[j%k].i]++;
  const rowsData=radii.map((r,i)=>({r,items:Array.from({length:fl[i]},(_,j)=>{const angle=fl[i]===1?90:180-j*(180/(fl[i]-1));const[x,y]=pt(cx,cy,r,angle);return{angle,x,y};})}));
  const slots=[];rowsData.forEach(row=>row.items.forEach(it=>slots.push(it)));
  slots.sort((a,b)=>b.angle-a.angle);slots.forEach((s,i)=>s.gi=i);
  return{rowsData,slots,dotR:Math.max(2.4,pitch*.46)};
}
function drawSeats(svg,L,o){
  const owner=[];PM.order.forEach(p=>{for(let i=0;i<PM.seats[p];i++)owner.push(p);});
  L.slots.forEach((s,i)=>{const p=owner[i];
    const c=el("circle",{class:"seat"+(p&&dark(colorOf(p))?" dk":""),cx:s.x.toFixed(2),cy:s.y.toFixed(2),r:L.dotR.toFixed(2),fill:p?colorOf(p,parties.indexOf(p)):"#D6D6D2",opacity:p&&o.dim&&o.dim(p)?.2:1},svg);
    if(p){c.addEventListener("mousemove",e=>showTip(e,`<b>${lab(p)}</b>: ${PM.seats[p]} seats (${fmt(PM.pct[p])}%)`));c.addEventListener("mouseleave",hideTip);}
  });
  const bp=L.rowsData.map(row=>{const m=row.items.length;let s=0;while(s<m&&row.items[s].gi<maj)s++;
    const a=s<=0?180:s>=m?0:(row.items[s-1].angle+row.items[s].angle)/2;return pt(o.cx,o.cy,row.r,a);});
  const ang=([px,py])=>Math.atan2(o.cy-py,px-o.cx)*180/Math.PI;
  const full=[pt(o.cx,o.cy,o.rIn-14,ang(bp[0])),...bp,pt(o.cx,o.cy,o.rOut+14,ang(bp[bp.length-1]))].map(([a,b])=>`${a.toFixed(2)},${b.toFixed(2)}`).join(" ");
  el("polyline",{class:"halo",points:full,fill:"none","stroke-width":5.5,"stroke-linejoin":"round","stroke-linecap":"round",opacity:.9},svg);
  el("polyline",{class:"zl",points:full,fill:"none","stroke-width":2.6,"stroke-dasharray":"5,4","stroke-linecap":"round"},svg);
  el("text",{class:"ink",x:o.cx,y:o.cy-48,"text-anchor":"middle","font-size":42,"font-weight":700},svg,String(N));
  el("text",{class:"mut",x:o.cx,y:o.cy-18,"text-anchor":"middle","font-size":15},svg,"Seats");
  el("text",{class:"mut",x:o.cx,y:o.cy+20,"text-anchor":"middle","font-size":14,"font-weight":700,"letter-spacing":"0.02em"},svg,`${maj} needed for majority`);
}
const members=()=>[...sel].filter(p=>PM.seats[p]>0).sort((a,b)=>spec(a)-spec(b));
function drawParl(){
  const W=940,H=710,cx=W/2,cy=470,rOut=330,rIn=178;
  const svg=frame($("#parl-chart"),{W,H,title:cfg.parliamentHeadline,sub:cfg.parliamentSubline,source:cfg.sourceName,boldSource:true});
  const L=layoutSeats(cx,cy,rIn,rOut);
  drawSeats(svg,L,{cx,cy,rIn,rOut,dim:p=>sel.size>0&&!sel.has(p)});
  const act=PM.order.filter(p=>PM.seats[p]>0),n=act.length,gp=8,avail=W-52,PADX=18,MINW=44,MAXW=230,names=act.map(p=>lab(p));
  // each box is as wide as its name (min/max limits); if they do not all fit, everything shrinks proportionally
  let fs0=12,nat;const calc=f=>names.map(t=>Math.min(MAXW,Math.max(MINW,tw(t,f)+PADX)));
  for(;;){nat=calc(fs0);if(nat.reduce((a,b)=>a+b,0)+(n-1)*gp<=avail||fs0<=8.5)break;fs0-=.5;}
  const natSum=nat.reduce((a,b)=>a+b,0),sc=natSum+(n-1)*gp>avail?(avail-(n-1)*gp)/natSum:1,bws=nat.map(w=>w*sc);
  let bxAcc=cx-(bws.reduce((a,b)=>a+b,0)+(n-1)*gp)/2;
  act.forEach((p,i)=>{
    const bw=bws[i],bx=bxAcc;bxAcc+=bw+gp;
    const c=colorOf(p,parties.indexOf(p)),on=sel.has(p),ft=fitLabel(names[i],fs0,bw-12);
    const g=el("g",{style:"cursor:pointer"},svg);g.addEventListener("click",()=>{on?sel.delete(p):sel.add(p);drawParl();});
    el("rect",{class:dark(c)?"dk":"",x:bx.toFixed(2),y:518,width:bw.toFixed(2),height:32,rx:6,fill:c},g);
    if(on)el("rect",{class:"zl",x:(bx-3).toFixed(2),y:515,width:(bw+6).toFixed(2),height:38,rx:8,fill:"none","stroke-width":2.5,style:"stroke:var(--cink)"},g);
    el("text",{x:(bx+bw/2).toFixed(2),y:(518+16+ft.fs*.35).toFixed(2),"text-anchor":"middle","font-size":ft.fs.toFixed(1),"font-weight":700,fill:contrast(c)},g,ft.t);
    el("text",{class:"ink",x:(bx+bw/2).toFixed(2),y:(518+32+15+6).toFixed(2),"text-anchor":"middle","font-size":15,"font-weight":700},g,String(PM.seats[p]));
  });
  const bx0=26,bW=W-52,bY=582,bH=34;
  el("text",{class:"mut",x:bx0,y:bY-14,"font-size":11,"font-weight":700,"letter-spacing":"0.04em"},svg,"VOTE SHARE");
  el("rect",{x:bx0,y:bY,width:bW,height:bH,rx:4,style:"fill:var(--track)"},svg);
  let cur=bx0;
  PM.order.forEach(p=>{
    const v=Math.round((PM.pct[p]||0)*10)/10;if(v<=0)return;
    const w=Math.min(bW-(cur-bx0),v/100*bW);if(w<=0)return;const c=colorOf(p,parties.indexOf(p));
    el("rect",{class:dark(c)?"dk":"",x:cur.toFixed(2),y:bY,width:w.toFixed(2),height:bH,fill:c},svg);
    if(w>22)el("text",{x:(cur+w/2).toFixed(2),y:(bY+bH/2+4).toFixed(2),"text-anchor":"middle","font-size":11,"font-weight":700,fill:contrast(c)},svg,v+"%");
    cur+=w;
  });
  const ow=bx0+bW-cur;
  if(ow>.5){el("rect",{x:cur.toFixed(2),y:bY,width:ow.toFixed(2),height:bH,style:"fill:var(--other)"},svg);
    if(ow>22)el("text",{class:"oth",x:(cur+ow/2).toFixed(2),y:(bY+bH/2+4).toFixed(2),"text-anchor":"middle","font-size":11,"font-weight":700},svg,"Other");}
  const mx=bx0+bW*.5;
  el("line",{class:"halo",x1:mx,y1:bY-8,x2:mx,y2:bY+bH+8,"stroke-width":5.5,"stroke-linecap":"round",opacity:.9},svg);
  el("line",{class:"zl",x1:mx,y1:bY-8,x2:mx,y2:bY+bH+8,"stroke-width":2.6,"stroke-dasharray":"5,4","stroke-linecap":"round"},svg);
  el("text",{class:"ink",x:mx,y:bY+bH+22,"text-anchor":"middle","font-size":11,"font-weight":700},svg,"50%+1 majority");
  renderCust();
}
const barHtml=m=>`<div class="bar"><div>${m.map(p=>`<i class="${dark(colorOf(p))?"dkb":""}" style="width:${PM.seats[p]/N*100}%;background:${colorOf(p)}"></i>`).join("")}</div><u style="left:${maj/N*100}%"></u></div>`;
function renderCust(){
  const m=members(),box=$("#cust");
  if(!m.length){box.innerHTML=`<span class="no">No parties selected yet. Click parties in the legend above or choose a coalition below.</span>`;return;}
  const s=m.reduce((a,p)=>a+PM.seats[p],0),ok=s>=maj;
  box.innerHTML=`<div class="sec-top"><b>${m.map(lab).join(" + ")}</b><button class="link" id="cust-clear" type="button">Clear</button></div>
    <div class="res ${ok?"yes":"no"}">${s} of ${N} seats \u2014 ${ok?`majority (${s-maj} above the ${maj} needed)`:`no majority (${maj-s} short of the ${maj} needed)`}</div>${barHtml(m)}`;
  $("#cust-clear").onclick=()=>{sel.clear();drawParl();};
}
function renderCoalitions(){
  const cmap=c=>[...new Set(c.map(p=>faOn.parl&&facOfParty(p)?facKey(facOfParty(p).id):p))];
  const key=c=>c.slice().sort().join("|");
  const valid=cfg.coalitions.map(cmap).filter(c=>c.every(p=>PM.seats[p]!=null))
    .filter(c=>!faOn.parl||c.length>1)
    .filter((c,i,a)=>!faOn.parl||a.findIndex(d=>key(d)===key(c))===i);
  $("#coalitions").innerHTML=valid.map((c,i)=>{
    const s=c.reduce((a,p)=>a+PM.seats[p],0),ok=s>=maj;
    return `<div class="coal" data-c="${i}" title="Show in the coalition builder"><div class="nm">${c.map(lab).join(" + ")}</div><div>${s} seats</div><div class="${ok?"yes":"no"}">${ok?"Majority":"No majority"}</div>${barHtml(c)}</div>`;
  }).join("")||"<span class='no'>No coalitions in config.json match the parties in the CSV.</span>";
  $("#coalitions").onclick=e=>{const r=e.target.closest(".coal");if(!r)return;sel.clear();valid[+r.dataset.c].forEach(p=>sel.add(p));drawParl();$("#cust").scrollIntoView({block:"center",behavior:"smooth"});};
}
if(polls.length){
  drawParl();
  renderCoalitions();
}

// ---------- OVERVIEW ----------
function ovBars(){
  if(!polls.length)return;
  const M=CW()<1000,W=M?460:820,base=M?236:206,left=M?30:38,right=M?4:8,maxH=M?170:140,gap=M?6:10;
  const bo=(cfg.barOrder||[]).filter(p=>pct[p]!=null),extra=order.filter(p=>!bo.includes(p)&&!isOther(p)&&pct[p]>=thr);
  const list=[...bo.filter(p=>!isOther(p)),...extra,...bo.filter(isOther)],n=list.length,bw=(W-left-right-(n-1)*gap)/n;
  const scale=maxH/Math.max(10,...list.map(p=>pct[p])),H=base+(M?106:86),host=$("#ov-bars");host.innerHTML="";
  const svg=el("svg",{viewBox:`0 0 ${W} ${H}`,role:"img"},host),y5=base-5*scale;
  el("line",{class:"gl",x1:0,x2:W,y1:y5,y2:y5,"stroke-width":1.5},svg);
  el("text",{class:"mut",x:2,y:y5-6,"font-size":M?13:14,"font-weight":500},svg,"5%");
  const gov=cfg.government||[];
  list.forEach((p,i)=>{
    const x=left+i*(bw+gap),cx=x+bw/2,v=pct[p],h=Math.max(2,v*scale),top=base-h,c=colorOf(p,parties.indexOf(p));
    const pv=smoothedValueAt(polls,p,monthAgo(tMax),BW),d=pv!=null?v-pv:null;
    const g=el("g",{},svg);
    g.addEventListener("mousemove",e=>showTip(e,`<b>${lab(p)}</b>: ${fmt(v)}%${pv!=null?`<br>1 month ago: ${fmt(pv)}%`:""}`));g.addEventListener("mouseleave",hideTip);
    el("rect",{class:dark(c)?"dk":"",x:x.toFixed(1),y:top.toFixed(1),width:bw.toFixed(1),height:h.toFixed(1),fill:c},g);
    el("text",{class:"ink",x:cx.toFixed(1),y:(top-(M?27:30)).toFixed(1),"text-anchor":"middle","font-size":M?19:21,"font-weight":700},g,Math.round(v)+"%");
    if(d!=null){const flat=Math.abs(d)<.05,t=el("text",{class:"ink",x:cx.toFixed(1),y:(top-8).toFixed(1),"text-anchor":"middle","font-size":M?12.5:18},g);
      el("tspan",{},t,"(");el("tspan",{class:flat?"":d>0?"pos":"neg"},t,flat?"=":(d>0?"+":"\u2212")+fmt(Math.abs(d)));el("tspan",{},t,")");}
    const tint=lighten(c,.38),name=lab(p),fs=M?12:14;
    el("rect",{x:x.toFixed(1),y:base+10,width:bw.toFixed(1),height:32,rx:2,fill:tint},g);
    const tx=el("text",{x:cx.toFixed(1),y:base+31,"text-anchor":"middle","font-size":fs,"font-weight":700,fill:contrast(tint)},g,name);
    {const ft=fitLabel(name,fs,bw-6);if(ft.fs!==fs||ft.t!==name){tx.setAttribute("font-size",ft.fs);tx.textContent=ft.t;}}
    if(gov.includes(p))el("text",{class:"neg",x:cx.toFixed(1),y:base+58,"text-anchor":"middle","font-size":M?12:13},g,"Gov't");
    const er=(cfg.electionResults||{})[p];
    if(er!=null)el("text",{class:"mut",x:cx.toFixed(1),y:base+78,"text-anchor":"middle","font-size":M?11.5:13,"font-weight":700},g,(i===0&&!M?cfg.electionYear+": ":"")+er+"%");
  });
  if(M&&cfg.electionResults)el("text",{class:"mut",x:left,y:base+98,"font-size":11.5},svg,cfg.electionYear+" election result (below each party)");
}
function ovApproval(){
  if(!apData.length)return;
  const {S,samples,latest}=apSeries(120);
  const df=latest.length>1&&latest[0]!=null&&latest[1]!=null?latest[0]-latest[1]:null;
  $("#ov-appr-nums").innerHTML=S.map((s,i)=>`<div>${s.name}<b style="color:${s.col}">${latest[i]!=null?fmt(latest[i])+"%":"\u2013"}</b></div>`).join("")+(df!=null?`<div>Net approval<b style="color:${df>=0?S[0].col:S[1].col}">${sgn(df)}</b></div>`:"");
  const M=CW()<1000,W=M?440:600,H=M?200:190,pl=6,pr=M?46:40,pt_=12,pb=M?26:22;
  let CH=null;if(chData.length){const sv=apData;apData=chData;try{CH=apSeries(120);}finally{apData=sv;}}
  const vs=samples.flat().concat(CH?CH.samples.flat():[]).map(p=>p.v).filter(v=>v!=null),lo=Math.floor(Math.min(...vs)/10)*10,hi=Math.ceil(Math.max(...vs)/10)*10;
  const t0=Math.min(samples[0][0].t,CH?CH.samples[0][0].t:Infinity),t1=Math.max(samples[0][samples[0].length-1].t,CH?CH.samples[0][CH.samples[0].length-1].t:-Infinity),X=t=>pl+(t-t0)/(t1-t0)*(W-pl-pr),Y=v=>H-pb-(v-lo)/(hi-lo)*(H-pb-pt_);
  const host=$("#ov-appr");host.innerHTML="";const svg=el("svg",{viewBox:`0 0 ${W} ${H}`,role:"img"},host);
  for(let v=lo;v<=hi;v+=10){el("line",{class:"g2",x1:pl,x2:W-pr,y1:Y(v),y2:Y(v),"stroke-width":1},svg);el("text",{class:"mut2",x:W-pr+6,y:Y(v)+4,"font-size":M?13.5:11},svg,v+"%");}
  if(50>lo&&50<hi)el("line",{class:"dash",x1:pl,x2:W-pr,y1:Y(50),y2:Y(50),"stroke-width":1.2},svg);
  S.forEach((s,i)=>el("path",{d:samples[i].filter(p=>p.v!=null).map((p,k)=>(k?"L":"M")+X(p.t).toFixed(1)+" "+Y(p.v).toFixed(1)).join(" "),fill:"none",stroke:s.col,"stroke-width":3,"stroke-linecap":"round","stroke-linejoin":"round"},svg));
  if(CH){const cc=CHC(),ccol=[cc.a,cc.d];CH.S.forEach((s,i)=>el("path",{d:CH.samples[i].filter(p=>p.v!=null).map((p,k)=>(k?"L":"M")+X(p.t).toFixed(1)+" "+Y(p.v).toFixed(1)).join(" "),fill:"none",stroke:ccol[i],"stroke-width":3,"stroke-linecap":"round","stroke-linejoin":"round"},svg));}
  const a=new Date(t0),b=new Date(t1);
  el("text",{class:"mut2",x:pl,y:H-4,"font-size":M?13.5:11},svg,MON[a.getUTCMonth()]+" "+a.getUTCFullYear());
  el("text",{class:"mut2",x:W-pr,y:H-4,"text-anchor":"end","font-size":M?13.5:11},svg,MON[b.getUTCMonth()]+" "+b.getUTCFullYear());
}

let mapParty=null,mapRedraw=null;
function setMapParty(p){mapParty=mapParty===p?null:p;ovChips();if(mapRedraw)mapRedraw();}
function ovChips(){
  if(!polls.length)return;
  const ord=[...parties].filter(p=>pct[p]!=null&&p!=="Freie Wähler").sort((a,b)=>(isOther(a)-isOther(b))||(pct[b]-pct[a]));
  const box=$("#ov-chips");
  box.innerHTML=ord.map(p=>{
    const pv=smoothedValueAt(polls,p,monthAgo(tMax),BW),d=pv!=null?pct[p]-pv:null,c=colorOf(p,parties.indexOf(p)),oth=isOther(p);
    const sty=oth?`border-left-color:${c}`:`background:${c};border-color:${c};color:${contrast(c)}`;
    return `<div class="chip${oth?"":" col"}${dark(c)?" dk":""}${mapParty===p?" sel":""}" data-p="${p}" tabindex="0" role="button" aria-pressed="${mapParty===p}" style="${sty}"><b>${fmt(pct[p])}%${d!=null?`<em class="${d>0?"up":"dn"}">${Math.abs(d)<.05?"\u2013":d>0?"\u25B2":"\u25BC"} ${fmt(Math.abs(d))}</em>`:""}</b><span>${lab(p)}</span></div>`;
  }).join("");
  box.onclick=e=>{const c=e.target.closest(".chip");if(c)setMapParty(c.dataset.p);};
  box.onkeydown=e=>{if(e.key!=="Enter"&&e.key!==" ")return;const c=e.target.closest(".chip");if(c){e.preventDefault();setMapParty(c.dataset.p);const n=box.querySelector(`.chip[data-p="${c.dataset.p}"]`);if(n)n.focus();}};
}
ovChips();
let chData=[];
const CHC=()=>isDarkMode()?{a:"#B0FA20",d:"#F49AA9"}:{a:"#7CB518",d:"#F0556A"};
function ovChancellor(){
  if(!chData.length)return;
  const saved=apData;apData=chData;let R;try{R=apSeries(120);}finally{apData=saved;}
  const {S,latest}=R,c=CHC(),col=[c.a,c.d],df=latest.length>1&&latest[0]!=null&&latest[1]!=null?latest[0]-latest[1]:null;
  $("#ov-chan-nums").innerHTML=S.map((s,i)=>`<div style="color:${col[i]}">${s.name}<b>${latest[i]!=null?fmt(latest[i])+"%":"\u2013"}</b></div>`).join("")+(df!=null?`<div style="color:${df>=0?c.a:c.d}">Net approval<b>${sgn(df)}</b></div>`:"");
}
try{const rows=await load("data/chancellor_approval.csv");chData=rows.map(r=>({t:+parseDate(r.Date),a:num(r.Approve),b:num(r.Disapprove),i:r.Pollster||""})).filter(r=>!isNaN(r.t)&&r.a!=null).sort((x,y)=>x.t-y.t);}catch(e){}
// ---------- "Latest polls" tables under the approval charts ----------
// same look as the federal table: header underlines in the chart colours (green = approve, red = disapprove)
const CHAN_COLS={approve:"#7CB518",disapprove:"#F0556A"};
function apprTableHtml(recs,withInst,cols){
  const dm=isDarkMode(),ca=dm?lighten(cols.approve,.32):cols.approve,cd=dm?lighten(cols.disapprove,.32):cols.disapprove,R=withInst?"":"text-align:right;",pc=v=>v!=null?fmt(v,0)+"%":"\u2013";
  return `<table><thead><tr><th>Date</th>${withInst?"<th>Pollster</th>":""}<th style="${R}border-bottom-color:${ca}">Approve</th><th style="border-bottom-color:${cd}">Disapprove</th></tr></thead><tbody>`+
    recs.slice(-15).reverse().map(r=>`<tr><td>${fmtDate(r.t)}</td>${withInst?`<td>${r.i||""}</td>`:""}<td${R?` style="${R}"`:""}>${pc(r.a)}</td><td>${pc(r.b)}</td></tr>`).join("")+`</tbody></table>`;
}
function apprTables(){
  if(apData.length)$("#approval-table").innerHTML=apprTableHtml(apData,false,AC);else $("#approval-fold").hidden=true;
  if(chData.length)$("#chancellor-table").innerHTML=apprTableHtml(chData,true,CHAN_COLS);else $("#chancellor-fold").hidden=true;
}
apprTables();redraw.push(apprTables);
ovBars();ovApproval();if(apData.length)redraw.push(ovApproval);
if(chData.length){ovChancellor();redraw.push(ovChancellor);}
function chancellorChart(){
  let host=$("#chancellor-chart");
  if(!host){const ac=$("#approval-card");if(!ac)return;const card=document.createElement("div");card.className="chart-card flow";card.id="chancellor-card";card.innerHTML='<div id="chancellor-chart"></div>';ac.insertAdjacentElement("afterend",card);host=$("#chancellor-chart");}
  if(!chData.length){host.innerHTML="";return;}
  const saved=apData;apData=chData;
  try{approvalChart({host:"#chancellor-chart",headline:"Chancellor approval",subline:"Share of Germans satisfied and dissatisfied with the Chancellor",cols:{approve:"#7CB518",disapprove:"#F0556A"},img:"img/merz.png",source:"INSA, Forsa, FG Wahlen, Infratest dimap"});}
  finally{apData=saved;}
}
if(chData.length){chancellorChart();redraw.push(chancellorChart);}

let stateData={},stateGeo={};
// 2025 Bundestag result for one state (from data/election2025.json, cached by fetchRaw)
async function stateResults(id){try{const r=await fetchRaw("data/election2025.json");if(!r.ok)return null;return (JSON.parse(r.text).states||{})[id]||null;}catch(e){return null;}}
async function openState(id){
  const s=stateData[id];if(!s)return;
  document.querySelectorAll(".tab-btn").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".pane").forEach(p=>p.classList.toggle("active",p.id==="tab-state"));
  history.replaceState(null,"","#state-"+id);scrollTo(0,0);
  track("/state/"+id,stateGeo[id].en+" polls");
  curState=id;await drawState(id);
}
let curState=null,stateRange="all";
async function drawState(id){
  const s=stateData[id];if(!s)return;
  const en=stateGeo[id].en,rec=s.rec,plist=s.ps,bwS=cfg.stateSmoothingDays||60;
  let t0=rec[0].t,t1=rec[rec.length-1].t;if(t1-t0<30*DAY){t0-=15*DAY;t1+=15*DAY;}
  // date filter (same ranges as the federal poll average, counted back from this state's latest poll)
  if(stateRange!=="all"){const m=RANGES.find(r=>r[0]===stateRange)[2],d=new Date(t1);d.setUTCMonth(d.getUTCMonth()-m);t0=Math.max(t0,+d);}
  const recR=rec.filter(r=>r.t>=t0);
  const N=160;
  const series=plist.map(p=>({name:lab(p),color:colorOf(p,parties.indexOf(p)),points:Array.from({length:N+1},(_,i)=>{const t=t0+(t1-t0)*i/N;return{t,v:smoothedValueAt(rec,p,t,bwS)};})}));
  // an event just after the last poll (e.g. the state election itself) still gets its marker: widen the x-range with an empty point
  {const ev=EVENTS_FOR(id).filter(e=>e.t>t1&&e.t-t1<=45*DAY).pop();if(ev&&series.length)series[0].points.push({t:ev.t,v:null});}
  const dots=[];plist.forEach(p=>rec.forEach(r=>{if(r.t>=t0&&r.v[p]!=null)dots.push({t:r.t,v:r.v[p],color:colorOf(p,parties.indexOf(p))});}));
  const mx=Math.max(0,...dots.map(d=>d.v)),yMax=Math.ceil(Math.max(10,mx*1.12)/5)*5;let step=1;[1,2,5,10,20,25,50,100].forEach(q=>{if(q<=yMax/6*1.4)step=q;});
  const res=await stateResults(id),results=res?plist.filter(p=>res[p]!=null).map(p=>({v:res[p],color:colorOf(p,parties.indexOf(p))})):[];
  lineChart($("#state-chart"),{H:720,title:en+" poll average",sub:`State election voting intention \u00B7 ${recR.length} poll${recR.length>1?"s":""}, latest ${fmtDate(rec[rec.length-1].t)}`+(results.length?" \u00B7 rings = 2025 Bundestag vote in this state":""),source:"Source: "+cfg.sourceName,
    series,dots,yMin:0,yMax,step,threshold:cfg.threshold,months:stateRange==="6m"||stateRange==="1y"?[1,2,3,4,5,6,7,8,9,10,11]:true,events:true,eventList:EVENTS_FOR(id),results,endLabel:(v,n)=>`${fmt(v)} % ${n}`});
  $("#state-table").innerHTML=pollTableHtml(rec,plist);
  $("#state-range").innerHTML=RANGES.map(r=>`<button type="button" class="faction-chip ${stateRange===r[0]?"on":""}" data-r="${r[0]}">${r[1]}</button>`).join("");
  $("#state-pick").innerHTML=Object.keys(stateData).sort((a,b)=>stateGeo[a].en.localeCompare(stateGeo[b].en)).map(k=>`<button type="button" class="faction-chip ${k===id?"on":""}" data-s="${k}">${stateGeo[k].en}</button>`).join("");
}
$("#state-pick").onclick=e=>{const b=e.target.closest("[data-s]");if(b)openState(b.dataset.s);};
$("#state-range").onclick=e=>{const b=e.target.closest("[data-r]");if(!b||!curState)return;stateRange=b.dataset.r;drawState(curState);};
// state map from state_polls/<State>.csv (written by update_data.cmd)
async function ovMap(){
  const host=$("#map"),note=$("#map-note");
  let geo;try{geo=JSON.parse((await fetchRaw(cfg.statesMap)).text);}catch(e){host.textContent="Map data missing.";return;}
  const entries=Object.entries(cfg.stateFiles||{});
  const res=await Promise.all(entries.map(async([id,slug])=>{
    try{
      const r=await fetchRaw(`${cfg.stateFolder}/${slug}.csv`);if(!r.ok)return null;
      const rows=parseCSV(r.text);if(!rows.length)return null;
      const kD=findKey(rows[0],["datum","date"]),kI=findKey(rows[0],["institut","institute","pollster"]);
      const ps=Object.keys(rows[0]).filter(k=>k&&!META.test(k));
      const rec=rows.map(x=>({t:+parseDate(x[kD]),i:kI?x[kI]:"",v:Object.fromEntries(ps.map(p=>[p,num(x[p])]))})).filter(x=>!isNaN(x.t)).sort((a,b)=>a.t-b.t);
      if(!rec.length)return null;
      const last=rec[rec.length-1].t,win=rec.filter(x=>x.t>=last-cfg.stateWindowDays*DAY),avg={};
      ps.forEach(p=>{const v=win.map(x=>x.v[p]).filter(z=>z!=null);if(v.length)avg[p]=v.reduce((a,b)=>a+b)/v.length;});
      const lead=Object.keys(avg).filter(p=>!isOther(p)).sort((a,b)=>avg[b]-avg[a])[0];
      return{id,avg,lead,last,n:win.length,rec,ps:ps.filter(p=>rec.some(x=>x.v[p]!=null))};
    }catch(e){return null;}
  }));
  const data=Object.fromEntries(res.filter(Boolean).map(r=>[r.id,r]));
  stateData=data;stateGeo=Object.fromEntries(geo.states.map(s=>[s.id,s]));
  const titleEl=$("#map-title"),subEl=document.querySelector(".ov-map .subl"),title0=titleEl.textContent,sub0=subEl.textContent;
  const mixHex=(h,t,a)=>{const f=x=>parseInt(x.replace("#","").length===6?x.replace("#",""):"000000",16),A=f(h),B=f(t),ch=sh=>Math.round(((A>>sh)&255)*(1-a)+((B>>sh)&255)*a).toString(16).padStart(2,"0");return"#"+ch(16)+ch(8)+ch(0);};
  function draw(){
    host.innerHTML="";const svg=el("svg",{viewBox:`0 0 ${geo.w} ${geo.h}`,role:"img"},host);
    const P=mapParty,vals=P?Object.values(data).map(d=>d.avg[P]).filter(v=>v!=null):[],strength=vals.length>0;
    const mn=strength?Math.min(...vals):0,mx=strength?Math.max(...vals):0;
    let shade=()=>null;
    if(strength){
      const base=colorOf(P,parties.indexOf(P)),full=isDarkMode()&&dark(base)?"#7A808A":base,dm=isDarkMode();
      shade=v=>{const t=mx>mn?.15+.85*(v-mn)/(mx-mn):1;return dm?mixHex(full,"#1B1E24",.75*(1-t)):mixHex(full,"#FFFFFF",.9*(1-t));};
    }
    titleEl.textContent=strength?`How strong is ${lab(P)} in each state?`:title0;
    subEl.textContent=strength?`Latest state polls`:sub0;
    const wins={},labels=[];
    geo.states.forEach(s=>{
      const d=data[s.id],sv=strength&&d&&d.avg[P]!=null?d.avg[P]:null;
      const c=strength?(sv!=null?shade(sv):null):(d&&d.lead?colorOf(d.lead):null);
      const p=el("path",{class:"st"+(c?"":" nodata")+(!strength&&c&&dark(c)?" dk":""),d:s.d,fill:c||"",style:d?"cursor:pointer":""},svg);
      if(c)p.setAttribute("fill",c);
      p.addEventListener("mousemove",e=>{
        if(!d){showTip(e,`<b>${s.en}</b><br>No polls found`);return;}
        const top=Object.entries(d.avg).sort((a,b)=>b[1]-a[1]).slice(0,5);
        showTip(e,`<b>${s.en}</b><br>`+top.map(([k,v])=>`${lab(k)}: ${fmt(v)}%`).join("<br>")+`<br><span style="opacity:.7">${d.n} poll${d.n>1?"s":""} \u00B7 latest ${fmtDate(d.last)}</span>`);
      });
      p.addEventListener("mouseleave",hideTip);
      if(d)p.addEventListener("click",()=>{hideTip();openState(s.id);});
      const tiny=["BE","HB","HH","SL"].includes(s.id);
      const label=(col,val)=>labels.push(()=>{
        const fc=contrast(col),lpos=LP[s.id]||[s.cx,s.cy],cx=lpos[0],cy=lpos[1]+(tiny?0:5);
        if(tiny){el("text",{x:cx,y:cy+4,"text-anchor":"middle","font-size":10.5,"font-weight":700,fill:fc,"pointer-events":"none"},svg,fmt(val)+"%");return;}
        el("text",{x:cx,y:cy-12,"text-anchor":"middle","font-size":9,"font-weight":600,fill:fc,opacity:.8,"pointer-events":"none"},svg,s.id);
        el("text",{x:cx,y:cy+8,"text-anchor":"middle","font-size":21,"font-weight":800,fill:fc,"pointer-events":"none"},svg,fmt(val)+"%");
      });
      if(strength&&sv!=null)label(c,sv);
      if(d&&d.lead){wins[d.lead]=(wins[d.lead]||0)+1;
        if(!strength)label(colorOf(d.lead),d.avg[d.lead]);
      }
    });
    labels.forEach(f=>f());
    if(strength){
      $("#map-legend").innerHTML=`<span>${lab(P)} \u00B7 weakest ${fmt(mn)}% <i style="width:110px;background:linear-gradient(to right,${shade(mn)},${shade(mx)})"></i> strongest ${fmt(mx)}%</span>`;
      note.textContent="";
    }else{
      $("#map-legend").innerHTML=Object.entries(wins).sort((a,b)=>b[1]-a[1]).map(([p,n])=>`<span><i class="${dark(colorOf(p))?"dk":""}" style="background:${colorOf(p)}"></i>${lab(p)} <b>${n}</b></span>`).join("");
      note.textContent=Object.keys(data).length?"":`No state polls found yet \u2014 double-click update_data.cmd to import them into the ${cfg.stateFolder} folder.`;
    }
  }
  mapRedraw=draw;redraw.push(()=>{if(mapParty)draw();});
  draw();
}
await ovMap();
// ---------- 2025 ELECTION TAB ----------
async function drawElection(){
  let E;
  try{const r=await fetchRaw("data/election2025.json");if(!r.ok)throw new Error("HTTP "+r.status);E=JSON.parse(r.text);}
  catch(e){showErr("data/election2025.json could not be loaded ("+e.message+").");return;}
  const ET=+parseDate(E.date),EP=E.parties,D=E.demographics,thr5=cfg.threshold;
  const MAIN=["CDU/CSU","AfD","SPD","Grüne","Linke","BSW","FDP"],ACC=[...MAIN,"Freie Wähler"];
  const ecol=p=>p==="SSW"?"#003C8F":colorOf(p);
  const mix=(h,t,a)=>{const f=x=>parseInt(x.replace("#",""),16),A=f(h),B=f(t),ch=sh=>Math.round(((A>>sh)&255)*(1-a)+((B>>sh)&255)*a).toString(16).padStart(2,"0");return"#"+ch(16)+ch(8)+ch(0);};
  const sdev=v=>(v>0?"+":v<0?"\u2212":"")+fmt(Math.abs(v));
  const pc=v=>(v<thr5&&+fmt(v,1)>=thr5?fmt(v,2):fmt(v,1))+"%";
  const PN={"Forschungsgruppe Wahlen":"FG Wahlen","Institut Wahlkreisprognose":"Wahlkreisprognose","Verian (Emnid)":"Verian"};
  const SH={"Forschungsgruppe Wahlen":"FG\nWahlen","Infratest dimap":"Infratest\ndimap","Institut Wahlkreisprognose":"Wahlkreis-\nprognose","Verian (Emnid)":"Verian\n(Emnid)"};
  const pn=n=>PN[n]||n;
  const othersPct=EP["Freie Wähler"].pct+EP["Sonstige"].pct;

  // header + chips
  $("#el-sub").textContent=`${fmtDate(ET)} \u00B7 turnout ${fmt(E.turnout)}% \u00B7 ${fmt(E.registered/1e6,1)} million eligible voters`;
  $("#el-chips").innerHTML=[...MAIN].sort((a,b)=>EP[b].pct-EP[a].pct).map(p=>{const c=ecol(p);
    return `<div class="chip col static${dark(c)?" dk":""}" style="background:${c};border-color:${c};color:${contrast(c)}"><b>${pc(EP[p].pct)}</b><span>${lab(p)} \u00B7 ${EP[p].seats} seats</span></div>`;}).join("")
    +`<div class="chip static" style="border-left-color:${colorOf("Sonstige")}"><b>${pc(othersPct)}</b><span>Others \u00B7 ${EP.SSW.seats} seat (SSW)</span></div>`;

  // result bars
  const rb=[...MAIN].sort((a,b)=>EP[b].pct-EP[a].pct).map(p=>({n:lab(p),c:ecol(p),pct:EP[p].pct,s:EP[p].seats,ch:EP[p].seatChange,isNew:p==="BSW"}));
  rb.push({n:"Free Voters",c:ecol("Freie Wähler"),pct:EP["Freie Wähler"].pct,s:0,ch:null},{n:"Others",c:colorOf("Sonstige"),pct:EP.Sonstige.pct,s:EP.SSW.seats,ch:null,note:" (SSW)"});
  const rmax=Math.max(...rb.map(r=>r.pct));
  const rowHtml=r=>{
    const chg=r.isNew?`<span class="sch m">new</span>`:r.ch==null||r.ch===0?"":`<span class="sch ${r.ch>0?"p":"n"}">${r.ch>0?"+":"\u2212"}${Math.abs(r.ch)}</span>`;
    return `<div class="elrow"><span class="eltag${dark(r.c)?" dk":""}" style="background:${r.c};color:${contrast(r.c)}">${r.n}</span><div class="eltrack"><i class="${dark(r.c)?"dkb":""}" style="width:${r.pct/rmax*100}%;background:${r.c}"></i><u style="left:${thr5/rmax*100}%" title="${thr5}% threshold"></u></div><span class="elval"><b>${pc(r.pct)}</b> &middot; ${r.s} seat${r.s===1?"":"s"}${r.note||""} ${chg}</span></div>`;};
  $("#el-bars").innerHTML=rb.map(rowHtml).join("")
    ;
  $("#ov-elec-sub").textContent=`${fmtDate(ET)} \u00B7 turnout ${fmt(E.turnout)}%`;
  {
    const ovp=[...MAIN].sort((a,b)=>EP[b].pct-EP[a].pct).map(p=>({n:lab(p),c:ecol(p),pct:EP[p].pct,s:EP[p].seats}));
    ovp.push({n:"Others",c:colorOf("Sonstige"),pct:othersPct,s:EP.SSW.seats,oth:1});
    const gov=cfg.government||[],gs=gov.reduce((a,p)=>a+(EP[p]?EP[p].seats:0),0);
    $("#ov-elec").innerHTML=`<div class="ovstack">${ovp.map(r=>`<i class="${dark(r.c)?"dkb":""}" style="width:${r.pct}%;background:${r.c};color:${contrast(r.c)};font-size:min(13px,${(r.pct/((fmt(r.pct)+"%").length*.8)).toFixed(2)}cqw)" title="${r.n}">${r.pct>=8?fmt(r.pct)+"%":""}</i>`).join("")}</div>`
      +`<div class="pills ovleg">${ovp.map(r=>`<span><i class="${dark(r.c)?"dk":""}" style="background:${r.c}"></i><b>${r.n}</b> ${pc(r.pct)} \u00B7 ${r.s} seat${r.s===1?"":"s"}</span>`).join("")}</div>`;
  }

  // parliament
  {
    const W=600,H=340,cx=W/2,cy=318,rIn=130,rOut=285,L=layoutSeats(cx,cy,rIn,rOut);
    const host=$("#el-parl");host.innerHTML="";const svg=el("svg",{viewBox:`0 0 ${W} ${H}`,role:"img"},host);
    const ord=["Linke","SPD","Grüne","SSW","CDU/CSU","AfD"],own=[];ord.forEach(p=>{for(let i=0;i<EP[p].seats;i++)own.push(p);});
    L.slots.forEach((sl,i)=>{const p=own[i],c=p?ecol(p):"#D6D6D2";
      const ci=el("circle",{class:"seat"+(p&&p!=="SSW"&&dark(c)?" dk":""),cx:sl.x.toFixed(2),cy:sl.y.toFixed(2),r:L.dotR.toFixed(2),fill:c},svg);
      if(p){ci.addEventListener("mousemove",e=>showTip(e,`<b>${p==="SSW"?"SSW":lab(p)}</b>: ${EP[p].seats} seats`));ci.addEventListener("mouseleave",hideTip);}});
    el("text",{class:"ink",x:cx,y:cy-52,"text-anchor":"middle","font-size":40,"font-weight":700},svg,String(E.totalSeats));
    el("text",{class:"mut",x:cx,y:cy-26,"text-anchor":"middle","font-size":14},svg,"Seats");
    el("text",{class:"mut",x:cx,y:cy+2,"text-anchor":"middle","font-size":12.5,"font-weight":700},svg,`${E.majority} needed for majority`);
    const gov=cfg.government||[],gs=gov.reduce((a,p)=>a+(EP[p]?EP[p].seats:0),0);
    $("#el-parl-legend").innerHTML=["Linke","SPD","Grüne","SSW","CDU/CSU","AfD"].map(p=>`<span><i class="${p!=="SSW"&&dark(ecol(p))?"dk":""}" style="background:${ecol(p)}"></i>${p==="SSW"?"SSW":lab(p)} <b>${EP[p].seats}</b></span>`).join("");
  }

  // polls leading up to the election (rings = actual result)
  {
    const recs=polls.filter(r=>r.t<ET),t0=Date.UTC(2021,8,26),N=320,BWp=10;
    const series=MAIN.map(p=>({name:lab(p),color:ecol(p),points:Array.from({length:N+1},(_,i)=>{const t=t0+(ET-t0)*i/N;return{t,v:smoothedValueAt(recs,p,t,BWp)};})}));
    const dots=[];MAIN.forEach(p=>recs.forEach(r=>{if(r.t>=t0&&r.v[p]!=null)dots.push({t:r.t,v:r.v[p],color:ecol(p)});}));
    const yMax=Math.ceil(Math.max(10,...series.flatMap(q=>q.points.map(z=>z.v||0)),...MAIN.map(p=>EP[p].pct))*1.06/5)*5;
    lineChart($("#el-poll-chart"),{H:720,events:true,title:"Polls leading up to the election",sub:"",source:"Source: "+cfg.sourceName+" \u00B7 Federal Returning Officer",
      series,dots,yMin:0,yMax,step:5,threshold:cfg.threshold,months:true,results:MAIN.map(p=>({v:EP[p].pct,color:ecol(p)})),endLabel:(v,n)=>`${fmt(v)} % ${n}`});
  }

  // pollster accuracy
  const lastBy={};
  polls.forEach(r=>{if(r.t<ET&&r.inst&&(!lastBy[r.inst]||r.t>=lastBy[r.inst].t))lastBy[r.inst]=r;});
  const acc=Object.values(lastBy).filter(r=>r.t>=ET-60*DAY).map(r=>{
    const dev={};ACC.forEach(p=>{dev[p]=r.v[p]!=null?+(EP[p].pct1-r.v[p]).toFixed(1):null;});
    const m=MAIN.filter(p=>dev[p]!=null);
    return{inst:r.inst,t:r.t,poll:r.v,dev,err:m.reduce((a,p)=>a+Math.abs(dev[p]),0)/m.length};
  }).sort((a,b)=>a.err-b.err);
  const SRC="Source: "+cfg.sourceName+" \u00B7 Federal Returning Officer";
  function accParty(){
    const n=acc.length,W=1200,H=720,X0=70,X1=W-26,Y0=160,Y1=H-140;
    const svg=frame($("#el-acc-chart"),{W,H,title:"Final polls vs. the actual result",sub:"Result minus the last poll before the election, in percentage points \u00B7 plus = underestimated, minus = overestimated",source:SRC});
    const all=acc.flatMap(a=>ACC.map(p=>a.dev[p]).filter(v=>v!=null));
    const lo=Math.min(-1,Math.floor(Math.min(...all))),hi=Math.max(1,Math.ceil(Math.max(...all))),y=v=>Y1-(v-lo)/(hi-lo)*(Y1-Y0);
    ACC.forEach((p,i)=>{const c=ecol(p),lx=X0+i*135;el("circle",{class:dark(c)?"dk":"",cx:lx,cy:118,r:6,fill:c},svg);el("text",{class:"ink",x:lx+12,y:123,"font-size":14,"font-weight":700},svg,lab(p));});
    for(let v=lo;v<=hi;v++){el("line",{class:"gl",x1:X0,x2:X1,y1:y(v),y2:y(v),"stroke-width":1},svg);el("text",{class:"mut",x:X0-10,y:y(v)+4,"text-anchor":"end","font-size":12},svg,v===0?"0":sdev(v));}
    const gw=(X1-X0)/n,nb=ACC.length,bw=(gw-14)/nb;
    acc.forEach((a,i)=>{
      const x0=X0+i*gw;
      if(i)el("line",{class:"gl",x1:x0,x2:x0,y1:Y0,y2:Y1+70,"stroke-width":1,"stroke-dasharray":"4,4"},svg);
      ACC.forEach((p,j)=>{const v=a.dev[p];if(v==null)return;const c=ecol(p),bx=x0+7+j*bw,yz=y(0),yv=y(v);
        el("rect",{class:dark(c)?"dk":"",x:bx.toFixed(1),y:Math.min(yz,yv).toFixed(1),width:(bw-1.5).toFixed(1),height:Math.max(1.5,Math.abs(yv-yz)).toFixed(1),fill:c},svg);
        const hit=el("rect",{x:bx.toFixed(1),y:Y0,width:bw.toFixed(1),height:Y1-Y0,fill:"transparent"},svg);
        hit.addEventListener("mousemove",e=>showTip(e,`<b>${pn(a.inst)}</b> \u00B7 ${lab(p)}<br>Last poll (${fmtDate(a.t)}): ${fmt(a.poll[p])}%<br>Result: ${fmt(EP[p].pct1)}%<br>${sdev(v)} \u2192 ${v>0?"underestimated":v<0?"overestimated":"spot on"}`));
        hit.addEventListener("mouseleave",hideTip);});
      const cx=x0+gw/2,nm=(SH[a.inst]||a.inst).split("\n");
      nm.forEach((s,k)=>el("text",{class:"ink",x:cx,y:Y1+24+k*16,"text-anchor":"middle","font-size":13,"font-weight":700},svg,s));
      el("text",{class:"mut",x:cx,y:Y1+28+nm.length*16,"text-anchor":"middle","font-size":11},svg,"\u00D8 miss "+fmt(a.err));
    });
    el("line",{class:"zl",x1:X0,x2:X1,y1:y(0),y2:y(0),"stroke-width":2.4},svg);
  }
  function accRank(){
    const n=acc.length,W=1200,rowH=40,Y0=140,H=Y0+n*rowH+90,X0=250,X1=W-130,mx=Math.max(...acc.map(a=>a.err));
    const svg=frame($("#el-acc-chart"),{W,H,title:"Who was closest?",sub:"Average miss of the final poll over CDU/CSU, AfD, SPD, Greens, Left, BSW and FDP, in percentage points",source:SRC});
    acc.forEach((a,i)=>{const yy=Y0+i*rowH,w=Math.max(2,a.err/mx*(X1-X0));
      el("text",{class:"ink",x:X0-14,y:yy+rowH/2+4,"text-anchor":"end","font-size":15,"font-weight":700},svg,`${i+1}. ${pn(a.inst)}`);
      el("rect",{x:X0,y:yy+6,width:w.toFixed(1),height:rowH-14,rx:2,style:"fill:var(--accent)"},svg);
      el("text",{class:"ink",x:X0+w+10,y:yy+rowH/2+5,"font-size":15,"font-weight":700},svg,fmt(a.err));
      const hit=el("rect",{x:26,y:yy,width:W-52,height:rowH,fill:"transparent"},svg);
      hit.addEventListener("mousemove",e=>showTip(e,`<b>${pn(a.inst)}</b> \u00B7 last poll ${fmtDate(a.t)}<br>`+ACC.filter(p=>a.dev[p]!=null).map(p=>`${lab(p)}: ${sdev(a.dev[p])}`).join("<br>")));
      hit.addEventListener("mouseleave",hideTip);});
  }
  let accMode="party";
  function drawAcc(){
    $("#el-acc-pick").innerHTML=`<button type="button" class="faction-chip ${accMode==="party"?"on":""}" data-m="party">Deviation by party</button><button type="button" class="faction-chip ${accMode==="rank"?"on":""}" data-m="rank">Ranking</button>`;
    accMode==="party"?accParty():accRank();
  }
  $("#el-acc-pick").onclick=e=>{const b=e.target.closest("[data-m]");if(b){accMode=b.dataset.m;drawAcc();}};
  drawAcc();
  const bias=ACC.map(p=>{const v=acc.filter(a=>a.dev[p]!=null);if(!v.length)return null;
    return{p,n:v.length,mean:v.reduce((s,a)=>s+a.dev[p],0)/v.length,hi:v.reduce((a,b)=>b.dev[p]>a.dev[p]?b:a),lo:v.reduce((a,b)=>b.dev[p]<a.dev[p]?b:a)};}).filter(Boolean);
  const dc=v=>v>0?"under":v<0?"over":"";
  $("#el-bias").innerHTML=`<table><thead><tr><th>Party</th><th>Result</th><th>Polls on average</th><th>Underestimated most by</th><th>Overestimated most by</th></tr></thead><tbody>`+bias.map(b=>{
    const c=ecol(b.p);
    return `<tr><td style="color:var(--cink);font-weight:700"><span class="dotc ${dark(c)?"dk":""}" style="background:${c}"></span>${lab(b.p)}</td><td>${pc(EP[b.p].pct)}</td><td class="${dc(+fmt(b.mean))}">${sdev(b.mean)} ${+fmt(b.mean)>0?"(under)":+fmt(b.mean)<0?"(over)":""}</td>`
      +`<td>${b.hi.dev[b.p]>0?`${pn(b.hi.inst)} <span class="under">${sdev(b.hi.dev[b.p])}</span>`:"\u2013"}</td><td>${b.lo.dev[b.p]<0?`${pn(b.lo.inst)} <span class="over">${sdev(b.lo.dev[b.p])}</span>`:"\u2013"}</td></tr>`;}).join("")+`</tbody></table>`;
  $("#el-acc-table").innerHTML=`<table><thead><tr><th>Pollster</th><th>Last poll</th>${ACC.map(p=>`<th class="${dark(ecol(p))?"dk":""}" style="border-bottom-color:${ecol(p)}">${lab(p)}</th>`).join("")}<th>Avg. miss</th><th style="text-align:left">Biggest miss</th></tr></thead><tbody>`+acc.map(a=>{
    const bp=ACC.filter(p=>a.dev[p]!=null).reduce((x,y)=>Math.abs(a.dev[y])>Math.abs(a.dev[x])?y:x);
    return `<tr><td style="color:var(--cink);font-weight:700">${pn(a.inst)}</td><td>${fmtDate(a.t)}</td>${ACC.map(p=>`<td class="${a.dev[p]==null?"":dc(a.dev[p])}">${a.dev[p]==null?"\u2013":sdev(a.dev[p])}</td>`).join("")}<td><b>${fmt(a.err)}</b></td><td style="text-align:left">${lab(bp)} <span class="${dc(a.dev[bp])}">${sdev(a.dev[bp])}</span> (${a.dev[bp]>0?"under":"over"}estimated)</td></tr>`;}).join("")+`</tbody></table>`;

  // state map
  let geo=null;try{geo=JSON.parse((await fetchRaw(cfg.statesMap)).text);}catch(e){}
  let mp=null;
  function drawMapE(){
    const host=$("#el-map");
    $("#el-map-pick").innerHTML=`<button type="button" class="faction-chip ${mp==null?"on":""}" data-p="">Winner</button>`+MAIN.map(p=>`<button type="button" class="faction-chip ${mp===p?"on":""}" data-p="${p}">${lab(p)}</button>`).join("");
    if(!geo){host.textContent="Map data missing.";return;}
    host.innerHTML="";const svg=el("svg",{viewBox:`0 0 ${geo.w} ${geo.h}`,role:"img"},host);
    const vals=mp?Object.values(E.states).map(d=>d[mp]):[],mn=Math.min(...vals),mx=Math.max(...vals);
    const dm=isDarkMode(),base=mp?ecol(mp):null,full=mp&&dm&&dark(base)?"#7A808A":base;
    const shade=v=>{const t=mx>mn?.15+.85*(v-mn)/(mx-mn):1;return dm?mix(full,"#1B1E24",.75*(1-t)):mix(full,"#FFFFFF",.9*(1-t));};
    $("#el-map-title").textContent=mp?`How strong was ${lab(mp)} in each state?`:"Who won each state?";
    const wins={},labels=[];
    geo.states.forEach(s=>{
      const d=E.states[s.id];if(!d)return;
      const win=MAIN.slice().sort((a,b)=>d[b]-d[a])[0],v=mp?d[mp]:d[win],c=mp?shade(v):ecol(win),tiny=["BE","HB","HH","SL"].includes(s.id);
      const pth=el("path",{class:"st"+(!mp&&dark(c)?" dk":""),d:s.d,fill:c},svg);
      pth.addEventListener("mousemove",e=>showTip(e,`<b>${s.en}</b><br>`+[...MAIN,"Sonstige"].sort((a,b)=>d[b]-d[a]).map(k=>`${lab(k)}: ${fmt(d[k])}%`).join("<br>")+`<br><span style="opacity:.7">Turnout ${fmt(d.turnout)}%</span>`));
      pth.addEventListener("mouseleave",hideTip);
      if(!mp)wins[win]=(wins[win]||0)+1;
      labels.push(()=>{const fc=contrast(c),lpos=LP[s.id]||[s.cx,s.cy],lx=lpos[0],ly=lpos[1]+(tiny?0:5);
        if(tiny){el("text",{x:lx,y:ly+4,"text-anchor":"middle","font-size":10.5,"font-weight":700,fill:fc,"pointer-events":"none"},svg,fmt(v)+"%");return;}
        el("text",{x:lx,y:ly-12,"text-anchor":"middle","font-size":9,"font-weight":600,fill:fc,opacity:.8,"pointer-events":"none"},svg,s.id);
        el("text",{x:lx,y:ly+8,"text-anchor":"middle","font-size":21,"font-weight":800,fill:fc,"pointer-events":"none"},svg,fmt(v)+"%");});
    });
    labels.forEach(f=>f());
    $("#el-map-legend").innerHTML=mp?`<span>${lab(mp)} \u00B7 weakest ${fmt(mn)}% <i style="width:110px;background:linear-gradient(to right,${shade(mn)},${shade(mx)})"></i> strongest ${fmt(mx)}%</span>`
      :Object.entries(wins).sort((a,b)=>b[1]-a[1]).map(([p,n])=>`<span><i class="${dark(ecol(p))?"dk":""}" style="background:${ecol(p)}"></i>${lab(p)} <b>${n}</b></span>`).join("");
  }
  $("#el-map-pick").onclick=e=>{const b=e.target.closest("[data-p]");if(b){mp=b.dataset.p||null;drawMapE();}};
  drawMapE();redraw.push(drawMapE);

  // demographics
  const DP=[...MAIN,"Sonstige"];let dg=0,dp=null;
  function drawDemo(){
    const g=D.groups[dg],rows=[{label:"All voters",v:D.total,tot:1},...g.rows];
    $("#el-demo-cat").innerHTML=D.groups.map((x,i)=>`<button type="button" class="faction-chip ${i===dg?"on":""}" data-g="${i}">${x.name}</button>`).join("");
    $("#el-demo-party").innerHTML=`<button type="button" class="faction-chip ${dp==null?"on":""}" data-p="">All parties</button>`+DP.map(p=>`<button type="button" class="faction-chip ${dp===p?"on":""}" data-p="${p}">${lab(p)}</button>`).join("");
    if(dp==null){
      $("#el-demo").innerHTML=rows.map(r=>{const sum=DP.reduce((a,p)=>a+r.v[p],0);
        return `<div class="drow${r.tot?" tot":""}"><div>${r.label}</div><div class="dbar"><div>${DP.map(p=>{const c=colorOf(p),v=r.v[p];return `<i class="${dark(c)?"dkb":""}" data-r="${r.label}" data-p="${p}" style="width:${v/sum*100}%;background:${c};color:${contrast(c)}">${v>=4?v:""}</i>`;}).join("")}</div></div></div>`;}).join("");
      $("#el-demo-legend").innerHTML=DP.map(p=>`<span><i class="${dark(colorOf(p))?"dk":""}" style="background:${colorOf(p)}"></i>${lab(p)}</span>`).join("");
    }else{
      const mx=Math.max(...rows.map(r=>r.v[dp])),c=colorOf(dp);
      $("#el-demo").innerHTML=rows.map(r=>`<div class="drow${r.tot?" tot":""}"><div>${r.label}</div><div class="dbar single"><i class="${dark(c)?"dkb":""}" data-r="${r.label}" data-p="${dp}" style="width:${r.v[dp]/mx*86}%;background:${c}"></i><b>${r.v[dp]}%</b></div></div>`).join("");
      $("#el-demo-legend").innerHTML="";
    }
    $("#el-demo-note").textContent="";
  }
  $("#el-demo-cat").onclick=e=>{const b=e.target.closest("[data-g]");if(b){dg=+b.dataset.g;drawDemo();}};
  $("#el-demo-party").onclick=e=>{const b=e.target.closest("[data-p]");if(b){dp=b.dataset.p||null;drawDemo();}};
  $("#el-demo").onmousemove=e=>{const t=e.target.closest("i[data-p]");if(!t){hideTip();return;}
    const g=D.groups[dg],row=t.dataset.r==="All voters"?D.total:g.rows.find(r=>r.label===t.dataset.r).v;
    showTip(e,`<b>${t.dataset.r}</b><br>${lab(t.dataset.p)}: ${row[t.dataset.p]}%`);};
  $("#el-demo").onmouseleave=hideTip;
  drawDemo();

  // voter migration (Infratest dimap): net flows between parties, 2021 -> 2025
  const MG=E.migration;
  if(MG){
    const NW="Nichtwähler",MN=[...MAIN,NW],mname=n=>n===NW?"Non-voters":lab(n),mcol=n=>n===NW?"#8A8F98":colorOf(n);
    const num0=v=>v.toLocaleString("en-US");
    const inn=n=>MG.flows.filter(f=>f.to===n),out=n=>MG.flows.filter(f=>f.from===n);
    const sum=a=>a.reduce((s,f)=>s+f.v,0),mmax=Math.max(...MG.flows.map(f=>f.v));
    let mg=null;
    function drawMig(){
      $("#el-mig-pick").innerHTML=`<button type="button" class="faction-chip ${mg==null?"on":""}" data-p="">Overview</button>`+MAIN.map(p=>`<button type="button" class="faction-chip ${mg===p?"on":""}" data-p="${p}">${lab(p)}</button>`).join("");
      if(mg==null){
        const rows=MN.map(n=>({n,g:sum(inn(n)),l:sum(out(n))})).map(r=>({...r,net:r.g-r.l})).sort((a,b)=>b.net-a.net),m=Math.max(...rows.map(r=>Math.max(r.g,r.l)));
        $("#el-mig").innerHTML=`<div class="mg-key"><span></span><div><span>\u2190 Lost to other parties</span><span>Gained from other parties \u2192</span></div><span></span></div>`+rows.map(r=>`<div class="mg-row" data-n="${r.n}"><div class="mg-lab"><i style="background:${mcol(r.n)}"></i>${mname(r.n)}</div><div class="mg-div"><div class="mg-l"><b style="width:${r.l/m*100}%"></b></div><div class="mg-r"><b style="width:${r.g/m*100}%"></b></div></div><div class="mg-net ${r.net>0?"up":r.net<0?"dn":""}">${r.net>0?"+":r.net<0?"\u2212":""}${num0(Math.abs(r.net))}</div></div>`).join("")+`<div class="note">Balance = voters gained minus voters lost. Select a party to see where its voters came from and went.</div>`;
      }else{
        const gi=inn(mg).sort((a,b)=>b.v-a.v),lo=out(mg).sort((a,b)=>b.v-a.v),G=sum(gi),L=sum(lo),net=G-L;
        const list=(a,key,cls)=>a.length?a.map(f=>{const o=f[key],c=mcol(o);return `<div class="mg-item" data-n="${o}"><div class="mg-lab"><i style="background:${c}"></i>${mname(o)}</div><div class="mg-bar"><b class="${cls}" style="width:${f.v/mmax*100}%;background:${c}"></b></div><div class="mg-val">${num0(f.v)}</div></div>`;}).join(""):`<div class="note">None reported</div>`;
        $("#el-mig").innerHTML=`<div class="mg-sum" style="--mc:${mcol(mg)}"><div><small>Gained</small><b class="up">+${num0(G)}</b></div><div><small>Lost</small><b class="dn">\u2212${num0(L)}</b></div><div><small>Balance</small><b class="${net>0?"up":net<0?"dn":""}">${net>0?"+":net<0?"\u2212":""}${num0(Math.abs(net))}</b></div></div>
        <div class="mg-cols"><div><div class="mg-h">Gained from</div>${list(gi,"from","in")}</div><div><div class="mg-h">Lost to</div>${list(lo,"to","out")}</div></div>`;
      }
    }
    $("#el-mig-pick").onclick=e=>{const b=e.target.closest("[data-p]");if(b){mg=b.dataset.p||null;drawMig();}};
    $("#el-mig").onmousemove=e=>{const r=e.target.closest("[data-n]");if(!r||mg==null&&false){hideTip();return;}
      const n=r.dataset.n;if(mg==null){showTip(e,`<b>${mname(n)}</b><br>Gained ${num0(sum(inn(n)))}<br>Lost ${num0(sum(out(n)))}`);}
      else{const f=r.classList.contains("mg-item")&&(inn(mg).find(x=>x.from===n)||out(mg).find(x=>x.to===n));if(f)showTip(e,`<b>${mname(f.from)} \u2192 ${mname(f.to)}</b><br>${num0(f.v)} voters`);else hideTip();}};
    $("#el-mig").onmouseleave=hideTip;
    drawMig();
  }
}
try{await drawElection();}catch(e){console.error(e);showErr("2025 Election tab failed to load: "+e.message);}

// ---------- POLL TABS (parties ruled out, maximum voter potential, ...) ----------
// every tab = one entry in config.json "pollTabs" + one CSV (Datum,Institut,<party columns>). Add an entry to add a tab.
// With several polls, the bars show the average of the last cfg.pollTabAverage polls (default 5).
const NTABS=(cfg.pollTabs&&cfg.pollTabs.length?cfg.pollTabs:[{id:"ruledout",label:"Parties ruled out",csv:cfg.negativeCsv,title:"Parties voters rule out",sub:"Share of voters who could never imagine voting for each party"}]).map(t=>({...t,rows:[],parties:[]}));
let negIdx=0;const negSmooth=new Map();
for(const T of NTABS){
  try{
    const rows=await load(T.csv);
    if(rows.length){
      const kD=findKey(rows[0],["datum","date"]),kI=findKey(rows[0],["institut","institute","pollster"]);
      T.parties=Object.keys(rows[0]).filter(k=>k&&!META.test(k)&&!isOther(k));
      T.rows=rows.map(r=>({t:+parseDate(r[kD]),inst:kI?r[kI]:"",v:Object.fromEntries(T.parties.map(p=>[p,num(r[p])]))})).filter(r=>!isNaN(r.t)).sort((a,b)=>a.t-b.t);
    }
  }catch(e){/* a tab without data just shows its empty state */}
}
const NAVG=Math.max(1,cfg.pollTabAverage||5);
// show one decimal when needed (36.5 stays 36.5, 36 stays 36); keep=true always shows one decimal (averages)
const nf=(v,keep)=>keep||Math.abs(v-Math.round(v))>=.05?fmt(v,1):fmt(v,0);
function negAgg(rows,parties){ // mean of every party over the given polls (ignoring polls that lack the party)
  const v={};parties.forEach(p=>{const x=rows.map(r=>r.v[p]).filter(n=>n!=null);v[p]=x.length?x.reduce((s,n)=>s+n,0)/x.length:null;});
  return {t:rows[rows.length-1].t,v,n:rows.length,inst:[...new Set(rows.map(r=>r.inst).filter(Boolean))].join(", ")};
}
function negTabs(){
  const box=$("#neg-tabs");
  box.innerHTML=NTABS.map((t,i)=>`<button type="button" role="tab" aria-selected="${i===negIdx}" class="seg-tab ${i===negIdx?"on":""}" data-i="${i}"><b>${t.label}</b>${t.sub?`<small>${t.sub}</small>`:""}</button>`).join("");
  box.style.display=NTABS.length>1?"":"none";
}
$("#neg-tabs").onclick=e=>{const b=e.target.closest("[data-i]");if(!b)return;negIdx=+b.dataset.i;negTabs();negDraw();};
function negChart(){
  const T=NTABS[negIdx],neg=T.rows,negParties=T.parties,host=$("#neg-chart"),tr=$("#neg-trend");
  if(!neg.length){host.innerHTML=`<div class="note" style="padding:28px 4px">No polls in this tab yet. Add rows to <b>${T.csv}</b>.</div>`;tr.innerHTML="";return;}
  const L=negAgg(neg.slice(-NAVG),negParties),P=neg.length>1?negAgg(neg.slice(-NAVG-1,-1),negParties):null,plist=negParties.filter(p=>L.v[p]!=null);
  const srcTxt=L.n>1?`Source: ${L.inst||cfg.sourceName} · average of the last ${L.n} polls, latest ${fmtDate(L.t)}`:"Source: "+(L.inst||cfg.sourceName);
  // chart type per tab (config.json -> pollTabs[].chart, or pollTabChart): "bar", "line" or "both"; a line needs at least 2 polls
  const mode=String(T.chart||cfg.pollTabChart||"both").toLowerCase(),showLine=neg.length>1&&mode!=="bar",showBar=mode!=="line"||!showLine;
  const allMaxT=Math.max(...neg.flatMap(r=>negParties.map(p=>r.v[p]??0))),yMaxT=Math.ceil(Math.max(...plist.map(p=>L.v[p]),allMaxT*(neg.length>1?1:0))*1.12/10)*10;
  if(!showBar)host.innerHTML="";
  if(showBar){
  const W=CW(),H=720,X0=70,X1=W-40,Y0=170,Y1=H-120;
  const svg=frame(host,{W,H,title:T.title,sub:T.sub,source:srcTxt});
  const allMax=Math.max(...neg.flatMap(r=>negParties.map(p=>r.v[p]??0))),yMax=Math.ceil(Math.max(...plist.map(p=>L.v[p]),allMax*(neg.length>1?1:0))*1.12/10)*10,y=v=>Y1-v/yMax*(Y1-Y0);
  for(let v=0;v<=yMax;v+=10){el("line",{class:"gl",x1:X0,x2:X1,y1:y(v),y2:y(v),"stroke-width":1},svg);if(v>0)el("text",{class:"mut",x:X0-10,y:y(v)+4,"text-anchor":"end","font-size":W<1000?14:12},svg,v+"%");}
  const slot=(X1-X0)/plist.length,bw=Math.min(120,slot*.56);
  plist.forEach((p,i)=>{
    const v=L.v[p],c=colorOf(p,parties.indexOf(p)),cx=X0+slot*(i+.5),x=cx-bw/2,top=y(v),g=el("g",{},svg);
    el("rect",{class:dark(c)?"dk":"",x:x.toFixed(1),y:top.toFixed(1),width:bw.toFixed(1),height:(Y1-top).toFixed(1),rx:2,fill:c},g);
    el("text",{class:"ink",x:cx.toFixed(1),y:(top-(P&&P.v[p]!=null?30:10)).toFixed(1),"text-anchor":"middle","font-size":W<1000?21:26,"font-weight":700},g,nf(v,L.n>1)+"%");
    if(P&&P.v[p]!=null){const d=v-P.v[p];el("text",{class:"mut",x:cx.toFixed(1),y:(top-9).toFixed(1),"text-anchor":"middle","font-size":15},g,Math.abs(d)<.05?"(=)":`(${d>0?"+":"−"}${fmt(Math.abs(d))})`);}
    const tint=lighten(c,.38);
    {const lw=W<1000?slot*.94:bw;el("rect",{x:(cx-lw/2).toFixed(1),y:Y1+12,width:lw.toFixed(1),height:36,rx:2,fill:tint},g);}
    el("text",{x:cx.toFixed(1),y:Y1+36,"text-anchor":"middle","font-size":W<1000?10.5:16,"font-weight":700,fill:contrast(tint)},g,lab(p));
    const hit=el("rect",{x:(cx-slot/2).toFixed(1),y:Y0-40,width:slot.toFixed(1),height:Y1-Y0+90,fill:"transparent"},g);
    hit.addEventListener("mousemove",e=>showTip(e,`<b>${lab(p)}</b>: ${nf(v,L.n>1)}%`+(P&&P.v[p]!=null?`<br>${L.n>1?"Previous average":"Previous poll"} (${fmtDate(P.t)}): ${nf(P.v[p],L.n>1)}%`:"")+(L.n>1?`<br>Average of the last ${L.n} polls`:L.inst?`<br>Pollster: ${L.inst}`:"")));
    hit.addEventListener("mouseleave",hideTip);
  });
  el("line",{class:"zl",x1:X0,x2:X1,y1:Y1,y2:Y1,"stroke-width":2},svg);
  }
  // line chart over time, once there is more than one result
  if(showLine){
    const sm=negSmooth.has(T.id)?negSmooth.get(T.id):!!(T.smooth??cfg.pollTabSmooth);
    const t0=neg[0].t,t1=neg[neg.length-1].t,NS=220,bwN=cfg.pollTabSmoothingDays||cfg.smoothingDays||30;
    const series=plist.map(p=>({name:lab(p),color:colorOf(p,parties.indexOf(p)),points:sm?Array.from({length:NS+1},(_,i)=>{const t=t0+(t1-t0)*i/NS;return{t,v:smoothedValueAt(neg,p,t,bwN)};}):neg.map(r=>({t:r.t,v:r.v[p]}))}));
    const dots=[];plist.forEach(p=>neg.forEach(r=>{if(r.v[p]!=null)dots.push({t:r.t,v:r.v[p],color:colorOf(p,parties.indexOf(p))});}));
    lineChart(tr,{H:720,title:T.trendTitle||T.title+" over time",sub:T.sub,source:"Source: "+(L.inst||cfg.sourceName),series,dots,yMin:0,yMax:yMaxT,step:10,endLabel:(v,n)=>`${nf(v)} % ${n}`});
    const tg=document.createElement("div");tg.className="neg-smooth";
    tg.innerHTML=`<label class="switch" aria-label="Smooth the lines"><input type="checkbox"${sm?" checked":""}><span class="slider"></span></label><span>Smooth lines</span>`;
    tg.querySelector("input").onchange=e=>{negSmooth.set(T.id,e.target.checked);negChart();};
    tr.appendChild(tg);
  }else tr.innerHTML="";
}
function negTable(){
  const T=NTABS[negIdx],neg=T.rows,negParties=T.parties,sec=$("#neg-sec");
  if(sec)sec.hidden=!neg.length;
  if(!neg.length){$("#neg-table").innerHTML="";return;}
  const rec=neg.slice(-15).reverse();
  $("#neg-table").innerHTML=`<table><thead><tr><th>Date</th><th>Pollster</th>${negParties.map(p=>`<th class="${dark(colorOf(p))?"dk":""}" style="border-bottom-color:${colorOf(p,parties.indexOf(p))}">${lab(p)}</th>`).join("")}</tr></thead><tbody>`+
    rec.map(r=>{const top=Math.max(...negParties.map(p=>r.v[p]??-1));return`<tr><td>${fmtDate(r.t)}</td><td>${r.inst||""}</td>${negParties.map(p=>`<td class="${r.v[p]===top?"lead":""}">${r.v[p]!=null?nf(r.v[p])+"%":"–"}</td>`).join("")}</tr>`;}).join("")+`</tbody></table>`;
}
function negDraw(){negChart();negTable();}
negTabs();negDraw();redraw.push(negChart);

// ---------- overview: fit to one screen, no scrolling ----------
// scale the whole page so it always has the same proportions as the 1440p design (layout viewport ~1620x911)
function scaleAll(){
  const g=innerWidth<900?1:Math.max(1,Math.min(innerWidth/1620,innerHeight/911));
  const tb=$("#tabbar"),m=$("main.wrap");
  if(tb)tb.style.zoom=g>1?g:"";
  if(m)m.style.zoom=g>1?g:"";
  return g;
}
function fitOv(){
  const f=$("#ov-fit");if(!f)return;
  const g=scaleAll();
  f.style.zoom=1;
  if(!$("#tab-overview").classList.contains("active")||innerWidth<900)return;
  // browsers differ on whether bounding boxes include the page scale; measure it instead of assuming
  const tbw=$("#tabbar").getBoundingClientRect().width/document.documentElement.clientWidth;
  const k=g>1&&tbw<(1+1/g)/2?g:1;
  const top=f.getBoundingClientRect().top+scrollY/k,avail=innerHeight/k-top-14;
  const fits=i=>{f.style.zoom=ZS[i];return f.getBoundingClientRect().height<=avail;};
  let lo=0,hi=ZS.length;
  while(lo<hi){const m=(lo+hi)>>1;if(fits(m))hi=m;else lo=m+1;}
  while(lo>0&&lo<ZS.length&&fits(lo-1))lo--;
  f.style.zoom=lo<ZS.length?ZS[lo]:ZEND;
}
let rzq=0;addEventListener("resize",()=>{cancelAnimationFrame(rzq);rzq=requestAnimationFrame(fitOv);});
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fitOv);
redraw.push(fitOv);
fitOv();

{const m=location.hash.match(/^#state-(\w+)/);if(m)openState(m[1]);}
// ---------- little scroll fade-ins ----------
try{
  if("IntersectionObserver" in window&&!matchMedia("(prefers-reduced-motion: reduce)").matches){
    document.documentElement.classList.add("fx");
    const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add("in");io.unobserve(e.target);}}),{threshold:.08,rootMargin:"0px 0px -4% 0px"});
    const seen=new WeakSet(),scan=()=>document.querySelectorAll(".chart-card,.ov-head,.group-title,#ov-chips,.latest,.foot:not(.ov-foot)").forEach(n=>{if(seen.has(n))return;seen.add(n);n.classList.add("rv");io.observe(n);});
    let sq=0;scan();new MutationObserver(()=>{if(sq)return;sq=requestAnimationFrame(()=>{sq=0;scan();});}).observe(document.querySelector("main"),{childList:true,subtree:true});
  }
}catch(e){}
// re-draw the charts when the phone/desktop breakpoint is crossed (rotate, resize)
;(function(){let w=CW();addEventListener("resize",()=>{const n=CW();if(n!==w){w=n;redraw.forEach(f=>{try{f();}catch(e){}});}});})();
})();

;(function(){
  if(!("ontouchstart" in window))return;
  let moved=false,sx=0,sy=0,tgt=null,active=false;
  const fire=(type,t,el)=>{(el||document.elementFromPoint(t.clientX,t.clientY)||document.body).dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,clientX:t.clientX,clientY:t.clientY,view:window}));};
  const isChart=el=>el&&el.closest&&el.closest(".chart-card svg, #map, #el-map, #el-demo");
  document.addEventListener("touchstart",e=>{const t=e.touches[0];tgt=e.target;active=!!isChart(tgt);moved=false;sx=t.clientX;sy=t.clientY;if(active)fire("mousemove",t,tgt);},{passive:true});
  document.addEventListener("touchmove",e=>{if(!active)return;const t=e.touches[0];if(Math.abs(t.clientY-sy)>14&&Math.abs(t.clientY-sy)>Math.abs(t.clientX-sx)){active=false;fire("mouseleave",t,tgt);return;}moved=true;fire("mousemove",t);},{passive:true});
  document.addEventListener("touchend",e=>{if(!active)return;const t=e.changedTouches[0];setTimeout(()=>{fire("mouseup",t);fire("mouseleave",t,tgt);},1400);},{passive:true});
  document.addEventListener("touchstart",e=>{if(!e.target.closest(".chart-card svg,#map,#el-map,#el-demo")&&typeof hideTip==="function")hideTip();},{passive:true});
})();
