"use strict";
const storageKey="dualz.liveSnapshot.v1";
const summaryKeys=["总资产（元）","证券市值（元）","可用资金（元）","可取资金（元）","持仓盈亏（元）","当日盈亏（元）"];
function numeric(raw){
 const s=String(raw??"").trim().replaceAll(",","").replace("−","-");
 if(!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(s))throw Error("有金额或数量无法识别，请复制完整区域。");
 const n=Number(s);if(!Number.isFinite(n))throw Error("金额或数量超出范围。");return n;
}
function parseSnapshot(tsv){
 const rows=String(tsv??"").trim().split(/\r?\n/).map(line=>line.split("\t").map(cell=>cell.trim()));
 if(rows[0]?.[0]!=="总体情况"||rows[1]?.[0]!=="快照日期"||!/^\d{4}-\d{2}-\d{2}$/.test(rows[1][1]??""))throw Error("请从「总体情况」复制 A1:I12，包含快照日期。");
 const holdingsHeader=rows.findIndex(row=>row[0]==="证券代码"&&row[1]==="证券简称");
 if(holdingsHeader<0)throw Error("找不到持仓表头，请复制完整区域。");
 const entries=new Map(rows.slice(2,holdingsHeader).map(([k,v])=>[k,v]));
 const totals=summaryKeys.map(k=>numeric(entries.get(k)));
 const positions=rows.slice(holdingsHeader+1).filter(r=>/^\d{6}$/.test(r[0])).map(([code,name,quantity,available,price,cost,value,pnl,rate])=>{
  if(!name||!/%$/.test(rate??""))throw Error("持仓明细缺少名称或收益率。");
  const p={code,name,quantity:numeric(quantity),available:numeric(available),price:numeric(price),cost:numeric(cost),value:numeric(value),pnl:numeric(pnl),rate:numeric(rate.slice(0,-1))};
  if(!Number.isInteger(p.quantity)||!Number.isInteger(p.available)||p.available<0||p.quantity<p.available)throw Error("持仓数量或可卖数量有误。");
  return p;
 });
 if(positions.length!==2||new Set(positions.map(p=>p.code)).size!==2)throw Error("请复制两只标的的完整持仓行。");
 return {date:rows[1][1],totals,positions};
}
function init(){
 const by=id=>document.getElementById(id), keyView=by("snapshot-view"), empty=by("snapshot-empty"), input=by("snapshot-input"), status=by("snapshot-status"), clear=by("snapshot-clear");
 const money=n=>new Intl.NumberFormat("zh-CN",{style:"currency",currency:"CNY"}).format(n);
 const decimal=(n,d)=>n.toLocaleString("zh-CN",{minimumFractionDigits:d,maximumFractionDigits:d});
 function el(tag,value){const e=document.createElement(tag);e.textContent=String(value);return e;}
 function display(value){
  keyView.hidden=!value;empty.hidden=!!value;clear.hidden=!value;
  if(!value){by("snapshot-date").textContent="";by("snapshot-totals").replaceChildren();by("snapshot-positions").replaceChildren();return;}
  by("snapshot-date").textContent=value.date+" · 北京时间 · 券商截图快照";
  by("snapshot-totals").replaceChildren(...value.totals.map((n,i)=>{const item=document.createElement("div");item.append(el("dt",summaryKeys[i].replace("（元）","")),el("dd",money(n)));return item;}));
  by("snapshot-positions").replaceChildren(...value.positions.map(p=>{const row=document.createElement("tr");row.append(...[p.name+"（"+p.code+"）",decimal(p.quantity,0),decimal(p.available,0),decimal(p.price,3),decimal(p.cost,4),money(p.value),money(p.pnl),decimal(p.rate,2)+"%"].map(v=>el("td",v)));return row;}));
 }
 try{const saved=localStorage.getItem(storageKey);if(saved){display(parseSnapshot(saved));by("snapshot-import").open=false;}}catch{status.textContent="未能读取本机快照，可重新导入。";}
 by("snapshot-save").addEventListener("click",()=>{
  try{const value=parseSnapshot(input.value);localStorage.setItem(storageKey,input.value);display(value);input.value="";status.textContent="已保存到此浏览器。";by("snapshot-import").open=false;}
  catch(e){status.textContent=e instanceof Error?e.message:"未能保存本机快照。";}
 });
 clear.addEventListener("click",()=>{
  if(!confirm("清除此浏览器的持仓快照？Drive 表格不会受影响。"))return;
  try{localStorage.removeItem(storageKey);display(null);status.textContent="已清除本机副本。";}
  catch{status.textContent="未能清除本机副本。";}
 });
}
if(typeof module!=="undefined")module.exports={parseSnapshot};
if(typeof document!=="undefined")init();