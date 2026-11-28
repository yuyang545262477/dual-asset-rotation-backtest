"use strict";
const originalRows=globalThis.ROTATION_PRICES, originalCandles=globalThis.ROTATION_CANDLES;
const etfPair=globalThis.ROTATION_ETF_PAIR;
const calendarAssets={
 "159509":{kind:"etf",name:"纳指科技 ETF",tick:1,candles:originalCandles.a,adjusted:new Map(originalRows.map(([date,value])=>[date,value]))},
 "600900":{kind:"stock",name:"长江电力",tick:10,candles:originalCandles.b,adjusted:new Map(originalRows.map(([date,,value])=>[date,value])),divs:{"2024-07-19":820,"2025-01-24":210,"2025-07-18":733,"2026-02-12":210,"2026-07-17":790}},
 "588170":{kind:"etf",name:"科创半导体 ETF 华夏",tick:1,candles:etfPair.candles.a,splits:{"2026-07-06":3}},
 "515880":{kind:"etf",name:"通信 ETF 国泰",tick:1,candles:[...(globalThis.ROTATION_515880_EARLY??[]),...etfPair.candles.b],splits:{"2026-02-03":3,"2026-07-06":2}}
};
for(const asset of Object.values(calendarAssets)){
 asset.byDate=new Map(asset.candles.map(bar=>[bar[0],bar]));
 if(!asset.adjusted){
  let remaining=1;
  asset.adjusted=new Map();
  for(let i=asset.candles.length-1;i>=0;i--){
   const [date,,close]=asset.candles[i];
   asset.adjusted.set(date,close/remaining);
   remaining*=asset.splits?.[date]??1;
  }
 }
}
let market,rows,dailyMoves,D,accountRows,accountMoves,tick,seriesAssets;
function selectMarket(a,b){
 if(a===b||!calendarAssets[a]||!calendarAssets[b])return false;
 seriesAssets=[calendarAssets[a],calendarAssets[b]];
 const [left,right]=seriesAssets;
 const dates=left.candles.map(bar=>bar[0]).filter(date=>right.byDate.has(date));
 rows=dates.map(date=>[date,left.adjusted.get(date),right.adjusted.get(date)]);
 tick=seriesAssets.map(x=>x.tick);
 market={codes:[a,b],names:seriesAssets.map(x=>x.name),candles:{a:dates.map(d=>left.byDate.get(d)),b:dates.map(d=>right.byDate.get(d))}};
 dailyMoves=rows.map(([,a,b],i)=>{
  if(!i)return null;
  const ra=a/rows[i-1][1], rb=b/rows[i-1][2];
  return {a:ra-1,b:rb-1,diff:ra-rb};
 });
 D=dailyMoves.map(m=>m?.diff??0);
 accountRows=market.candles?.a.map((r,i)=>[r[0],Math.round(r[2]*1000),Math.round(market.candles.b[i][2]*1000)])??[];
 accountMoves=accountRows.map(([date,a,b],i)=>{
  if(!i)return null;
  const [pa,pb]=seriesAssets.map((asset,j)=>{
   const factor=asset.splits?.[date]??1, previous=accountRows[i-1][j+1];
   return (factor===1?previous:Math.round(previous/factor/tick[j])*tick[j])-(asset.divs?.[date]??0);
  });
  const spread=[(a-tick[0])/pa-(b+tick[1])/pb,(b-tick[1])/pb-(a+tick[0])/pa];
  return {a:a/pa-1,b:b/pb-1,diff:Math.max(...spread),spread};
 });
 return true;
}
selectMarket("588170","600900");
const fmt=(x,d=2)=>(x>0?"+":x<0?"−":"")+Math.abs(x).toFixed(d);
const pct=x=>fmt(x*100)+"%";
const projectionYears=[5,10,15,20,30];
const relativeHold=f=>f.value/f.hold-1;
function compound(rate,years,principal){
 const multiplier=(1+rate)**years;
 return {gain:multiplier-1,amount:principal*multiplier};
}
function compactMoney(amount){
 const unit=amount>=1e8?[1e8,"亿"]:amount>=1e4?[1e4,"万"]:[1,""];
 const digits={minimumFractionDigits:2,maximumFractionDigits:2};
 return "¥"+(amount/unit[0]).toLocaleString("zh-CN",digits)+unit[1];
}

function simulate(t, full=false){
 const q=[.5/rows[0][1],.5/rows[0][2]],init=q.slice(),n=[4,4],block=[0,0], log=[],frames=[],year=[];
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
function rank(mode="ideal"){
 const account=mode!=="ideal", evaluate=account?t=>simulateAccount(t,true,capitalByMode[mode]):simulate;
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
// 以厘记账；手续费和印花税四舍五入至分，过户费按截图示例截到分。费率按每十万成交额表示。
const capitalByMode={account100:1000000,account:100000,account20:20000};
const feePolicy={brokerRate:30,minimumBrokerFee:5000,stockTransferRate:1,stockSellStampRate:50};
function tradeFee(amount,kind,side){
 if(amount<=0)return 0;
 const roundToCent=rate=>10*Math.floor((amount*rate+500000)/1000000);
 const broker=Math.max(feePolicy.minimumBrokerFee,roundToCent(feePolicy.brokerRate));
 if(kind==="etf")return broker;
 const transfer=10*Math.floor(amount*feePolicy.stockTransferRate/1000000);
 const stamp=side==="sell"?roundToCent(feePolicy.stockSellStampRate):0;
 return broker+transfer+stamp;
}
function affordable(cash,price,kind){
 let quantity=Math.max(0,Math.floor(cash/price/100)*100);
 while(quantity>0&&quantity*price+tradeFee(quantity*price,kind,"buy")>cash)quantity-=100;
 return quantity;
}
const maxPortions=8, lotSize=100;

// 单手金额较大的一侧作为锚。容量变化时，仅在另一侧增减份数。
function accountAllocation(holdings,prices,cash,previous=null,previousAnchor=null){
 const lots=holdings.map(q=>Math.floor(q/lotSize));
 const lotValues=prices.map(p=>p*lotSize);
 const anchor=lotValues[0]===lotValues[1]?(previousAnchor??0):lotValues[0]>lotValues[1]?0:1;
 const other=1-anchor;
 const nav=cash+holdings[0]*prices[0]+holdings[1]*prices[1];
 const capacity=Math.min(maxPortions,Math.floor(nav/lotValues[anchor]));
 if(capacity<2||lots.some(q=>q<1))return {anchor,capacity,portions:null,reason:"底仓拦截"};
 const portions=[0,0];
 if(previous){
  portions[anchor]=previous[anchor];
 }else{
  // 满八份且持仓允许时按 4:4 建仓；不足八份时，锚侧取持有手数，建仓最多四份。
  portions[anchor]=Math.min(4,lots[anchor],capacity-1);
 }
 portions[other]=capacity-portions[anchor];
 if(portions.some(q=>q<1))return {anchor,capacity,portions:null,reason:"底仓拦截"};
 if(portions.some((q,i)=>q>lots[i]))return {anchor,capacity,portions:null,reason:"不足整手"};
 return {anchor,capacity,portions,reason:null};
}

// 常规预算先由卖出所得覆盖；如果这一份卖到上限仍不够一手，现金才补差。
function planAccountSwap({holdings,portions,cash,seller,bid,ask,kinds,sellable=holdings[seller]}){
 const buyer=1-seller;
 if(portions[seller]<=1)return {reason:"底仓拦截"};
 const saleLimit=lotSize*Math.floor(Math.min(holdings[seller]/portions[seller],sellable)/lotSize);
 if(saleLimit<lotSize)return {reason:"不足整手"};
 const net=quantity=>quantity*bid[seller]-tradeFee(quantity*bid[seller],kinds[seller],"sell");
 const buyTotal=quantity=>quantity*ask[buyer]+tradeFee(quantity*ask[buyer],kinds[buyer],"buy");
 const netLimit=net(saleLimit);
 const buyBySale=affordable(netLimit,ask[buyer],kinds[buyer]);
 let sold=saleLimit,bought=buyBySale;
 if(buyBySale>=lotSize){
  // 先按这一份最多能买到的整手计算，再只卖够这些手数。
  const target=buyTotal(buyBySale);
  let low=1,high=saleLimit/lotSize;
  while(low<high){
   const mid=Math.floor((low+high)/2);
   if(net(mid*lotSize)>=target)high=mid;
   else low=mid+1;
  }
  sold=low*lotSize;
 }else{
  if(netLimit+cash<buyTotal(lotSize))return {reason:"卖出金额不足"};
  bought=lotSize;
 }
 const gross=sold*bid[seller],cost=bought*ask[buyer];
 const sellFee=tradeFee(gross,kinds[seller],"sell"),buyFee=tradeFee(cost,kinds[buyer],"buy");
 const cashUsed=Math.max(0,cost+buyFee-(gross-sellFee));
 return {sold,bought,sellFee,buyFee,cashUsed,cashAfter:cash+gross-sellFee-cost-buyFee};
}

// Quote scenarios use only the selected day's closes; never read next-session prices.
function nextTradePlans(frame,priceTicks,kinds,threshold){
 const holdings=frame.closingPositions.map(p=>p.quantity);
 const closes=frame.closingPositions.map(p=>Math.round(p.price*1000));
 const cash=Math.round(frame.cash*1000),parsed=frame.n?.split(":").map(Number);
 const previous=parsed?.length===2&&parsed.every(n=>Number.isInteger(n)&&n>0)?parsed:null;
 return [0,1].map(seller=>{
  const buyer=1-seller;
  if(!closes.every(p=>p>0)||!priceTicks.every(p=>p>0)||!Number.isFinite(threshold))return {reason:"暂无有效报价"};
  const quotes=closes.slice(),step=priceTicks[seller];
  // Buy leg: unchanged reference price, plus one tick for its modeled ask.
  const ask=closes.map((p,i)=>p+priceTicks[i]);
  const required=closes[seller]*(ask[buyer]/closes[buyer]+threshold+1e-12);
  let sellBid=(Math.floor(required/step)+1)*step;
  if(!(sellBid/closes[seller]-ask[buyer]/closes[buyer]>threshold+1e-12))sellBid+=step;
  // Sell leg uses bid; its reference price is one tick higher.
  quotes[seller]=sellBid+step;
  const bid=quotes.map((p,i)=>p-priceTicks[i]);
  const allocation=accountAllocation(holdings,quotes,cash,previous,frame.anchor);
  if(allocation.reason)return {reason:allocation.reason};
  return {...planAccountSwap({holdings,portions:allocation.portions,cash,seller,bid,ask,kinds}),sellBid,buyAsk:ask[buyer]};
 });
}

function simulateAccount(threshold, trade=true, capital=capitalByMode.account){
 const startCapital=capital*1000,kinds=seriesAssets.map(asset=>asset.kind);
 let cash=startCapital,totalFees=0,benchCash,peak=1,dd=0,signals=0,tr=0,prevYearV=1,prevYearH=1,units=null,anchor=null;
 const q=[0,0],benchQ=[0,0],block=[0,0],log=[],frames=[],year=[];
 for(const [i,[date,a,b]] of accountRows.entries()){
  const p=[a,b],bid=p.map((v,j)=>v-tick[j]),ask=p.map((v,j)=>v+tick[j]);
  if(!i){
   for(let j=0;j<2;j++){q[j]=affordable(startCapital/2,ask[j],kinds[j]);const amt=q[j]*ask[j],f=tradeFee(amt,kinds[j],"buy");cash-=amt+f;totalFees+=f;benchQ[j]=q[j];}
   benchCash=cash;
  }else{
   for(let j=0;j<2;j++){
    const asset=seriesAssets[j],factor=asset.splits?.[date]??1,div=asset.divs?.[date]??0;
    q[j]*=factor;benchQ[j]*=factor;cash+=q[j]*div;benchCash+=benchQ[j]*div;
   }
  }
  let allocation=accountAllocation(q,p,cash,units,anchor);
  anchor=allocation.anchor;
  if(allocation.portions)units=allocation.portions;
  if(i){
   const m=accountMoves[i],x=m.spread[0]>threshold+1e-12?0:m.spread[1]>threshold+1e-12?1:-1;
   if(trade&&x>=0){
    signals++;
    const y=1-x,e={date,dv:m.spread[x],x,n:units?.join(":")??"—"};
    const plan=allocation.reason?{reason:allocation.reason}:planAccountSwap({holdings:q,portions:units,cash,seller:x,bid,ask,kinds});
    if(plan.reason){
     e.bottom=plan.reason==="底仓拦截";e.skipped=true;e.reason=plan.reason;
     if(e.bottom)block[x]++;
    }else{
     const cashChange=(plan.cashAfter-cash)/1000;
     q[x]-=plan.sold;q[y]+=plan.bought;cash=plan.cashAfter;totalFees+=plan.sellFee+plan.buyFee;
     units[x]--;units[y]++;tr++;
     allocation=accountAllocation(q,p,cash,units,anchor);
     anchor=allocation.anchor;
     if(allocation.portions)units=allocation.portions;
     Object.assign(e,{sold:plan.sold,bought:plan.bought,sellPrice:bid[x]/1000,buyPrice:ask[y]/1000,cashUsed:plan.cashUsed/1000,sellAmount:plan.sold*bid[x]/1000,buyAmount:plan.bought*ask[y]/1000,tradeFee:(plan.sellFee+plan.buyFee)/1000,cashChange,n:units.join(":")});
    }
    log.push(e);
   }
  }
  const nav=cash+q[0]*a+q[1]*b,benchNav=benchCash+benchQ[0]*a+benchQ[1]*b,value=nav/startCapital,hold=benchNav/startCapital;
  frames.push({date,value,hold,n:units?.join(":")??"—",nav:nav/1000,benchNav:benchNav/1000,cash:cash/1000,closingPositions:p.map((price,j)=>({quantity:q[j],price:price/1000,marketValue:q[j]*price/1000})),fees:totalFees/1000,capacity:allocation.capacity,anchor,portionStatus:allocation.reason});
  peak=Math.max(peak,value);dd=Math.min(dd,value/peak-1);
  const yr=date.slice(0,4);
  if(i===accountRows.length-1||accountRows[i+1][0].slice(0,4)!==yr){
   year.push([yr,value/prevYearV-1,hold/prevYearH-1]);prevYearV=value;prevYearH=hold;
  }
 }
 const {value,hold,nav,benchNav}=frames.at(-1);
 return {value,hold,nav,benchNav,tr,signals,block,n:units,log,frames,year,dd,fees:totalFees/1000};
}
// Each month starts from the preceding month's ending value, or the initial principal.
function monthlyPerformance(frames,principal){
 const months=[];
 let prevV=1,prevH=1;
 for(let i=0;i<frames.length;i++){
  const {date,value,hold}=frames[i], month=date.slice(0,7);
  if(frames[i+1]?.date.slice(0,7)===month)continue;
  months.push({month,time:month+"-01",strategy:value/prevV-1,hold:hold/prevH-1,
   strategyPnl:(value-prevV)*principal,holdPnl:(hold-prevH)*principal});
  prevV=value;prevH=hold;
 }
 return months;
}
if(typeof document!=="undefined"){
 const $=id=>document.getElementById(id), set=(id,v)=>{$(id).textContent=v;};
 let rankings={};
 const money=x=>"¥"+x.toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2});
 let mode="account20";
 function renderAccountRanks(next){
  const benchmark=simulateAccount(0,false,capitalByMode[next]), tbody=$("account-comparisons");
  tbody.innerHTML=rankings[next].map(r=>'<tr><td><button class="threshold-button" type="button" data-threshold="'+r.threshold+'">'+r.threshold+'%</button></td><td>'+money(r.nav)+'</td><td>'+pct(r.value-1)+'</td><td>'+r.tr+'</td><td>'+money(r.fees)+'</td></tr>').join("")+'<tr><td>各买一半不动</td><td>'+money(benchmark.nav)+'</td><td>'+pct(benchmark.value-1)+'</td><td>0</td><td>'+money(benchmark.fees)+'</td></tr>';
  tbody.querySelectorAll("[data-threshold]").forEach(el=>el.addEventListener("click",()=>update(+el.dataset.threshold)));
 }
 function renderIdealRanks(){
  const tbody=$("ranks");
  tbody.innerHTML=rankings.ideal.map(k=>'<tr><td>'+k.band+'.x</td><td><button class="threshold-button" type="button" data-threshold="'+k.threshold+'">'+k.threshold+'%</button></td><td>'+pct(k.value-1)+'</td><td>'+k.tr+'</td></tr>').join("");
  tbody.querySelectorAll("[data-threshold]").forEach(el=>el.addEventListener("click",()=>update(+el.dataset.threshold)));
 }


 let current, view="net", range="all", mainSeries, holdSeries, gapSeries, gapVisible=false, cursorIndex=null, keyboardCursor=false, eventByDate=new Map(), activeThreshold=0;
 const host=$("chart"), terminal=$("terminal"), full=$("full");
 const TV=globalThis.LightweightCharts, theme=globalThis.dualChartTheme;
 let palette=theme.palette();
 const monthlyHost=$("monthly-calendar"),monthlyChoice=$("monthly-series");
 let monthlyMonths=[],monthlyHasCash=false;
 function paintMonths(){
  const key=monthlyChoice.value,amountKey=key+"Pnl";
  const byMonth=new Map(monthlyMonths.map(m=>[m.month,m]));
  const years=[...new Set(monthlyMonths.map(m=>m.month.slice(0,4)))].reverse();
  const signedMoney=value=>(value>.005?"+":value<-.005?"−":"")+money(Math.abs(value));
  monthlyHost.innerHTML=years.map(year=>{
   let multiplier=1,annualPnl=0;
   for(const month of monthlyMonths){
    if(!month.month.startsWith(year))continue;
    multiplier*=1+month[key];
    annualPnl+=month[amountKey];
   }
   const annualRate=multiplier-1,sign=annualRate>1e-10?"up":annualRate< -1e-10?"down":"flat";
   return '<section class="month-year"><h3>'+year+' 年 <span class="year-pnl" data-sign="'+sign+'">'+pct(annualRate)+
    (monthlyHasCash?' ('+signedMoney(annualPnl)+')':'')+'</span></h3><ul class="month-grid">'+
   Array.from({length:12},(_,i)=>{
    const n=i+1,m=byMonth.get(year+"-"+String(n).padStart(2,"0"));
    if(!m)return '<li class="month-tile month-empty"><span>'+n+' 月</span><span aria-label="无数据">—</span></li>';
    const rate=m[key],value=m[amountKey],sign=rate>1e-10?"up":rate< -1e-10?"down":"flat";
    return '<li class="month-tile" data-sign="'+sign+'"><span>'+n+' 月</span><strong>'+pct(rate)+'</strong>'+
     (monthlyHasCash?'<small>'+signedMoney(value)+'</small>':'')+'</li>';
   }).join("")+"</ul></section>";
  }).join("")||"暂无月度数据";
 }
 function renderMonths(frames,principal,hasCash){
  monthlyMonths=monthlyPerformance(frames,principal);
  monthlyHasCash=hasCash;
  paintMonths();
 }
 monthlyChoice.addEventListener("change",paintMonths);
 let ohlc,byDate,index;
 let yearRanges=new Map();
 const periods=$("chart-periods");
 const defaultReadoutIndex=()=>range==="start"?0:(yearRanges.get(range)?.last??rows.length-1);
 function renderYearRanges(){
  yearRanges=new Map();
  rows.forEach(([date],i)=>{
   const year=date.slice(0,4);
   if(!yearRanges.has(year))yearRanges.set(year,{first:i,last:i});
   else yearRanges.get(year).last=i;
  });
  if(range!=="all"&&range!=="start"&&!yearRanges.has(range))range="all";
  periods.querySelectorAll("[data-year-range]").forEach(button=>button.remove());
  const all=periods.querySelector('[data-range="all"]');
  for(const [year,{first,last}] of yearRanges){
   const button=document.createElement("button");
   button.type="button";
   button.dataset.range=year;
   button.dataset.yearRange="";
   button.textContent=year+" 年";
   button.title=rows[first][0]+" 至 "+rows[last][0];
   button.setAttribute("aria-pressed",String(range===year));
   all.before(button);
  }
 }
 // Adjust all four OHLC prices by the same factor, keeping the original return baseline.
 function normalizedCandles(bars,column){
  const base=rows[0][column];
  return bars.map(({time,open,high,low,close},i)=>{
   const normalizedClose=rows[i][column]/base;
   const factor=normalizedClose/close;
   return {time,open:open*factor,high:high*factor,low:low*factor,close:normalizedClose};
  });
 }
 const assetCandleColors=color=>({
  upColor:"transparent",downColor:color+"66",
  borderUpColor:color,borderDownColor:color,wickUpColor:color,wickDownColor:color
 });
 const assets={
  a:{color:palette.a,candles:[],visible:false,series:null},
  b:{color:palette.b,candles:[],visible:false,series:null}
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
   syncNetAxes();
   setNetSummary();
   showData(cursorIndex===null?undefined:rows[cursorIndex][0]);
  });
 }
 const chart=TV?.createChart(host,{
  autoSize:true,
  layout:{background:{type:TV.ColorType.Solid,color:palette.background},textColor:palette.text,fontSize:13,attributionLogo:false},
  grid:{vertLines:{color:palette.grid},horzLines:{color:palette.grid}},
  crosshair:{mode:TV.CrosshairMode.Normal},
  leftPriceScale:{visible:false,borderColor:palette.border,textColor:palette.gapAxis,scaleMargins:{top:.1,bottom:.11}},
  rightPriceScale:{borderColor:palette.border,scaleMargins:{top:.1,bottom:.11}},
  timeScale:{borderColor:palette.border,rightOffset:3,timeVisible:false,fixLeftEdge:true},
  localization:{locale:"zh-CN",dateFormat:"yyyy-MM-dd"}
 });
 let netTradeMarkers,gapTradeMarkers,gapZeroLine;
 const gapToggle=$("hold-gap-toggle"), strategyToggle=$("strategy-toggle"), gapLabel=$("hold-gap-return");
 function syncNetAxes(){
  const comparing=view==="net"&&gapVisible;
  chart.applyOptions({
   leftPriceScale:{visible:false},
   rightPriceScale:{visible:!comparing}
  });
 }
 function toggleGap(on){
  if(!gapSeries||view!=="net")return;
  gapVisible=on;
  mainSeries.applyOptions({visible:!on});
  holdSeries.applyOptions({visible:!on});
  gapSeries.applyOptions({visible:on});
  strategyToggle.setAttribute("aria-pressed",!on);
  gapToggle.setAttribute("aria-pressed",on);
  gapLabel.hidden=!on;
  syncNetAxes();
  renderTradeMarkers();
  setNetSummary();
  if(keyboardCursor&&cursorIndex!==null)selectDay(cursorIndex,false);
  else showData(cursorIndex===null?undefined:rows[cursorIndex][0]);
 }
 gapToggle.addEventListener("click",()=>toggleGap(!gapVisible));
 function showData(time){
  if(view==="net"){
   const i=index.get(time)??defaultReadoutIndex(), f=current.frames[i], move=mode!=="ideal"?accountMoves[i]:dailyMoves[i];
   set("strategy-return"," "+pct(f.value-1));
   const differenceRate=pct(relativeHold(f));
   if(gapVisible)set("hold-gap-return"," "+differenceRate);
   set("readout",f.date+" · 轮动 "+f.value.toFixed(3)+" · 持有 "+f.hold.toFixed(3)+" · 份数 "+f.n);
   if(gapVisible&&mode==="ideal")set("readout",f.date+" · 比持有 "+differenceRate+" · 份数 "+f.n);
   for(const [key,asset] of Object.entries(assets)){
    if(asset.visible)set("asset-return-"+key," "+pct(asset.candles[i].close-1));
   }
   const event=eventByDate.get(f.date), status=$("daily-status");
   $("account-readout").hidden=mode==="ideal";
   if(mode!=="ideal"){
    const dailyReturn=i>0?Math.round((f.nav/current.frames[i-1].nav-1)*10000)/100:null;
    set("account-amounts",money(f.nav));
    const swapped=event?.sold>0&&event?.bought>0&&!event.skipped;
    $("account-day-trade-content").hidden=!swapped;
    $("account-day-trade-blank").hidden=swapped;
    if(swapped){
     const sign=value=>value>0?"up":value<0?"down":"flat";
     const prefix=value=>value>0?"+":value<0?"−":"";
     const showChange=(id,value,label)=>{
      set(id,prefix(value)+label);
      $(id).dataset.sign=sign(value);
     };
     seriesAssets.forEach(({kind},j)=>{
      const selling=j===event.x, quantity=selling?event.sold:event.bought;
      showChange(j===0?"day-trade-a":"day-trade-b",selling?-quantity:quantity,quantity.toLocaleString("zh-CN")+(kind==="etf"?" 份":" 股"));
     });
     const delta=Math.round((event.buyAmount-event.sellAmount)*100)/100;
     set("day-trade-sell",money(event.sellAmount));
     set("day-trade-delta",(delta<0?"-":prefix(delta))+money(Math.abs(delta)));
     $("day-trade-delta").dataset.sign=sign(delta);
     set("day-trade-fee",money(event.tradeFee));
     showChange("day-trade-cash",event.cashChange,money(Math.abs(event.cashChange)));
    }
    for(const [j,{quantity,price,marketValue}] of f.closingPositions.entries()){
     const key=j===0?"a":"b", etf=seriesAssets[j].kind==="etf";
     set("account-close-"+key,key.toUpperCase()+"：持有 "+quantity.toLocaleString("zh-CN")+(etf?" 份":" 股")+" · 收盘价 ¥"+price.toFixed(etf?3:2)+" · 市值 "+money(marketValue));
    }
    set("account-close-cash","现金："+money(f.cash));
    const kindBySide=seriesAssets.map(asset=>asset.kind);
    nextTradePlans(f,tick,kindBySide,activeThreshold/100).forEach((plan,seller)=>{
     const reason=$("plan-"+seller+"-reason");
     reason.hidden=!plan.reason;
     reason.textContent=plan.reason?"不交易 · "+plan.reason:"";
     for(let side=0;side<2;side++){
      const id="plan-"+seller+"-"+side;
      $(id+"-cell").hidden=!!plan.reason;
      if(plan.reason)continue;
      const selling=side===seller,qty=selling?plan.sold:plan.bought;
      set(id+"-qty",(selling?"−":"+")+qty.toLocaleString("zh-CN"));
      $(id+"-qty").dataset.sign=selling?"down":"up";
      set(id+"-unit",kindBySide[side]==="etf"?" 份":" 股");
      const quote=(selling?plan.sellBid:plan.buyAsk)/1000;
      set(id+"-price"," @ ¥"+quote.toFixed(tick[side]===1?3:2));
     }
    });
    set("account-daily-return",dailyReturn===null?"—":fmt(dailyReturn)+"%");
    $("account-daily-return").dataset.sign=dailyReturn>0?"up":dailyReturn<0?"down":"flat";
    $("account-daily-return").title=i>0?"策略总资产（含现金）相对上一交易日的变化":"样本首日无前一日总资产";
   }
   for(const [id,value,unit] of [["daily-a",move?.a,"%"],["daily-b",move?.b,"%"],["daily-diff",move?.diff,"%"]]){
    set(id,value===undefined?"—":fmt(value*100)+unit);
    $(id).dataset.sign=value>0?"up":value<0?"down":"flat";
   }
   $("daily-readout").title=move?"按回测口径，以当天收盘相对上个交易日收盘计算。":"样本首日无前一日数据。";
   status.dataset.kind=event?.bottom?"blocked":event&&!event.skipped?"trade":"idle";
   status.textContent=event?.bottom?"底仓拦截":event?.reason??(event?"交易":"未达条件");
   status.title=event?(event.bottom?"至少保留一份底仓，未换仓":event.reason??"交易")
    :move?"价差未超过 "+activeThreshold+"%":"首日无昨收";
   status.hidden=false;
   $("daily-readout").hidden=false;
  }else{
   $("daily-readout").hidden=true;
   $("account-readout").hidden=true;
   const f=byDate[view].get(time)??ohlc[view][defaultReadoutIndex()], d=tick[view==="a"?0:1]===1?3:2;
   set("readout",f.time+" · 开 "+f.open.toFixed(d)+" · 高 "+f.high.toFixed(d)+" · 低 "+f.low.toFixed(d)+" · 收 "+f.close.toFixed(d));
  }
 }
 function setRange(){
  if(!chart)return;
  cancelPan();
  if(panEdgeUnlocked){chart.timeScale().applyOptions({fixLeftEdge:true});panEdgeUnlocked=false;}
  if(range==="all")chart.timeScale().fitContent();
  else if(range==="start")chart.timeScale().setVisibleLogicalRange({from:0,to:Math.min(364,rows.length-1)});
  else{
   const bounds=yearRanges.get(range);
   if(bounds)chart.timeScale().setVisibleLogicalRange({from:bounds.first-.49,to:bounds.last+.49});
  }
  periods.querySelectorAll("[data-range]").forEach(e=>e.setAttribute("aria-pressed",e.dataset.range===range));
 }
 function setNetSummary(){
  const title=gapVisible?"比持有 · 0% 为基准":"蓝线：轮动 · 灰线：持有";
  host.setAttribute("aria-label",gapVisible?"比持有差异线":"策略与持有净值曲线");
  set("graph-summary",title+" · 策略最大回撤 "+pct(current.dd)+" · 期末份数 "+(current.n?.join(":")??"—")+(Object.values(assets).some(asset=>asset.visible)?" · K 线独立缩放":""));
 }
 function renderTradeMarkers(){
  if(!netTradeMarkers||!gapTradeMarkers)return;
  const points=activeThreshold>1?current.log.filter(e=>!e.bottom&&!e.skipped).map(e=>({
   time:e.date,position:e.x===0?"aboveBar":"belowBar",shape:e.x===0?"arrowDown":"arrowUp",
   color:e.x===0?palette.buyB:palette.buyA,size:1
  })):[];
  netTradeMarkers.setMarkers(gapVisible?[]:points);
  gapTradeMarkers.setMarkers(gapVisible?points:[]);
 }
 function updateNet(){
  if(!chart||view!=="net"||!mainSeries)return;
  mainSeries.setData(current.frames.map(f=>({time:f.date,value:f.value})));
  holdSeries.setData(current.frames.map(f=>({time:f.date,value:f.hold})));
  gapSeries.setData(current.frames.map(f=>({time:f.date,value:relativeHold(f)})));
  renderTradeMarkers();
  setNetSummary();
  showData(cursorIndex===null?undefined:rows[cursorIndex][0]);
 }
 const candleColors=()=>({upColor:palette.up,downColor:palette.down,wickUpColor:palette.up,wickDownColor:palette.down,borderVisible:false});
 function setView(next){
  cancelPan();crosshairY=null;
  view=next;cursorIndex=null;keyboardCursor=false;
  if(!chart){set("readout","图表组件无法加载，收益和换仓记录仍可查看。");return;}
  netTradeMarkers?.detach();gapTradeMarkers?.detach();
  netTradeMarkers=gapTradeMarkers=null;
  if(mainSeries)chart.removeSeries(mainSeries);
  if(holdSeries){chart.removeSeries(holdSeries);holdSeries=null;}
  if(gapSeries){chart.removeSeries(gapSeries);gapSeries=null;gapZeroLine=null;}
  for(const asset of Object.values(assets)){
   if(asset.series){chart.removeSeries(asset.series);asset.series=null;}
  }
  $("asset-legend").hidden=view!=="net";
  gapToggle.hidden=view!=="net";
  if(view==="net"){
   mainSeries=chart.addSeries(TV.LineSeries,{color:palette.net,lineWidth:2,visible:!gapVisible,priceFormat:{type:"price",precision:3,minMove:.001}});
   holdSeries=chart.addSeries(TV.LineSeries,{color:palette.hold,lineWidth:2,visible:!gapVisible,lineStyle:TV.LineStyle.Dashed,priceLineVisible:false,priceFormat:{type:"price",precision:3,minMove:.001}});
   gapSeries=chart.addSeries(TV.LineSeries,{color:palette.gap,lineWidth:2,visible:gapVisible,priceScaleId:"left",
    lastValueVisible:false,priceLineVisible:false,priceFormat:{type:"custom",minMove:.0001,formatter:pct},
    autoscaleInfoProvider:base=>{
     const info=base();
     if(!info?.priceRange)return info;
     const {minValue,maxValue}=info.priceRange;
     return {...info,priceRange:{minValue:Math.min(0,minValue),maxValue:Math.max(0,maxValue)}};
    }
   });
   if(TV.createSeriesMarkers){
    netTradeMarkers=TV.createSeriesMarkers(mainSeries,[],{autoScale:false});
    gapTradeMarkers=TV.createSeriesMarkers(gapSeries,[],{autoScale:false});
   }
   gapZeroLine=gapSeries.createPriceLine({price:0,color:palette.zero,lineWidth:1,lineStyle:TV.LineStyle.Dashed,axisLabelVisible:false,title:""});
   // Overlay candles in the same pane, with an independent auto-scaled axis for each asset.
   for(const [key,asset] of Object.entries(assets)){
    asset.series=chart.addSeries(TV.CandlestickSeries,{
     ...assetCandleColors(asset.color),visible:asset.visible,
     priceScaleId:"asset-"+key,lastValueVisible:false,priceLineVisible:false,
     priceFormat:{type:"price",precision:3,minMove:.001}
    });
    asset.series.setData(asset.candles);
   }
   updateNet();
  }else{
   const colors=candleColors();
   const d=tick[view==="a"?0:1]===1?3:2;
   mainSeries=chart.addSeries(TV.CandlestickSeries,{...colors,priceFormat:{type:"price",precision:d,minMove:10**(-d)}});
   mainSeries.setData(ohlc[view]);
   set("graph-summary","日 K 线 · 场内成交价（不复权）· 红涨绿跌");
   showData();
  }
  if(view!=="net")host.setAttribute("aria-label",market.names[view==="a"?0:1]+" 日 K 线");
  document.querySelectorAll("[data-view]").forEach(e=>e.setAttribute("aria-pressed",e.dataset.view===view&&!gapVisible));
  syncNetAxes();
  setRange();
 }
 let crosshairY=null,panFrame=0,pendingPan=null,panEdgeUnlocked=false;
 function cancelPan(){
  if(panFrame)cancelAnimationFrame(panFrame);
  panFrame=0;pendingPan=null;
 }
 chart?.subscribeCrosshairMove(p=>{
  if(keyboardCursor)return;
  const time=typeof p.time==="string"?p.time:p.time?[p.time.year,String(p.time.month).padStart(2,"0"),String(p.time.day).padStart(2,"0")].join("-"):null;
  if(time&&index.has(time)){
   const nextIndex=index.get(time);
   if(Number.isFinite(p.point?.y))crosshairY=p.point.y;
   if(cursorIndex!==nextIndex){cursorIndex=nextIndex;showData(time);}
  }
  else if(mainSeries&&!keyboardCursor&&cursorIndex===null){showData();}
 });
 host.addEventListener("pointermove",()=>{cancelPan();keyboardCursor=false;},{passive:true,capture:true});
 host.addEventListener("pointerdown",()=>{cancelPan();keyboardCursor=false;host.focus({preventScroll:true});});
 let last=rows.length-1;
 const clampDay=i=>Math.max(0,Math.min(last,i));
 function spanRange(from,width){
  const t=chart.timeScale(), span=Math.max(8,Math.min(last,width)), start=Math.max(0,Math.min(last-span,from));
  t.setVisibleLogicalRange({from:start,to:start+span});
 }
 function selectDay(i,follow=true,fixedY=null){
  keyboardCursor=true;cursorIndex=clampDay(i);
  const t=chart.timeScale(), r=t.getVisibleLogicalRange();
  if(follow&&r&&(cursorIndex<Math.ceil(r.from)||cursorIndex>Math.floor(r.to))){
   const w=r.to-r.from;
   spanRange(cursorIndex<r.from?cursorIndex-1:cursorIndex-w+1,w);
  }
  const date=rows[cursorIndex][0], f=current.frames[cursorIndex];
  const comparing=view==="net"&&gapVisible;
  const value=view==="net"?(comparing?relativeHold(f):f.value):byDate[view].get(date)?.close;
  const series=comparing?gapSeries:mainSeries;
  const cursorPrice=Number.isFinite(fixedY)?series.coordinateToPrice(fixedY):value;
  if(Number.isFinite(cursorPrice)){
   chart.setCrosshairPosition(cursorPrice,date,series);
   crosshairY=fixedY??series.priceToCoordinate(cursorPrice);
  }
  showData(date);
 }
 function clearCursor(){
  cancelPan();crosshairY=null;
  cursorIndex=null;keyboardCursor=false;chart?.clearCrosshairPosition();showData();
 }
 function panWithFixedCrosshair(step){
  const scale=chart.timeScale(), r=scale.getVisibleLogicalRange();
  if(!r)return;
  const cursorVisible=cursorIndex!==null&&cursorIndex>=r.from-.5&&cursorIndex<=r.to+.5;
  const origin=pendingPan?.index??(cursorVisible?cursorIndex:clampDay(Math.round((r.from+r.to)/2)));
  const next=clampDay(origin+step);
  if(next===origin)return;
  const from=pendingPan?.from??r.from,to=pendingPan?.to??r.to;
  const y=pendingPan?.y??(cursorVisible?crosshairY:null);
  pendingPan={index:next,from:from+step,to:to+step,y};
  keyboardCursor=true;
  if(!panEdgeUnlocked){scale.applyOptions({fixLeftEdge:false});panEdgeUnlocked=true;}
  // Shift the logical range and date by the same number of bars to preserve the x coordinate.
  scale.setVisibleLogicalRange({from:pendingPan.from,to:pendingPan.to});
  if(!panFrame)panFrame=requestAnimationFrame(()=>{
   panFrame=0;
   const target=pendingPan;pendingPan=null;
   if(target)selectDay(target.index,false,target.y);
  });
 }
 function handleShortcut(e){
  if(!chart||!mainSeries||e.defaultPrevented||e.isComposing||e.metaKey||e.ctrlKey)return;
  if(e.altKey){
   if(e.shiftKey||!["ArrowLeft","ArrowRight"].includes(e.key))return;
   e.preventDefault();panWithFixedCrosshair(e.key==="ArrowLeft"?-1:1);return;
  }
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
  e.preventDefault();cancelPan();fn();
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
 const detailTabs=[...document.querySelectorAll(".backtest-tabs [role=tab]")];
 function activateDetailTab(index,focus=false){
  detailTabs.forEach((tab,i)=>{
   const active=i===index;
   tab.setAttribute("aria-selected",String(active));
   tab.tabIndex=active?0:-1;
   $(tab.getAttribute("aria-controls")).hidden=!active;
   if(active&&focus)tab.focus({preventScroll:true});
  });
 }
 detailTabs.forEach((tab,i)=>{
  tab.addEventListener("click",()=>activateDetailTab(i));
  tab.addEventListener("keydown",e=>{
   const size=detailTabs.length;
   const next={ArrowRight:(i+1)%size,ArrowLeft:(i+size-1)%size,Home:0,End:size-1}[e.key];
   if(next!==undefined){e.preventDefault();activateDetailTab(next,true);}
  });
 });
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
 periods.addEventListener("click",e=>{
  const button=e.target.closest("button[data-range]");
  if(!button||!periods.contains(button))return;
  range=button.dataset.range;
  setRange();
  clearCursor();
 });
 function update(value, preserve=false){
  const t=Math.min(12,Math.max(0,value));
  if(!preserve)$("limit").value=t;
  $("slider").value=t;
  current=mode!=="ideal"?simulateAccount(t/100,true,capitalByMode[mode]):simulate(t/100,true);
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
  renderMonths(current.frames,principal,mode!=="ideal");
  set("projection-capital",mode==="ideal"?"本金 1":compactMoney(principal));
  $("projections").innerHTML=projectionYears.map(n=>'<tr><td>'+n+' 年</td>'+averages.map(rate=>{
   if(rate===null)return "<td>—</td>";
   const {gain,amount}=compound(rate,n,principal);
   return "<td>"+pct(gain)+" ("+(mode==="ideal"?"本金 ×"+amount.toFixed(2):compactMoney(amount))+")</td>";
  }).join("")+"</tr>").join("");
  $("years").innerHTML=year.map(([y,a,b])=>'<tr><td>'+y+'</td><td>'+pct(a)+'</td><td>'+pct(b)+'</td></tr>').join("");
  $("log").innerHTML=log.slice(-12).reverse().map(({date,dv,x,bottom,n,skipped,sold,bought,sellPrice,buyPrice,reason,cashUsed})=>'<tr><td>'+date+'</td><td>'+fmt(dv*100,4)+'</td><td'+(bottom?' class="warn"':'')+'>'+(bottom?"底仓拦截":skipped?(reason??"不足一手"):(x===0?"A 转 B":"B 转 A")+(sold?" · 卖 "+sold+" @ "+sellPrice+"，买 "+bought+" @ "+buyPrice+(cashUsed?" · 现金补差 "+money(cashUsed):""):""))+'</td><td>'+n+'</td></tr>').join("")||'<tr><td colspan="4">该阈值没有触发记录。</td></tr>';
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
  if(refresh||!rankings[next])rankings[next]=rank(next);
  if(account){
   const wan=capitalByMode[next]/10000;
   set("account-mode-label",wan+" 万元模拟");
   set("account-start-capital",wan+" 万元");
   set("account-half-capital",wan/2+" 万元");
   renderAccountRanks(next);
  }else renderIdealRanks();
  const best=rankings[next][0].threshold;
  $("threshold-best").dataset.threshold=best;
  set("threshold-best","样本最高 "+best+"%");
  set("gap-label",account?"可成交价差":"价差");
  $("gap-label").title=account?"卖 A 买 B、卖 B 买 A 两种方向中，按买一和卖一算出的较大价差。":"A 的日收益率减去 B 的日收益率";
  update(threshold??Number(best));
 }
 document.querySelectorAll("[data-mode]").forEach(el=>el.addEventListener("click",()=>setMode(el.dataset.mode)));
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
 const choiceA=$("asset-choice-a"),choiceB=$("asset-choice-b");
 function changePair(){
  if(!selectMarket(choiceA.value,choiceB.value))return;
  set("stock-view-a",market.codes[0]+" "+market.names[0]);
  set("stock-view-b",market.codes[1]+" "+market.names[1]);
  set("history-pair","A = "+market.codes[0]+" · B = "+market.codes[1]);
  stockLabel.textContent="个股 K 线";
  for(const [target,other] of [[choiceA,choiceB],[choiceB,choiceA]]){
   const selected=target.value;
   const options=["159509","600900","588170","515880"].filter(code=>code!==other.value).map(code=>{
    const option=document.createElement("option");
    option.value=code;option.textContent=code+" "+calendarAssets[code].name;
    option.selected=code===selected;
    return option;
   });
   target.replaceChildren(...options);
   target.value=selected;
  }
  rankings={};
  ohlc=Object.fromEntries(Object.entries(market.candles).map(([k,days])=>[k,days.map(([time,open,close,high,low])=>({time,open,high,low,close}))]));
  byDate=Object.fromEntries(Object.entries(ohlc).map(([k,days])=>[k,new Map(days.map(bar=>[bar.time,bar]))]));
  index=new Map(rows.map(([d],i)=>[d,i]));
  renderYearRanges();
  last=rows.length-1;
  cursorIndex=null; keyboardCursor=false;
  chart?.clearCrosshairPosition();
  assetButtons.forEach((button,j)=>{
   const key=button.dataset.assetReturn;
   assets[key].candles=normalizedCandles(ohlc[key],j+1);
   set("asset-tip-"+key,market.names[j]+"（"+market.codes[j]+"）");
  });
  set("period",rows[0][0].replaceAll("-",".")+" 至 "+rows.at(-1)[0].replaceAll("-",".")+" · "+rows.length+" 个交易日");
  $("period").title=market.codes.includes("588170")?"588170 于 2025-04-08 上市；从上市首日起覆盖两只标的全部共同交易日。":"";
  const tickText=j=>"¥"+(tick[j]/1000).toFixed(tick[j]===1?3:2);
  set("tick-text","A 每档 "+tickText(0)+"，B 每档 "+tickText(1)+"。");
  $("etf-sources").hidden=!market.codes.some(c=>c==="588170"||c==="515880");
  $("original-sources").hidden=!market.codes.some(c=>c==="159509"||c==="600900");
  setMode(mode);
  setView("net");
 }
 choiceA.addEventListener("change",changePair);
 choiceB.addEventListener("change",changePair);
 changePair();
 theme.watch(p=>{
  palette=p;
  if(chart)theme.apply(chart,TV,p);
  if(view==="net")mainSeries?.applyOptions({color:p.net});
  else mainSeries?.applyOptions(candleColors());
  holdSeries?.applyOptions({color:p.hold});
  gapSeries?.applyOptions({color:p.gap});
  gapZeroLine?.applyOptions({color:p.zero});
  for(const button of assetButtons){
   const key=button.dataset.assetReturn;
   assets[key].color=p[key];
   assets[key].series?.applyOptions(assetCandleColors(p[key]));
   button.style.setProperty("--asset-color",p[key]);
  }
  renderTradeMarkers();
 });
}
if(typeof module!=="undefined")module.exports={accountAllocation,planAccountSwap,tradeFee,affordable,simulate,simulateAccount,rank,rows,dailyMoves,accountMoves,compound,compactMoney,relativeHold,selectMarket,get marketState(){return {rows,accountMoves};}};
