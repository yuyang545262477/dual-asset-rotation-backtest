"use strict";
const labels=["总资产","证券市值","可用资金","可取资金","持仓盈亏","当日盈亏"];
const money=n=>new Intl.NumberFormat("zh-CN",{style:"currency",currency:"CNY"}).format(n);
const decimal=(n,d)=>n.toLocaleString("zh-CN",{minimumFractionDigits:d,maximumFractionDigits:d});
function collectSnapshots(snapshot,history=[]){
 const byDate=new Map();
 for(const day of [...history,snapshot]){
  if(day&&/^\d{4}-\d{2}-\d{2}$/.test(day.date)&&Number.isFinite(day.totals?.[0]))byDate.set(day.date,day);
 }
 return [...byDate.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
function renderChart(days){
 const TV=globalThis.LightweightCharts;
 if(!TV||!days.length)return;
 const by=id=>document.getElementById(id), panel=by("live-terminal"), host=by("live-chart"), full=by("live-full");
 panel.hidden=false;
 const chart=TV.createChart(host,{
  autoSize:true,
  layout:{background:{type:TV.ColorType.Solid,color:"#ffffff"},textColor:"#39516b",fontSize:13,attributionLogo:false},
  grid:{vertLines:{color:"#edf2f8"},horzLines:{color:"#edf2f8"}},
  crosshair:{mode:TV.CrosshairMode.Normal},
  rightPriceScale:{borderColor:"#dce5ef",scaleMargins:{top:.12,bottom:.12}},
  timeScale:{borderColor:"#dce5ef",timeVisible:false},
  localization:{locale:"zh-CN",dateFormat:"yyyy-MM-dd"}
 });
 const curve=chart.addSeries(TV.LineSeries,{color:"#1555bd",lineWidth:2,priceFormat:{type:"custom",minMove:.01,formatter:money},priceLineVisible:false,pointMarkersVisible:days.length===1,pointMarkersRadius:5});
 curve.setData(days.map(d=>({time:d.date,value:d.totals[0]})));
 if(days.length===1)chart.timeScale().setVisibleLogicalRange({from:-5,to:5});
 else chart.timeScale().fitContent();
 const positionText=(p,label)=>p?label+"｜"+p.name+"："+decimal(p.quantity,0)+(p.code==="600900"?" 股":" 份")+" · 快照价 ¥"+decimal(p.price,p.code==="600900"?2:3)+" · 市值 "+money(p.value):label+"｜暂无持仓快照";
 const byDate=new Map(days.map((day,i)=>[day.date,i]));
 let selected=days.length-1;
 function show(i){
  selected=i;
  const day=days[i], [a,b]=day.positions??[];
  by("live-chart-date").textContent=day.date+" · 总资产 "+money(day.totals[0]);
  by("live-chart-a").textContent=positionText(a,"A");
  by("live-chart-b").textContent=positionText(b,"B");
  by("live-chart-cash").textContent=Number.isFinite(day.totals[2])?"现金："+money(day.totals[2]):"现金：暂无记录";
 }
 const keyOf=t=>typeof t==="string"?t:t&&[t.year,String(t.month).padStart(2,"0"),String(t.day).padStart(2,"0")].join("-");
 chart.subscribeCrosshairMove(({time})=>{
  const i=byDate.get(keyOf(time));
  if(i!==undefined)show(i);
 });
 show(selected);
 host.addEventListener("keydown",e=>{
  const target={ArrowLeft:selected-1,ArrowRight:selected+1,Home:0,End:days.length-1}[e.key];
  if(target===undefined)return;
  e.preventDefault();
  const i=Math.max(0,Math.min(days.length-1,target));
  const range=chart.timeScale().getVisibleLogicalRange();
  if(range&&(i<range.from||i>range.to))chart.timeScale().scrollToPosition(i-days.length+1,false);
  chart.setCrosshairPosition(days[i].totals[0],days[i].date,curve);
  show(i);
 });
 function syncFull(){
  const on=document.fullscreenElement===panel||panel.classList.contains("full-fallback");
  full.setAttribute("aria-pressed",on);
  full.textContent=on?"退出全屏":"⛶ 全屏";
 }
 full.addEventListener("click",async()=>{
  if(document.fullscreenElement===panel)await document.exitFullscreen();
  else if(panel.classList.contains("full-fallback"))panel.classList.remove("full-fallback");
  else try{await panel.requestFullscreen();}catch{panel.classList.add("full-fallback");}
  syncFull();
 });
 document.addEventListener("fullscreenchange",syncFull);
 document.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&panel.classList.contains("full-fallback")){panel.classList.remove("full-fallback");syncFull();}
 });
}
function render({snapshot,trades,dailySnapshots}){
 const by=id=>document.getElementById(id);
 function node(tag,value){const e=document.createElement(tag);e.textContent=String(value);return e;}
 function row(values){const e=document.createElement("tr");e.append(...values.map(v=>node("td",v)));return e;}
 by("snapshot-date").textContent=snapshot.date+" · 北京时间 · 券商持仓快照（非实时）";
 by("snapshot-totals").replaceChildren(...snapshot.totals.map((n,i)=>{const e=document.createElement("div");e.append(node("dt",labels[i]),node("dd",money(n)));return e;}));
 by("snapshot-positions").replaceChildren(...snapshot.positions.map(p=>row([p.name+"（"+p.code+"）",decimal(p.quantity,0),decimal(p.available,0),decimal(p.price,3),decimal(p.cost,4),money(p.value),money(p.profit),decimal(p.returnPct,2)+"%"])));
 by("public-trades").replaceChildren(...trades.map(t=>row([t.date,t.name+"（"+t.code+"）",t.side,decimal(t.quantity,0),decimal(t.price,3),money(t.amount),t.fee===null?"待对账":money(t.fee)])));
 by("snapshot-view").hidden=false;
 by("snapshot-empty").hidden=true;
 renderChart(collectSnapshots(snapshot,dailySnapshots));
}
if(typeof document!=="undefined")fetch("live-data.json",{cache:"no-store"}).then(r=>{if(!r.ok)throw Error("data unavailable");return r.json();}).then(render).catch(()=>{document.getElementById("snapshot-empty").textContent="暂时无法加载，请稍后刷新。";});
if(typeof module!=="undefined")module.exports={render,collectSnapshots};
