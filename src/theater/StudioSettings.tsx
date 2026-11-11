import type { ReactNode } from "react";
import { ArrowLeft, Bot, Film, FolderOpen, Palette, SlidersHorizontal } from "lucide-react";
import { AppearanceFields, type Preferences } from "./AppearanceMenu";

const pages=[["appearance","外观与预览",Palette],["project","工程与保存",FolderOpen],
  ["editing","编辑默认值",SlidersHorizontal],["export","导出",Film],["agent","Agent 与 MCP",Bot]] as const;
export type SettingsPage=(typeof pages)[number][0];

export function StudioSettings({page,select,prefs,change,close,help,agent}:{
  page:SettingsPage;select:(page:SettingsPage)=>void;prefs:Preferences;change:(prefs:Preferences)=>void;
  close:()=>void;help:()=>void;agent:ReactNode;
}) {
  function set<K extends keyof Preferences>(key:K,value:Preferences[K]) { change({...prefs,[key]:value}); }
  function number<K extends "defaultFps"|"defaultDuration"|"autosaveDelay"|"previewQuality">(key:K,label:string,values:readonly (readonly [number,string])[]) {
    return <label className="stack-field">{label}<select value={prefs[key]} onChange={e=>set(key,+e.target.value)}>
      {values.map(([n,name])=><option key={n} value={n}>{name}</option>)}
    </select></label>;
  }
  function toggle(key:"autoSave"|"embedCanvases"|"embedSingle"|"defaultSnap"|"defaultAutoKey"|"defaultGrid",label:string) {
    return <label className="toggle-line"><input type="checkbox" checked={prefs[key]} onChange={e=>set(key,e.target.checked)}/>{label}</label>;
  }
  return <section className="studio-settings-page" aria-label="FrameStudio 设置">
    <header><button onClick={close} aria-label="关闭对话框"><ArrowLeft size={18}/> 返回编辑</button><strong>FrameStudio 设置</strong></header>
    <nav aria-label="设置分类">{pages.map(([id,name,Icon])=><button key={id} aria-pressed={id===page} onClick={()=>select(id)}><Icon size={17}/>{name}</button>)}
      <button onClick={help}>查看操作帮助</button>
    </nav>
    <main><h1>{pages.find(p=>p[0]===page)?.[1]}</h1>
      {page==="appearance" && <div className="studio-settings-fields">
        <AppearanceFields value={prefs} change={change}/>
        {number("previewQuality","预览质量",[[640,"流畅"],[960,"均衡"],[1440,"高清"]])}
        {toggle("defaultGrid","启动时显示三维网格")}
      </div>}
      {page==="project" && <div className="studio-settings-fields">
        {toggle("autoSave","工作时自动保存草稿")}
        {number("autosaveDelay","停止编辑后自动保存",[[1.3,"约 1 秒"],[5,"5 秒"],[15,"15 秒"],[30,"30 秒"]])}
        <label className="stack-field">软件关闭行为<select value={prefs.closeBehavior} onChange={e=>set("closeBehavior",e.target.value as Preferences["closeBehavior"])}>
          <option value="ask">每次询问</option><option value="save">保存草稿后退出</option><option value="discard">直接退出</option>
        </select></label>
        {toggle("embedCanvases","总工程内的子画布各自嵌入资产")}
        {toggle("embedSingle","独立 .livemg 嵌入资产")}
      </div>}
      {page==="editing" && <div className="studio-settings-fields">
        {number("defaultFps","新建独立工程帧率",[24,25,30,50,60].map(n=>[n,n+" fps"] as const))}
        {number("defaultDuration","新建独立工程时长",[5,10,12,15,30,60].map(n=>[n,n+" 秒"] as const))}
        {toggle("defaultSnap","启动时启用时间线吸附")}
        {toggle("defaultAutoKey","启动时启用自动关键帧")}
      </div>}
      {page==="export" && <div className="studio-settings-fields"><label className="stack-field">打开导出面板时的格式
        <select value={prefs.defaultExportFormat} onChange={e=>set("defaultExportFormat",e.target.value as Preferences["defaultExportFormat"])}>
          <option value="mp4">MP4</option><option value="prores">ProRes 4444</option><option value="webm">WebM</option><option value="png">PNG 序列</option>
        </select></label></div>}
      {page==="agent" && <div className="studio-settings-fields">{agent}</div>}
    </main>
  </section>;
}
