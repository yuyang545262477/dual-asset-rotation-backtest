"use strict";
const labels=["总资产","证券市值","可用资金","可取资金","持仓盈亏","当日盈亏"];
const money=n=>new Intl.NumberFormat("zh-CN",{style:"currency",currency:"CNY"}).format(n);
const decimal=(n,d)=>n.toLocaleString("zh-CN",{minimumFractionDigits:d,maximumFractionDigits:d});
function render({snapshot,trades}){
 const by=id=>document.getElementById(id);
 function node(tag,value){const e=document.createElement(tag);e.textContent=String(value);return e;}
 function row(values){const e=document.createElement("tr");e.append(...values.map(v=>node("td",v)));return e;}
 by("snapshot-date").textContent=snapshot.date+" · 北京时间 · 券商持仓快照（非实时）";
 by("snapshot-totals").replaceChildren(...snapshot.totals.map((n,i)=>{const e=document.createElement("div");e.append(node("dt",labels[i]),node("dd",money(n)));return e;}));
 by("snapshot-positions").replaceChildren(...snapshot.positions.map(p=>row([p.name+"（"+p.code+"）",decimal(p.quantity,0),decimal(p.available,0),decimal(p.price,3),decimal(p.cost,4),money(p.value),money(p.profit),decimal(p.returnPct,2)+"%"])));
 by("public-trades").replaceChildren(...trades.map(t=>row([t.date,t.name+"（"+t.code+"）",t.side,decimal(t.quantity,0),decimal(t.price,3),money(t.amount),t.fee===null?"待对账":money(t.fee)+(t.feeStatus==="估算"?"（估算）":"")])));
 by("snapshot-view").hidden=false;
 by("snapshot-empty").hidden=true;
}
if(typeof document!=="undefined")fetch("live-data.json",{cache:"no-store"}).then(r=>{if(!r.ok)throw Error("data unavailable");return r.json();}).then(render).catch(()=>{document.getElementById("snapshot-empty").textContent="暂时无法加载，请稍后刷新。";});
if(typeof module!=="undefined")module.exports={render};
