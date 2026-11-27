"use strict";
globalThis.dualChartTheme=(()=>{
 const media=globalThis.matchMedia?.("(prefers-color-scheme: dark)");
 const light={background:"#ffffff",text:"#39516b",grid:"#edf2f8",border:"#dce5ef",net:"#1555bd",hold:"#718198",gap:"#008375",gapAxis:"#09665b",zero:"#66827e",a:"#ad4d13",b:"#7650a6",buyB:"#d00068",buyA:"#698500",up:"#c53c46",down:"#148067"};
 const dark={background:"#182332",text:"#bccbe0",grid:"#29374b",border:"#344257",net:"#83b4ff",hold:"#a1aec2",gap:"#55d1bb",gapAxis:"#79e0cb",zero:"#617d79",a:"#ffae73",b:"#c6a4fb",buyB:"#ff68ac",buyA:"#c4df63",up:"#fd8497",down:"#55d3a3"};
 const palette=()=>media?.matches?dark:light;
 const apply=(chart,TV,p)=>chart.applyOptions({
  layout:{background:{type:TV.ColorType.Solid,color:p.background},textColor:p.text},
  grid:{vertLines:{color:p.grid},horzLines:{color:p.grid}},
  leftPriceScale:{borderColor:p.border,textColor:p.gapAxis},rightPriceScale:{borderColor:p.border},timeScale:{borderColor:p.border}
 });
 const watch=fn=>{
  fn(palette());
  if(media?.addEventListener)media.addEventListener("change",()=>fn(palette()));
  else media?.addListener?.(()=>fn(palette()));
 };
 return {palette,apply,watch};
})();
