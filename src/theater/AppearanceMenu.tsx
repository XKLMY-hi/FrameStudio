export const accents={
  mono:{label:"黑白",swatch:"#eeeeee"},blue:{label:"湖蓝",swatch:"#a5c6e0"},
  violet:{label:"鸢尾紫",swatch:"#c8b9e8"},rose:{label:"玫瑰粉",swatch:"#e2b4cb"},
} as const;
export type Accent=keyof typeof accents;
export type Appearance="system"|"light"|"dark";
export type Preferences={
  appearance:Appearance;accent:Accent;autoSave:boolean;closeBehavior:"ask"|"save"|"discard";
  previewQuality:number;embedCanvases:boolean;embedSingle:boolean;
  defaultFps:number;defaultDuration:number;autosaveDelay:number;
  defaultSnap:boolean;defaultAutoKey:boolean;defaultGrid:boolean;
  defaultExportFormat:"mp4"|"prores"|"webm"|"png";
};
export function normalizePreferences(value?:Partial<Preferences>):Preferences {
  return {
    appearance:value?.appearance==="light"||value?.appearance==="dark" ? value.appearance : "system",
    accent:value?.accent && Object.hasOwn(accents,value.accent) ? value.accent : "mono",
    autoSave:value?.autoSave!==false,
    closeBehavior:value?.closeBehavior==="save"||value?.closeBehavior==="discard" ? value.closeBehavior : "ask",
    previewQuality:[640,960,1440].includes(value?.previewQuality??0)?value!.previewQuality!:960,
    embedCanvases:value?.embedCanvases===true,embedSingle:value?.embedSingle!==false,
    defaultFps:[24,25,30,50,60].includes(value?.defaultFps??0)?value!.defaultFps!:30,
    defaultDuration:[5,10,12,15,30,60].includes(value?.defaultDuration??0)?value!.defaultDuration!:12,
    autosaveDelay:[1.3,5,15,30].includes(value?.autosaveDelay??0)?value!.autosaveDelay!:1.3,
    defaultSnap:value?.defaultSnap!==false,defaultAutoKey:value?.defaultAutoKey===true,defaultGrid:value?.defaultGrid!==false,
    defaultExportFormat:["mp4","prores","webm","png"].includes(value?.defaultExportFormat??"")?value!.defaultExportFormat!:"mp4",
  };
}
export function AppearanceFields({value,change}:{value:Preferences;change:(p:Preferences)=>void}) {
  return <>
    <label className="stack-field">主题<select aria-label="外观" value={value.appearance}
      onChange={e=>change({...value,appearance:e.target.value as Appearance})}>
      <option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option>
    </select></label>
    <fieldset className="accent-choices"><legend>强调色</legend>
      {Object.entries(accents).map(([id,{label,swatch}])=><label key={id}>
        <input type="radio" name="interface-accent" value={id} checked={value.accent===id} onChange={()=>change({...value,accent:id as Accent})}/>
        <span><i className={id==="mono"?"mono-swatch":undefined} style={{backgroundColor:swatch}} aria-hidden="true"/>{label}</span>
      </label>)}
    </fieldset>
  </>;
}
