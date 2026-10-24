(async function(){
"use strict";
const yieldUi=()=>new Promise(r=>setTimeout(r,0)); // give the browser a moment between the heavy start-up steps so the page stays responsive
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
let biasAdj={}; // Historical pollster bias to adjust 2025 projection in constituencies
const CW=()=>matchMedia("(max-width:600px)").matches?500:1200; // chart canvas width: narrower on phones so text and lines render larger
// zoom steps tried by fitOv (same sequence as before: 1.30, 1.28, ... down to ~0.45)
const ZS=[];let ZEND=1.3;for(;ZEND>.45;ZEND-=.02)ZS.push(ZEND);
function setDark(d){document.body.classList.toggle("dark",d);$("#dark-toggle").checked=d;const lg=$("#logo");if(lg)lg.src=d?"/img/logo-dark.png":"/img/logo.png";redraw.forEach(f=>f());}
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
function fetchRaw(url){url=/^(\/|[a-z][a-z0-9+.-]*:)/i.test(url)?url:"/"+url;let p=rawCache.get(url);if(!p){p=fetch(url,{cache:"no-cache"}).then(async r=>({ok:r.ok,status:r.status,text:r.ok?await r.text():""}));rawCache.set(url,p);}return p;}
async function load(path){const r=await fetchRaw(path);if(!r.ok)throw new Error("Could not load "+path+" ("+r.status+")");return parseCSV(r.text);}
function showErr(m){const e=$("#error");e.hidden=false;e.textContent=m;const o=$("#tab-overview");if(o)o.classList.remove("loading");}


let cfg;
try{
  const r=await fetch("/config.json");
  if(!r.ok)throw new Error("HTTP "+r.status);
  cfg=await r.json();
}catch(e){showErr("config.json could not be loaded ("+e.message+"). Serve the site over http(s) \u2014 opening index.html as a local file will not work \u2014 and make sure config.json sits next to index.html.");return;}
[cfg.pollsCsv,cfg.approvalCsv,"data/chancellor_approval.csv",cfg.negativeCsv,...(cfg.pollTabs||[]).map(t=>t.csv),cfg.statesMap,"data/election2025.json","data/constituencies.json","data/wahlkreise.geojson",cfg.politiciansJson||"data/politicians_approval.json",
  ...Object.values(cfg.stateFiles||{}).map(slug=>`${cfg.stateFolder}/${slug}.csv`)].forEach(u=>{if(u)fetchRaw(u).catch(()=>{});});
document.title=cfg.siteTitle;$("#site-title").textContent=cfg.siteTitle;
// faction keys look like "F:<id>" so they can stand in for a party key anywhere a party key is used
let FAC=[];
const isFac=p=>typeof p==="string"&&p.startsWith("F:");
const facById=id=>FAC.find(f=>f.id===id);
const lab=p=>{if(isFac(p)){const f=facById(p.slice(2));return f?f.name:p;}return (cfg.labels||{})[p]||p;};
const FALLBACK=["#1C4E9C","#C62828","#2E7D32","#F9A825","#6A1B9A","#00838F","#8D6E63","#546E7A"];
const colorOf=(p,i=0)=>isFac(p)?((facById(p.slice(2))||{}).color||"#888888"):(p==="SSW"?"#003C8F":cfg.colors[p])||cfg.colors[p==="Union"?"CDU/CSU":p]||FALLBACK[i%FALLBACK.length];
const lum=c=>{const n=parseInt(c.slice(1),16);return((n>>16)&255)*.299+((n>>8)&255)*.587+(n&255)*.114;};
const dark=c=>c!=="#003C8F"&&/^#[0-9a-f]{6}$/i.test(c)&&lum(c)<60;
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

// ---------- URLs ----------
// /  (overview), /polls, /parliament, /constituencies, /election, /state/<ID>;  view settings follow as a query string, e.g. /polls?range=1y&pst=INSA
// (the old hash links, e.g. /#polls?range=1y or /#state-BY, are still understood and get rewritten to the new form)
const tabPath=b=>b==="overview"?"/":/^state-/.test(b)?"/state/"+b.slice(6):"/"+b;
function parseLoc(){ // current address -> {base: "polls" | "state-BY" | ..., q: query string without "?"}
  const hs=location.hash.replace(/^#/,""),p=location.pathname.replace(/\/(index|404)\.html$/,"").replace(/\/+$/,"");
  let base,q;
  if(hs&&p===""){const i=hs.indexOf("?");base=i<0?hs:hs.slice(0,i);q=i<0?"":hs.slice(i+1);}
  else{const m=/^\/state\/(\w+)$/.exec(p);base=m?"state-"+m[1].toUpperCase():p.replace(/^\//,"");q=location.search.replace(/^\?/,"");}
  return{base:base||"overview",q};
}

// ---------- tabs ----------
function goTab(t,target){
  const b=document.querySelector(`.tab-btn[data-tab="${t}"]`);if(!b)return;
  track("/"+t,b.textContent.trim());
  document.querySelectorAll(".tab-btn").forEach(x=>x.classList.toggle("active",x.dataset.tab===t));
  document.querySelectorAll(".pane").forEach(p=>p.classList.toggle("active",p.id==="tab-"+t));
  history.replaceState(null,"",tabPath(t));scrollTo(0,0);
  if(typeof fitOv==="function")fitOv();
  if(target)requestAnimationFrame(()=>{const e=document.getElementById(target);if(e)e.scrollIntoView();});
}
document.querySelectorAll(".tab-btn").forEach(b=>b.onclick=()=>{goTab(b.dataset.tab);if(typeof sideSet==="function")sideSet(false);});
// ---------- sidebar menu: show / hide ----------
function sideSet(open){
  const sb=document.getElementById("sidebar"),sc=document.getElementById("side-scrim"),tg=document.getElementById("side-toggle");
  if(!sb)return;
  sb.classList.toggle("open",open);sb.setAttribute("aria-hidden",String(!open));
  if(tg){tg.setAttribute("aria-expanded",String(open));tg.setAttribute("aria-label",open?"Hide menu":"Show menu");}
  if(sc){if(open){sc.hidden=false;requestAnimationFrame(()=>sc.classList.add("open"));}else{sc.classList.remove("open");setTimeout(()=>{if(!sb.classList.contains("open"))sc.hidden=true;},200);}}
}
{const tg=document.getElementById("side-toggle"),cl=document.getElementById("side-close"),sc=document.getElementById("side-scrim");
  if(tg)tg.onclick=()=>sideSet(!document.getElementById("sidebar").classList.contains("open"));
  if(cl)cl.onclick=()=>sideSet(false);
  if(sc)sc.onclick=()=>sideSet(false);
  addEventListener("keydown",e=>{if(e.key==="Escape")sideSet(false);});
  try{matchMedia("(min-width:601px)").addEventListener("change",e=>{if(e.matches)sideSet(false);});}catch(e){}}
document.querySelectorAll("[data-go]").forEach(b=>{b.onclick=e=>{e.stopPropagation();goTab(b.dataset.go,b.dataset.scroll);};if(b.classList.contains("clickable"))b.onkeydown=e=>{if(e.target!==b)return;if(e.key==="Enter"||e.key===" "){e.preventDefault();goTab(b.dataset.go,b.dataset.scroll);}};});
const LOC0=parseLoc(); // the link the page was opened with: tab / state plus view settings (applied once everything has loaded, see HS.apply)
if(LOC0.base!=="overview")goTab(LOC0.base);

// ---------- shareable links: the address mirrors exactly what is on screen ----------
// Format:  /<tab>  or  /state/<ID>,  then  ?key=value&key=value  (only settings that differ from the defaults), e.g.  /polls?range=1y&pst=INSA
// Every view registers its settings with HS.reg(tab, key, get, set): get() returns the encoded value (null = default), set(raw) applies a value (raw = null: back to default).
const HS=(()=>{
  const regs=[];let applying=false,ready=false;
  const enc=s=>encodeURIComponent(s).replace(/[!'()*.~]/g,c=>"%"+c.charCodeAt(0).toString(16).toUpperCase()).replace(/%2F/gi,"/").replace(/%3A/gi,":");
  const dec=s=>{try{return decodeURIComponent(s);}catch(e){return s;}};
  const list=a=>a.map(enc).join(","),items=s=>s?s.split(",").map(dec).filter(Boolean):[];
  const reg=(tabs,key,get,set)=>[].concat(tabs).forEach(t=>regs.push({tab:t,key,get,set}));
  function viewNow(){const p=document.querySelector(".pane.active");if(!p)return null;const t=p.id.replace(/^tab-/,"");
    return t==="state"?(curState?{tab:"state",base:"state-"+curState}:null):{tab:t,base:t};}
  function write(){ // called after every click / change / input: rewrite the address (no new history entry)
    if(!ready||applying)return;
    try{
      const v=viewNow();if(!v)return;
      const ps=[];regs.forEach(r=>{if(r.tab!==v.tab)return;const x=r.get();if(x!=null&&x!=="")ps.push(r.key+"="+x);});
      const u=tabPath(v.base)+(ps.length?"?"+ps.join("&"):"");
      if(u===location.pathname+location.search&&!location.hash)return;
      history.replaceState(null,"",u);
    }catch(e){}
  }
  async function apply(loc,initial){
    const base=loc.base,map={};
    (loc.q||"").split("&").forEach(kv=>{const i=kv.indexOf("=");if(i>0)map[kv.slice(0,i)]=kv.slice(i+1);});
    const sm=/^state-(\w+)$/.exec(base);let tab=base;
    applying=true;
    try{
      if(sm){
        if(!stateData[sm[1]])return;tab="state";
        if(initial||curState!==sm[1]||!document.getElementById("tab-state").classList.contains("active"))await openState(sm[1]);
      }else if(document.querySelector(`.tab-btn[data-tab="${base}"]`)){
        if(!initial&&!document.getElementById("tab-"+base).classList.contains("active"))goTab(base);
      }else return;
      for(const r of regs){
        if(r.tab!==tab)continue;
        try{
          if(map[r.key]!=null)await r.set(map[r.key]);
          else if(!initial&&r.get()!=null)await r.set(null); // a link without this setting: back to the default
        }catch(e){console.error("link setting "+r.key+":",e);}
      }
    }finally{applying=false;ready=true;write();}
  }
  ["click","change","input"].forEach(t=>document.addEventListener(t,()=>setTimeout(write,0),true));
  addEventListener("popstate",()=>{if(ready)apply(parseLoc(),false);});
  // "Copy link" button in the top bar
  const sb=document.getElementById("share-btn");
  if(sb){
    const lbl=sb.querySelector("span"),t0=lbl?lbl.textContent:"";let to=0;
    const done=ok=>{if(!lbl)return;lbl.textContent=ok?"Link copied":"Copy failed";sb.classList.toggle("ok",ok);clearTimeout(to);to=setTimeout(()=>{lbl.textContent=t0;sb.classList.remove("ok");},1800);};
    sb.onclick=async()=>{
      write();const url=location.href;
      if(navigator.share&&matchMedia("(pointer:coarse)").matches){try{await navigator.share({title:document.title,url});return;}catch(e){if(e&&e.name==="AbortError")return;}}
      try{await navigator.clipboard.writeText(url);done(true);}
      catch(e){try{const ta=document.createElement("textarea");ta.value=url;ta.setAttribute("readonly","");ta.style.cssText="position:fixed;top:0;opacity:0";document.body.appendChild(ta);ta.select();const ok=document.execCommand("copy");ta.remove();done(ok);}catch(_){done(false);}}
    };
  }
  return{reg,apply,write,enc,dec,list,items};
})();
try{if(LOC0.base==="overview"||(!document.querySelector(`.tab-btn[data-tab="${LOC0.base}"]`)&&!/^state-/.test(LOC0.base)))track("/overview","Overview");}catch(e){track("/overview","Overview");}

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
function showTip(ev,html,big){
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
    body+=`<div class="tf"><b style="color:${tipCol(lead[0].c)}">${strip(lead[0].k)}</b> ${d<.05?"is level with":"leads"} ${big?`<b style="color:${tipCol(lead[1].c)}">${strip(lead[1].k)}</b>`:strip(lead[1].k)}${d<.05?"":` by <b>${fmt(d)}</b> pts`}</div>`;
  }
  tip.hidden=false;tip.classList.toggle("big",!!big);
  tip.style.setProperty("--tc",hc);
  tip.innerHTML=`<div class="th"><span>${head}</span>${hv?`<b class="thv">${hv}</b>`:""}</div>${body?`<div class="tbody">${body}</div>`:""}`;
  const w=tip.offsetWidth,h=tip.offsetHeight;
  let x=ev.clientX+16,y=ev.clientY+16;
  if(ev._touch){ // finger: centre the card above the touch point (the hand covers what is below it), fall back to below
    x=Math.min(Math.max(8,ev.clientX-w/2),innerWidth-w-8);y=ev.clientY-h-26;if(y<8)y=Math.min(ev.clientY+30,innerHeight-h-8);
  }else{
    if(x+w>innerWidth-8)x=ev.clientX-w-16;if(x<8)x=8;
    if(y+h>innerHeight-8)y=Math.max(8,ev.clientY-h-16);
  }
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
  const W=CW(),H=o.H||720,PR=o.padR||120,X0=46,X1=W-(W<1000?PR+32:PR),Y0=o.y0||186,Y1=H-100,GAP=(o.gapDays||60)*DAY,VF=o.vf||(v=>fmt(v)+"%"),DF=o.df||dlt,TD=c=>o.tipDots?`<span style="color:${c}">\u25CF</span> `:"";
  const svg=frame(host,{...o,W}),F=n=>W<1000?Math.round(n*1.25*10)/10:n;
  const selBg=el("rect",{y:Y0,height:Y1-Y0,fill:selFill(svg),visibility:"hidden"},svg);
  const all=o.series.flatMap(s=>s.points.map(p=>p.t));
  const t0=o.t0!=null?o.t0:Math.min(...all),t1=o.t1!=null?o.t1:Math.max(...all),span=Math.max(1,t1-t0);
  const x=t=>X0+(t-t0)/span*(X1-X0),y=v=>Y1-(v-o.yMin)/(o.yMax-o.yMin)*(Y1-Y0);
  if(o.threshold){const yt=y(o.threshold);
    el("rect",{class:"band",x:X0,y:yt,width:X1-X0,height:Y1-yt},svg);
    el("line",{class:"gl",x1:X0,y1:yt,x2:X1,y2:yt,"stroke-width":1},svg);}
  for(let v=o.yMin;v<=o.yMax+.001;v+=o.step){
    el("line",{class:"gl",x1:X0,y1:y(v),x2:X1,y2:y(v),"stroke-width":1},svg);
    if(v>0||o.signed)el("text",{class:"mut",x:X0-10,y:y(v)+4,"text-anchor":"end","font-size":F(12)},svg,o.yFmt?o.yFmt(v):fmt(v,0)+"%");
  }
  if(o.half&&50>o.yMin&&50<o.yMax)el("line",{class:"dash",x1:X0,y1:y(50),x2:X1,y2:y(50),"stroke-width":1.4},svg);
  if(o.refLine!=null&&o.refLine>o.yMin&&o.refLine<o.yMax)el("line",{class:"dash",x1:X0,y1:y(o.refLine),x2:X1,y2:y(o.refLine),"stroke-width":1.4},svg);
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
  }else(o.dots||[]).forEach(d=>el("circle",d.est?{class:dark(d.color)?"dk":"",cx:x(d.t).toFixed(2),cy:y(d.v).toFixed(2),r:3.4,fill:"none",stroke:d.color,"stroke-width":1.6,opacity:.85}:{class:dark(d.color)?"dk":"",cx:x(d.t).toFixed(2),cy:y(d.v).toFixed(2),r:o.dotR||2.1,fill:d.color,opacity:o.dotOp||.2},svg));
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
    if(d&&s.estUntil!=null){ // stretches that start at an estimated value are dashed
      let ds="",dd="",cur=null;const pts=s.points.filter(p=>p.v!=null);
      pts.forEach((p,i)=>{if(i===0)return;const a=pts[i-1],kind=a.t<=s.estUntil?"e":"s",seg=`${x(a.t).toFixed(2)} ${y(a.v).toFixed(2)}L${x(p.t).toFixed(2)} ${y(p.v).toFixed(2)}`;
        const prev=pts[i-2],cont=cur===kind&&i>1;
        const add=cont?`L${x(p.t).toFixed(2)} ${y(p.v).toFixed(2)} `:`M${seg} `;
        if(kind==="e")dd+=add;else ds+=add;cur=kind;});
      const k=dark(s.color)?"dk":"",a={class:k,fill:"none",stroke:s.color,"stroke-width":2.6,"stroke-linejoin":"round","stroke-linecap":"round"};
      if(dd)el("path",{...a,d:dd.trim(),"stroke-dasharray":"2,6"},svg);
      if(ds)el("path",{...a,d:ds.trim()},svg);
    }else if(d&&!o.noLine)el("path",{class:dark(s.color)?"dk":"",d:d.trim(),fill:"none",stroke:s.color,"stroke-width":2.6,"stroke-linejoin":"round","stroke-linecap":"round"},svg);
    if(last&&(o.endWithin==null||last.t>=t1-o.endWithin*DAY))ends.push({s,v:last.v,y:y(last.v),ty:y(last.v),ex:x(last.t)});
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
  const EG=o.endGap||22;for(let i=1;i<ends.length;i++)if(ends[i].y-ends[i-1].y<EG)ends[i].y=ends[i-1].y+EG;
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
  (o.results||[]).forEach(r=>{if(r.t!=null&&(r.t<t0||r.t>t1))return;el("circle",{class:dark(r.color)?"dkr":"",cx:x(r.t!=null?r.t:t1).toFixed(2),cy:y(r.v).toFixed(2),r:6.5,fill:"none",stroke:r.color,"stroke-width":3},svg);});
  const band=el("rect",{y:Y0,width:16,height:Y1-Y0,style:"fill:var(--cink);opacity:.08",visibility:"hidden"},svg);
  const cross=el("line",{y1:Y0,y2:Y1,style:"stroke:var(--cink);opacity:.75","stroke-width":2,visibility:"hidden"},svg);
  const hdots=o.series.map(s=>el("circle",{r:6,fill:s.color,style:"stroke:var(--cbg)","stroke-width":3,visibility:"hidden"},svg));
  // drag-to-compare: hold left-click and drag to compare the values at two dates
  const veil=[0,1].map(()=>el("rect",{y:Y0,height:Y1-Y0,style:"fill:var(--cbg);opacity:.5",visibility:"hidden"},svg));
  const selL=[0,1].map(()=>el("line",{y1:Y0,y2:Y1,style:"stroke:var(--cink);opacity:.4","stroke-width":1.5,visibility:"hidden"},svg));
  const selT=[0,1].map(()=>el("text",{class:"ink",y:Y0-10,"font-size":13,"font-weight":700,visibility:"hidden"},svg));
  const selD=o.series.map(s=>[0,1].map(()=>el("circle",{r:6,fill:s.color,style:"stroke:var(--cbg)","stroke-width":3,visibility:"hidden"},svg)));
  function nearV(s,t){let b=null;s.points.forEach(p=>{if(p.v!=null&&(!b||Math.abs(p.t-t)<Math.abs(b.t-t)))b=p;});return b&&Math.abs(b.t-t)<GAP?b.v:null;}
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
      if(v[0]!=null&&v[1]!=null)rows.push({n:s.name,a:v[0],b:v[1],c:s.color});});
    rows.sort((m,n)=>n.b-m.b);
    showTip(e,`<b>${fmtDate(ta)} \u2192 ${fmtDate(tb)}</b><br>`+rows.map(r=>`${TD(r.c)}${r.n}: ${VF(r.a)} \u2192 ${VF(r.b)} (${DF(r.b-r.a)})`).join("<br>")+[lo[1],hi[1]].filter(Boolean).map(ev=>`<br>\u25B8 ${ev.label}`).join(""));
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
    o.series.forEach((s,i)=>{let b=null;s.points.forEach(p=>{if(p.v!=null&&(!b||Math.abs(p.t-t)<Math.abs(b.t-t)))b=p;});const d=hdots[i];if(b&&Math.abs(b.t-t)<GAP){d.setAttribute("cx",px);d.setAttribute("cy",y(b.v));d.setAttribute("visibility","visible");}else d.setAttribute("visibility","hidden");});
    const rows=o.series.map(s=>{let b=null;s.points.forEach(p=>{if(p.v!=null&&(!b||Math.abs(p.t-t)<Math.abs(b.t-t)))b=p;});return b&&Math.abs(b.t-t)<GAP?{n:s.name,v:b.v,c:s.color}:null;}).filter(Boolean).sort((a,b)=>b.v-a.v);
    const er=hv?(o.results||[]).filter(r=>r.t===hv.t&&r.name&&r.pre!=null).sort((a,b)=>b.v-a.v):[];
    if(er.length){const n=Math.max(...er.map(r=>r.preN));
      showTip(e,`<b>${fmtDate(t)}</b> \u00B7 ${hv.label}<br>${hv.desc}<br><br><b>Final polls vs. actual result</b><br>`+er.map(r=>`${r.name}: ${fmt(r.pre)}% \u2192 <b>${fmt(r.v)}%</b> (${dlt(r.v-r.pre)})`).join("<br>")+`<br><span style="opacity:.7">Poll = average of the ${n} poll${n>1?"s":""} in the 30 days before the election \u00B7 plus = polls underestimated</span>`);
      return;}
    showTip(e,`<b>${fmtDate(t)}</b><br>`+rows.map(r=>`${TD(r.c)}${r.n}: ${VF(r.v)}`).join("<br>")+(hv?`<br>\u25B8 ${hv.label}<br>${hv.desc}`:""));
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

function pollTableHtml(recs,plist,pick,srt,limit=15){ // srt (optional) = {k:"t"|"inst"|party, d:1|-1}: makes the column headers click-to-sort (only the latest 15 polls shown are sorted)
  let recent=recs.slice(-limit).reverse();const cand=plist.filter(p=>!isOther(p));
  if(srt&&srt.k){const g=r=>srt.k==="t"?r.t:srt.k==="inst"?(r.inst||"").toLowerCase():(r.v[srt.k]==null?-Infinity:r.v[srt.k]);
    recent=recent.map((r,i)=>[r,i]).sort((a,b)=>{const x=g(a[0]),y=g(b[0]);return(x<y?-1:x>y?1:0)*srt.d||a[1]-b[1];}).map(o=>o[0]);}
  const th=(k,html,style,cls)=>srt?`<th class="srt ${cls||""}" data-sort="${escF(k)}" tabindex="0" role="button" aria-sort="${srt.k===k?(srt.d>0?"ascending":"descending"):"none"}" title="Sort by this column"${style?` style="${style}"`:""}>${html}<i class="srta">${srt.k===k?(srt.d>0?"\u25B2":"\u25BC"):""}</i></th>`:`<th${cls?` class="${cls}"`:""}${style?` style="${style}"`:""}>${html}</th>`;
  return `<table><thead><tr>${th("t","Date")}${th("inst","Pollster")}${plist.map(p=>th(p,lab(p),`border-bottom-color:${colorOf(p,parties.indexOf(p))}`,dark(colorOf(p))?"dk":"")).join("")}</tr></thead><tbody>`+
    recent.map(r=>{const top=Math.max(...cand.map(p=>r.v[p]??-1));
      const nm=r.inst||r.i||"";return `<tr${pick!==undefined&&nm&&pick===nm?' class="pst-on"':""}><td>${fmtDate(r.t)}</td>${pick!==undefined&&nm?`<td class="pst${pick===nm?" on":""}" data-pst="${escF(nm)}" tabindex="0" role="button" aria-pressed="${pick===nm}" title="Show only polls by ${escF(nm)}">${escF(nm)}</td>`:`<td>${nm}</td>`}${plist.map(p=>`<td class="${r.v[p]===top&&!isOther(p)?"lead":""}">${r.v[p]!=null?fmt(r.v[p])+"%":"\u2013"}</td>`).join("")}</tr>`;}).join("")+`</tbody></table>`;
}
// ---------- POLLS TAB ----------
let tMin=0,tMax=0,BW=cfg.smoothingDays||30;
const active=new Set(parties);
const RANGES=[["6m","6 months",6],["1y","1 year",12],["2y","2 years",24],["5y","5 years",60],["10y","10 years",120],["all","All time",0]];
let pollRange="all",pollsterSel=null; // pollsterSel: show only this pollster in the poll chart (null = all)
const yrOf=r=>/^y\d{4}$/.test(r)?+r.slice(1):null; // pollRange "y2019" = one calendar year (dropdown)
function rangeEnd(){const y=yrOf(pollRange);return y==null?tMax:Math.min(tMax,Date.UTC(y,11,31,23,59,59));}
function rangeStart(){const y=yrOf(pollRange);if(y!=null)return Math.max(tMin,Date.UTC(y,0,1));if(pollRange==="all")return tMin;const m=RANGES.find(r=>r[0]===pollRange)[2],d=new Date(tMax);d.setUTCMonth(d.getUTCMonth()-m);return Math.max(tMin,+d);}
const smoothCache=new Map(),viewCache=new Map();
function smoothedPoints(p,ts,N,src=polls,tag=""){const te=rangeEnd(),k=pollRange+"|"+tag+p;let pts=smoothCache.get(k);if(!pts){pts=Array.from({length:N+1},(_,i)=>{const t=ts+(te-ts)*i/N;return{t,v:smoothedValueAt(src,p,t,BW)};});smoothCache.set(k,pts);}return pts;}

// ---------- factions (poll average + Bundestag projection; off by default, editable in the Polls tab) ----------
const escF=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const facKey=id=>"F:"+id;
const facOfParty=p=>FAC.find(f=>f.members.includes(p))||null;
let faOn={poll:false,parl:false},facVer=0,activeF=new Set(),vpCache=null,vpVer=-1,PM=null,baseM=null;
let selPoll=null; // index into polls of the poll shown in the Bundestag projection (null = current poll average)
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
  if(selPoll!=null&&baseM){
    // one specific poll: seats are worked out from that poll's own figures (same method as the average)
    const src=faOn.parl?viewPolls():polls,rec=src[selPoll],ord=[...(faOn.parl?unitsOf():parties),"SSW"].sort((a,b)=>spec(a)-spec(b)),pc={},st={};
    ord.forEach(p=>pc[p]=p!=="SSW"&&rec.v[p]!=null?rec.v[p]:null);
    const el_=ord.filter(p=>pc[p]!=null&&pc[p]>=thr&&!isOther(p));
    const sl_=sainteLague(Object.fromEntries(el_.map(p=>[p,pc[p]])),N-1); // 1 seat is reserved for SSW (minority exemption)
    ord.forEach(p=>st[p]=p==="SSW"?1:(sl_[p]||0));
    PM={order:ord,pct:pc,seats:st,elig:el_};return;
  }
  if(!faOn.parl||!baseM){PM=baseM;return;}
  const src=viewPolls(),order=[...unitsOf(),"SSW"].sort((a,b)=>spec(a)-spec(b)),pct={},seats={};
  order.forEach(p=>pct[p]=p==="SSW"?null:smoothedValueAt(src,p,tMax,BW));
  const elig=order.filter(p=>pct[p]!=null&&pct[p]>=thr&&!isOther(p));
  const sl=sainteLague(Object.fromEntries(elig.map(p=>[p,pct[p]])),N-1);
  order.forEach(p=>seats[p]=p==="SSW"?1:(sl[p]||0));
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
// shareable link: the custom coalition groups ("Group by coalitions") travel in the link as  fac=<flags>;<id>.<name>.<colour>.<members>;...  (flags: p = poll chart, l = Bundestag projection).
// A link never overwrites the visitor's own saved groups; they are only saved once the visitor edits them.
if(polls.length)HS.reg(["polls","parliament"],"fac",
  ()=>(faOn.poll||faOn.parl)?(faOn.poll?"p":"")+(faOn.parl?"l":"")+";"+FAC.map(f=>[f.id,HS.enc(f.name),f.color.slice(1),f.members.map(HS.enc).join(",")].join(".")).join(";"):null,
  v=>{
    if(v==null){faOn={poll:false,parl:false};loadFac();}
    else{
      const parts=v.split(";"),fl=parts.shift()||"",seen=new Set(),fs=[];
      parts.slice(0,8).forEach(g=>{
        const a=g.split(".");if(a.length<4||!/^[A-Za-z0-9]{1,16}$/.test(a[0]))return;
        const mem=HS.items(a[3]).filter(p=>{if(!parties.includes(p)||seen.has(p))return false;seen.add(p);return true;});
        fs.push({id:a[0],name:HS.dec(a[1]).trim().slice(0,40)||"Faction",color:/^[0-9a-fA-F]{6}$/.test(a[2])?"#"+a[2]:"#888888",members:mem});
      });
      if(!fs.length)return;
      FAC=fs;faOn={poll:fl.includes("p"),parl:fl.includes("l")};
    }
    facVer++;vpVer=-1;activeF=new Set(unitsOf());sel.clear();
    renderFacEditor();syncFacUI();buildPM();drawParl();renderCoalitions();drawPolls();renderChips();
  });

// one pollster's own polls as a series: joined by a continuous line, broken where that pollster has a long gap
function rawPoints(src,p,ts){const te=rangeEnd();
  const out=[];let prev=null;
  src.forEach(r=>{if(r.t<ts||r.t>te||r.v[p]==null)return;
    if(prev!=null&&r.t-prev>120*DAY)out.push({t:(r.t+prev)/2,v:null});
    out.push({t:r.t,v:r.v[p]});prev=r.t;});
  return out;
}
function drawPolls(){
  const N=220,host=$("#poll-chart"),ts=rangeStart(),te=rangeEnd(),yrSel=yrOf(pollRange)!=null,fm=faOn.poll;
  const src0=fm?viewPolls():polls,src=pollsterSel?src0.filter(r=>r.inst===pollsterSel):src0,tag=(fm?"F"+facVer+"|":"")+(pollsterSel?"P:"+pollsterSel+"|":"");
  const units=fm?unitsOf():parties,vset=fm?activeF:active;
  const vis=units.filter(p=>vset.has(p));
  const viewKey=tag+pollRange+"|"+vis.join(",")+"|"+(isDarkMode()?"d":"l")+"|"+CW(),cachedView=viewCache.get(viewKey);
  if(cachedView){viewCache.delete(viewKey);viewCache.set(viewKey,cachedView);host.replaceChildren(...cachedView);return;}
  const series=vis.map(p=>({name:lab(p),color:colorOf(p,parties.indexOf(p)),points:pollsterSel?rawPoints(src,p,ts):smoothedPoints(p,ts,N,src,tag)}));
  const dots=[];vis.forEach(p=>src.forEach(r=>{if(r.t>=ts&&r.t<=te&&r.v[p]!=null)dots.push({t:r.t,v:r.v[p],color:colorOf(p,parties.indexOf(p))});}));
  // actual federal election results (rings), with the final polls for comparison in the tooltip - same as on the state charts
  const preAvg=(p,t)=>{let w=src.filter(q=>q.t<t&&q.t>=t-30*DAY&&q.v[p]!=null);if(!w.length)w=src.filter(q=>q.t<t&&q.v[p]!=null).slice(-3);return w.length?{v:w.reduce((a,q)=>a+q.v[p],0)/w.length,n:w.length}:null;};
  const results=[];if(FED&&!fm)Object.entries(FED).forEach(([dt,r])=>{const t=Date.parse(dt+"T00:00:00Z");if(isNaN(t)||t<ts||t>te)return;
    vis.forEach(p=>{if(r[p]==null)return;const pa=preAvg(p,t);if(pa)results.push({t,v:r[p],name:lab(p),pre:pa.v,preN:pa.n,color:colorOf(p,parties.indexOf(p))});});});
  const mx=Math.max(0,...dots.map(d=>d.v),...results.map(r=>r.v)),yMax=Math.ceil(Math.max(10,mx*1.12)/5)*5;
  let step=1;[1,2,5,10,20,25,50,100].forEach(s=>{if(s<=yMax/6*1.4)step=s;});
  lineChart(host,{H:720,rasterDots:true,t0:pollsterSel||yrSel?ts:undefined,t1:pollsterSel||yrSel?te:undefined,events:true,months:pollRange==="6m"||pollRange==="1y"||yrSel?[1,2,3,4,5,6,7,8,9,10,11]:pollRange==="2y"||undefined,title:cfg.pollHeadline,sub:cfg.pollSubline+(pollsterSel?" \u00B7 only "+pollsterSel:"")+(results.length?" \u00B7 rings = actual federal election results":""),source:"Source: "+cfg.sourceName,series,dots,results,yMin:0,yMax,step,threshold:cfg.threshold,endLabel:(v,n)=>`${fmt(v)} % ${n}`});
  viewCache.set(viewKey,Array.from(host.childNodes));if(viewCache.size>14)viewCache.delete(viewCache.keys().next().value);
}
function renderChips(){
  $("#party-filters").innerHTML=(faOn.poll?unitsOf():parties).map(p=>{const c=colorOf(p,parties.indexOf(p)),on=(faOn.poll?activeF:active).has(p);return`<button type="button" class="faction-chip pc${dark(c)?" dkb":""} ${on?"on":""}" data-p="${p}" style="border-color:${c};${on?`background:${c};color:${contrast(c)}`:""}">${lab(p)}</button>`;}).join("")
;
  const yy=yrOf(pollRange),y0=new Date(tMin).getUTCFullYear(),y1=new Date(tMax).getUTCFullYear();
  $("#range-filters").innerHTML=RANGES.map(r=>`<button type="button" class="faction-chip ${pollRange===r[0]?"on":""}" data-r="${r[0]}">${r[1]}</button>`).join("")
;
}
let FED=null;try{const r=await fetchRaw("data/federal_results.json");if(r.ok)FED=JSON.parse(r.text);}catch(e){} // final federal election results (rings + tooltips in the poll chart)
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

  let pollSort=null; // sort of the "Latest polls" table (the chart is not affected)
  let tblYear="",tblShown=15;const TBL_FIRST=15,TBL_STEP=25; // "Latest polls" table only: year filter + "See more" (the chart is not affected)
  const renderPollTable=()=>{
    const pool=tblYear===""?polls:polls.filter(r=>new Date(r.t).getUTCFullYear()===+tblYear),yrs=[...new Set(polls.map(r=>new Date(r.t).getUTCFullYear()))].sort((a,b)=>b-a);
    $("#poll-table").innerHTML=pollTableHtml(pool,parties,pollsterSel,pollSort||{k:null,d:-1},tblShown);
    const bar=$("#poll-tbl-bar");if(bar&&!bar.dataset.k){bar.dataset.k="1";bar.innerHTML=`<select class="yr-sel" id="poll-tbl-year" aria-label="Show polls of one year"><option value="">All years</option>${yrs.map(y=>`<option value="${y}">${y}</option>`).join("")}</select>`;}
    const ys=$("#poll-tbl-year");if(ys){ys.value=tblYear;ys.classList.toggle("on",tblYear!=="");}
    const left=pool.length-tblShown,mo=$("#poll-more");
    if(mo)mo.innerHTML=(left>0?`<button type="button" class="faction-chip" data-a="more">See more${left>TBL_STEP?"":" ("+left+")"}</button>`:"")+(tblShown>TBL_FIRST?`<button type="button" class="faction-chip" data-a="hide">Hide</button>`:"");
  };
  const sortPollTable=k=>{pollSort=pollSort&&pollSort.k===k?{k,d:-pollSort.d}:{k,d:k==="inst"?1:-1};renderPollTable();const h=$(`#poll-table th[data-sort="${k}"]`);if(h)h.focus();};
  const pollPick=(nm,scroll)=>{
    pollsterSel=nm&&nm!==pollsterSel?nm:null;
    renderPollTable();
    const bar=$("#poll-pf");
    if(bar){bar.hidden=!pollsterSel;bar.innerHTML=pollsterSel?`<span>Showing only polls by <b>${escF(pollsterSel)}</b></span><button type="button" class="link" data-clear="1">Show all pollsters &times;</button>`:"";}
    drawPolls();
    if(pollsterSel&&scroll&&bar)bar.scrollIntoView({block:"start",behavior:"smooth"});
  };
  renderPollTable();
  {const ys=$("#poll-tbl-bar");if(ys)ys.addEventListener("change",e=>{if(e.target.id!=="poll-tbl-year")return;tblYear=e.target.value;tblShown=TBL_FIRST;renderPollTable();});
   const mo=$("#poll-more");if(mo)mo.addEventListener("click",e=>{const b=e.target.closest("button[data-a]");if(!b)return;tblShown=b.dataset.a==="more"?tblShown+TBL_STEP:TBL_FIRST;renderPollTable();});}
  $("#poll-table").addEventListener("click",e=>{const h=e.target.closest("th[data-sort]");if(h){sortPollTable(h.dataset.sort);return;}const c=e.target.closest("[data-pst]");if(c)pollPick(c.dataset.pst,true);});
  $("#poll-table").addEventListener("keydown",e=>{if(e.key!=="Enter"&&e.key!==" ")return;const h=e.target.closest("th[data-sort]");if(h){e.preventDefault();sortPollTable(h.dataset.sort);return;}const c=e.target.closest("[data-pst]");if(c){e.preventDefault();pollPick(c.dataset.pst,true);}});
  {const bar=$("#poll-pf");if(bar)bar.addEventListener("click",e=>{if(e.target.closest("[data-clear]"))pollPick(null,false);});}
  // shareable link settings of the Polls tab
  HS.reg("polls","range",()=>pollRange!=="all"?pollRange:null,v=>{pollRange=RANGES.some(r=>r[0]===v)||(yrOf(v)!=null&&yrOf(v)>=new Date(tMin).getUTCFullYear()&&yrOf(v)<=new Date(tMax).getUTCFullYear())?v:"all";drawPolls();renderChips();});
  HS.reg("polls","pst",()=>pollsterSel?HS.enc(pollsterSel):null,v=>{
    const nm=v?HS.dec(v):null;if(nm===pollsterSel)return;if(nm&&!polls.some(r=>r.inst===nm))return;
    pollsterSel=null;pollPick(nm,false);});
  HS.reg("polls","hide",()=>!faOn.poll&&active.size<parties.length?HS.list(parties.filter(p=>!active.has(p))):null,v=>{
    const hid=HS.items(v),vis=parties.filter(p=>!hid.includes(p));active.clear();(vis.length?vis:parties).forEach(p=>active.add(p));drawPolls();renderChips();});
}

// ---------- BUNDESTAG ----------
const thr=cfg.threshold,N=cfg.seats,maj=Math.floor(N/2)+1;
const order=[...parties,"SSW"].sort((a,b)=>spec(a)-spec(b)),pct={},sel=new Set();
let seats={},elig=[];
if(polls.length){
  order.forEach(p=>pct[p]=p==="SSW"?null:smoothedValueAt(polls,p,tMax,BW));
  elig=order.filter(p=>pct[p]!=null&&pct[p]>=thr&&!isOther(p));
  const sl=sainteLague(Object.fromEntries(elig.map(p=>[p,pct[p]])),N-1); // 1 seat is reserved for SSW (minority exemption)
  order.forEach(p=>seats[p]=p==="SSW"?1:(sl[p]||0));
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
    if(p){c.addEventListener("mousemove",e=>showTip(e,p==="SSW"?`<b>SSW</b>: 1 seat (exempt from the 5% threshold as a minority party)`:`<b>${lab(p)}</b>: ${PM.seats[p]} seats (${fmt(PM.pct[p])}%)`));c.addEventListener("mouseleave",hideTip);}
  });
  const bp=L.rowsData.map(row=>{const m=row.items.length;let s=0;while(s<m&&row.items[s].gi<maj)s++;
    const a=s<=0?180:s>=m?0:(row.items[s-1].angle+row.items[s].angle)/2;return pt(o.cx,o.cy,row.r,a);});
  const ang=([px,py])=>Math.atan2(o.cy-py,px-o.cx)*180/Math.PI;
  const full=[pt(o.cx,o.cy,o.rIn-14,ang(bp[0])),...bp,pt(o.cx,o.cy,o.rOut+14,ang(bp[bp.length-1]))].map(([a,b])=>`${a.toFixed(2)},${b.toFixed(2)}`).join(" ");
  el("polyline",{class:"halo",points:full,fill:"none","stroke-width":5.5,"stroke-linejoin":"round","stroke-linecap":"round",opacity:.9},svg);
  el("polyline",{class:"zl",points:full,fill:"none","stroke-width":2.6,"stroke-dasharray":"5,4","stroke-linecap":"round"},svg);
  const MB=!!o.M;
  el("text",{class:"ink",x:o.cx,y:o.cy-(MB?40:48),"text-anchor":"middle","font-size":MB?40:42,"font-weight":700},svg,String(N));
  el("text",{class:"mut",x:o.cx,y:o.cy-(MB?14:18),"text-anchor":"middle","font-size":MB?16:15},svg,"Seats");
  el("text",{class:"mut",x:o.cx,y:o.cy+(MB?20:20),"text-anchor":"middle","font-size":MB?14:14,"font-weight":700,"letter-spacing":"0.02em"},svg,`${maj} needed for majority`);
}
// ---------- chance of a majority: Monte Carlo over polling error ----------
// SIM_RUNS simulated elections: every party's vote share is multiplied by a random polling error (log-normal, independent per party, then scaled back to the
// original total), then the same rules as the projection above are applied: 5% threshold, Sainte-Lague, 1 seat for the SSW. The size of the error is the one of the
// Battleground map model (national error: natA / natB / widen in data/constituencies.json), so both parts of the site rest on the same assumption.
const SIM_RUNS=5000,simPar={natA:.06,natB:1.45,widen:1.3};
const simReady=(async()=>{try{const r=await fetchRaw("data/constituencies.json");if(r.ok){const M=JSON.parse(r.text).model;
  if(M&&M.natA!=null){simPar.natA=M.natA;simPar.natB=M.natB;simPar.widen=(M.settings&&M.settings.widen)||1;}}}catch(e){}})();
const simCache=new Map();let simBusy=null;
const simKey=()=>(selPoll==null?"avg":"p"+selPoll)+"|"+(faOn.parl?"f"+facVer:"p");
const mulberry=a=>()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
function simulate(){
  const U=PM.order.filter(u=>u!=="SSW"),k=U.length,memb=U.map(u=>isFac(u)?((facById(u.slice(2))||{}).members||[]):[u]);
  const start=selPoll!=null&&polls[selPoll]?polls[selPoll].v:pct;
  const ps=parties.filter(p=>start[p]!=null&&start[p]>0),b=ps.map(p=>start[p]),S0=b.reduce((a,x)=>a+x,0),np=ps.length;
  const sd=b.map(x=>simPar.widen*Math.sqrt(simPar.natA**2+(simPar.natB/Math.max(x,1))**2));
  const unitOf=ps.map(p=>memb.findIndex(ms=>ms.includes(p)));
  const rnd=mulberry(20261023),gauss=()=>Math.sqrt(-2*Math.log(rnd()||1e-12))*Math.cos(2*Math.PI*rnd());
  const out=new Uint16Array(SIM_RUNS*k),sh=new Float64Array(k),q=new Int32Array(k),x=new Float64Array(np),el=new Int32Array(k);
  for(let r=0;r<SIM_RUNS;r++){
    let tot=0;for(let i=0;i<np;i++){x[i]=b[i]*Math.exp(sd[i]*gauss());tot+=x[i];}
    const f=S0/tot;sh.fill(0);for(let i=0;i<np;i++)if(unitOf[i]>=0)sh[unitOf[i]]+=x[i]*f;
    let ne=0;for(let u=0;u<k;u++)if(sh[u]>=thr&&!isOther(U[u]))el[ne++]=u;
    q.fill(0);
    for(let sN=0;sN<N-1&&ne;sN++){let best=el[0],bq=-1;for(let e=0;e<ne;e++){const u=el[e],v=sh[u]/(2*q[u]+1);if(v>bq){bq=v;best=u;}}q[best]++;}
    for(let u=0;u<k;u++)out[r*k+u]=q[u];
  }
  return{U,k,out};
}
function simStart(key){
  if(simBusy===key)return;simBusy=key;
  simReady.then(()=>setTimeout(()=>{ // after the page has painted, so the first draw is never blocked
    try{if(simKey()===key){simCache.set(key,simulate());if(simCache.size>12)simCache.delete(simCache.keys().next().value);}}catch(e){console.error(e);}
    simBusy=null;
    if(simCache.has(key)&&simKey()===key){renderCoalitions();renderCust();}
  },0));
}
// chance that the given units (parties / factions) together hold at least `maj` seats, plus the range of seats in the middle 80% of the simulations; null while still calculating
function simOdds(units){
  const S=simCache.get(simKey());if(!S){simStart(simKey());return null;}
  const idx=units.filter(u=>u!=="SSW").map(u=>S.U.indexOf(u));if(idx.some(i=>i<0))return null;
  const extra=units.includes("SSW")?1:0,sums=new Uint16Array(SIM_RUNS);let hit=0;
  for(let r=0;r<SIM_RUNS;r++){let t=extra;for(let j=0;j<idx.length;j++)t+=S.out[r*S.k+idx[j]];sums[r]=t;if(t>=maj)hit++;}
  sums.sort();
  return{p:hit/SIM_RUNS,lo:sums[Math.floor(.1*SIM_RUNS)],hi:sums[Math.floor(.9*SIM_RUNS)]};
}
const oddsPct=p=>p>=.995?">99%":p<.005?"<1%":Math.round(p*100)+"%";
const members=()=>[...sel].filter(p=>PM.seats[p]>0).sort((a,b)=>spec(a)-spec(b));
function drawParl(){
  const M=CW()<1000; // phones: narrower canvas (text renders larger), party boxes wrap onto several rows
  const W=M?500:940,cx=W/2,rOut=M?232:330,rIn=M?122:178,cy=M?96+rOut:470;
  const act=PM.order.filter(p=>PM.seats[p]>0),n=act.length,gp=M?6:8,avail=W-(M?32:52),PADX=M?16:18,MINW=M?46:44,MAXW=230,names=act.map(p=>lab(p));
  // party boxes: one row on desktop (shrinks to fit); on phones they wrap onto as many rows as needed at a readable size
  let fs0=M?13:12,rows=[],bws=[];
  if(M){
    const w=names.map(t=>Math.min(MAXW,Math.max(MINW,tw(t,fs0)+PADX)));
    let r=[],used=0;w.forEach((bw,i)=>{if(r.length&&used+gp+bw>avail){rows.push(r);r=[];used=0;}used+=(r.length?gp:0)+bw;r.push(i);});if(r.length)rows.push(r);
    bws=w;
  }else{
    let nat;const calc=f=>names.map(t=>Math.min(MAXW,Math.max(MINW,tw(t,f)+PADX)));
    for(;;){nat=calc(fs0);if(nat.reduce((a,b)=>a+b,0)+(n-1)*gp<=avail||fs0<=8.5)break;fs0-=.5;}
    const natSum=nat.reduce((a,b)=>a+b,0),sc=natSum+(n-1)*gp>avail?(avail-(n-1)*gp)/natSum:1;bws=nat.map(w=>w*sc);rows=[act.map((_,i)=>i)];
  }
  const boxY=cy+(M?46:48),rowH=M?62:0,boxH=M?36:32,barY=boxY+(M?rows.length*rowH+26:64),bH=M?36:34,H=barY+bH+(M?92:94);
  const svg=frame($("#parl-chart"),{W,H,title:cfg.parliamentHeadline,sub:selPoll!=null?`Based on the ${polls[selPoll].inst||""} poll of ${fmtDate(polls[selPoll].t)}`:cfg.parliamentSubline,source:cfg.sourceName,boldSource:true});
  const L=layoutSeats(cx,cy,rIn,rOut);
  drawSeats(svg,L,{cx,cy,rIn,rOut,dim:p=>sel.size>0&&!sel.has(p),M});
  rows.forEach((row,ri)=>{
    const rw=row.reduce((a,i)=>a+bws[i],0)+(row.length-1)*gp;let bxAcc=cx-rw/2;const by=boxY+ri*rowH;
    row.forEach(i=>{
      const p=act[i],bw=bws[i],bx=bxAcc;bxAcc+=bw+gp;
      const c=colorOf(p,parties.indexOf(p)),on=sel.has(p),ft=fitLabel(names[i],fs0,bw-12);
      const g=el("g",{style:"cursor:pointer"},svg);g.addEventListener("click",()=>{on?sel.delete(p):sel.add(p);drawParl();});
      if(M)el("rect",{x:(bx-3).toFixed(2),y:by-3,width:(bw+6).toFixed(2),height:rowH-4,fill:"transparent"},g); // bigger tap target
      el("rect",{class:dark(c)?"dk":"",x:bx.toFixed(2),y:by,width:bw.toFixed(2),height:boxH,rx:6,fill:c},g);
      if(on)el("rect",{class:"zl",x:(bx-3).toFixed(2),y:by-3,width:(bw+6).toFixed(2),height:boxH+6,rx:8,fill:"none","stroke-width":2.5,style:"stroke:var(--cink)"},g);
      el("text",{x:(bx+bw/2).toFixed(2),y:(by+boxH/2+ft.fs*.35).toFixed(2),"text-anchor":"middle","font-size":ft.fs.toFixed(1),"font-weight":700,fill:contrast(c)},g,ft.t);
      el("text",{class:"ink",x:(bx+bw/2).toFixed(2),y:(by+boxH+(M?18:21)).toFixed(2),"text-anchor":"middle","font-size":M?16:15,"font-weight":700},g,String(PM.seats[p]));
    });
  });
  const bx0=M?16:26,bW=W-2*bx0,bY=barY;
  el("text",{class:"mut",x:bx0,y:bY-14,"font-size":M?12.5:11,"font-weight":700,"letter-spacing":"0.04em"},svg,"VOTE SHARE");
  el("rect",{x:bx0,y:bY,width:bW,height:bH,rx:4,style:"fill:var(--track)"},svg);
  let cur=bx0;
  PM.order.forEach(p=>{
    const v=Math.round((PM.pct[p]||0)*10)/10;if(v<=0)return;
    const w=Math.min(bW-(cur-bx0),v/100*bW);if(w<=0)return;const c=colorOf(p,parties.indexOf(p));
    el("rect",{class:dark(c)?"dk":"",x:cur.toFixed(2),y:bY,width:w.toFixed(2),height:bH,fill:c},svg);
    if(w>(M?30:22))el("text",{x:(cur+w/2).toFixed(2),y:(bY+bH/2+4).toFixed(2),"text-anchor":"middle","font-size":M?12.5:11,"font-weight":700,fill:contrast(c)},svg,v+"%");
    cur+=w;
  });
  const ow=bx0+bW-cur;
  if(ow>.5){el("rect",{x:cur.toFixed(2),y:bY,width:ow.toFixed(2),height:bH,style:"fill:var(--other)"},svg);
    if(ow>(M?44:22))el("text",{class:"oth",x:(cur+ow/2).toFixed(2),y:(bY+bH/2+4).toFixed(2),"text-anchor":"middle","font-size":M?12.5:11,"font-weight":700},svg,"Other");}
  const mx=bx0+bW*.5;
  el("line",{class:"halo",x1:mx,y1:bY-8,x2:mx,y2:bY+bH+8,"stroke-width":5.5,"stroke-linecap":"round",opacity:.9},svg);
  el("line",{class:"zl",x1:mx,y1:bY-8,x2:mx,y2:bY+bH+8,"stroke-width":2.6,"stroke-dasharray":"5,4","stroke-linecap":"round"},svg);
  el("text",{class:"ink",x:mx,y:bY+bH+(M?26:22),"text-anchor":"middle","font-size":M?12.5:11,"font-weight":700},svg,"50%+1 majority");
  renderCust();
}
const barHtml=m=>`<div class="bar"><div>${m.map(p=>`<i class="${dark(colorOf(p))?"dkb":""}" style="width:${PM.seats[p]/N*100}%;background:${colorOf(p)}"></i>`).join("")}</div><u style="left:${maj/N*100}%"></u></div>`;
function renderCust(){
  const m=members(),box=$("#cust");
  if(!m.length){box.innerHTML=`<span class="no">No parties selected yet. Click parties in the legend above or choose a coalition below.</span>`;return;}
  const s=m.reduce((a,p)=>a+PM.seats[p],0),ok=s>=maj;
  box.innerHTML=`<div class="sec-top"><b>${m.map(lab).join(" + ")}</b><button class="link" id="cust-clear" type="button">Clear</button></div>
    <div class="res ${ok?"yes":"no"}">${s} of ${N} seats \u2014 ${ok?`majority (${s-maj} above the ${maj} needed)`:`no majority (${maj-s} short of the ${maj} needed)`} \u00B7 ${fmt(s/N*100)}% of seats</div>${barHtml(m)}${(o=>o?`<div class="odds">Chance of a majority: <b>${oddsPct(o.p)}</b> <span>(in the middle 80% of simulations: ${o.lo}\u2013${o.hi} seats)</span></div>`:`<div class="odds"><span>Calculating the chance of a majority\u2026</span></div>`)(simOdds(m))}`;
  $("#cust-clear").onclick=()=>{sel.clear();drawParl();};
}
function renderCoalitions(){
  const cmap=c=>[...new Set(c.map(p=>faOn.parl&&facOfParty(p)?facKey(facOfParty(p).id):p))];
  const key=c=>c.slice().sort().join("|");
  const valid=cfg.coalitions.map(cmap).filter(c=>c.every(p=>PM.seats[p]!=null))
    .filter(c=>!faOn.parl||c.length>1)
    .filter((c,i,a)=>!faOn.parl||a.findIndex(d=>key(d)===key(c))===i);
  const rows=valid.map((c,i)=>{
    const s=c.reduce((a,p)=>a+PM.seats[p],0),ok=s>=maj,o=simOdds(c);
    const nm=c.map(x=>`<span class="cp"><i class="dotc ${dark(colorOf(x))?"dkb":""}" style="background:${colorOf(x)}"></i>${lab(x)}</span>`).join('<span class="pl"> + </span>');
    return `<tr class="coal-row" data-c="${i}" title="Show in the coalition builder"><td>${nm}</td><td><b>${s}</b></td><td>${fmt(s/N*100)}%</td><td class="cb">${barHtml(c)}</td><td class="pr">${o?`<b>${oddsPct(o.p)}</b><div class="prb"><i style="width:${(o.p*100).toFixed(1)}%"></i></div><small>${o.lo}\u2013${o.hi} seats</small>`:`<span class="no">\u2026</span>`}</td><td class="${ok?"yes":"no"}">${ok?`Majority (+${s-maj})`:`No majority (\u2212${maj-s})`}</td></tr>`;
  }).join("");
  $("#coalitions").innerHTML=rows?`<div class="scroll"><table class="coal-t"><thead><tr><th>Coalition</th><th>Seats</th><th>Share</th><th class="cb"></th><th title="Share of ${SIM_RUNS.toLocaleString("en-GB")} simulated elections in which the coalition wins at least ${maj} seats. Below it: the seat range of the middle 80% of the simulations.">Chance of majority</th><th>Majority of ${maj}</th></tr></thead><tbody>${rows}</tbody></table></div>`:"<span class='no'>No coalitions in config.json match the parties in the CSV.</span>";
  $("#coalitions").onclick=e=>{const r=e.target.closest(".coal-row");if(!r)return;sel.clear();valid[+r.dataset.c].forEach(p=>sel.add(p));drawParl();$("#cust").scrollIntoView({block:"center",behavior:"smooth"});};
}
if(polls.length){
  drawParl();
  renderCoalitions();
  redraw.push(drawParl); // re-layout when crossing the phone breakpoint
}

// ---------- latest polls in the Bundestag projection: click a poll to see its seats ----------
if(polls.length){
  const PP_FIRST=15,PP_STEP=25;let ppShown=PP_FIRST;
  const ppTable=$("#parl-poll-table"),ppMore=$("#parl-poll-more"),ppNote=$("#parl-poll-note");
  const ppCand=parties.filter(p=>!isOther(p));
  function ppRender(){
    const n=polls.length,from=n-1,to=Math.max(0,n-ppShown);let rows="";
    for(let i=from;i>=to;i--){const r=polls[i],top=Math.max(...ppCand.map(p=>r.v[p]??-1));
      rows+=`<tr class="${selPoll===i?"sel":""}" data-i="${i}" tabindex="0" role="button" aria-pressed="${selPoll===i}" title="Show this poll in the Bundestag projection"><td>${fmtDate(r.t)}</td><td>${r.inst||""}</td>${parties.map(p=>`<td class="${r.v[p]===top&&!isOther(p)?"lead":""}">${r.v[p]!=null?fmt(r.v[p])+"%":"\u2013"}</td>`).join("")}</tr>`;}
    ppTable.innerHTML=`<table class="pp"><thead><tr><th>Date</th><th>Pollster</th>${parties.map(p=>`<th class="${dark(colorOf(p))?"dk":""}" style="border-bottom-color:${colorOf(p,parties.indexOf(p))}">${lab(p)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>`;
    const left=n-ppShown;
    ppMore.innerHTML=(left>0?`<button type="button" class="faction-chip" data-a="more">See more${left>PP_STEP?"":" ("+left+")"}</button>`:"")+(ppShown>PP_FIRST?`<button type="button" class="faction-chip" data-a="hide">Hide</button>`:"");
    ppMore.hidden=!ppMore.innerHTML;
  }
  function ppNoteRender(){
    if(selPoll==null){ppNote.hidden=true;ppNote.innerHTML="";return;}
    const r=polls[selPoll];
    ppNote.innerHTML=`<div class="sec-top"><span>Showing the projection for the <b>${r.inst||"selected"}</b> poll of <b>${fmtDate(r.t)}</b></span><button class="link" id="parl-poll-back" type="button">Back to current projection</button></div>`;
    ppNote.hidden=false;
    $("#parl-poll-back").onclick=()=>ppSelect(null);
  }
  function ppSelect(i){
    selPoll=i;buildPM();drawParl();renderCoalitions();ppNoteRender();ppRender();
    (selPoll!=null?ppNote:$("#parl-chart")).scrollIntoView({block:"start",behavior:"smooth"});
  }
  ppTable.addEventListener("click",e=>{const tr=e.target.closest("tr[data-i]");if(!tr)return;const i=+tr.dataset.i;ppSelect(selPoll===i?null:i);});
  ppTable.addEventListener("keydown",e=>{if(e.key!=="Enter"&&e.key!==" ")return;const tr=e.target.closest("tr[data-i]");if(!tr)return;e.preventDefault();const i=+tr.dataset.i;ppSelect(selPoll===i?null:i);});
  ppMore.addEventListener("click",e=>{const b=e.target.closest("button[data-a]");if(!b)return;
    if(b.dataset.a==="more")ppShown=Math.min(polls.length,ppShown+PP_STEP);else ppShown=PP_FIRST;
    ppRender();});
  ppRender();
  // shareable link settings of the Bundestag projection: which poll is shown (date_pollster) and the parties picked in the coalition builder
  const isoD=t=>new Date(t).toISOString().slice(0,10);
  HS.reg("parliament","poll",()=>selPoll!=null&&polls[selPoll]?isoD(polls[selPoll].t)+"_"+HS.enc(polls[selPoll].inst||""):null,v=>{
    let i=null;
    if(v){const k=v.indexOf("_"),d=k<0?v:v.slice(0,k),inst=k<0?null:HS.dec(v.slice(k+1));
      for(let q=polls.length-1;q>=0;q--)if(isoD(polls[q].t)===d&&(inst==null||(polls[q].inst||"")===inst)){i=q;break;}}
    if(i===selPoll)return;
    selPoll=i;buildPM();drawParl();renderCoalitions();ppNoteRender();
    if(i!=null)ppShown=Math.max(ppShown,polls.length-i);ppRender();});
  HS.reg("parliament","sel",()=>sel.size?HS.list([...sel].sort((a,b)=>spec(a)-spec(b))):null,v=>{
    sel.clear();HS.items(v).filter(p=>PM.seats[p]!=null).forEach(p=>sel.add(p));drawParl();});
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

let mapParty=null,mapRedraw=null,ovView="st",ovCoRedraw=null;
function setMapParty(p){mapParty=mapParty===p?null:p;ovChips();if(ovView==="wk"){if(ovCoRedraw)ovCoRedraw();}else if(mapRedraw)mapRedraw();}
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
// past state election results for one state, keyed by election date (from data/state_results.json, cached by fetchRaw)
async function stateResults(id){try{const r=await fetchRaw("data/state_results.json");if(!r.ok)return null;return JSON.parse(r.text)[id]||null;}catch(e){return null;}}
async function openState(id){
  const s=stateData[id];if(!s)return;
  document.querySelectorAll(".tab-btn").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".pane").forEach(p=>p.classList.toggle("active",p.id==="tab-state"));
  history.replaceState(null,"","/state/"+id);scrollTo(0,0);
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
  const preAvg=(p,t)=>{let w=rec.filter(q=>q.t<t&&q.t>=t-30*DAY&&q.v[p]!=null);if(!w.length)w=rec.filter(q=>q.t<t&&q.v[p]!=null).slice(-3);return w.length?{v:w.reduce((a,q)=>a+q.v[p],0)/w.length,n:w.length}:null;};
  const res=await stateResults(id),results=res?Object.entries(res).flatMap(([dt,r])=>plist.filter(p=>r[p]!=null).map(p=>{const t=Date.parse(dt+"T00:00:00Z"),pa=preAvg(p,t);return{t,v:r[p],name:lab(p),pre:pa?pa.v:null,preN:pa?pa.n:0,color:colorOf(p,parties.indexOf(p))};})):[];
  const tEnd=Math.max(...series.flatMap(q=>q.points.map(z=>z.t)));
  const mx=Math.max(0,...dots.map(d=>d.v),...results.filter(r=>r.t>=t0&&r.t<=tEnd).map(r=>r.v)),yMax=Math.ceil(Math.max(10,mx*1.12)/5)*5;let step=1;[1,2,5,10,20,25,50,100].forEach(q=>{if(q<=yMax/6*1.4)step=q;});
  lineChart($("#state-chart"),{H:720,title:en+" poll average",sub:`State election voting intention \u00B7 ${recR.length} poll${recR.length>1?"s":""}, latest ${fmtDate(rec[rec.length-1].t)}`+(results.length?" \u00B7 rings = actual state election results":""),source:"Source: "+cfg.sourceName,
    series,dots,yMin:0,yMax,step,threshold:cfg.threshold,months:stateRange==="6m"||stateRange==="1y"?[1,2,3,4,5,6,7,8,9,10,11]:true,events:true,eventList:EVENTS_FOR(id),results,endLabel:(v,n)=>`${fmt(v)} % ${n}`});
  $("#state-table").innerHTML=pollTableHtml(rec,plist);
  $("#state-range").innerHTML=RANGES.map(r=>`<button type="button" class="faction-chip ${stateRange===r[0]?"on":""}" data-r="${r[0]}">${r[1]}</button>`).join("");
  $("#state-pick").innerHTML=Object.keys(stateData).sort((a,b)=>stateGeo[a].en.localeCompare(stateGeo[b].en)).map(k=>`<button type="button" class="faction-chip ${k===id?"on":""}" data-s="${k}">${stateGeo[k].en}</button>`).join("");
}
$("#state-pick").onclick=e=>{const b=e.target.closest("[data-s]");if(b)openState(b.dataset.s);};
$("#state-range").onclick=e=>{const b=e.target.closest("[data-r]");if(!b||!curState)return;stateRange=b.dataset.r;drawState(curState);};
HS.reg("state","range",()=>stateRange!=="all"?stateRange:null,v=>{const r=RANGES.some(q=>q[0]===v)?v:"all";if(r===stateRange)return;stateRange=r;if(curState)return drawState(curState);});
// state map from state_polls/<State>.csv (written by update_data.cmd)
async function ovMap(){
  const host=$("#map"),note=$("#map-note");
  let geo;try{geo=JSON.parse((await fetchRaw(cfg.statesMap)).text);}catch(e){host.textContent="Map data missing.";return;}
  const entries=Object.entries(cfg.stateFiles||{});
  const res=await Promise.all(entries.map(async([id,slug])=>{
    try{
      const r=await fetchRaw(`${cfg.stateFolder}/${slug}.csv`);if(!r.ok)return null;
      const rows=parseCSV(r.text);if(!rows.length)return null;
      const kD=findKey(rows[0],["datum","date"]),kI=findKey(rows[0],["institut","institute","pollster"]),kN=findKey(rows[0],["befragtenanzahl","sample size","samplesize"]);
      const ps=Object.keys(rows[0]).filter(k=>k&&!META.test(k));
      const rec=rows.map(x=>({t:+parseDate(x[kD]),i:kI?x[kI]:"",n:kN?num(x[kN]):null,v:Object.fromEntries(ps.map(p=>[p,num(x[p])]))})).filter(x=>!isNaN(x.t)).sort((a,b)=>a.t-b.t);
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
      shade=v=>{const t=mx>mn?.15+.85*(v-mn)/(mx-mn):1;return dm?mixHex(full,"#D5D8DE",.8*(1-t)):mixHex(full,"#FFFFFF",.9*(1-t));};
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
  mapRedraw=draw;redraw.push(()=>{if(ovView==="st"&&mapParty)draw();});
  draw();
}
await ovMap();
// show the overview as soon as it is complete (maps drawn, fonts ready, fitted to the screen); the other tabs are built afterwards while the page is already visible
await new Promise(res=>{const go=()=>{try{fitOv();}catch(e){}const o=$("#tab-overview");if(o)requestAnimationFrame(()=>{o.classList.remove("loading");setTimeout(res,0);});else res();};
  (document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve()).then(go,go);});
await yieldUi();
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
  // Store bias for constituencies projection adjustment
  biasAdj={};bias.forEach(b=>{biasAdj[b.p]=b.mean;});
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
    const shade=v=>{const t=mx>mn?.15+.85*(v-mn)/(mx-mn):1;return dm?mix(full,"#D5D8DE",.8*(1-t)):mix(full,"#FFFFFF",.9*(1-t));};
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
        return `<div class="drow${r.tot?" tot":""}"><div>${r.label}${r.share!=null?` <span class="dshare">(${Math.round(r.share)}%)</span>`:""}</div><div class="dbar"><div>${DP.map(p=>{const c=colorOf(p),v=r.v[p];return `<i class="${dark(c)?"dkb":""}" data-r="${r.label}" data-p="${p}" style="width:${v/sum*100}%;background:${c};color:${contrast(c)}">${v>=4?v:""}</i>`;}).join("")}</div></div></div>`;}).join("");
      $("#el-demo-legend").innerHTML=DP.map(p=>`<span><i class="${dark(colorOf(p))?"dk":""}" style="background:${colorOf(p)}"></i>${lab(p)}</span>`).join("");
    }else{
      const mx=Math.max(...rows.map(r=>r.v[dp])),c=colorOf(dp);
      $("#el-demo").innerHTML=rows.map(r=>`<div class="drow${r.tot?" tot":""}"><div>${r.label}${r.share!=null?` <span class="dshare">(${Math.round(r.share)}%)</span>`:""}</div><div class="dbar single"><i class="${dark(c)?"dkb":""}" data-r="${r.label}" data-p="${dp}" style="width:${r.v[dp]/mx*86}%;background:${c}"></i><b>${r.v[dp]}%</b></div></div>`).join("");
      $("#el-demo-legend").innerHTML="";
    }
    $("#el-demo-note").textContent=g.rows.some(r=>r.share!=null)?"Percentage in brackets: group's share of all voters (Bundeswahlleiterin, repr. Wahlstatistik 2025).":"";
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
        $("#el-mig").innerHTML=`<div class="mg-key"><span></span><div><span>\u2190 Lost to other parties</span><span>Gained from other parties \u2192</span></div><span></span></div>`+rows.map(r=>`<div class="mg-row" data-n="${r.n}"><div class="mg-lab"><i style="background:${mcol(r.n)}"></i>${mname(r.n)}</div><div class="mg-div"><div class="mg-l"><b style="width:${r.l/m*100}%"></b></div><div class="mg-r"><b style="width:${r.g/m*100}%"></b></div></div><div class="mg-net ${r.net>0?"up":r.net<0?"dn":""}">${r.net>0?"+":r.net<0?"\u2212":""}${num0(Math.abs(r.net))}</div></div>`).join("");
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
await yieldUi();
try{await drawElection();}catch(e){console.error(e);showErr("2025 Election tab failed to load: "+e.message);}

// ---------- CONSTITUENCIES TAB: the 2025 result of every Wahlkreis, moved to today's poll average ----------
// Method (data built by py/build_constituencies.py): ratio swing. Every party's 2025 share in each constituency is multiplied by one
// party-specific factor, shares are re-normalised per constituency, and the factors are solved so that the national total equals the
// current poll average. Win chances: 2000 simulations with a national and a local random error (sigmas in the data file).
async function drawConstituencies(){
  const mapHost=$("#co-map");
  let C;try{const r=await fetchRaw("data/constituencies.json");if(!r.ok)throw new Error("HTTP "+r.status);C=JSON.parse(r.text);}
  catch(e){showErr("data/constituencies.json could not be loaded ("+e.message+").");return;}
  if(!polls.length){$("#co-sub").textContent="No polls loaded.";return;}
  const CAL_ON=false; // date-snapshot calendar on the Battleground map: unfinished, keep false until it is ready (also un-hide #co-cal / #co-date in index.html)
  let R13=null;if(CAL_ON)try{const r=await fetchRaw("data/results2013.json");if(r.ok)R13=JSON.parse(r.text).wk;}catch(e){} // 2013 result, only used for date snapshots before the 2017 election
  const K=["CDU/CSU","AfD","SPD","Grüne","Linke","BSW","FDP","Sonstige"],m=K.length,PI=C.parties,fwI=PI.indexOf("Freie Wähler");
  const merge=a=>K.map(k=>k==="Sonstige"?a[PI.indexOf("Sonstige")]+(fwI>=0?a[fwI]:0):a[PI.indexOf(k)]); // Free Voters count as Others
  // Two sets of constituency boundaries: 2025 (today, and every date after the 2021 election) and 2021 (dates between the 2017 and the 2021 election = snapshots that project the 2021 election).
  // W, n, V, Vt (and the map geometry, city list, year buttons) always belong to the active set, see useSet(). Within a set, s25/f25 = the result of the election the boundaries were drawn for (GY),
  // s21/f21 = the election before it, q = the one before that (the field names come from the 2025 set; in the 2021 set s25 holds 2021 and s21 holds 2017).
  const mkW=ws=>ws.map(w=>({...w,s25:merge(w.s),s21:merge(w.p),f25:w.f?merge(w.f):null,f21:w.fp?merge(w.fp):null}));
  let GY=2025,W=mkW(C.wk),n=W.length,V=W.map(w=>w.v),Vt=V.reduce((a,b)=>a+b,0);
  const SETS={2025:{GY:2025,W,n,V,Vt}};
  const nat25=K.map((k,j)=>W.reduce((a,w)=>a+w.v*w.s25[j],0)/Vt);
  // national target = the site's current poll average (same smoothing as the Poll Average tab)
  let T=K.map((k,j)=>k==="Sonstige"?((pct["Sonstige"]??null)==null&&(pct["Freie Wähler"]??null)==null?nat25[j]:(pct["Sonstige"]||0)+(pct["Freie Wähler"]||0)):(pct[k]!=null?pct[k]:nat25[j]));
  const Ts=T.reduce((a,b)=>a+b,0);T=T.map(v=>v/Ts*100);
  // Apply historical pollster bias: adjust shares by average underestimation/overestimation
  const BIAS_W=0.15; // share of the 2025 final-poll miss that is carried into the projection (past misses did not repeat in 2017->2021 / 2021->2025 tests, so only a small part)
  T=T.map((v,j)=>{const bias=(biasAdj[K[j]]||0)*BIAS_W;return Math.max(0.1,v+bias);});const TTs=T.reduce((a,b)=>a+b,0);T=T.map(v=>v/TTs*100);
  // =====================================================================================================================================
  // THE MODEL (numbers come from py/calibrate_model.py, which estimates them from the 2017, 2021 and 2025 results and polls and replays two past elections)
  //  1. Start from the 2025 second-vote result of every constituency.
  //  2. State polls: for each state and party, compare how the state's own polls moved since the 2025 election with how the national polls moved over the
  //     same stretch (a "gap to the nation" measured on the same kind of poll then and now, so state-vs-federal level differences cancel out). Fresh polls only,
  //     newer and bigger polls count more. The raw gap is then shrunk hard towards 0 (see stateSignal), so state polls tilt a state but never rule it.
  //  3. Ratio swing: every party's share (times its state tilt) is multiplied by one party-wide factor and re-normalised per constituency, with the factors
  //     solved so that the national total equals the national poll average. State polls therefore only move votes BETWEEN states; the national total stays pinned.
  //  4. 2,000 simulated elections: one national shock per party + one shock per state and party (large where we know little, small where polls pin it down)
  //     + one local shock per constituency and party. The share of runs a party wins a constituency is its win chance.
  // =====================================================================================================================================
  const MD=C.model||null,SP=MD?MD.settings:{widen:1,runs:2000};
  const nz=t=>t.toLowerCase().replace(/ü/g,"ue").replace(/ö/g,"oe").replace(/ä/g,"ae").replace(/ß/g,"ss");
  const stLands=[...new Set(W.map(w=>w.land))],idOf={};Object.entries(cfg.stateFiles||{}).forEach(([id,slug])=>idOf[nz(slug)]=id);
  const U={},PV={},stInfo={},DAYMS=DAY,YR=365.25*DAY,TODAY0=tMax,REF0=MD?+parseDate(MD.refDate):0;
  function stateSignal(recs,j,today=TODAY0,ref=REF0,pl=polls){ // -> {u: shrunk state tilt (log share), pv: variance left after the polls, n: polls used}
    const v1=MD.stateVarPerYear[K[j]],prior=v1*(today-ref)/YR,kap=MD.stateMismatchVar;
    const win=(c,span,oneSided)=>{const w=[];for(const r of recs){const age=(r.t-c)/DAYMS;if(oneSided?(age>0||age<-span):Math.abs(age)>span)continue;
      const v=r.v[K[j]];if(v==null||v<SP.minSharePct)continue;const N=smoothedValueAt(pl,K[j],r.t,SP.natSmoothDays);if(N==null||N<SP.minSharePct)continue;
      w.push({R:Math.pow(.5,Math.abs(age)/SP.halfLifeDays),n:Math.min(r.n||1000,2500),g:Math.log(v)-Math.log(N),sh:v,a:Math.abs(age)});}return w;};
    const stat=w=>{if(!w.length)return null;let sR=0,sW=0,sG=0,sA=0,sR2=0,sR2n=0,sRa=0;
      for(const x of w){const W_=x.R*x.n;sW+=W_;sG+=W_*x.g;sA+=W_*x.sh;sR+=x.R;sR2+=x.R*x.R;sR2n+=x.R*x.R*x.n;sRa+=x.R*x.a;}
      const G=sG/sW,A=sA/sW,vp=SP.designEffect*A*(100-A)*sR2n/(sW*sW)+SP.houseSdPts*SP.houseSdPts*sR2/(sR*sR);return{G,v:vp/(A*A),age:sRa/sR/365.25,k:w.length};};
    const a=stat(win(today,SP.maxAgeDays,true)),b=stat(win(ref,SP.refWindowDays,false));
    if(!a||!b)return{u:0,pv:prior,n:0};
    const vg=a.v+b.v+v1*(a.age+b.age)+kap,g=a.G-b.G;return{u:g*prior/(prior+vg),pv:prior*vg/(prior+vg),n:a.k};
  }
  stLands.forEach(land=>{const id=idOf[nz(land)],sd=id&&stateData[id],recs=sd?sd.rec:[];U[land]=new Array(m).fill(0);PV[land]=new Array(m).fill(0);
    let used=0;for(let j=0;j<m-1;j++){if(MD){const r=stateSignal(recs,j);U[land][j]=r.u;PV[land][j]=r.pv;used=Math.max(used,r.n);}}
    stInfo[land]={polls:used,last:recs.length?recs[recs.length-1].t:null};});
  // vt = 2: second votes (the original projection). vt = 1: first votes - there are no first-vote polls, so the first-vote national result is DERIVED:
  // every party's poll average (second-vote level) is moved by FV_GAP of the gap between its national first-vote and second-vote share at the last election, then re-normalised.
  // The gap is only partly carried forward (backtests 2017 -> 2021 and 2021 -> 2025: the first-vote bonus of a party changes a lot from one election to the next).
  // The rest is identical (state tilts, ratio swing per constituency, simulated elections), but with first-vote local noise and extra national noise
  // (both estimated in py/add_first_votes.py from the 2021 -> 2025 replay).
  const FV_OTH=.5; // share of the local deviation of the "Others" bucket (first votes) that is kept in the starting point of the swing
  const FV_GAP=.6; // share of the last election's first-vote minus second-vote gap that is carried into the derived national first-vote result
  function runProjection(vt,cx){
  const CS=cx?cx.S:null,CF=cx?cx.F:null,UU=cx?cx.U:U,PP=cx?cx.PV:PV,N0=cx?cx.nat:nat25,TT0=cx?cx.T:T;
  const Vw=vt===1?W.map(w=>w.fv):V,Vtt=Vw.reduce((a,b)=>a+b,0);let Tt=TT0;
  if(vt===1){const n1=K.map((k,j)=>W.reduce((a,w,i)=>a+Vw[i]*(CF?CF[i][j]:w.f25[j]),0)/Vtt);Tt=K.map((k,j)=>N0[j]>0?Math.max(.05,TT0[j]+FV_GAP*(n1[j]-N0[j])):0);const ts=Tt.reduce((a,b)=>a+b,0);Tt=Tt.map(v=>v/ts*100);}
  // ratio swing, solved iteratively (X0 = without state polls, X = with them; both hit the same national totals)
  // first votes: starting point of the swing. (1) A party with no first-vote candidate in a constituency (0 %, e.g. the AfD in 12 constituencies in 2017) can never grow there,
  // so its start is borrowed from its second-vote share x its national first/second ratio. (2) The "Others" bucket mixes parties that only sometimes field candidates:
  // its local deviation from the national level is halved before the swing, otherwise a national rise of Others multiplies every local oddity (backtests 2017 -> 2021, 2021 -> 2025).
  let B1=null;
  if(vt===1){const SB=cx?CS:W.map(w=>w.s25),FB=cx?CF:W.map(w=>w.f25),o=m-1,
      nS=K.map((k,j)=>W.reduce((a,w,i)=>a+V[i]*SB[i][j],0)/Vt),nF=K.map((k,j)=>W.reduce((a,w,i)=>a+Vw[i]*FB[i][j],0)/Vtt);
    B1=FB.map((r,i)=>r.map((v,j)=>v===0&&j!==5&&j<o&&nF[j]>.5&&nS[j]>0&&SB[i][j]>0?SB[i][j]*nF[j]/nS[j]:v));
    if(nF[o]>0)B1.forEach(r=>{r[o]=Math.exp(Math.log(nF[o])+FV_OTH*(Math.log(Math.max(r[o],.01))-Math.log(nF[o])));});}
  const L0=W.map((w,i)=>(vt===1?B1[i]:cx?CS[i]:w.s25).map(v=>Math.log(Math.max(v,.01)/100)));
  function solve(useState){
    const L=L0.map((r,i)=>r.map((v,j)=>v+(useState&&j<m-1?UU[W[i].land][j]:0))),c=new Array(m).fill(0),Xo=W.map(()=>new Float64Array(m));
    for(let it=0;it<200;it++){
      const nat=new Float64Array(m);
      for(let i=0;i<n;i++){let s=0;for(let j=0;j<m;j++){Xo[i][j]=Math.exp(L[i][j]+c[j]);s+=Xo[i][j];}for(let j=0;j<m;j++){Xo[i][j]/=s;nat[j]+=Vw[i]*Xo[i][j];}}
      let err=0;for(let j=0;j<m;j++){const d=Math.log(Math.max(Tt[j],1e-9)/100/Math.max(nat[j]/Vtt,1e-12));c[j]+=.8*d;err=Math.max(err,Math.abs(d));}
      if(err<1e-5)break;
    }
    return Xo;
  }
  const X0=solve(false),X=MD?solve(true):X0;
  // average effect of the state polls on each state's vote shares, in points (for the explanation panel)
  const stEff={};stLands.forEach(land=>{const idx=W.map((w,i)=>w.land===land?i:-1).filter(i=>i>=0),vt=idx.reduce((a,i)=>a+V[i],0);
    stEff[land]=Array.from({length:m-1},(_,j)=>100*idx.reduce((a,i)=>a+V[i]*(X[i][j]-X0[i][j]),0)/vt);});
  // win chances (seeded, so the map never changes between page loads)
  const rnd=(a=>()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;})(2029);
  const gauss=()=>Math.sqrt(-2*Math.log(rnd()||1e-12))*Math.cos(2*Math.PI*rnd()),NS_=SP.runs||2000,wins=W.map(()=>new Float64Array(m)),fw=SP.widen||1;
  const sdN=Array.from({length:m-1},(_,j)=>fw*(MD?Math.sqrt(MD.natA**2+(MD.natB/Math.max(Tt[j],1))**2+(vt===1?MD.first.natExtra**2:0)):C.sigmaNational));
  const sdL=Array.from({length:m-1},(_,j)=>fw*(MD?(vt===1?MD.first.localSd:MD.localSd)[K[j]]:C.sigmaLocal));
  const sdS=stLands.map(l=>Array.from({length:m-1},(_,j)=>MD?fw*Math.sqrt(PP[l][j]):0)),sIdx=W.map(w=>stLands.indexOf(w.land));
  const LX=X.map(r=>Array.from(r,v=>Math.log(Math.max(v,1e-9))));
  for(let s=0;s<NS_;s++){
    const nsh=sdN.map(sd=>sd*gauss()),ssh=sdS.map(r=>r.map(sd=>sd*gauss()));
    for(let i=0;i<n;i++){const st=ssh[sIdx[i]];let b=-1,bv=-1e9;for(let j=0;j<m-1;j++){const v=LX[i][j]+nsh[j]+st[j]+sdL[j]*gauss();if(v>bv){bv=v;b=j;}}wins[i][b]++;}
  }
  const R=W.map((w,i)=>{const o=Array.from(X[i],(v,j)=>({j,v:v*100})).filter(q=>q.j<m-1).sort((a,b)=>b.v-a.v),pr=Array.from(wins[i],v=>v/NS_);
    const lead=o[0].j;return{w,i,x:X[i].map(v=>v*100),lead,share:o[0].v,margin:o[0].v-o[1].v,second:o[1].j,prob:pr[lead],pr};});
  const byN=Object.fromEntries(R.map(r=>[r.w.n,r]));
  const expW=K.map((k,j)=>R.filter(r=>r.lead===j).length),tossups=R.filter(r=>r.prob<.6).length;
  return{X,R,byN,expW,tossups,stEff};
  }
  let X,R,byN,expW,tossups,stEff,voteMode=2,SNAP=null;const projCache={}; // SNAP = date snapshot (null = today's poll average)
  const applyProj=vt=>{const ck=(SNAP?SNAP.key:"live")+"|"+vt,P=projCache[ck]||(projCache[ck]=runProjection(vt,SNAP));({X,R,byN,expW,tossups,stEff}=P);};
  applyProj(2);
  const dm=()=>isDarkMode(),pcol=j=>{const col=colorOf(K[j]);return dm()&&dark(col)?"#7A808A":col;};
  const mixc=(h,t,a)=>{const f=x=>parseInt(x.replace("#",""),16),A=f(h),B=f(t),ch=sh=>Math.round(((A>>sh)&255)*(1-a)+((B>>sh)&255)*a).toString(16).padStart(2,"0");return"#"+ch(16)+ch(8)+ch(0);};
  const cbg=()=>dm()?"#D5D8DE":"#F6F5F1",sg=v=>(v>0?"+":v<0?"−":"")+fmt(Math.abs(v));
  const vn=()=>voteMode===1?"first":"second";let hasFirst=!!(MD&&MD.first&&W.every(w=>w.f25&&w.f21)),FB=hasFirst?MD.first.backtest:null;
  const BY=()=>SNAP?SNAP.year:2025,projLbl=()=>SNAP&&SNAP.poll?`Projected from a single poll: ${SNAP.poll.inst||"poll"}, ${fmtDate(SNAP.poll.t)}`:SNAP?`Projected from the poll average of ${fmtDate(SNAP.ms)} (built on the ${SNAP.year} result)`:"Projected from the current poll average";
  const setTexts=()=>{
    if(SNAP&&SNAP.poll)$("#co-sub").textContent=`What the single ${SNAP.poll.inst||""} poll of ${fmtDate(SNAP.poll.t)} would mean in each of the 299 constituencies (${voteMode===1?"first":"second"} votes) if it were the election result. Only this poll sets the national level; state polls published up to that day still tilt the states.`;
    else if(SNAP)$("#co-sub").textContent=`How the map looked on ${fmtDate(SNAP.ms)}: the ${SNAP.year} election result moved to the poll average of that day (${voteMode===1?"first":"second"} votes). Only polls published up to that date are used. A reconstruction, not what was published then.`;
    else $("#co-sub").textContent=voteMode===1?`Who would lead each of the 299 constituencies on first votes (the direct-mandate race) if the poll average of ${fmtDate(tMax)} were the election result. A projection from today\u2019s polls.`
      :`What the poll average of ${fmtDate(tMax)} would mean in each of the 299 constituencies (second votes). A projection from today\u2019s polls, not a forecast for 2029.`;
    const gt=$("#co-gt-vote");if(gt)gt.textContent=vn()+" votes";
    const nt=$("#co-vote-note");
    if(nt)nt.innerHTML=SNAP&&SNAP.poll?`<b>Single poll: ${SNAP.poll.inst||"poll"} \u00b7 ${fmtDate(SNAP.poll.t)}</b> · built on the 2025 election result · <button type="button" class="co-back" data-back="1">Back to poll average</button>`:SNAP?`<b>Snapshot: ${fmtDate(SNAP.ms)}</b> · built on the ${SNAP.year} election result${SNAP.filled?` (${SNAP.filled} of ${n} constituencies had no comparable ${SNAP.year} result and were estimated from the next election)`:""}${GY===2025?"":` · ${GY} constituency boundaries`}${SNAP.F?"":" · first votes not available for this period"} · <button type="button" class="co-back" data-back="1">Back to today</button>`:"";};
  setTexts();
  // chips: constituencies led per party; click one to map where that party is strongest (click again to go back)
  const coChips=()=>{
    // projection: expected constituencies led; 2025 / 2021 / 2017: constituencies actually won in that election
    const cntY={};if(yearView!==PJ)yearData.forEach(d=>{if(d)cntY[d.lead]=(cntY[d.lead]||0)+1;});
    const cnum=j=>yearView===PJ?expW[j]:(cntY[j]||0);
    const gt=$("#co-gt-vote");if(gt)gt.textContent=vn()+" votes"+(yearView===PJ?"":" \u00B7 "+yearView+" result");
    $("#co-chips").innerHTML=[...K.keys()].filter(j=>cnum(j)>0).sort((a,b)=>cnum(b)-cnum(a)).map(j=>{const col=colorOf(K[j]);
    return `<div class="chip col${dark(col)?" dk":""}${mode===j?" sel":""}" data-p="${j}" tabindex="0" role="button" aria-pressed="${mode===j}" title="Highlight the constituencies ${lab(K[j])} leads" style="background:${col};border-color:${col};color:${contrast(col)}"><b>${cnum(j)}</b><span>${lab(K[j])} · constituencies led</span></div>`;}).join("")
    +`<div class="chip${certainty?" sel":""}" data-cert="1"${yearView===PJ?"":" hidden"} tabindex="0" role="button" aria-pressed="${certainty}" title="Show how certain each constituency is" style="border-left-color:#999;cursor:pointer"><b>${tossups}</b><span>Toss-ups (lead under 60% likely)</span></div>`;};
  let hasQ=W.some(q=>q.q);const DV=C.demo.map((_,k)=>W.map(q=>q.d[k]).sort((a,b)=>a-b));
  // state of the view
  const PJ="proj"; // yearView: PJ = poll-average projection, 2025 / 2021 / 2017 = actual election result
  let mode=null,sel=[...R].sort((a,b)=>a.prob-b.prob)[0].w.n,stF="",sortBy="close",q="",yearView=PJ,metric=null,certainty=true,swings=false; // metric = index of the "About this constituency" figure the map is coloured by
  const lands=[...new Set(W.map(w=>w.land))].sort((a,b)=>a.localeCompare(b,"de"));
  $("#co-state").innerHTML=`<option value="">All states</option>`+lands.map(l=>`<option>${l}</option>`).join("");
  // year selector buttons
  const availYears=()=>GY===2021?[PJ,2021,2017]:[PJ,2025,...hasQ?[2021,...W.some(w=>w.q)&&voteMode===2?[2017]:[]]:[]]; // 2021 boundaries: the 2021 result and the 2017 result recalculated to them
  function renderCal(){const b=$("#co-cal");if(!b)return;b.classList.toggle("snap",!!SNAP);const l=b.querySelector(".co-callbl");if(l)l.textContent=SNAP?fmtDate(SNAP.ms):"Pick a date";
    b.title=SNAP?"Showing "+fmtDate(SNAP.ms)+" \u00b7 click to change the date":"See how the map looked on a past date";}
  const renderYearButtons=()=>{
    $("#co-year-filter").innerHTML=availYears().map(y=>`<button type="button" role="tab" aria-selected="${yearView===y}" class="${yearView===y?"on":""}" data-year="${y}">${y===PJ?"Projection":y}</button>`).join("");renderCal();
  };
  renderYearButtons();
  const firstOK=()=>hasFirst&&(!SNAP||!!SNAP.F);
  const renderVoteButtons=()=>{const row=$("#co-vote");if(!row)return;row.style.display=firstOK()?"":"none";
    const ci=$("#co-info");if(ci){let gone=false;try{gone=localStorage.getItem("co-info-hide")==="1";}catch(e){}ci.hidden=gone||!firstOK();const cx=$("#co-info-x");if(cx&&!cx.dataset.b){cx.dataset.b="1";cx.addEventListener("click",()=>{ci.hidden=true;try{localStorage.setItem("co-info-hide","1");}catch(e){}});}}
    $("#co-vote").innerHTML=[[1,"First vote"],[2,"Second vote"]].map(([k,t])=>`<button type="button" role="tab" aria-selected="${voteMode===k}" class="${voteMode===k?"on":""}" data-vote="${k}">${t}</button>`).join("");};
  renderVoteButtons();
  const renderViewButtons=()=>{$("#co-view").innerHTML=[["lead","Leader"],["swing","Swings"],["cert","Certainty"]].map(([k,t])=>{
    const on=k==="cert"?certainty:k==="swing"?swings:!certainty&&!swings&&mode==null&&metric==null,off=k!=="lead"&&yearView!==PJ;
    return `<button type="button" role="tab" aria-selected="${on}" class="${on?"on":""}" data-v="${k}"${off?' disabled title="Only available for the projection"':""}>${t}</button>`;}).join("");};
  renderViewButtons();
  // get data for specific year: create array parallel to R with year-specific values
  // result of election yr on the active boundaries: GY = s25/f25, GY-4 = s21/f21, GY-8 = q (second votes only); null where there is none
  const resOf=(w,yr,f1)=>{const k=(GY-yr)/4;return k===0?(f1?w.f25:w.s25):k===1?(f1?w.f21:w.s21):k===2?(f1||!w.q?null:merge(w.q)):null;};
  const getYearData=yr=>{
    if(yr===PJ) return R; // use the existing projection data
    // for the past elections, create data from actual results
    const sourceData=W.map(w=>resOf(w,yr,voteMode===1));
    return W.map((w,i)=>{
      const x=sourceData[i];if(!x) return null;
      const o=K.map((k,j)=>({j,v:x[j]})).filter(q=>q.j<m-1).sort((a,b)=>b.v-a.v);
      return{w:w,i:i,x:x,lead:o[0].j,share:o[0].v,margin:o[0].v-o[1].v,second:o[1].j,prob:1.0,pr:new Array(m).fill(0)};
    });
  };
  let yearData=getYearData(PJ);
  // geometry (optional file; without it the tab shows list + details only)
  // geometry of one set of boundaries -> {paths,bbox,stBox} (optional file; without it the tab shows list + details only)
  const geoBuild=(gj,Ws)=>{
    const idx=Object.fromEntries(Ws.map((w,i)=>[w.n,i])),feats=gj&&gj.features?gj.features.filter(f=>idx[f.properties.n]!=null):[];
    if(!feats.length)return null;
    const kx=Math.cos(51*Math.PI/180),ring=r=>r.map(p=>[p[0]*kx,-p[1]]);let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;const stBox={};
    const polys=feats.map(f=>{const g=f.geometry,ps=g.type==="Polygon"?[g.coordinates]:g.coordinates;return ps.map(p=>p.map(ring));});
    polys.forEach(ps=>ps.forEach(p=>p.forEach(r=>r.forEach(([x,y])=>{x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}))));
    const sc=1000/(x1-x0),bbox=[0,0,1000,(y1-y0)*sc];
    const paths=feats.map((f,k)=>{const sb=[1e9,1e9,-1e9,-1e9];
      const d=polys[k].map(p=>p.map(r=>"M"+r.map(([x,y])=>{const X_=(x-x0)*sc,Y_=(y-y0)*sc;sb[0]=Math.min(sb[0],X_);sb[1]=Math.min(sb[1],Y_);sb[2]=Math.max(sb[2],X_);sb[3]=Math.max(sb[3],Y_);return X_.toFixed(1)+" "+Y_.toFixed(1);}).join("L")+"Z").join("")).join("");
      const land=Ws[idx[f.properties.n]].land;stBox[land]=stBox[land]?[Math.min(stBox[land][0],sb[0]),Math.min(stBox[land][1],sb[1]),Math.max(stBox[land][2],sb[2]),Math.max(stBox[land][3],sb[3])]:sb;
      const ri=idx[f.properties.n];
      return{n:f.properties.n,d,i:ri,sb};});
    return{paths,bbox,stBox};
  };
  let geo=null;try{const r=await fetchRaw("data/wahlkreise.geojson");if(r.ok)geo=JSON.parse(r.text);}catch(e){}
  const G25=geoBuild(geo,W),hasMap=!!G25;SETS[2025].geo=G25;
  $("#co-mapcard").hidden=!hasMap;$("#co-grid").classList.toggle("nomap",!hasMap);
  let paths=hasMap?G25.paths:null,bbox=hasMap?G25.bbox:null,stBox=hasMap?G25.stBox:{};
  // ---- shading: the darker / more solid, the stronger ----
  // ---- map coloured by one "About this constituency" figure: darker = higher in the ranking (percentile of rank, so skewed figures like density stay readable) ----
  const demoName=k=>C.demo[k].label.replace(/\s*%$/,"").replace(/\s*\(.*\)$/,"");
  const demoFmt=(k,v)=>{const dd=C.demo[k],t=v.toLocaleString("en-US",{minimumFractionDigits:dd.dec,maximumFractionDigits:dd.dec});
    return /income/i.test(dd.label)?"€"+t:/%$/.test(dd.label)?t+"%":/^Population/.test(dd.label)?t+"k":/^Density/.test(dd.label)?t+" /km²":t;};
  const metricKeys=()=>yearView===PJ||yearView===GY?["d"]:yearView===2021&&GY===2025?["d21"]:["d17","d21"]; // 2017: the few constituencies redrawn before 2021 use their 2021 figures
  const mval=(w,k=metric)=>{if(yearView!==PJ&&!yearData[byN[w.n].i])return null;for(const key of metricKeys())if(w[key])return w[key][k];return null;};
  let miCache=null;
  function metricInfo(){
    const ck=metric+"|"+yearView;if(miCache&&miCache.ck===ck)return miCache;
    const a=W.map(w=>({w,v:mval(w)})).filter(o=>o.v!=null).sort((x,y)=>y.v-x.v),pct=new Map(),rank=new Map();
    a.forEach((o,i)=>{rank.set(o.w.n,a.filter(q=>q.v>o.v).length+1);pct.set(o.w.n,a.length>1?a.filter(q=>q.v<o.v).length/(a.length-1):1);});
    return miCache={ck,a,n:a.length,pct,rank,hi:a[0],lo:a[a.length-1]};
  }
  const metricRamp=t=>dm()?mixc("#D5D8DE","#2F6FDB",t):mixc("#E3EAF6","#123B7A",t);
  // ---- certainty map: chance that the projected leader really wins (100 % = darkest, toss-up = lightest) ----
  const certT=p=>Math.max(0,Math.min(1,(p-.5)/.45)),certRamp=t=>dm()?mixc("#D5D8DE","#8B5CF6",t):mixc("#EEE9F8","#3C1F82",t);
  const certBands=[[.95,"Safe (95%+)"],[.8,"Likely (80–95%)"],[.6,"Lean (60–80%)"],[0,"Toss-up (under 60%)"]];
  // colour = projected leader, intensity = certainty: 100% = the party's full (darkest) colour, toss-up = palest tint
  const certFill=d=>{const t=certT(d.prob),c=pcol(d.lead);return mixc(dm()?c:mixc(c,"#000000",.22*t),cbg(),.92*(1-t));};
  const fillOf=(r,md=mode,met=metric,cert=certainty)=>{
    if(cert){const d=yearData[r.i];return d?certFill(d):"#ccc";}
    if(met!=null){const v=mval(r.w,met);return v==null?"#ccc":metricRamp(metricInfo().pct.get(r.w.n));}
    const d=yearData[r.i];if(!d) return"#ccc";
    if(md==null)return pcol(d.lead); // Leader view: flat party colour; confidence is shown in the Certainty view
    return d.lead===md?pcol(md):(dm()?"#2A2E36":"#E2E0DA");
  };
  function shade(v,md=mode){const vals=yearData.map(d=>d?d.x[md]:null).filter(x=>x!=null),mn=Math.min(...vals),mx=Math.max(...vals),t=mx>mn?(v-mn)/(mx-mn):1,full=pcol(md);
    // weakest = a faint tint, strongest = the party's full colour (deepened in light mode), so 20 % and 50 % are clearly different
    return dm()?mixc(mixc(full,"#262A33",.88),full,Math.pow(t,.85)):mixc("#F3F1EC",mixc(full,"#000000",.28),.04+.96*Math.pow(t,.85));}
  function legendHtml(md,met=metric,cert=certainty,showSwing=false){
    if(cert){const cnt=certBands.map(()=>0),pc={};yearData.forEach(d=>{if(d){const b=certBands.findIndex(x=>d.prob>=x[0]);cnt[b<0?cnt.length-1:b]++;pc[d.lead]=1;}});
      return Object.keys(pc).map(Number).sort((a,b)=>expW[b]-expW[a]).map(j=>`<span>${lab(K[j])} <i style="width:70px;background:linear-gradient(to right,${certFill({lead:j,prob:.4})},${certFill({lead:j,prob:1})})"></i></span>`).join("")
        +`<span style="flex-basis:100%;height:0;margin:-6px 0 0"></span>`+certBands.map((x,k)=>`<span>${x[1]} <b>${cnt[k]}</b></span>`).join("");}
    if(met!=null){const mi=metricInfo(),miss=n-mi.n;
      return `<span>Lowest <i style="width:110px;background:linear-gradient(to right,${metricRamp(0)},${metricRamp(1)})"></i> highest · darker = higher in the ranking</span>`
        +`<span>Highest: <b>${mi.hi.w.name}</b> ${demoFmt(met,mi.hi.v)}</span><span>Lowest: <b>${mi.lo.w.name}</b> ${demoFmt(met,mi.lo.v)}</span>`
        +(miss?`<span class="co-faint"><i style="background:#ccc"></i>No ${yearView===PJ?GY:yearView} figures (redrawn) <b>${miss}</b></span>`:"");}
    const data=yearData.filter(d=>d!=null);
    if(md==null){const cnt={};data.forEach(d=>cnt[d.lead]=(cnt[d.lead]||0)+1);
      return Object.entries(cnt).sort((a,b)=>b[1]-a[1]).map(([j,k])=>`<span><i class="${dark(colorOf(K[j]))?"dk":""}" style="background:${colorOf(K[j])}"></i>${lab(K[j])} <b>${k}</b></span>`).join("")+(data.length<yearData.length?`<span class="co-faint"><i style="background:#ccc"></i>No ${yearView} result (redrawn in ${GY}) <b>${yearData.length-data.length}</b></span>`:"")+(swings&&yearView===PJ&&met==null&&!cert&&md==null&&showSwing?(()=>{const n=data.filter(d=>swingOf(d)>=0).length;return n?`<span><i style="background:repeating-linear-gradient(45deg,#888 0 3px,#ddd 3px 6px)"></i>Striped = swing (previous ${BY()} winner in the stripes) <b>${n}</b></span>`:"";})():"");}
    const led=data.filter(d=>d.lead===md).length;
    return `<span class="co-hl"><i class="hl" style="background:${pcol(md)}"></i>${lab(K[md])} leads <b>${led}</b></span><span><i class="fd"></i>Led by another party <b>${data.length-led}</b></span>`;}
  const bigTip=(e,h)=>showTip(e,h,true);
  function tipFor(e,r,met=metric,cert=certainty){
    if(cert){const d=yearData[r.i];if(!d){bigTip(e,`<b>${r.w.name}</b><br>${r.w.land}`);return;}
      const o=[...K.keys()].sort((a,b)=>d.x[b]-d.x[a]).slice(0,3);
      bigTip(e,`<b>${r.w.name}</b>: ${Math.round(d.prob*100)}%<br>`+o.map(j=>`${lab(K[j])}: ${fmt(d.x[j])}%`).join("<br>")+(d.prob<.6?`<br><span style="opacity:.7">Toss-up · ${r.w.land}</span>`:""));return;}
    if(met!=null){const v=mval(r.w,met),mi=metricInfo();
      bigTip(e,`<b>${r.w.name}</b><br>${demoName(met)}: ${v==null?"no figures for this year":demoFmt(met,v)}`+(v==null?"":`<br><span style="opacity:.7">#${mi.rank.get(r.w.n)} of ${mi.n} · ${r.w.land}</span>`));return;}
    const d=yearData[r.i];
    if(!d){bigTip(e,`<b>${r.w.name}</b><br>No ${yearView} result for these boundaries<br><span style="opacity:.7">Redrawn in ${GY} · ${r.w.land}</span>`);return;}
    const o=[...K.keys()].sort((a,b)=>d.x[b]-d.x[a]).slice(0,5);
    bigTip(e,`<b>${r.w.name}</b><br>`+o.map(j=>`${lab(K[j])}: ${fmt(d.x[j])}%`).join("<br>")+`<br><span style="opacity:.7">${d.prob<.6?"Toss-up":Math.round(d.prob*100)+"% chance for "+lab(K[d.lead])} · ${r.w.land}</span>`+(swings&&swingOf(d)>=0?`<br><span style="opacity:.7">Swing: won by ${lab(K[swingOf(d)])} in ${BY()}</span>`:""));
  }
  // ---- zoomable map: wheel / pinch to zoom, drag to pan, buttons, smooth jump to a state ----
  // cities / regions with several constituencies (the whole Ruhrgebiet counts as one; constituency numbers; surrounding rural "-Land" districts are not part of the city).
  // Berlin, Hamburg and Bremen are states already, so double-clicking there keeps zooming to the state.
  const CITIES25={"München":[216,217,218,219],"Köln":[92,93,94],"Frankfurt am Main":[181,182],"Stuttgart":[258,259],"Düsseldorf":[105,106],"Ruhrgebiet":[112,114,115,116,117,118,119,120,121,122,124,137,138,139,140,141,142,143,144],
    "Leipzig":[151,152],"Dresden":[158,159],"Nürnberg":[243,244],"Hannover":[41,42]},
    // the same cities in the 2021 numbering (the numbers moved up by one in Bavaria north of Stuttgart, NRW, Hesse and Saxony; Stuttgart and Hannover kept theirs)
    CITIES21={"München":[217,218,219,220],"Köln":[93,94,95],"Frankfurt am Main":[182,183],"Stuttgart":[258,259],"Düsseldorf":[106,107],"Ruhrgebiet":[113,115,116,117,118,119,120,121,122,123,125,138,139,140,141,142,143,144,145],
    "Leipzig":[152,153],"Dresden":[159,160],"Nürnberg":[244,245],"Hannover":[41,42]};
  let CITIES=CITIES25;SETS[2025].cities=CITIES25;
  const cityOf=n=>Object.keys(CITIES).find(k=>CITIES[k].includes(n))||"";
  let AR=hasMap?bbox[3]/bbox[2]:1;const MAXZ=14;
  let view=hasMap?[...bbox]:null,svgEl=null,anim=0,drag=null,lastClk=null,cityF="",ptrType="mouse",pinned=null; // ptrType: how the map was last touched; pinned: constituency whose popup is held open on touch screens
  const vbStr=v=>v.map(n=>+n.toFixed(2)).join(" ");
  const stView=l=>{if(!l||!stBox[l])return[...bbox];const b=stBox[l],w=Math.min(bbox[2],Math.max(b[2]-b[0],(b[3]-b[1])/AR)*1.14),h=w*AR;return[(b[0]+b[2])/2-w/2,(b[1]+b[3])/2-h/2,w,h];};
  const cityView=k=>{const bs=paths.filter(p=>CITIES[k].includes(p.n)).map(p=>p.sb);if(!bs.length)return stView(stF);
    const b=[Math.min(...bs.map(x=>x[0])),Math.min(...bs.map(x=>x[1])),Math.max(...bs.map(x=>x[2])),Math.max(...bs.map(x=>x[3]))],w=Math.min(bbox[2],Math.max(b[2]-b[0],(b[3]-b[1])/AR)*1.3),h=w*AR;
    return[(b[0]+b[2])/2-w/2,(b[1]+b[3])/2-h/2,w,h];};
  const clampV=v=>{const w=Math.min(bbox[2],Math.max(bbox[2]/MAXZ,v[2])),h=w*AR,mx_=bbox[2]*.05,my_=bbox[3]*.05;
    const x=w>=bbox[2]-.01?bbox[0]:Math.min(Math.max(v[0],bbox[0]-mx_),bbox[0]+bbox[2]+mx_-w),y=h>=bbox[3]-.01?bbox[1]:Math.min(Math.max(v[1],bbox[1]-my_),bbox[1]+bbox[3]+my_-h);return[x,y,w,h];};
  function setView(v){view=clampV(v);if(svgEl)svgEl.setAttribute("viewBox",vbStr(view));
    const z=bbox[2]/view[2];mapHost.style.touchAction=z>1.05?"none":"pan-y";
    const zi=$("#co-zoom [data-z=in]"),zo=$("#co-zoom [data-z=out]");if(zi)zi.disabled=z>=MAXZ-.05;if(zo)zo.disabled=z<=1.01;}
  function animateTo(t){cancelAnimationFrame(anim);const f=[...view],T=clampV(t);
    if(matchMedia("(prefers-reduced-motion:reduce)").matches){setView(T);return;}
    const t0=performance.now(),D=420,step=now=>{const k=Math.min(1,(now-t0)/D),e=1-Math.pow(1-k,3);setView(f.map((v,i)=>v+(T[i]-v)*e));if(k<1)anim=requestAnimationFrame(step);};anim=requestAnimationFrame(step);}
  function zoomAt(cx,cy,f){const nw=Math.min(bbox[2],Math.max(bbox[2]/MAXZ,view[2]/f));f=view[2]/nw;setView([cx-(cx-view[0])/f,cy-(cy-view[1])/f,nw,nw*AR]);}
  const toMap=(x,y)=>{const r=svgEl.getBoundingClientRect();return[view[0]+(x-r.left)/r.width*view[2],view[1]+(y-r.top)/r.height*view[3]];};
  if(hasMap){
    const ptrs=new Map();let pinch=null;
    mapHost.addEventListener("wheel",e=>{if(!svgEl)return;const dy=e.deltaMode===1?e.deltaY*16:e.deltaMode===2?e.deltaY*400:e.deltaY,f=Math.exp(-Math.max(-120,Math.min(120,dy))*(e.ctrlKey?.008:.0018));
      if(f<1&&view[2]>=bbox[2]-.5)return; // fully zoomed out: let the page scroll
      e.preventDefault();cancelAnimationFrame(anim);pinned=null;hideTip();const[cx,cy]=toMap(e.clientX,e.clientY);zoomAt(cx,cy,f);},{passive:false});
    mapHost.addEventListener("pointerdown",e=>{ptrType=e.pointerType||"mouse";if(!svgEl||(e.pointerType==="mouse"&&e.button!==0))return;cancelAnimationFrame(anim);ptrs.set(e.pointerId,[e.clientX,e.clientY]);drag={x:e.clientX,y:e.clientY,moved:false};
      if(ptrs.size===2){const[a,b]=[...ptrs.values()];pinch={d:Math.hypot(a[0]-b[0],a[1]-b[1])};drag.moved=true;}});
    mapHost.addEventListener("pointermove",e=>{if(!ptrs.has(e.pointerId))return;
      if(e.pointerType==="mouse"&&!(e.buttons&1)){ptrs.delete(e.pointerId);return;}
      const prev=ptrs.get(e.pointerId);ptrs.set(e.pointerId,[e.clientX,e.clientY]);
      if(ptrs.size===2&&pinch){const[a,b]=[...ptrs.values()],d=Math.hypot(a[0]-b[0],a[1]-b[1]),[cx,cy]=toMap((a[0]+b[0])/2,(a[1]+b[1])/2);zoomAt(cx,cy,d/pinch.d);pinch.d=d;pinned=null;hideTip();return;}
      if(ptrs.size!==1||!drag)return;
      if(!drag.moved){if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<5)return;drag.moved=true;try{mapHost.setPointerCapture(e.pointerId);}catch(_){}mapHost.classList.add("grab");}
      pinned=null;hideTip();const r=svgEl.getBoundingClientRect();
      setView([view[0]-(e.clientX-prev[0])/r.width*view[2],view[1]-(e.clientY-prev[1])/r.height*view[3],view[2],view[3]]);});
    const up=e=>{ptrs.delete(e.pointerId);if(ptrs.size<2)pinch=null;if(!ptrs.size)mapHost.classList.remove("grab");};
    mapHost.addEventListener("pointerup",up);mapHost.addEventListener("pointercancel",up);
    document.addEventListener("pointerdown",e=>{if(pinned!=null&&!e.target.closest("#co-map")){pinned=null;hideTip();}},{passive:true}); // tap anywhere else closes the popup
    addEventListener("scroll",()=>{if(pinned!=null){pinned=null;hideTip();}},{passive:true}); // the popup is fixed to the screen, so it must not float away from its district
    $("#co-zoom").onclick=e=>{const b=e.target.closest("[data-z]");if(!b)return;const z=b.dataset.z;
      if(z==="reset"){cityF="";drawMap();animateTo(stView(stF));return;}
      const f=z==="in"?1.8:1/1.8,cx=view[0]+view[2]/2,cy=view[1]+view[3]/2,w=view[2]/f;animateTo([cx-w/2,cy-w*AR/2,w,w*AR]);};
    setView(view);
  }
  // swings: projected leader differs from the 2025 winner (same vote type) -> drawn striped in the Leader view
  const prevLead=w=>{const i_=SNAP?W.indexOf(w):-1,a=SNAP?(voteMode===1?SNAP.F[i_]:SNAP.Sd[i_]):(voteMode===1?w.f25:w.s25);let b=0;for(let j=1;j<m-1;j++)if(a[j]>a[b])b=j;return b;};
  const swingOf=d=>yearView===PJ&&d&&d.lead!==prevLead(d.w)?prevLead(d.w):-1;
  // Regional projection card: vote share of the selected state / city / Ruhrgebiet = the projected constituency shares, weighted by each constituency's valid votes in the 2025 election.
  // Only second votes, only today's projection, only regions with at least REG_MIN constituencies (small cities are too noisy).
  const REG_MIN=4;
  function drawRegion(){
    const host=$("#co-region");if(!host)return;
    let rs=null,name="";
    if(cityF&&CITIES[cityF]){rs=R.filter(r=>CITIES[cityF].includes(r.w.n));name=cityF;}
    else if(stF){rs=R.filter(r=>r.w.land===stF);name=stF;}
    if(!rs||rs.length<REG_MIN||voteMode!==2||yearView!==PJ||SNAP){host.hidden=true;host.innerHTML="";return;}
    const t=rs.reduce((a,r)=>a+r.w.v,0),P=K.map((k,j)=>rs.reduce((a,r)=>a+r.w.v*r.x[j],0)/t),B=K.map((k,j)=>rs.reduce((a,r)=>a+r.w.v*r.w.s25[j],0)/t);
    const lead=K.map((k,j)=>rs.filter(r=>r.lead===j).length),mx=Math.max(...P);
    const ord=[...K.keys()].sort((a,b)=>(a===m-1)-(b===m-1)||P[b]-P[a]);
    const top=ord.find(j=>lead[j]>0&&j!==m-1),ld=top!=null?`${lab(K[top])} leads ${lead[top]} of ${rs.length}`:"";
    const sg=d=>{const v=Math.round(d*10)/10;return v===0?"\u00B10.0":(v>0?"+":"\u2212")+Math.abs(v).toFixed(1);};
    host.innerHTML=`<div class="rg-head"><h4>${name}</h4><span>projected second votes</span></div>
      <p class="subl">${rs.length} constituencies${ld?" \u00B7 "+ld:""} \u00B7 change vs ${GY}</p>
      <div class="rg-rows">${ord.map(j=>{const col=colorOf(K[j]),d=P[j]-B[j];
        return `<div class="rg-row"><span class="rg-n"><i class="${dark(col)?"dk":""}" style="background:${col}"></i>${lab(K[j])}</span><span class="rg-bar"><b class="${dark(col)?"dk":""}" style="width:${Math.max(1.5,P[j]/mx*100).toFixed(1)}%;background:${col}"></b></span><span class="rg-v">${P[j].toFixed(1)}%</span><span class="rg-d ${d>0.05?"up":d<-0.05?"dn":""}">${sg(d)}</span></div>`;}).join("")}</div>`;
    host.hidden=false;
  }
  function drawMap(){
  drawRegion();
    if(!hasMap)return;
    mapHost.innerHTML="";const svg=el("svg",{viewBox:vbStr(view),role:"img","aria-label":"Leading party per constituency"},mapHost);svgEl=svg;
    const leaderView=swings,defs=el("defs",{},svg),pats={};
    const swingFill=(a,b)=>{const id="sw"+a+"_"+b;if(!pats[id]){const pt=el("pattern",{id,width:7,height:7,patternUnits:"userSpaceOnUse",patternTransform:"rotate(45)"},defs);el("rect",{width:7,height:7,fill:pcol(a)},pt);el("rect",{width:3,height:7,fill:pcol(b)},pt);pats[id]=1;}return `url(#${id})`;};
    let selEl=null;
    // party view: the constituencies this party leads are outlined and drawn on top, all others are faded back
    const hlMode=mode!=null&&!certainty&&metric==null,leaders=[];
    paths.forEach(p=>{const r=byN[p.n],d=yearData[p.i],dim=(stF&&r.w.land!==stF)||(cityF&&!CITIES[cityF].includes(p.n)),isLead=hlMode&&d&&d.lead===mode;
      const e=el("path",{class:"wk"+(dim?" dim":"")+(p.n===sel?" sel":"")+(hlMode?(isLead?" lead":" fade"):""),d:p.d,fill:fillOf({i:p.i,w:r.w,prob:d?d.prob:1,lead:d?d.lead:0}),"data-n":p.n},svg);
      if(leaderView){const sw=swingOf(d);if(sw>=0)e.setAttribute("fill",swingFill(d.lead,sw));}
      if(p.n===sel)selEl=e;else if(isLead)leaders.push(e);
      e.addEventListener("mousemove",ev=>{if(ptrType!=="mouse")return;if(!drag||!drag.moved)tipFor(ev,{i:p.i,w:r.w});});e.addEventListener("mouseleave",()=>{if(ptrType==="mouse")hideTip();});
      e.addEventListener("click",ev=>{if(drag&&drag.moved)return;
        const touch=ptrType!=="mouse",now=Date.now(),dbl=lastClk&&now-lastClk.t<400&&Math.hypot(ev.clientX-lastClk.x,ev.clientY-lastClk.y)<10;
        if(!touch)hideTip();
        // two quick clicks on a constituency = double-click (done by hand: the map is redrawn after the first click, so the browser's own dblclick never fires)
        if(dbl){lastClk=null;hideTip();pinned=null;const ck=cityOf(p.n);
          if(ck){ // city district: double-click zooms to the city, double-click again back out to the federal map
            if(cityF===ck){cityF="";stF="";}else{cityF=ck;stF=r.w.land;}
            $("#co-state").value=stF;select(p.n);if(hasMap)animateTo(cityF?cityView(cityF):stView(stF));return;}
          const fromCity=!!cityF;cityF="";stF=(fromCity||stF!==r.w.land)?r.w.land:""; // from a city view, double-clicking elsewhere moves to that district's state
          $("#co-state").value=stF;select(p.n);if(hasMap)animateTo(stView(stF));return;}
        lastClk={t:now,x:ev.clientX,y:ev.clientY};
        // phone / tablet: a tap pins the popup (it stays until you tap somewhere else or the same district again), instead of vanishing when the finger lifts
        if(touch&&pinned===p.n){pinned=null;hideTip();select(p.n);return;}
        select(p.n);
        if(touch){pinned=p.n;tipFor({clientX:ev.clientX,clientY:ev.clientY,_touch:true},{i:p.i,w:r.w});}});});
    leaders.forEach(e=>svg.appendChild(e));
    if(selEl)svg.appendChild(selEl);
    $("#co-legend").innerHTML=legendHtml(mode,metric,certainty,true);
    if(certainty)$("#co-map-title").textContent="How certain is each constituency?";
    else if(metric!=null)$("#co-map-title").textContent=`${demoName(metric)} by constituency`;
    else if(swings)$("#co-map-title").textContent="Which constituencies swing?";
    else $("#co-map-title").textContent=mode==null?"Who leads in each constituency?":`Where does ${lab(K[mode])} lead?`;
    const subl=$("#co-map-subl");if(subl)subl.textContent=(yearView===PJ?projLbl():`Actual election result, ${yearView}`)+(voteMode===1?" \u00b7 first votes":"");
    if(swings&&subl)subl.textContent=`Striped = won by another party in ${BY()} (the ${BY()} winner is in the stripes)`+(voteMode===1?" \u00b7 first votes":"");
    if(metric!=null&&subl)subl.textContent=`Darker = higher in the ranking · ${yearView===PJ?GY+" structure data":yearView+" election structure data"}`;
  }
  // ---- the same map on the Overview tab (follows the party chips there, click opens the constituency) ----
  const ovHost=$("#ov-comap"),ovSw=$("#ov-mapsw");
  function paintOv(){
    if(!hasMap||!ovHost)return;const j=mapParty?K.indexOf(mapParty):-1,md=j>=0&&j<m-1?j:null,cert=md==null&&yearView===PJ; // no party chip selected = certainty view
    ovHost.innerHTML="";const svg=el("svg",{viewBox:bbox.join(" "),role:"img","aria-label":"Leading party per constituency"},ovHost);
    const lead_=[];
    paths.forEach(p=>{const r=byN[p.n],d=yearData[p.i],hl=md!=null&&!cert,isL=hl&&d&&d.lead===md,e=el("path",{class:"wk"+(hl?(isL?" lead":" fade"):""),d:p.d,fill:fillOf({i:p.i,w:r.w,prob:d?d.prob:1,lead:d?d.lead:0},md,null,cert),"data-n":p.n},svg);if(isL)lead_.push(e);
      e.addEventListener("mousemove",ev=>tipFor(ev,{i:p.i,w:r.w},null,cert));e.addEventListener("mouseleave",hideTip);
      e.addEventListener("click",()=>{hideTip();select(p.n);goTab("constituencies");});});
    lead_.forEach(e=>svg.appendChild(e));
    $("#ov-co-legend").innerHTML=cert?(()=>{const cnt=certBands.map(()=>0);yearData.forEach(d=>{if(d){const b=certBands.findIndex(x=>d.prob>=x[0]);cnt[b<0?cnt.length-1:b]++;}});
      return certBands.map((x,k)=>`<span>${x[1]} <b>${cnt[k]}</b></span>`).join("");})():legendHtml(md,null,false);
    $("#map-title").textContent=cert?"How certain is each constituency?":md==null?"Who leads in each constituency?":`Where does ${lab(K[md])} lead?`;
    const sb=document.querySelector(".ov-map .subl");if(sb)sb.textContent=cert?projLbl()+(voteMode===1?" \u00b7 first votes":"")+" \u00b7 darker = more certain":(yearView===PJ?projLbl():`Election result, ${yearView}`)+(voteMode===1?" \u00b7 first votes":"");
  }
  if(hasMap&&ovHost&&ovSw){
    ovSw.style.display="";ovCoRedraw=paintOv;
    const setV=v=>{ovView=v;const wk=v==="wk";ovSw.querySelectorAll("[data-m]").forEach(b=>b.classList.toggle("on",b.dataset.m===v));
      [$("#map"),$("#map-legend"),$("#map-note")].forEach(x=>{if(x)x.style.display=wk?"none":"";});
      ovHost.style.display=wk?"":"none";$("#ov-co-legend").style.display=wk?"":"none";
      if(wk)paintOv();else if(mapRedraw)mapRedraw();
      if(typeof fitOv==="function")fitOv();};
    ovSw.onclick=e=>{const b=e.target.closest("[data-m]");if(b&&b.dataset.m!==ovView)setV(b.dataset.m);};
    redraw.push(()=>{if(ovView==="wk")paintOv();});
    setV("wk"); // the constituency map is the main view; states stay one click away (and are the fallback when no constituency map exists)
  }
  function detail(){
    const r=byN[sel],w=r.w,col=j=>colorOf(K[j]);
    // right-hand panel follows the map: Projection = poll-average projection vs the 2025 result; 2021 / 2017 = that election's actual result,
    // Δ = change vs the election before (2021 vs 2017; for 2017 there is no earlier result, and no result at all in the ~5 % of constituencies redrawn in 2025)
    const isY=yearView!==PJ,yd=isY?yearData[r.i]:null,X=isY?(yd?yd.x:null):r.x,mx=X?Math.max(...X):1;
    const toss=r.prob<.6;
    const hq=hasQ&&voteMode===2&&!(SNAP&&!isY),f1=voteMode===1,w25=SNAP&&!isY?(f1?SNAP.F[r.i]:SNAP.Sd[r.i]):(f1?w.f25:w.s25),yA=SNAP&&!isY?SNAP.year:GY,yB=SNAP&&!isY?(SNAP.prevYear||"–"):GY-4,yv=(arr,j)=>arr&&!(j===5)?fmt(arr[j]):"–"; // BSW did not exist before 2024
    const s21=SNAP&&!isY?SNAP.prev(r.i,f1):(f1?w.f21:merge(w.p)),s17=!f1&&w.q?merge(w.q):null;
    const base=isY?(yearView===GY?s21:yearView===GY-4?s17:null):w25,src=X||w25;
    const rows=[...K.keys()].sort((a,b)=>src[b]-src[a]).map(j=>{
      const none=!X||(isY&&yearView!==2025&&j===5),nb=!X||!base||(isY&&j===5),d=nb?0:X[j]-base[j],c=pcol(j); // BSW did not exist in 2021 / 2017
      return `<div class="co-prow${hq?" hq":""}"><div class="co-pn"><i style="background:${c}"></i>${lab(K[j])}</div><div class="co-pb"><b style="width:${none?0:X[j]/mx*100}%;background:${c}"></b></div><div class="co-pv">${none?"–":fmt(X[j])+"%"}</div><div class="co-pd ${nb||Math.abs(d)<.05?"":d>0?"up":"dn"}">${nb?"–":Math.abs(d)<.05?"=":sg(d)}</div><div class="co-py">${yv(w25,j)}</div><div class="co-py">${yv(s21,j)}</div>${hq?`<div class="co-py">${yv(s17,j)}</div>`:""}</div>`;}).join("");
    // "About this constituency" follows the map: 2025 = current structure data, 2021 / 2017 = that election's structure data (d21 / d17).
    // The structure data only counts where the area is unchanged: 2017 results of constituencies redrawn between 2017 and 2021 are given on the 2021
    // boundaries, so those use the 2021 figures; ~5 % were redrawn in 2025 (no earlier result) and show the 2025 figures with a notice.
    const chain=yearView===PJ||yearView===GY||(isY&&!yd)?["d"]:yearView===2021&&GY===2025?["d21","d"]:["d17","d21","d"];
    const key=chain.find(k=>w[k])||"d",pool=W.filter(q=>q[key]),np_=pool.length;
    const keyYear=key==="d"?GY:key==="d21"?2021:2017,popT=pool.reduce((a,q)=>a+q[key][0],0);
    const yrNote=!w[key]?`<p class="co-fyear">No ${GY} structure data for this constituency: it was redrawn in 2025, so there are no comparable figures.</p>`
      :yearView===PJ||keyYear===yearView?"":key==="d"?`<p class="co-fyear">This constituency was redrawn in ${GY}, so there are no comparable ${yearView} figures. Showing ${GY} figures.</p>`
      :`<p class="co-fyear">The 2017 boundaries of this constituency changed before 2021, so the figures are from the 2021 data.</p>`;
    const demo=!w[key]?"":C.demo.map((dd,k)=>{
      const arr=pool.map(q=>q[key][k]).sort((a,b)=>a-b),v=w[key][k];
      const nat=k===0?popT/np_:pool.reduce((a,q)=>a+q[key][0]*q[key][k],0)/popT;
      const f=x=>x.toLocaleString("en-US",{minimumFractionDigits:dd.dec,maximumFractionDigits:dd.dec}),pctU=/%$/.test(dd.label);
      let name=dd.label.replace(/\s*%$/,"").replace(/\s*\(.*\)$/,""),pre="",suf="";
      if(pctU)suf="%";else if(/^Population/.test(dd.label))suf="k";else if(/^Density/.test(dd.label))suf=" /km²";else if(/income/i.test(dd.label))pre="€";
      const rank=arr.filter(x=>x>v).length+1,pos=arr.filter(x=>x<v).length/(np_-1),pn=arr.filter(x=>x<nat).length/(np_-1);
      const diff=pctU?v-nat:(v/nat-1)*100,dz=Math.abs(diff)<(pctU?.05:.5),dtxt=dz?"≈ average":(diff>0?"▲ ":"▼ ")+Math.abs(diff).toLocaleString("en-US",{maximumFractionDigits:pctU?1:0})+(pctU?" pts":"%");
      return `<div class="co-fact${metric===k?" on":""}" data-k="${k}" role="button" tabindex="0" aria-pressed="${metric===k}" title="${metric===k?"Click to go back to the party map":"Click to colour the map by this figure"}"><div class="co-fl">${name}</div>
        <div class="co-fvr"><span class="co-fv">${pre}${f(v)}${suf}</span><span class="co-dl ${dz?"eq":diff>0?"up":"dn"}">${dtxt}</span></div>
        <div class="co-ft"><span class="fill" style="width:${(pos*100).toFixed(1)}%"></span><span class="tick" style="left:${(pn*100).toFixed(1)}%"></span><span class="dot" style="left:${(pos*100).toFixed(1)}%"></span></div>
        <div class="co-ff"><span>${k===0?"Avg. constituency":"Germany"} ${pre}${f(nat)}${suf}</span><span>#${rank} of ${np_}</span></div></div>`;}).join("");
    $("#co-detail").innerHTML=`<h3>${w.name}</h3><p class="subl">${w.land} · Constituency ${w.n}</p>
      ${isY?(yd?`<div class="co-lead" style="border-left-color:${pcol(yd.lead)}"><b>${lab(K[yd.lead])} led</b><span>${fmt(yd.margin)} pts ahead of ${lab(K[yd.second])} · ${yearView} ${vn()} votes</span></div>`
        :`<div class="co-lead" style="border-left-color:var(--line)"><b>No ${yearView} result</b><span>Redrawn in ${GY}, so there is no comparable ${yearView} result</span></div>`)
      :`<div class="co-lead" style="border-left-color:${pcol(r.lead)}"><b>${toss?"Toss-up":lab(K[r.lead])+" ahead"}</b><span>${toss?`${lab(K[r.lead])} ${fmt(r.margin)} pts ahead of ${lab(K[r.second])} · ${Math.round(r.prob*100)}% chance`:`${fmt(r.margin)} pts ahead of ${lab(K[r.second])} · ${Math.round(r.prob*100)}% chance`}</span></div>`}
      <div class="co-ph${hq?" hq":""}"><span></span><span></span><span>${isY?yearView:"Proj."}</span><span title="${isY?(yearView===GY?"Change vs "+(GY-4):yearView===GY-4&&GY===2025?"Change vs 2017":""):"Projection minus "+yA+" result"}">Δ</span><span>${yA}</span><span>${yB}</span>${hq?"<span>2017</span>":""}</div>${rows}
      <h4 class="co-h4">About this constituency${yearView===PJ?"":` <span class="co-h4y">· ${keyYear}</span>`}</h4><p class="co-fyear">${metric==null?"Click a figure to colour the map by it (darker = higher in the ranking).":"Map coloured by "+demoName(metric).toLowerCase()+". Click it again to go back."}</p>${yrNote}<div class="co-facts">${demo}</div>
      ${w[key]?`<p class="co-fnote"><span class="lg"><span class="dot"></span>This constituency</span><span class="lg"><span class="tick"></span>Germany overall</span><span>Bar = rank among all ${np_}</span></p>`:""}
      <div class="note">${isY?`${yearView} election result (${vn()} votes) within the ${GY} constituency boundaries. ${yearView===GY?`Δ = change vs the ${GY-4} result.`:yearView===GY-4&&GY===2025?"Δ = change vs the 2017 result.":"Δ is empty because there is no earlier result to compare with."} The ${GY}, ${GY-4}${hq?" and "+(GY-8):""} columns are ${vn()}-vote shares (%).`
        :SNAP&&SNAP.poll?`Projection from the single ${SNAP.poll.inst||""} poll of ${fmtDate(SNAP.poll.t)}, built on the 2025 result. Δ = projected share minus the 2025 ${vn()}-vote result. The ${yA} and ${yB} columns are ${vn()}-vote shares (%). Pollster bias is not adjusted for a single poll. The structure data below is from ${GY}.`
        :SNAP?`Projection from the poll average of ${fmtDate(SNAP.ms)}, built on the ${SNAP.year} result. Δ = projected share minus the ${SNAP.year} ${vn()}-vote result. The ${yA} and ${yB} columns are ${vn()}-vote shares (%).${SNAP.filled&&SNAP.Sd[r.i]&&SNAP.est[r.i]?` The ${SNAP.year} figures for this constituency are estimated (no comparable result for these boundaries).`:""} Pollster bias is not adjusted in snapshots. The structure data below is from ${GY}.`
        :`Projection from the poll average of ${fmtDate(tMax)}. Δ = projected share minus the 2025 ${vn()}-vote result. 2025, 2021${hq?" and 2017":""} are ${vn()}-vote shares (%). 2025 projection includes historical pollster bias adjustment.`}</div>`;
  }
  // The list at the bottom follows the map: leader map = closest races; certainty map = ranked by certainty; party map = by that party's share; figure map = by that figure.
  function list(){
    const view=certainty?"cert":metric!=null?"metric":mode!=null?"party":"lead";
    const opts={lead:[["close","Closest races first"],["n","By number"]],cert:[["close","Toss-ups first"],["safe","Safest first"],["n","By number"]],
      party:[["high","Strongest first"],["low","Weakest first"],["n","By number"]],metric:[["high","Highest first"],["low","Lowest first"],["n","By number"]]}[view];
    if(list.last!==view||!opts.some(o=>o[0]===sortBy))sortBy=opts[0][0]; // a new map type starts with its natural order
    list.last=view;
    const yrTxt=yearView===PJ?"projection":yearView+" result";
    const val=r=>view==="party"?(yearData[r.i]?yearData[r.i].x[mode]:null):view==="metric"?mval(r.w):null;
    let rank=null;if(val&&(view==="party"||view==="metric")){const all=R.map(val).filter(v=>v!=null).sort((a,b)=>b-a);rank=v=>all.filter(x=>x>v).length+1;}
    const cmp={n:(a,b)=>a.w.n-b.w.n,close:(a,b)=>a.prob-b.prob||a.margin-b.margin,safe:(a,b)=>b.prob-a.prob||b.margin-a.margin,
      high:(a,b)=>(val(b)??-1e9)-(val(a)??-1e9),low:(a,b)=>(val(a)??1e9)-(val(b)??1e9)}[sortBy];
    const rows=R.filter(r=>(!stF||r.w.land===stF)&&(!q||(r.w.name+" "+r.w.land+" "+r.w.n).toLowerCase().includes(q))).sort(cmp);
    $("#co-list-sub").textContent={lead:"Select one to see its projection and demographics",cert:"Ranked by how certain the projected leader is · select one to see its projection",
      party:`Ranked by ${lab(K[mode])} share (${yrTxt}) · select one for details`,metric:`Ranked by ${(metric!=null?demoName(metric):"").toLowerCase()} (${yearView===PJ?GY:yearView} data) · select one for details`}[view];
    $("#co-sort").innerHTML=opts.map(([k,t])=>`<button type="button" class="faction-chip ${sortBy===k?"on":""}" data-k="${k}">${t}</button>`).join("");
    $("#co-list").innerHTML=rows.map(r=>{
      let ld=`<i style="background:${pcol(r.lead)}"></i>${lab(K[r.lead])} ${fmt(r.share)}%`,pr=`<span class="co-pr${r.prob<.6?" t":""}">${r.prob<.6?"Toss-up":Math.round(r.prob*100)+"%"}</span>`;
      if(view==="party"||view==="metric"){const v=val(r);
        ld=view==="party"?`<i style="background:${pcol(mode)}"></i>${lab(K[mode])} ${v==null?"–":fmt(v)+"%"}`:`<i style="background:var(--accent)"></i>${v==null?"–":demoFmt(metric,v)}`;
        pr=`<span class="co-pr rk">${v==null?"–":"#"+rank(v)}</span>`;}
      return `<button type="button" class="co-li${r.w.n===sel?" on":""}" data-n="${r.w.n}"><span class="co-n">${r.w.n}</span><span class="co-nm">${r.w.name}<small>${r.w.land}</small></span><span class="co-ld">${ld}</span>${pr}</button>`;}).join("")||`<div class="note">No constituency found.</div>`;
  }
  function select(num,scroll){sel=num;detail();drawMap();list();if(scroll){const e=$("#co-list .on");if(e)e.scrollIntoView({block:"nearest"});}}
  const setYear=y=>{yearView=y===PJ?PJ:+y;yearData=getYearData(yearView);if(yearView!==PJ){certainty=false;swings=false;}renderYearButtons();renderViewButtons();coChips();drawMap();detail();list();};
  const setVote=v=>{v=+v;if(v===voteMode||(v===1&&!firstOK()))return;voteMode=v;applyProj(v);miCache=null;
    if(!availYears().includes(yearView))yearView=PJ;yearData=getYearData(yearView);if(yearView!==PJ){certainty=false;swings=false;}
    setTexts();renderVoteButtons();renderYearButtons();renderViewButtons();coChips();drawMap();detail();list();if(ovView==="wk")paintOv();};
  const cv=$("#co-vote");if(cv)cv.onclick=e=>{const b=e.target.closest("[data-vote]");if(b)setVote(b.dataset.vote);};
  $("#co-year-filter").onclick=e=>{const b=e.target.closest("[data-year]");if(b)setYear(b.dataset.year);};
  if(CAL_ON){const cb=$("#co-cal");if(cb){cb.hidden=false;cb.onclick=()=>openCal();const di=$("#co-date");if(di){di.hidden=false;di.disabled=false;}}}
  // ---- date snapshots: the map as it would have looked on a past date (polls up to that day, built on the election before it) ----
  const ELD=[[2025,Date.UTC(2025,1,23)],[2021,Date.UTC(2021,8,26)],[2017,Date.UTC(2017,8,24)],[2013,Date.UTC(2013,8,22)]]; // federal election days: the base for a date is the last election before it
  const iso=t=>new Date(t).toISOString().slice(0,10),minMs=()=>tMin+14*DAY;
  const eraOf=ms=>ELD.find(e=>ms>=e[1]+(e[0]===2021?2*DAY:0))||ELD[3]; // the 2021 election modelling runs up to and including the day AFTER the election (27 Sep 2021), the others change over on election day
  // fill constituencies without a comparable result of that election: later election's shares x (national ratio earlier/later over the constituencies that have both)
  function fillFrom(base,later){const fac=K.map((k,j)=>{let a=0,b=0;W.forEach((w,i)=>{if(base[i]){a+=V[i]*base[i][j];b+=V[i]*later[i][j];}});return b>0?a/b:1;});
    let est=0;const out=base.map((x,i)=>{if(x)return x;est++;const y=later[i].map((v,j)=>v*fac[j]),t=y.reduce((a,b)=>a+b,0);return y.map(v=>v/t*100);});return{out,est,flag:base.map(x=>!x)};}
  const baseCache={};
  function baseSet(year){
    const ck=GY+"|"+year;if(baseCache[ck])return baseCache[ck];
    const nat=S=>K.map((k,j)=>W.reduce((a,w,i)=>a+V[i]*S[i][j],0)/Vt);let o;
    if(year===2025)o={S:W.map(w=>w.s25),F:W.map(w=>w.f25),est:W.map(()=>false),filled:0,prevYear:2021,prev:(i,f1)=>f1?W[i].f21:W[i].s21};
    else if(year===2021)o={S:W.map(w=>w.s21),F:W.every(w=>w.f21)?W.map(w=>w.f21):null,est:W.map(()=>false),filled:0,prevYear:2017,prev:(i,f1)=>f1?null:(W[i].q?merge(W[i].q):null)};
    else if(year===2017&&GY===2021)o={S:W.map(w=>w.s21),F:W.every(w=>w.f21)?W.map(w=>w.f21):null,est:W.map(()=>false),filled:0,prevYear:null,prev:()=>null}; // 2017 result recalculated to the 2021 boundaries by the Bundeswahlleiterin: complete, nothing to estimate (no 2013 result on these boundaries)
    else if(year===2017){const f=fillFrom(W.map(w=>w.q?merge(w.q):null),W.map(w=>w.s21));o={S:f.out,F:null,est:f.flag,filled:f.est,prevYear:R13?2013:null,prev:(i,f1)=>f1||!R13||!R13[W[i].n]?null:R13[W[i].n].s13};}
    else{const b17=baseSet(2017).S,f=fillFrom(W.map(w=>R13&&R13[w.n]?R13[w.n].s13:null),b17);o={S:f.out,F:null,est:f.flag,filled:f.est,prevYear:null,prev:()=>null};}
    o.year=year;o.nat=nat(o.S);return baseCache[ck]=o;
  }
  function buildSnap(ms,poll){
    const year=eraOf(ms)[0],B=baseSet(year),refMs=(ELD.find(e=>e[0]===year)||ELD[3])[1],pl=polls.filter(r=>r.t<=ms);
    const av=k=>smoothedValueAt(pl,k,ms,BW);
    let Tn=K.map((k,j)=>{if(k==="Sonstige"){const a=av("Sonstige"),b=av("Freie Wähler");return a==null&&b==null?B.nat[j]:(a||0)+(b||0);}const v=av(k);return v!=null?v:B.nat[j];});
    if(poll){ // one single poll sets the national level: a party the poll does not list is 0.1 %, "Others" = the poll's Sonstige (+ Freie Wähler), or whatever is left over
      const o=m-1;Tn=K.map((k,j)=>{if(j===o)return null;const v=poll.v[k];return v!=null?v:.1;});
      const a=poll.v["Sonstige"],b=poll.v["Freie Wähler"],rest=100-Tn.reduce((x,y)=>x+(y||0),0);
      Tn[o]=a==null&&b==null?Math.max(rest,.5):(a||0)+(b||0);}
    const ts=Tn.reduce((a,b)=>a+b,0);Tn=Tn.map(v=>v/ts*100);
    // a party that did not exist at the last election (BSW) has no result to start from: its starting pattern is borrowed from the Left (its main source of voters), the national level comes from the polls
    const Sm=B.S.map(r=>r.slice());if(B.nat[5]<.05&&Tn[5]>.3)Sm.forEach((r,i)=>{r[5]=Math.max(r[4],.5)*.3;});
    const Us={},PVs={};
    stLands.forEach(land=>{const id=idOf[nz(land)],sd=id&&stateData[id],recs=sd?sd.rec.filter(r=>r.t<=ms):[];Us[land]=new Array(m).fill(0);PVs[land]=new Array(m).fill(0);
      for(let j=0;j<m-1;j++){if(MD){const r=stateSignal(recs,j,ms,refMs,pl);Us[land][j]=r.u;PVs[land][j]=r.pv;}}});
    return{key:poll?"p"+poll.t+"|"+(poll.inst||""):"s"+ms,poll:poll||null,ms,year,S:Sm,Sd:B.S,F:B.F,est:B.est,filled:B.filled,prevYear:B.prevYear,prev:B.prev,T:Tn,nat:B.nat,U:Us,PV:PVs};
  }
  // Which boundaries a date uses = those of the election the map projects: before the 2017 election -> 2025 map (no earlier map available), 2017 up to the day after the 2021 election -> 2021 map, after that and today -> 2025 map.
  const geoYearOf=ms=>ms!=null&&eraOf(ms)[0]===2017?2021:2025;
  let set21P=null,asOfTok=0;
  const loadSet21=()=>set21P||(set21P=(async()=>{ // fetched the first time a date in that period is picked
    try{const a=await fetchRaw("data/constituencies2021.json"),b=hasMap?await fetchRaw("data/wahlkreise2021.geojson"):{ok:true,text:"null"};
      if(!a.ok||!b.ok)throw new Error("HTTP "+(a.ok?b.status:a.status));
      const c=JSON.parse(a.text);if(!c.wk||c.wk.length!==299||c.parties.join()!==PI.join())throw new Error("unexpected file");
      const W2=mkW(c.wk),g=hasMap?geoBuild(JSON.parse(b.text),W2):null;if(hasMap&&!g)throw new Error("no geometry");
      const V2=W2.map(w=>w.v);SETS[2021]={GY:2021,W:W2,n:W2.length,V:V2,Vt:V2.reduce((x,y)=>x+y,0),geo:g,cities:CITIES21};
    }catch(e){console.error("2021 constituency boundaries could not be loaded, the 2025 boundaries are used instead:",e);}
  })());
  function useSet(gy){const S=SETS[gy];if(!S||GY===gy)return false;
    GY=gy;W=S.W;n=S.n;V=S.V;Vt=S.Vt;hasQ=W.some(q=>q.q);hasFirst=!!(MD&&MD.first&&W.every(w=>w.f25&&w.f21));FB=hasFirst?MD.first.backtest:null;CITIES=S.cities;cityF="";
    if(hasMap&&S.geo){paths=S.geo.paths;bbox=S.geo.bbox;stBox=S.geo.stBox;AR=bbox[3]/bbox[2];setView(stView(stF));}
    return true;}
  const setAsOf=async ms=>{
    if(ms!=null&&ms>=tMax)ms=null;
    const tok=++asOfTok;
    if(geoYearOf(ms)===2021&&!SETS[2021]){await loadSet21();if(tok!==asOfTok)return;} // a newer date was picked while loading
    const prevW=byN[sel]?byN[sel].w:null,switched=useSet(ms!=null&&geoYearOf(ms)===2021&&SETS[2021]?2021:2025);
    selPollMap=null;renderPT();
    SNAP=ms==null?null:buildSnap(ms);
    if(SNAP&&voteMode===1&&!SNAP.F)voteMode=2;
    applyProj(voteMode);miCache=null;
    if(switched){const same=prevW&&R.find(r=>r.w.name===prevW.name&&r.w.land===prevW.land);sel=same?same.w.n:[...R].sort((a,b)=>a.prob-b.prob)[0].w.n;} // constituency numbers differ between the sets: keep the same constituency by name
    if(!availYears().includes(yearView))yearView=PJ;yearData=getYearData(yearView);if(yearView!==PJ){certainty=false;swings=false;}
    setTexts();renderVoteButtons();renderYearButtons();renderViewButtons();coChips();drawMap();detail();list();if(ovView==="wk")paintOv();
  };
  // ---- single poll: the map as if ONE chosen poll (published after the 2025 election) were the election result ----
  const POLL_ON=GY===2025&&polls.some(r=>r.t>ELD[0][1]);
  const poolPolls=()=>polls.map((r,i)=>({r,i})).filter(o=>o.r.t>ELD[0][1]).reverse(); // newest first
  const pollKey=r=>iso(r.t)+"_"+HS.enc(r.inst||"");
  let selPollMap=null;
  const setPoll=async idx=>{
    const tok=++asOfTok;
    const prevW=byN[sel]?byN[sel].w:null,switched=useSet(2025);
    selPollMap=idx;
    SNAP=idx==null?null:buildSnap(polls[idx].t,polls[idx]);
    if(SNAP&&voteMode===1&&!SNAP.F)voteMode=2;
    applyProj(voteMode);miCache=null;
    if(switched){const same=prevW&&R.find(r=>r.w.name===prevW.name&&r.w.land===prevW.land);sel=same?same.w.n:[...R].sort((a,b)=>a.prob-b.prob)[0].w.n;}
    if(!availYears().includes(yearView))yearView=PJ;yearData=getYearData(yearView);if(yearView!==PJ){certainty=false;swings=false;}
    if(idx!=null){const f=$("#co-pt-fold");if(f&&!f.open)f.open=true;}
    renderPT();
    setTexts();renderVoteButtons();renderYearButtons();renderViewButtons();coChips();drawMap();detail();list();if(ovView==="wk")paintOv();
  };
  // poll table under the map: the same "Latest polls" table as in the Polls tab; click a poll to model the map on it. Polls that currently feed the poll average are highlighted.
  const ptHost=$("#co-pollcard"),PT_FIRST=15,PT_STEP=25;let ptShown=PT_FIRST,ptYear="",ptSort={k:null,d:-1};
  const usedFrom=()=>tMax-3*BW*DAY; // the average (smoothedValueAt) uses polls within 3 smoothing widths before the latest poll, each weighted by a bell curve
  const wOf=r=>{const dx=(r.t-tMax)/(BW*DAY);return Math.abs(dx)>3?0:Math.exp(-.5*dx*dx);};
  function renderPT(){
    if(!ptHost||!POLL_ON)return;
    const cand=parties.filter(p=>!isOther(p)),pool=poolPolls().filter(o=>ptYear===""||new Date(o.r.t).getUTCFullYear()===+ptYear);
    const wt=polls.reduce((a,r)=>a+wOf(r),0)||1;let shown=pool.slice(0,ptShown);
    if(ptSort.k){const g=({r})=>ptSort.k==="t"?r.t:ptSort.k==="inst"?(r.inst||"").toLowerCase():ptSort.k==="w"?wOf(r):(r.v[ptSort.k]==null?-Infinity:r.v[ptSort.k]);
      shown=shown.map((o,i)=>[o,i]).sort((a,b)=>{const x=g(a[0]),y=g(b[0]);return(x<y?-1:x>y?1:0)*ptSort.d||a[1]-b[1];}).map(o=>o[0]);}
    const th=(k,html,style,cls,title)=>`<th class="srt ${cls||""}" data-sort="${escF(k)}" tabindex="0" role="button" aria-sort="${ptSort.k===k?(ptSort.d>0?"ascending":"descending"):"none"}" title="${title||"Sort by this column"}"${style?` style="${style}"`:""}>${html}<i class="srta">${ptSort.k===k?(ptSort.d>0?"\u25B2":"\u25BC"):""}</i></th>`;
    const rows=shown.map(({r,i})=>{const top=Math.max(...cand.map(p=>r.v[p]??-1)),w=wOf(r),used=w>0;
      return `<tr class="${selPollMap===i?"sel":""}${used?" used":""}" data-i="${i}" tabindex="0" role="button" aria-pressed="${selPollMap===i}" title="Model the map on this poll"><td>${fmtDate(r.t)}</td><td>${escF(r.inst||"")}</td>${parties.map(p=>`<td class="${r.v[p]===top&&!isOther(p)?"lead":""}">${r.v[p]!=null?fmt(r.v[p])+"%":"\u2013"}</td>`).join("")}<td class="pt-w">${used?`<span class="pt-chip" title="This poll is part of the poll average the default map is based on">${(w/wt*100).toFixed(1)}%</span>`:""}</td></tr>`;}).join("");
    const left=pool.length-ptShown,yrs=[...new Set(poolPolls().map(o=>new Date(o.r.t).getUTCFullYear()))].sort((a,b)=>b-a);
    const note=selPollMap!=null&&polls[selPollMap]?`<div class="sec-top"><span>Map modelled on the <b>${escF(polls[selPollMap].inst||"selected")}</b> poll of <b>${fmtDate(polls[selPollMap].t)}</b></span><button class="link" data-back="1" type="button">Back to poll average</button></div>`:"";
    const fold=$("#co-pt-fold");
    if(!fold){ptHost.innerHTML=`<details class="sec fold" id="co-pt-fold"><summary><h3>Latest federal polls</h3></summary><div id="co-pt-body"></div></details>`;
      $("#co-pt-fold").addEventListener("toggle",()=>{if($("#co-pt-fold").open)renderPT();});}
    if(!$("#co-pt-fold").open)return; // the table is only built when the section is opened
    $("#co-pt-body").innerHTML=`<div><p class="subl">Click a poll to see the map as if that one poll were the election result. Highlighted polls are the ones that make up the current poll average; the percentage is each poll\u2019s weight in it.</p>
      <div class="pt-bar"><select class="yr-sel${ptYear!==""?" on":""}" id="co-poll-year" aria-label="Show polls of one year"><option value="">All years</option>${yrs.map(y=>`<option value="${y}"${+ptYear===y?" selected":""}>${y}</option>`).join("")}</select></div>
      ${note?`<div class="pp-note pt-note">${note}</div>`:""}
      <div class="scroll"><table class="pp"><thead><tr>${th("t","Date")}${th("inst","Pollster")}${parties.map(p=>th(p,lab(p),`border-bottom-color:${colorOf(p,parties.indexOf(p))}`,dark(colorOf(p))?"dk":"")).join("")}${th("w","In average","","","Sort by weight in the current poll average")}</tr></thead><tbody>${rows||`<tr><td colspan="${parties.length+3}">No polls in this year.</td></tr>`}</tbody></table></div>
      <div class="pp-more">${left>0?`<button type="button" class="faction-chip" data-a="more">See more${left>PT_STEP?"":" ("+left+")"}</button>`:""}${ptShown>PT_FIRST?`<button type="button" class="faction-chip" data-a="hide">Hide</button>`:""}</div></div>`;
  }
  if(ptHost&&POLL_ON){
    ptHost.hidden=false;renderPT();if(selPollMap!=null){const f=$("#co-pt-fold");if(f)f.open=true;}
    const pick=i=>{const f=selPollMap===i?null:i;setPoll(f);if(f!=null)$("#co-mapcard").scrollIntoView({block:"start",behavior:"smooth"});};
    ptHost.addEventListener("click",e=>{
      if(e.target.closest("[data-back]")){setPoll(null);return;}
      const h=e.target.closest("th[data-sort]");if(h){const k=h.dataset.sort;ptSort=ptSort.k===k?{k,d:-ptSort.d}:{k,d:k==="inst"?1:-1};renderPT();const n=$(`#co-pollcard th[data-sort="${k}"]`);if(n)n.focus();return;}
      const m=e.target.closest("button[data-a]");if(m){ptShown=m.dataset.a==="more"?ptShown+PT_STEP:PT_FIRST;renderPT();return;}
      const tr=e.target.closest("tr[data-i]");if(tr)pick(+tr.dataset.i);});
    ptHost.addEventListener("keydown",e=>{if(e.key!=="Enter"&&e.key!==" ")return;const h=e.target.closest("th[data-sort]");if(h){e.preventDefault();h.click();return;}const tr=e.target.closest("tr[data-i]");if(tr){e.preventDefault();pick(+tr.dataset.i);}});
    ptHost.addEventListener("change",e=>{if(e.target.id==="co-poll-year"){ptYear=e.target.value;ptShown=PT_FIRST;renderPT();}});
  }
  function openCal(){
    const inp=$("#co-date"),b=$("#co-cal");if(!inp||!b)return;
    inp.min=iso(minMs());inp.max=iso(tMax);inp.value=SNAP?iso(SNAP.ms):iso(tMax);
    inp.style.left=b.offsetLeft+"px";inp.style.top=(b.offsetTop+b.offsetHeight)+"px";
    try{if(inp.showPicker){inp.showPicker();return;}}catch(e){}
    inp.focus();inp.click();
  }
  const dEl=$("#co-date");
  if(CAL_ON&&dEl)dEl.onchange=()=>{const v=dEl.value;if(!v){setAsOf(null);return;}const p=parseDate(v);if(!p)return;let t=Math.max(minMs(),+p);setAsOf(t);};
  $("#co-vote-note").onclick=e=>{if(e.target.closest("[data-back]")){if(selPollMap!=null)setPoll(null);else if(CAL_ON)setAsOf(null);}};
  const setMode=j=>{mode=mode===j?null:j;if(mode!=null){metric=null;certainty=false;swings=false;}coChips();renderViewButtons();drawMap();detail();list();};
  const setSwing=on=>{swings=on;if(on){mode=null;metric=null;certainty=false;}coChips();renderViewButtons();drawMap();detail();list();};
  const setCert=on=>{certainty=on;if(on){mode=null;metric=null;swings=false;}coChips();renderViewButtons();drawMap();detail();list();};
  $("#co-view").onclick=e=>{const b=e.target.closest("[data-v]");if(b&&!b.disabled){if(b.dataset.v==="cert")setCert(!certainty);else if(b.dataset.v==="swing")setSwing(!swings);else{mode=null;metric=null;certainty=false;swings=false;coChips();renderViewButtons();drawMap();detail();list();}}};
  $("#co-chips").addEventListener("click",e=>{if(e.target.closest(".chip[data-cert]"))setCert(!certainty);});
  $("#co-chips").addEventListener("keydown",e=>{if((e.key==="Enter"||e.key===" ")&&e.target.closest(".chip[data-cert]")){e.preventDefault();setCert(!certainty);const c=$("#co-chips .chip[data-cert]");if(c)c.focus();}});
  const setMetric=k=>{metric=metric===k?null:k;if(metric!=null){mode=null;certainty=false;swings=false;coChips();}renderViewButtons();drawMap();detail();list();};
  $("#co-detail").onclick=e=>{const c=e.target.closest(".co-fact[data-k]");if(c)setMetric(+c.dataset.k);};
  $("#co-detail").onkeydown=e=>{if(e.key!=="Enter"&&e.key!==" ")return;const c=e.target.closest(".co-fact[data-k]");if(c){e.preventDefault();setMetric(+c.dataset.k);const k=$(`#co-detail .co-fact[data-k="${c.dataset.k}"]`);if(k)k.focus();}};
  $("#co-chips").onclick=e=>{const c=e.target.closest(".chip[data-p]");if(c)setMode(+c.dataset.p);};
  $("#co-chips").onkeydown=e=>{if(e.key!=="Enter"&&e.key!==" ")return;const c=e.target.closest(".chip[data-p]");if(c){e.preventDefault();setMode(+c.dataset.p);const n=$(`#co-chips .chip[data-p="${c.dataset.p}"]`);if(n)n.focus();}};
  $("#co-state").onchange=e=>{stF=e.target.value;cityF="";drawMap();list();if(hasMap)animateTo(stView(stF));};
  $("#co-search").oninput=e=>{q=e.target.value.trim().toLowerCase();list();};
  $("#co-sort").onclick=e=>{const b=e.target.closest("[data-k]");if(b){sortBy=b.dataset.k;list();}};
  $("#co-list").onclick=e=>{const b=e.target.closest("[data-n]");if(b)select(+b.dataset.n);};
  // shareable link settings of the Battleground map: vote type, election year, map colouring, state zoom, selected constituency (and the date snapshot, once that feature is switched on)
  {const sel0=sel;
  HS.reg("constituencies","vote",()=>voteMode===1?"1":null,v=>{setVote(v==="1"?1:2);});
  HS.reg("constituencies","poll",()=>selPollMap!=null&&polls[selPollMap]?pollKey(polls[selPollMap]):null,v=>{
    let i=null;if(v){const k=v.indexOf("_"),d=k<0?v:v.slice(0,k),inst=k<0?null:HS.dec(v.slice(k+1));
      for(let q2=polls.length-1;q2>=0;q2--)if(polls[q2].t>ELD[0][1]&&iso(polls[q2].t)===d&&(inst==null||(polls[q2].inst||"")===inst)){i=q2;break;}}
    if(i===selPollMap)return;return setPoll(i);});
  HS.reg("constituencies","asof",()=>CAL_ON&&SNAP?iso(SNAP.ms):null,v=>{if(!CAL_ON)return;const p=v?parseDate(v):null;return setAsOf(p?Math.max(minMs(),+p):null);});
  HS.reg("constituencies","year",()=>yearView===PJ?null:String(yearView),v=>{const y=v==null?PJ:+v;if(y===yearView||(y!==PJ&&!availYears().includes(y)))return;setYear(y);});
  HS.reg("constituencies","map",()=>mode!=null?"p:"+HS.enc(K[mode]):swings?"swing":certainty?null:metric!=null?"m"+metric:"lead",v=>{
    mode=null;metric=null;certainty=false;swings=false;
    if(v==null)certainty=true;
    else if(v==="swing")swings=true;
    else if(v==="lead"){}
    else if(v.slice(0,2)==="p:"){const j=K.indexOf(HS.dec(v.slice(2)));if(j>=0&&j<m-1)mode=j;else certainty=true;}
    else if(/^m\d+$/.test(v)&&+v.slice(1)<C.demo.length)metric=+v.slice(1);
    else certainty=true;
    if(yearView!==PJ){certainty=false;swings=false;}
    coChips();renderViewButtons();drawMap();detail();list();});
  HS.reg("constituencies","st",()=>stF||null,v=>{const nm=v?HS.dec(v):"";const t=lands.includes(nm)?nm:"";if(t===stF)return;stF=t;cityF="";$("#co-state").value=t;drawMap();list();if(hasMap)animateTo(stView(stF));});
  HS.reg("constituencies","wk",()=>sel!==sel0?String(sel):null,v=>{const nn=v==null?sel0:+v;if(nn===sel||!W.some(w=>w.n===nn))return;select(nn,false);});}
  coChips();list();select(sel);redraw.push(()=>{drawMap();list();});
  // warm the cache: the first-vote projection is computed once the browser is idle after load, so clicking "First vote" is instant
  if(hasFirst){const warm=()=>{if(!projCache["live|1"]&&GY===2025)try{projCache["live|1"]=runProjection(1);}catch(e){console.error(e);}};
    if(window.requestIdleCallback)requestIdleCallback(warm,{timeout:4000});else setTimeout(warm,800);}
}
await yieldUi();
try{await drawConstituencies();}catch(e){console.error(e);showErr("Constituencies tab failed to load: "+e.message);}


await yieldUi();
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

await yieldUi();
// ---------- POLITICIAN SATISFACTION (Poll Average tab) ----------
// data/politicians_approval.json = ARD-DeutschlandTREND by Infratest dimap. Every politician's line is a shade of his or her party's colour.
const POLS={polls:[],people:[],act:new Set(),metric:"sat",range:"all",estMax:null};
const PRANGES=[["1y","1 year",12],["2y","2 years",24],["all","All time",0]];
const PMETRICS=[["sat","Satisfied"],["dis","Dissatisfied"],["net","Net"]];
const PSPEC=["Linke","BSW","SPD","Grüne","FDP","CDU","CSU","AfD"];
const PSUB={sat:"Share of respondents satisfied with each politician",dis:"Share of respondents dissatisfied with each politician",net:"Satisfied minus dissatisfied, in percentage points"};
const pFam=p=>p==="CDU"||p==="CSU"?"CDU/CSU":p;
const pBase=p=>colorOf(pFam(p));
const pLab=p=>p==="CDU"||p==="CSU"?p:lab(p);
const darken=(hex,a)=>{const c=hex.replace("#","");if(c.length!==6)return hex;const ch=i=>Math.round(parseInt(c.substr(i,2),16)*(1-a)).toString(16).padStart(2,"0");return"#"+ch(0)+ch(2)+ch(4);};
const shortN=n=>{const t=n.split(" "),i=t.findIndex((w,k)=>k>0&&w[0]===w[0].toLowerCase());return t.slice(i>0?i:t.length-1).join(" ");};
const monYr=t=>new Date(t).toLocaleDateString("en-GB",{month:"short",year:"numeric",timeZone:"UTC"});
const sgnI=v=>(v>0?"+":v<0?"\u2212":"")+Math.abs(Math.round(v));
// the i-th of n politicians of one party family: same hue, stepped lightness (dark party colours only get lighter, pale ones only darker)
function polShade(base,i,n,dm){
  const L=lum(base),black=L<60,pale=L>=170;
  const lo=black?(dm?.40:.16):pale?(dm?-.12:-.50):(dm?-.10:-.32),hi=black?(dm?.80:.64):pale?(dm?.18:-.10):(dm?.40:.34);
  const a=n>1?lo+(hi-lo)*i/(n-1):black?(dm?.55:.10):pale?(dm?0:-.18):0;
  return a>=0?lighten(base,a):darken(base,-a);
}
function polColors(dm){
  const g={},out={};
  [...POLS.people].sort((a,b)=>b.n-a.n||b.last-a.last).forEach(p=>(g[pFam(p.party)]=g[pFam(p.party)]||[]).push(p));
  Object.values(g).forEach(a=>a.forEach((p,i)=>out[p.name]=polShade(pBase(p.party),i,a.length,dm)));
  return out;
}
const polVal=(x,m)=>m==="sat"?x.satisfied_pct:m==="dis"?x.dissatisfied_pct:(x.satisfied_pct!=null&&x.dissatisfied_pct!=null?x.satisfied_pct-x.dissatisfied_pct:null);
try{
  const r=await fetchRaw(cfg.politiciansJson||"data/politicians_approval.json");
  if(r.ok){
    POLS.polls=JSON.parse(r.text).map(p=>({t:+parseDate(p.poll_info.publish_date),est:!!p.poll_info.estimated_from_chart,inst:p.poll_info.institution||"Infratest dimap",survey:p.poll_info.source_survey||"ARD-DeutschlandTREND",res:p.results||[]})).filter(p=>!isNaN(p.t)).sort((a,b)=>a.t-b.t);
    const m=new Map();
    POLS.polls.forEach(p=>p.res.forEach(x=>{let q=m.get(x.name);if(!q){q={name:x.name,party:x.party,n:0,last:0};m.set(x.name,q);}q.n++;q.last=p.t;q.party=x.party;}));
    POLS.people=[...m.values()].sort((a,b)=>PSPEC.indexOf(a.party)-PSPEC.indexOf(b.party)||b.n-a.n||b.last-a.last);
    const lastP=POLS.polls[POLS.polls.length-1];
    POLS.act=new Set(lastP.res.map(x=>x.name));
    POLS.estMax=Math.max(-Infinity,...POLS.polls.filter(p=>p.est).map(p=>p.t));if(POLS.estMax===-Infinity)POLS.estMax=null;
  }
}catch(e){console.error(e);POLS.polls=[];}
function polChips(){
  const dm=isDarkMode(),col=polColors(dm),L=POLS.polls,parties=PSPEC.filter(p=>POLS.people.some(x=>x.party===p));
  $("#pol-range").innerHTML=PRANGES.map(r=>`<button type="button" class="faction-chip ${POLS.range===r[0]?"on":""}" data-r="${r[0]}">${r[1]}</button>`).join("");
  $("#pol-metric").innerHTML=PMETRICS.map(r=>`<button type="button" class="faction-chip ${POLS.metric===r[0]?"on":""}" data-m="${r[0]}">${r[1]}</button>`).join("");
  // party chips = show / hide everyone of that party (same look as "Party visibility" above); filled = all shown, tinted = some shown
  $("#pol-party").innerHTML=parties.map(p=>{const c=pBase(p),all=POLS.people.filter(x=>x.party===p),k=all.filter(x=>POLS.act.has(x.name)).length,on=k===all.length,part=k>0&&!on;
    return`<button type="button" class="faction-chip pc${dark(c)?" dkb":""} ${on?"on":""}${part?" part":""}" data-p="${p}" aria-pressed="${on}" style="border-color:${c};${on?`background:${c};color:${contrast(c)}`:part?`background:color-mix(in srgb,${c} 24%,transparent)`:""}">${pLab(p)}</button>`;}).join("");
  // individual politicians live in a collapsible panel (like "Customize coalitions"), grouped by party; the dot is the colour of the line
  const kOn=POLS.people.filter(x=>POLS.act.has(x.name)).length,lbl=$("#pol-pick-lbl");
  if(lbl)lbl.textContent=`Choose individual politicians (${kOn} of ${POLS.people.length} shown)`;
  $("#pol-pick").innerHTML=parties.map(p=>{const c=pBase(p);
    return`<div class="pol-grp"><div class="pol-gl"><i class="${dark(c)?"dkb":""}" style="background:${c}"></i>${escF(pLab(p))}</div><div class="filters">`
      +POLS.people.filter(x=>x.party===p).map(x=>{const on=POLS.act.has(x.name);
        return`<button type="button" class="faction-chip ${on?"on":""}" data-n="${escF(x.name)}" aria-pressed="${on}"><i style="background:${col[x.name]}"></i>${escF(x.name)}</button>`;}).join("")+`</div></div>`;}).join("");
}
function polChart(){
  const host=$("#pol-chart");if(!host||!POLS.polls.length)return;
  const dm=isDarkMode(),col=polColors(dm),L=POLS.polls,t1=L[L.length-1].t,met=POLS.metric,rm=PRANGES.find(r=>r[0]===POLS.range)[2];
  const first=L.find(q=>q.res.some(x=>polVal(x,met)!=null));let t0=first?first.t:L[0].t;if(rm){const d=new Date(t1);d.setUTCMonth(d.getUTCMonth()-rm);t0=Math.max(t0,+d);}
  const vis=POLS.people.filter(p=>POLS.act.has(p.name));
  const series=vis.map(p=>({name:p.name,color:col[p.name],estUntil:POLS.estMax,points:L.filter(q=>q.t>=t0).map(q=>{const x=q.res.find(z=>z.name===p.name);const v=x?polVal(x,met):null;return v!=null?{t:q.t,v,est:q.est}:null;}).filter(Boolean)}));
  const dots=[];series.forEach(s=>s.points.forEach(p=>dots.push({t:p.t,v:p.v,color:s.color,est:p.est&&p.t<=POLS.estMax})));
  const vals=dots.map(d=>d.v);let yMin=0,yMax,step,signed=false,ref=null;
  if(met==="net"){const lo=Math.min(0,...vals),hi=Math.max(0,...vals);step=hi-lo>70?20:10;yMin=Math.floor(lo/step)*step;yMax=Math.ceil(hi/step)*step;if(yMax<=yMin)yMax=yMin+step;signed=true;ref=0;}
  else{yMax=Math.ceil(Math.max(10,Math.max(0,...vals)*1.1)/10)*10;step=yMax>70?20:10;}
  const net=met==="net",W=CW();
  lineChart(host,{H:700,y0:118,endGap:19,title:"Politician satisfaction",sub:PSUB[met],source:W<1000?"Source: Infratest dimap, ARD-DeutschlandTREND":`Source: Infratest dimap for ARD-DeutschlandTREND \u00B7 latest survey ${fmtDate(t1)}`,
    series,dots,dotR:3,dotOp:.55,t0,t1,yMin,yMax,step,signed,refLine:ref,padR:net?130:150,endWithin:45,gapDays:200,tipDots:true,
    months:rm&&rm<=12?[1,2,3,4,5,6,7,8,9,10,11]:rm===24||undefined,
    vf:net?(v=>sgnI(v)+" pts"):(v=>fmt(v,0)+"%"),df:d=>d===0?"0":sgnI(d),yFmt:net?sgnI:undefined,
    endLabel:(v,n)=>net?`${sgnI(v)} ${shortN(n)}`:`${fmt(v,0)} % ${shortN(n)}`});
}
function polNote(){
  const L=POLS.polls,rm=PRANGES.find(r=>r[0]===POLS.range)[2],from=rm?(()=>{const d=new Date(L[L.length-1].t);d.setUTCMonth(d.getUTCMonth()-rm);return +d;})():-Infinity,est=L.filter(p=>p.est&&p.t>=from),dis=L.find(p=>p.res.some(x=>x.dissatisfied_pct!=null));
  $("#pol-note").innerHTML=`Survey: ARD-DeutschlandTREND, politician satisfaction (monthly, Infratest dimap). Each line is a shade of the politician's party colour.`+
    (est.length&&POLS.metric==="sat"?` Dashed lines and open dots mark values estimated from published charts (${monYr(est[0].t)} \u2013 ${monYr(est[est.length-1].t)}), which only include the satisfied share.`:"")+
    (dis&&POLS.metric!=="sat"?` Dissatisfied and net values are available from ${monYr(dis.t)}.`:"");
}
function polTable(){
  const L=POLS.polls;if(!L.length)return;
  const dm=isDarkMode(),col=polColors(dm),last=L[L.length-1],cs=dm?lighten(AC.approve,.32):AC.approve,cd=dm?lighten(AC.disapprove,.32):AC.disapprove,cn=dm?lighten(AC.net||"#1C4E9C",.32):(AC.net||"#1C4E9C");
  const rows=last.res.slice().sort((a,b)=>(b.satisfied_pct??-1)-(a.satisfied_pct??-1)),top=rows[0]?rows[0].satisfied_pct:null,pc=v=>v!=null?fmt(v,0)+"%":"\u2013";
  $("#pol-table").innerHTML=`<table class="pol-tbl"><thead><tr><th>Politician</th><th>Party</th><th style="border-bottom-color:${cs}">Satisfied</th><th style="border-bottom-color:${cd}">Dissatisfied</th><th style="border-bottom-color:${cn}">Net</th><th title="Change in the satisfied share vs. the previous survey, in percentage points">Change</th><th>Familiarity</th></tr></thead><tbody>`+
    rows.map(r=>{const net=polVal(r,"net"),ch=r.change;
      return`<tr><td><i class="pol-dot" style="background:${col[r.name]||"#888"}"></i>${escF(r.name)}</td><td>${escF(pLab(r.party))}</td><td class="${r.satisfied_pct===top?"lead":""}">${pc(r.satisfied_pct)}</td><td>${pc(r.dissatisfied_pct)}</td><td>${net!=null?sgnI(net):"\u2013"}</td><td>${ch==null?"\u2013":`<span class="pol-chg" style="color:${ch>0?cs:ch<0?cd:"inherit"}">${ch===0?"0":sgnI(ch)}</span>`}</td><td>${pc(r.familiarity_pct)}</td></tr>`;}).join("")+`</tbody></table>`;
  $("#pol-fold").querySelector("h3").textContent="Latest poll \u00B7 "+fmtDate(last.t);
}
function polDraw(){polChips();polChart();polNote();polTable();}
if(POLS.polls.length&&$("#politician-card")){
  $("#politician-card").hidden=false;
  $("#pol-range").onclick=e=>{const b=e.target.closest("[data-r]");if(!b)return;POLS.range=b.dataset.r;polDraw();};
  $("#pol-metric").onclick=e=>{const b=e.target.closest("[data-m]");if(!b)return;POLS.metric=b.dataset.m;polDraw();};
  $("#pol-party").onclick=e=>{const b=e.target.closest("[data-p]");if(!b)return;
    const names=POLS.people.filter(x=>x.party===b.dataset.p).map(x=>x.name),all=names.every(n=>POLS.act.has(n));
    if(all){const rest=[...POLS.act].filter(n=>!names.includes(n));if(!rest.length)return;POLS.act=new Set(rest);}else names.forEach(n=>POLS.act.add(n));
    polDraw();};
  {const eb=$("#pol-pick-btn"),fp=$("#pol-panel");if(eb&&fp)eb.addEventListener("click",()=>{const open=fp.hidden;fp.hidden=!open;eb.setAttribute("aria-expanded",String(open));});}
  $("#pol-pick").onclick=e=>{const b=e.target.closest("[data-n]");if(!b)return;const n=b.dataset.n;
    if(POLS.act.has(n)){if(POLS.act.size>1)POLS.act.delete(n);}else POLS.act.add(n);polDraw();};
  polDraw();redraw.push(polDraw);
}

// ---------- overview: fit to one screen, no scrolling ----------
// scale the whole page so it always has the same proportions as the 1440p design (layout viewport ~1620x911)
function scaleAll(){
  const g=innerWidth<900?1:Math.max(1,Math.min(innerWidth/1620,innerHeight/911));
  const tb=$("#tabbar"),m=$("main.wrap");
  if(tb)tb.style.zoom=g>1?g:"";
  const sb=$("#sidebar");if(sb)sb.style.zoom=g>1?g:"";
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
  // every probe forces a full layout of the overview (incl. the 299-path constituency map), so start from the last result:
  // if it still fits and the next-bigger zoom doesn't, that is the answer (2 probes instead of a full search). Same result as the search below.
  let lo=-1;const L=fitOv.last;
  if(L!=null&&L<ZS.length&&fits(L)&&(L===0||!fits(L-1)))lo=L;
  if(lo<0){lo=0;let hi=ZS.length;
    while(lo<hi){const m=(lo+hi)>>1;if(fits(m))hi=m;else lo=m+1;}
    while(lo>0&&lo<ZS.length&&fits(lo-1))lo--;}
  fitOv.last=lo;
  f.style.zoom=lo<ZS.length?ZS[lo]:ZEND;
}
let rzq=0;addEventListener("resize",()=>{cancelAnimationFrame(rzq);rzq=requestAnimationFrame(fitOv);});
if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fitOv);
redraw.push(fitOv);
fitOv();
// reveal the overview only now: maps drawn, fonts ready, page fitted to the screen (no half-loaded flash, no size jump)
{const done=()=>{fitOv();const o=$("#tab-overview");if(o)requestAnimationFrame(()=>o.classList.remove("loading"));};
  (document.fonts&&document.fonts.ready?document.fonts.ready:Promise.resolve()).then(done,done);}

await HS.apply(LOC0,true);
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
  const isChart=el=>el&&el.closest&&!el.closest("#co-map")&&el.closest(".chart-card svg, #map, #el-map, #el-demo"); // #co-map pins its own popup
  document.addEventListener("touchstart",e=>{const t=e.touches[0];tgt=e.target;active=!!isChart(tgt);moved=false;sx=t.clientX;sy=t.clientY;if(active)fire("mousemove",t,tgt);},{passive:true});
  document.addEventListener("touchmove",e=>{if(!active)return;const t=e.touches[0];if(Math.abs(t.clientY-sy)>14&&Math.abs(t.clientY-sy)>Math.abs(t.clientX-sx)){active=false;fire("mouseleave",t,tgt);return;}moved=true;fire("mousemove",t);},{passive:true});
  document.addEventListener("touchend",e=>{if(!active)return;const t=e.changedTouches[0];setTimeout(()=>{fire("mouseup",t);fire("mouseleave",t,tgt);},1400);},{passive:true});
  document.addEventListener("touchstart",e=>{if(!e.target.closest(".chart-card svg,#map,#el-map,#el-demo,#co-map")&&typeof hideTip==="function")hideTip();},{passive:true});
})();
