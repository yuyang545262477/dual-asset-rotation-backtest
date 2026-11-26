"use strict";
const markets={
 original:{rows:globalThis.ROTATION_PRICES,candles:globalThis.ROTATION_CANDLES,names:["纳指科技 ETF","长江电力"],codes:["159509","600900"],tick:[1,10],cashDivs:{"2024-07-19":820,"2025-01-24":210,"2025-07-18":733,"2026-02-12":210,"2026-07-17":790}},
 etfs:{...globalThis.ROTATION_ETF_PAIR,names:["科创半导体 ETF 华夏","通信 ETF 国泰"],codes:["588170","515880"],tick:[1,1]}
};
// The new pair stores split-normalized rows on a first-day share basis.
 // Rebase to latest-day shares for forward-adjusted historical prices.
if(markets.etfs.rows){
 const factors=Object.values(markets.etfs.splits).reduce(([a,b],[x,y])=>[a*x,b*y],[1,1]);
 markets.etfs.rows=markets.etfs.rows.map(([day,a,b])=>[day,a/factors[0],b/factors[1]]);
}
let market, rows, dailyMoves, D, accountRows, accountMoves, tick, cashDivs, splits;
function selectMarket(key){
 market=markets[key];
 ({rows,tick,cashDivs={},splits={}}=market);
 dailyMoves=rows.map(([,a,b],i)=>{
  if(!i)return null;
  const ra=a/rows[i-1][1], rb=b/rows[i-1][2];
  return {a:ra-1,b:rb-1,diff:ra-rb};
 });
 D=dailyMoves.map(m=>m?.diff??0);
 accountRows=market.candles?.a.map((r,i)=>[r[0],Math.round(r[2]*1000),Math.round(market.candles.b[i][2]*1000)])??[];
 accountMoves=accountRows.map(([date,a,b],i)=>{
  if(!i)return null;
  const [splitA,splitB]=splits[date]??[1,1];
  const pa=Math.round(accountRows[i-1][1]/splitA/tick[0])*tick[0];
  const prevB=accountRows[i-1][2];
  const pb=(splitB===1?prevB:Math.round(prevB/splitB/tick[1])*tick[1])-(cashDivs[date]??0);
  const spread=[(a-tick[0])/pa-(b+tick[1])/pb,(b-tick[1])/pb-(a+tick[0])/pa];
  return {a:a/pa-1,b:b/pb-1,diff:Math.max(...spread),spread};
 });
}
selectMarket("original");
const fmt=(x,d=2)=>(x>0?"+":x<0?"−":"")+Math.abs(x).toFixed(d);
const pct=x=>fmt(x*100)+"%";
const projectionYears=[5,10,15,20,30];
const relativeHold=f=>f.value/f.hold;
function compound(rate,years,principal){
 const multiplier=(1+rate)**years;
 return {gain:multiplier-1,amount:principal*multiplier};
}
function compactMoney(amount){
 const unit=amount>=1e8?[1e8,"亿"]:amount>=1e4?[1e4,"万"]:[1,""];
 const digits={minimumFractionDigits:2,maximumFractionDigits:2};
 return "¥"+(amount/unit[0]).toLocaleString("zh-CN",digits)+unit[1];
}

function simulate(t, full=false, portions=4){
 const q=[.5/rows[0][1],.5/rows[0][2]],init=q.slice(),n=[portions,portions],block=[0,0], log=[],frames=[],year=[];
 let tr=0,signals=0,value=1,hold=1,peak=1,dd=0,prevYearV=1,prevYearH=1;
 for(let i=0;i<rows.length;i++){
  const [date,a,b]=rows[i],dv=D[i],p=[a,b];
  if(i&&Math.abs(dv)>t){
   signals++;
   const x=dv>0?0:1,y=1-x,bottom=n[x]===1;
   if(bottom)block[x]++;
   else {const s=q[x]/n[x];q[x]-=s;q[y]+=s*p[x]/p[y];n[x]--;n[y]++;tr++;}
   if(full)log.push({date,dv,x,bottom,n:n.join(":")});
  }
  value=q[0]*a+q[1]*b;
  if(full){
   hold=init[0]*a+init[1]*b;
   peak=Math.max(peak,value);dd=Math.min(dd,value/peak-1);
   frames.push({date,value,hold,n:n.join(":")});
   const yr=date.slice(0,4);
   if(i===rows.length-1||rows[i+1][0].slice(0,4)!==yr){
    year.push([yr,value/prevYearV-1,hold/prevYearH-1]);prevYearV=value;prevYearH=hold;
   }
  }
 }
 return {value, hold,tr,signals,block,n,log,frames,year,dd};
}
function rank(mode="ideal", portions=4){
 const account=mode!=="ideal", evaluate=account?t=>simulateAccount(t,true,capitalByMode[mode],portions):t=>simulate(t,false,portions);
 const changes=account?accountMoves.slice(1).flatMap(m=>m.spread.map(v=>v-1e-12)):D.slice(1).map(Math.abs);
 // Between signal boundaries, the ordered trades cannot change.
 const max=.12, cuts=[...new Set([...changes.filter(v=>v>0&&v<max),...Array.from({length:13},(_,i)=>i/100)])].sort((a,b)=>a-b);
 const winners=new Map();
 function record(band,threshold){
  const {value,tr,nav,fees}=evaluate(+threshold/100);
  if(!winners.has(band)||value>winners.get(band).value+1e-12)winners.set(band,{band,threshold,value,tr,nav,fees});
 }
 record(0,"0");
 for(let i=0;i<cuts.length-1;i++){
  const lo=cuts[i],hi=cuts[i+1],mid=(lo+hi)*50,band=Math.floor(mid);
  let threshold=String(mid);
  for(let d=band===0?4:2;d<=12;d++){
   const s=mid.toFixed(d);
   if(+s/100>lo&&+s/100<hi){threshold=s;break;}
  }
  record(band,threshold);
 }
 record(12,"12");
 return [...winners.values()].sort((a,b)=>b.value-a.value||a.band-b.band).slice(0,5);
}
// 按金额模拟时以厘记账，佣金四舍五入到分。收盘价上下各一档是模拟盘口。
const capitalByMode={account:100000,account20:20000};
const fee=x=>10*Math.floor((x+10000)/20000);
function affordable(cash,p){
 let q=Math.floor(cash/p/100)*100;
 while(q*p+fee(q*p)>cash)q-=100;
 return q;
}
function simulateAccount(threshold, trade=true, capital=capitalByMode.account, portions=4){
 const startCapital=capital*1000;
 let cash=startCapital, totalFees=0, benchCash, peak=1, dd=0, signals=0, tr=0, prevYearV=1, prevYearH=1;
 const units=[portions,portions], q=[0,0], benchQ=[0,0], block=[0,0], log=[], frames=[], year=[];
 for(const [i,[date,a,b]] of accountRows.entries()){
  const p=[a,b], bid=p.map((v,j)=>v-tick[j]),ask=p.map((v,j)=>v+tick[j]);
  if(!i){
   for(let j=0;j<2;j++){q[j]=affordable(startCapital/2,ask[j]);const amt=q[j]*ask[j], f=fee(amt);cash-=amt+f;totalFees+=f;benchQ[j]=q[j];}
   benchCash=cash;
  }else{
   const factors=splits[date];
   if(factors)for(let j=0;j<2;j++){q[j]*=factors[j];benchQ[j]*=factors[j];}
   const d=cashDivs[date]??0;cash+=q[1]*d;benchCash+=benchQ[1]*d;
   const m=accountMoves[i],x=m.spread[0]>threshold+1e-12?0:m.spread[1]>threshold+1e-12?1:-1;
   if(trade&&x>=0){
    signals++;
    const y=1-x, dv=m.spread[x], bottom=units[x]===1, e={date,dv,x,bottom,n:units.join(":")};
    if(bottom)block[x]++;
    else{
     const sold=Math.floor(q[x]/units[x]/100)*100, gross=sold*bid[x], fc=fee(gross), available=cash+gross-fc;
     const bought=affordable(available,ask[y]), cost=bought*ask[y], fb=fee(cost);
     if(sold>=100&&bought>=100){
      q[x]-=sold;q[y]+=bought;cash=available-cost-fb;totalFees+=fc+fb;
      units[x]--;units[y]++;tr++;
      Object.assign(e,{sold,bought,sellPrice:bid[x]/1000,buyPrice:ask[y]/1000,n:units.join(":")});
     }else e.skipped=true;
    }
    log.push(e);
   }
  }
  const nav=cash+q[0]*a+q[1]*b, benchNav=benchCash+benchQ[0]*a+benchQ[1]*b, value=nav/startCapital, hold=benchNav/startCapital;
  frames.push({date,value,hold,n:units.join(":"),nav:nav/1000,benchNav:benchNav/1000,cash:cash/1000,fees:totalFees/1000});
  peak=Math.max(peak,value);dd=Math.min(dd,value/peak-1);
  const yr=date.slice(0,4);
  if(i===accountRows.length-1||accountRows[i+1][0].slice(0,4)!==yr){
   year.push([yr,value/prevYearV-1,hold/prevYearH-1]);prevYearV=value;prevYearH=hold;
  }
 }
 const {value,hold,nav,benchNav}=frames.at(-1);
 return {value,hold,nav,benchNav,tr,signals,block,n:units,log,frames,year,dd,fees:totalFees/1000};
}
if(typeof document!=="undefined"){
 const $=id=>document.getElementById(id), set=(id,v)=>{$(id).textContent=v;};
 let rankings={};
 const money=x=>"¥"+x.toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2});
 let mode="account", portions=4;
 function renderAccountRanks(next, ranked){
  const benchmark=simulateAccount(0,false,capitalByMode[next]), tbody=$("account-comparisons");
  tbody.innerHTML=ranked.map(r=>'<tr><td><button class="threshold-button" type="button" data-threshold="'+r.threshold+'">'+r.threshold+'%</button></td><td>'+money(r.nav)+'</td><td>'+pct(r.value-1)+'</td><td>'+r.tr+'</td><td>'+money(r.fees)+'</td></tr>').join("")+'<tr><td>各买一半不动</td><td>'+money(benchmark.nav)+'</td><td>'+pct(benchmark.value-1)+'</td><td>0</td><td>'+money(benchmark.fees)+'</td></tr>';
  tbody.querySelectorAll("[data-threshold]").forEach(el=>el.addEventListener("click",()=>update(+el.dataset.threshold)));
 }
 function renderIdealRanks(ranked){
  const tbody=$("ranks");
  tbody.innerHTML=ranked.map(k=>'<tr><td>'+k.band+'.x</td><td><button class="threshold-button" type="button" data-threshold="'+k.threshold+'">'+k.threshold+'%</button></td><td>'+pct(k.value-1)+'</td><td>'+k.tr+'</td></tr>').join("");
  tbody.querySelectorAll("[data-threshold]").forEach(el=>el.addEventListener("click",()=>update(+el.dataset.threshold)));
 }


 let current, view="net", range="all", mainSeries, holdSeries, gapSeries, gapVisible=false, cursorIndex=null, keyboardCursor=false, eventByDate=new Map(), activeThreshold=0;
 const host=$("chart"), terminal=$("terminal"), full=$("full");
 const TV=globalThis.LightweightCharts;
 let ohlc,byDate,index;
 // Individual adjusted returns share the net-value axis: 1.000 is 0%.
 const assets={
  a:{color:"#ad4d13",points:rows.map(([time,a])=>({time,value:a/rows[0][1]})),visible:false,series:null},
  b:{color:"#7650a6",points:rows.map(([time,,b])=>({time,value:b/rows[0][2]})),visible:false,series:null}
 };
 const assetButtons=[...document.querySelectorAll("[data-asset-return]")];
 for(const button of assetButtons){
  const key=button.dataset.assetReturn, asset=assets[key], label=$("asset-return-"+key);
  button.style.setProperty("--asset-color",asset.color);
  button.addEventListener("click",()=>{
   if(!asset.series)return;
   asset.visible=!asset.visible;
   asset.series.applyOptions({visible:asset.visible});
   button.setAttribute("aria-pressed",asset.visible);
   label.hidden=!asset.visible;
   showData(cursorIndex===null?undefined:rows[cursorIndex][0]);
  });
 }
 const chart=TV?.createChart(host,{
  autoSize:true,
  layout:{background:{type:TV.ColorType.Solid,color:"#ffffff"},textColor:"#39516b",fontSize:13,attributionLogo:false},
  grid:{vertLines:{color:"#edf2f8"},horzLines:{color:"#edf2f8"}},
  crosshair:{mode:TV.CrosshairMode.Normal},
  rightPriceScale:{borderColor:"#dce5ef",scaleMargins:{top:.1,bottom:.11}},
  timeScale:{borderColor:"#dce5ef",rightOffset:3,timeVisible:false,fixLeftEdge:true},
  localization:{locale:"zh-CN",dateFormat:"yyyy-MM-dd"}
 });
 const gapToggle=$("hold-gap-toggle"), strategyToggle=$("strategy-toggle"), gapLabel=$("hold-gap-return");
 function toggleGap(on){
  if(!gapSeries||view!=="net")return;
  gapVisible=on;
  mainSeries.applyOptions({visible:!on});
  holdSeries.applyOptions({visible:!on});
  gapSeries.applyOptions({visible:on});
  strategyToggle.setAttribute("aria-pressed",!on);
  gapToggle.setAttribute("aria-pressed",on);
  gapLabel.hidden=!on;
  setNetSummary();
  if(keyboardCursor&&cursorIndex!==null)selectDay(cursorIndex,false);
  else showData(cursorIndex===null?undefined:rows[cursorIndex][0]);
 }
 gapToggle.addEventListener("click",()=>toggleGap(!gapVisible));
 function showData(time){
  if(view==="net"){
   const i=index.get(time)??(range==="start"?0:rows.length-1), f=current.frames[i], move=mode!=="ideal"?accountMoves[i]:dailyMoves[i];
   set("strategy-return"," "+pct(f.value-1));
   const differenceRate=pct(relativeHold(f)-1);
   if(gapVisible)set("hold-gap-return"," "+differenceRate);
   set("readout",f.date+" · 轮动 "+f.value.toFixed(3)+" · 持有 "+f.hold.toFixed(3)+" · 份数 "+f.n);
   if(gapVisible&&mode==="ideal")set("readout",f.date+" · 比持有 "+differenceRate+" · 份数 "+f.n);
   for(const [key,asset] of Object.entries(assets)){
    if(asset.visible)set("asset-return-"+key," "+pct(asset.points[i].value-1));
   }
   $("account-readout").hidden=mode==="ideal";
   if(mode!=="ideal"){
    const diff=Math.round((f.nav-f.benchNav)*100)/100;
    const dailyReturn=i>0?Math.round((f.nav/current.frames[i-1].nav-1)*10000)/100:null;
    set("account-amounts","资产 "+money(f.nav)+" · 现金 "+money(f.cash));
    set("account-daily-return",dailyReturn===null?"—":fmt(dailyReturn)+"%");
    $("account-daily-return").dataset.sign=dailyReturn>0?"up":dailyReturn<0?"down":"flat";
    $("account-daily-return").title=i>0?"策略总资产（含现金）相对上一交易日的变化":"样本首日无前一日总资产";
    set("account-totals","策略总额 "+money(f.nav)+" · 持有总额 "+money(f.benchNav));
    const diffRate=f.benchNav>0?differenceRate:"—";
    set("account-difference",diffRate+" ("+(diff>0?"+":diff<0?"−":"")+money(Math.abs(diff))+")");
    $("account-difference").title="百分比＝差额 ÷ 同日持有总额";
    $("account-difference").dataset.sign=diff>0?"up":diff<0?"down":"flat";
   }
   for(const [id,value,unit] of [["daily-a",move?.a,"%"],["daily-b",move?.b,"%"],["daily-diff",move?.diff,"%"]]){
    set(id,value===undefined?"—":fmt(value*100)+unit);
    $(id).dataset.sign=value>0?"up":value<0?"down":"flat";
   }
   $("daily-readout").title=move?"按回测口径，以当天收盘相对上个交易日收盘计算。":"样本首日无前一日数据。";
   const event=eventByDate.get(f.date), status=$("daily-status");
   status.dataset.kind=event&&!event.skipped?(event.bottom?"blocked":"trade"):"idle";
   status.textContent=event&&!event.skipped?(event.bottom?"底仓拦截":"交易"):"未达条件";
   status.title=event?(event.skipped?"至少一侧不足整手":event.bottom?"仅剩 1 份底仓，未换仓":"交易")
    :move?"价差未超过 "+activeThreshold+"%":"首日无昨收";
   status.hidden=false;
   $("daily-readout").hidden=false;
  }else{
   $("daily-readout").hidden=true;
   $("account-readout").hidden=true;
   const f=byDate[view].get(time)??(range==="start"?ohlc[view][0]:ohlc[view].at(-1)), d=view==="a"||tick[1]===1?3:2;
   set("readout",f.time+" · 开 "+f.open.toFixed(d)+" · 高 "+f.high.toFixed(d)+" · 低 "+f.low.toFixed(d)+" · 收 "+f.close.toFixed(d));
  }
 }
 function setRange(){
  if(!chart)return;
  if(range==="all")chart.timeScale().fitContent();
  else if(range==="start")chart.timeScale().setVisibleLogicalRange({from:0,to:Math.min(364,rows.length-1)});
  else chart.timeScale().setVisibleLogicalRange({from:Math.max(0,rows.length-Number(range)),to:rows.length+2});
  document.querySelectorAll("[data-range]").forEach(e=>e.setAttribute("aria-pressed",e.dataset.range===range));
 }
 function setNetSummary(){
  const title=gapVisible?"比持有 · 1.000 = 0%":"蓝线：轮动 · 灰线：持有";
  host.setAttribute("aria-label",gapVisible?"比持有差异线":"策略与持有净值曲线");
  set("graph-summary",title+" · 策略最大回撤 "+pct(current.dd)+" · 期末份数 "+current.n.join(":"));
 }
 function updateNet(){
  if(!chart||view!=="net"||!mainSeries)return;
  mainSeries.setData(current.frames.map(f=>({time:f.date,value:f.value})));
  holdSeries.setData(current.frames.map(f=>({time:f.date,value:f.hold})));
  gapSeries.setData(current.frames.map(f=>({time:f.date,value:relativeHold(f)})));
  setNetSummary();
  showData(cursorIndex===null?undefined:rows[cursorIndex][0]);
 }
 function setView(next){
  view=next;cursorIndex=null;keyboardCursor=false;
  if(!chart){set("readout","图表组件无法加载，收益和换仓记录仍可查看。");return;}
  if(mainSeries)chart.removeSeries(mainSeries);
  if(holdSeries){chart.removeSeries(holdSeries);holdSeries=null;}
  if(gapSeries){chart.removeSeries(gapSeries);gapSeries=null;}
  for(const asset of Object.values(assets)){
   if(asset.series){chart.removeSeries(asset.series);asset.series=null;}
  }
  $("asset-legend").hidden=view!=="net";
  gapToggle.hidden=view!=="net";
  if(view==="net"){
   mainSeries=chart.addSeries(TV.LineSeries,{color:"#1555bd",lineWidth:2,visible:!gapVisible,priceFormat:{type:"price",precision:3,minMove:.001}});
   holdSeries=chart.addSeries(TV.LineSeries,{color:"#718198",lineWidth:2,visible:!gapVisible,lineStyle:TV.LineStyle.Dashed,priceLineVisible:false,priceFormat:{type:"price",precision:3,minMove:.001}});
   gapSeries=chart.addSeries(TV.LineSeries,{color:"#008375",lineWidth:2,visible:gapVisible,
    lastValueVisible:false,priceLineVisible:false,priceFormat:{type:"price",precision:3,minMove:.001},
    autoscaleInfoProvider:base=>{
     const info=base();
     if(!info?.priceRange)return info;
     const {minValue,maxValue}=info.priceRange;
     return {...info,priceRange:{minValue:Math.min(1,minValue),maxValue:Math.max(1,maxValue)}};
    }
   });
   gapSeries.createPriceLine({price:1,color:"#66827e",lineWidth:1,lineStyle:TV.LineStyle.Dashed,axisLabelVisible:false,title:""});
   for(const asset of Object.values(assets)){
    asset.series=chart.addSeries(TV.LineSeries,{
     color:asset.color,lineWidth:2,visible:asset.visible,
     lastValueVisible:false,priceLineVisible:false
    });
    asset.series.setData(asset.points);
   }
   updateNet();
  }else{
   const colors={upColor:"#c53c46",downColor:"#148067",wickUpColor:"#c53c46",wickDownColor:"#148067",borderVisible:false};
   const d=view==="a"||tick[1]===1?3:2;
   mainSeries=chart.addSeries(TV.CandlestickSeries,{...colors,priceFormat:{type:"price",precision:d,minMove:10**(-d)}});
   mainSeries.setData(ohlc[view]);
   set("graph-summary","日 K 线 · 场内成交价（不复权）· 红涨绿跌");
   showData();
  }
  if(view!=="net")host.setAttribute("aria-label",market.names[view==="a"?0:1]+" 日 K 线");
  document.querySelectorAll("[data-view]").forEach(e=>e.setAttribute("aria-pressed",e.dataset.view===view&&!gapVisible));
  setRange();
 }
 chart?.subscribeCrosshairMove(p=>{
  if(keyboardCursor)return;
  const time=typeof p.time==="string"?p.time:p.time?[p.time.year,String(p.time.month).padStart(2,"0"),String(p.time.day).padStart(2,"0")].join("-"):null;
  if(time&&index.has(time)){cursorIndex=index.get(time);showData(time);}
  else if(mainSeries&&!keyboardCursor&&cursorIndex===null){showData();}
 });
 host.addEventListener("pointermove",()=>{keyboardCursor=false;},{passive:true,capture:true});
 host.addEventListener("pointerdown",()=>{keyboardCursor=false;host.focus({preventScroll:true});});
 let last=rows.length-1;
 const clampDay=i=>Math.max(0,Math.min(last,i));
 function spanRange(from,width){
  const t=chart.timeScale(), span=Math.max(8,Math.min(last,width)), start=Math.max(0,Math.min(last-span,from));
  t.setVisibleLogicalRange({from:start,to:start+span});
 }
 function selectDay(i,follow=true){
  keyboardCursor=true;cursorIndex=clampDay(i);
  const t=chart.timeScale(), r=t.getVisibleLogicalRange();
  if(follow&&r&&(cursorIndex<Math.ceil(r.from)||cursorIndex>Math.floor(r.to))){
   const w=r.to-r.from;
   spanRange(cursorIndex<r.from?cursorIndex-1:cursorIndex-w+1,w);
  }
  const date=rows[cursorIndex][0], f=current.frames[cursorIndex];
  const comparing=view==="net"&&gapVisible;
  const value=view==="net"?(comparing?relativeHold(f):f.value):byDate[view].get(date)?.close;
  if(Number.isFinite(value))chart.setCrosshairPosition(value,date,comparing?gapSeries:mainSeries);
  showData(date);
 }
 function clearCursor(){
  cursorIndex=null;keyboardCursor=false;chart?.clearCrosshairPosition();showData();
 }
 function handleShortcut(e){
  if(!chart||!mainSeries||e.defaultPrevented||e.isComposing||e.altKey||e.metaKey||e.ctrlKey)return;
  const r=chart.timeScale().getVisibleLogicalRange();if(!r)return;
  const w=r.to-r.from;
  const seed=cursorIndex!==null&&cursorIndex>=r.from&&cursorIndex<=r.to?cursorIndex:clampDay(Math.ceil(r.from));
  const rightmost=clampDay(Math.floor(r.to));
  let fn;
  switch(e.key){
   case "ArrowLeft":fn=()=>selectDay(seed-(e.shiftKey?5:1));break;
   case "ArrowRight":fn=()=>selectDay(seed+(e.shiftKey?5:1));break;
   case "PageUp":case "PageDown":fn=()=>{const step=Math.max(1,Math.floor(w));selectDay(seed+(e.key==="PageUp"?-step:step));};break;
   case "Home":fn=()=>{spanRange(0,w);selectDay(0,false);};break;
   case "End":fn=()=>{spanRange(last-w,w);selectDay(last,false);};break;
   case "ArrowUp":case "ArrowDown":case "+":case "=":case "-":case "_":fn=()=>{
    const zoom=["ArrowUp","+","="].includes(e.key), pivot=cursorIndex!==null&&cursorIndex>=r.from&&cursorIndex<=r.to?cursorIndex:Math.round((seed+rightmost)/2);
    const width=Math.max(8,Math.min(last,w*(zoom?.8:1.25))), frac=w?(pivot-r.from)/w:.5;
    spanRange(pivot-width*frac,width);selectDay(pivot,false);
   };break;
   case "0":fn=()=>{range="start";setRange();clearCursor();};break;
   case "f":case "F":fn=()=>{if(!e.repeat)full.click();};break;
   case "Escape":
    if(document.fullscreenElement===terminal||terminal.classList.contains("full-fallback"))return;
    if(cursorIndex===null)return;
    fn=clearCursor;break;
   default:return;
  }
  e.preventDefault();fn();
 }
 host.addEventListener("keydown",handleShortcut);
 document.addEventListener("keydown",e=>{
  if(e.target!==document.body&&e.target!==document.documentElement)return;
  const box=host.getBoundingClientRect();
  if(box.top<window.innerHeight&&box.bottom>0)handleShortcut(e);
 });
 function syncFull(){
  const on=document.fullscreenElement===terminal||terminal.classList.contains("full-fallback");
  full.textContent=on?"退出全屏":"⛶ 全屏";
  full.setAttribute("aria-pressed",on);
 }
 function closeFallback(){
  terminal.classList.remove("full-fallback");document.body.classList.remove("fallback-open");syncFull();
 }
 full.addEventListener("click",async()=>{
  if(document.fullscreenElement===terminal){await document.exitFullscreen();return;}
  if(terminal.classList.contains("full-fallback")){closeFallback();return;}
  try{if(!terminal.requestFullscreen)throw Error();await terminal.requestFullscreen();}
  catch{terminal.classList.add("full-fallback");document.body.classList.add("fallback-open");}
  syncFull();host.focus({preventScroll:true});
 });
 document.addEventListener("fullscreenchange",syncFull);
 document.addEventListener("keydown",e=>{if(e.key==="Escape"&&terminal.classList.contains("full-fallback"))closeFallback();});
 for(const btn of document.querySelectorAll("[data-panel]")){
  const panel=$(btn.dataset.panel);
  btn.setAttribute("aria-controls",panel.id);btn.setAttribute("aria-expanded","false");
  panel.addEventListener("toggle",()=>btn.setAttribute("aria-expanded",String(panel.open)));
  btn.addEventListener("click",()=>{panel.open=!panel.open;if(panel.open)panel.scrollIntoView({block:"start"});});
 }
 const stockViews=$("stock-views"), stockLabel=$("stock-views-label");
 document.querySelectorAll("[data-view]").forEach(e=>e.addEventListener("click",()=>{
  const next=e.dataset.view;
  if(next==="net"&&view==="net"&&gapVisible){toggleGap(false);return;}
  setView(next);
  stockLabel.textContent=next==="net"?"个股 K 线":"个股 K 线 · "+market.codes[next==="a"?0:1];
  stockViews.open=false;
  if(next!=="net")host.focus({preventScroll:true});
 }));
 stockViews.addEventListener("keydown",e=>{
  if(e.key==="Escape"&&stockViews.open){e.preventDefault();stockViews.open=false;stockLabel.focus();}
 });
 document.addEventListener("pointerdown",e=>{if(stockViews.open&&!stockViews.contains(e.target))stockViews.open=false;});
 document.querySelectorAll("[data-range]").forEach(e=>e.addEventListener("click",()=>{range=e.dataset.range;setRange();clearCursor();}));
 function update(value, preserve=false){
  const t=Math.min(12,Math.max(0,value));
  if(!preserve)$("limit").value=t;
  $("slider").value=t;
  const run=p=>mode!=="ideal"?simulateAccount(t/100,true,capitalByMode[mode],p):simulate(t/100,true,p);
  current=run(portions);
  set("portion-threshold",t+"%");
  $("portion-comparison").innerHTML=[4,8].map(p=>{
   const r=p===portions?current:run(p);
   const amount=mode==="ideal"?r.value.toFixed(3):money(r.nav);
   const missed=r.log.filter(e=>e.skipped).length;
   return '<tr'+(p===portions?' class="portion-selected"':'')+'><th scope="row">每边 '+p+' 份'+(p===portions?' · 当前':'')+'</th><td>'+pct(r.value-1)+'</td><td>'+amount+'</td><td>'+r.tr+'</td><td>'+missed+'</td></tr>';
  }).join("");
  set("threshold-current","阈值 "+t+"%");
  activeThreshold=t;
  eventByDate=new Map(current.log.map(e=>[e.date,e]));
  const {value:v,hold,tr,signals,block,n,year,log,dd}=current;
  set("total",pct(v-1));set("nav",mode!=="ideal"?money(current.nav):"本金 1 → "+v.toFixed(3));set("hold",pct(hold-1));
  set("gap",mode!=="ideal"?money(current.benchNav):"策略相差 "+fmt((v-hold)*100)+" 个百分点");
  set("trades",tr+" 次");set("signals","超过阈值 "+signals+" 天");
  set("blocked",block[0]+block[1]+" 次");set("split",market.names[0]+" "+block[0]+" 次 / "+market.names[1]+" "+block[1]+" 次");
  const averageYear=column=>year.length?year.reduce((sum,y)=>sum+y[column],0)/year.length:null;
  const averages=[averageYear(1),averageYear(2)];
  set("annual-avg-strategy",averages[0]===null?"—":pct(averages[0]));
  set("annual-avg-hold",averages[1]===null?"—":pct(averages[1]));
  const principal=capitalByMode[mode]??1;
  set("projection-capital",mode==="ideal"?"本金 1":compactMoney(principal));
  $("projections").innerHTML=projectionYears.map(n=>'<tr><td>'+n+' 年</td>'+averages.map(rate=>{
   if(rate===null)return "<td>—</td>";
   const {gain,amount}=compound(rate,n,principal);
   return "<td>"+pct(gain)+" ("+(mode==="ideal"?"本金 ×"+amount.toFixed(2):compactMoney(amount))+")</td>";
  }).join("")+"</tr>").join("");
  $("years").innerHTML=year.map(([y,a,b])=>'<tr><td>'+y+'</td><td>'+pct(a)+'</td><td>'+pct(b)+'</td></tr>').join("");
  $("log").innerHTML=log.slice(-12).reverse().map(({date,dv,x,bottom,n,skipped,sold,bought,sellPrice,buyPrice})=>'<tr><td>'+date+'</td><td>'+fmt(dv*100,4)+'</td><td'+(bottom?' class="warn"':'')+'>'+(bottom?(x===0?"A":"B")+" 只剩底仓":skipped?"不足一手":(x===0?"A 转 B":"B 转 A")+(sold?" · 卖 "+sold+" @ "+sellPrice+"，买 "+bought+" @ "+buyPrice:""))+'</td><td>'+n+'</td></tr>').join("")||'<tr><td colspan="4">该阈值没有触发记录。</td></tr>';
  document.querySelectorAll("[data-threshold]").forEach(el=>{const selected=+el.dataset.threshold===t;el.classList.toggle("active",selected);el.setAttribute("aria-pressed",selected);});
  updateNet();
 }
 $("slider").addEventListener("input",e=>update(e.target.valueAsNumber));
 $("limit").addEventListener("input",e=>{const v=e.target.valueAsNumber;if(Number.isFinite(v)&&v>=0&&v<=12)update(v,true);});
 $("limit").addEventListener("change",e=>update(Number.isFinite(e.target.valueAsNumber)?e.target.valueAsNumber:$("slider").valueAsNumber));
 document.querySelectorAll("[data-threshold]").forEach(el=>el.addEventListener("click",()=>update(+el.dataset.threshold)));
 function setMode(next,threshold,refresh=false){
  mode=next;
  const account=next!=="ideal";
  document.querySelectorAll("[data-mode]").forEach(el=>el.setAttribute("aria-pressed",el.dataset.mode===next));
  document.querySelectorAll("[data-for-mode]").forEach(el=>{el.hidden=el.dataset.forMode!==(account?"account":"ideal");});
  const rankKey=next+":"+portions;
  if(refresh||!rankings[rankKey])rankings[rankKey]=rank(next,portions);
  const ranked=rankings[rankKey];
  set("portion-start-account",portions+":"+portions);
  set("portion-start-ideal",portions+":"+portions);
  if(account){
   const wan=capitalByMode[next]/10000;
   set("account-mode-label",wan+" 万元模拟");
   set("account-start-capital",wan+" 万元");
   set("account-half-capital",wan/2+" 万元");
   renderAccountRanks(next,ranked);
  }else renderIdealRanks(ranked);
  const best=ranked[0].threshold;
  $("threshold-best").dataset.threshold=best;
  set("threshold-best","样本最高 "+best+"%");
  set("gap-label",account?"可成交价差":"价差");
  $("gap-label").title=account?"卖 A 买 B、卖 B 买 A 两种方向中，按买一和卖一算出的较大价差。":"A 的日收益率减去 B 的日收益率";
  update(threshold??(account?0:Number(best)));
 }
 document.querySelectorAll("[data-mode]").forEach(el=>el.addEventListener("click",()=>setMode(el.dataset.mode)));
 $("position-portions").addEventListener("change",e=>{
  portions=Number(e.target.value)===8?8:4;
  setMode(mode,activeThreshold);
 });
 document.querySelectorAll("[data-recompute]").forEach(button=>{
  let resetLabel;
  button.addEventListener("click",()=>{
   clearTimeout(resetLabel);
   button.disabled=true;
   button.textContent="计算中…";
   requestAnimationFrame(()=>requestAnimationFrame(()=>{
    try{
     setMode(mode,activeThreshold,true);
     button.textContent="已重新计算";
    }catch(error){
     console.error(error);
     button.textContent="计算失败";
    }finally{
     button.disabled=false;
     resetLabel=setTimeout(()=>{button.textContent="重新计算";},1600);
    }
   }));
  });
 });
 function changePair(key){
  const threshold=current?activeThreshold:undefined;
  selectMarket(key);
  rankings={};
  ohlc=Object.fromEntries(Object.entries(market.candles).map(([k,days])=>[k,days.map(([time,open,close,high,low])=>({time,open,high,low,close}))]));
  byDate=Object.fromEntries(Object.entries(ohlc).map(([k,days])=>[k,new Map(days.map(bar=>[bar.time,bar]))]));
  index=new Map(rows.map(([d],i)=>[d,i]));
  last=rows.length-1;
  cursorIndex=null; keyboardCursor=false;
  chart?.clearCrosshairPosition();
  assetButtons.forEach((button,j)=>{
   const key=button.dataset.assetReturn;
   assets[key].points=rows.map(row=>({time:row[0],value:row[j+1]/rows[0][j+1]}));
   set("asset-tip-"+key,market.names[j]+"（"+market.codes[j]+"）");
  });
  set("period",rows[0][0].replaceAll("-",".")+" 至 "+rows.at(-1)[0].replaceAll("-",".")+" · "+rows.length+" 个交易日");
  $("period").title=key==="etfs"?"588170 于 2025-04-08 上市；从上市首日起覆盖两只标的全部共同交易日。":"";
  set("tick-text","A 每档 ¥0.001，B 每档 ¥"+(tick[1]/1000).toFixed(tick[1]===1?3:2)+"。");
  $("etf-sources").hidden=key!=="etfs";
  $("original-sources").hidden=key!=="original";
  setMode(mode,threshold);
  setView("net");
 }
 $("asset-pair").addEventListener("change",e=>changePair(e.target.value));
 changePair("original");
}
if(typeof module!=="undefined")module.exports={simulate,simulateAccount,rank,rows,dailyMoves,accountMoves,compound,compactMoney,relativeHold,selectMarket,get marketState(){return {rows,accountMoves};}};
