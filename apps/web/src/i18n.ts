import { readFileSync, readdirSync } from "node:fs";

export type MessageCatalog = Record<string, string>;
const directory = new URL("../locales/", import.meta.url);
export function readCatalogs(): Record<string, MessageCatalog> {
  const catalogs: Record<string, MessageCatalog> = Object.fromEntries(
    readdirSync(directory)
      .filter((name) => /^[a-z]{2}(?:-[A-Za-z]{2,4})?\.json$/.test(name))
      .map((name) => [name.slice(0, -5), JSON.parse(readFileSync(new URL(name, directory), "utf8")) as MessageCatalog]),
  );
  // Incomplete community drafts are checked by CI, but never offered in the UI.
  const baseline = catalogs["zh-CN"];
  if (!baseline) throw new Error("Missing canonical interface catalog");
  for (const [locale, catalog] of Object.entries(catalogs)) {
    if (
      locale !== "zh-CN" &&
      Object.keys(baseline).some((key) => typeof catalog[key] !== "string" || !catalog[key].length)
    )
      delete catalogs[locale];
  }
  return catalogs;
}

/** Translate authored UI messages only. Never pass source, logs or evidence here. */
export function translateMessage(catalog: MessageCatalog, locale: string, key: string): string {
  if (locale === "zh-CN") return catalog[key] ?? key;
  return catalog[key] ?? key;
}

export function i18nClient(): string {
  const resources = JSON.stringify(readCatalogs()).replaceAll("<", "\\u003c");
  return String.raw`
const canaryCatalogs=${resources};
let storedLocale;try{storedLocale=localStorage.getItem('canary.locale')}catch{}
const requestedLocale=new URLSearchParams(location.search).get('lang');
const browserLocales=navigator.languages||[navigator.language];
const browserLocale=browserLocales.map(value=>Object.keys(canaryCatalogs).find(locale=>locale===value)||Object.keys(canaryCatalogs).find(locale=>locale.split('-')[0]===value.split('-')[0])).find(Boolean);
let canaryLocale=[requestedLocale,storedLocale,browserLocale,'en'].find(locale=>Object.hasOwn(canaryCatalogs,locale));
const t=key=>canaryCatalogs[canaryLocale][key]??canaryCatalogs['zh-CN'][key]??key;
const tfmt=(key,values)=>t(key).replace(/\{([a-zA-Z][a-zA-Z0-9_]*)\}/g,(match,name)=>Object.hasOwn(values,name)?String(values[name]):match);
function localizedValues(factory){let locale=canaryLocale,values=factory();return Object.defineProperties({},Object.fromEntries(Object.keys(values).map(key=>[key,{enumerable:true,get(){if(locale!==canaryLocale){values=factory();locale=canaryLocale}return values[key]}}])))}
const originalTitle=document.title,staticBindings=[];
const staticText=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
while(staticText.nextNode()){
 const node=staticText.currentNode;
 if(node.parentElement?.closest('script,style,pre,code,[data-no-translate]'))continue;
 const key=node.nodeValue.trim();
 if(Object.hasOwn(canaryCatalogs['zh-CN'],key))staticBindings.push({node,key,original:node.nodeValue});
}
for(const node of document.querySelectorAll('[title],[aria-label],[placeholder]'))for(const attr of ['title','aria-label','placeholder']){
 const value=node.getAttribute(attr);if(value&&Object.hasOwn(canaryCatalogs['zh-CN'],value))staticBindings.push({node,key:value,attr});
}
function translateStatic(){document.documentElement.lang=canaryLocale;document.title=t(originalTitle);for(const binding of staticBindings){const {node,key,original,attr}=binding;if(!node.isConnected)continue;if(attr)node.setAttribute(attr,t(key));else node.nodeValue=original.replace(key,t(key))}}
translateStatic();
const localePicker=document.getElementById('language-selector');
for(const locale of Object.keys(canaryCatalogs)){
 const option=document.createElement('option');option.value=locale;
 try{option.textContent=new Intl.DisplayNames([locale],{type:'language'}).of(locale)}catch{option.textContent=locale}
 localePicker.append(option);
}
localePicker.value=canaryLocale;
localePicker.onchange=()=>{const locale=localePicker.value;if(locale===canaryLocale||!Object.hasOwn(canaryCatalogs,locale))return;canaryLocale=locale;try{localStorage.setItem('canary.locale',locale)}catch{}const url=new URL(location.href);url.searchParams.set('lang',locale);history.replaceState(null,'',url);translateStatic();window.dispatchEvent(new Event('canary:locale-change'))};
`;
}
