import fs from 'node:fs/promises';import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
const pkg=JSON.parse(await fs.readFile('package.json','utf8'));pkg.version='1.1.0';await fs.writeFile('package.json',JSON.stringify(pkg,null,2)+'\n');
const lock=JSON.parse(await fs.readFile('package-lock.json','utf8'));lock.version='1.1.0';lock.packages[''].version='1.1.0';await fs.writeFile('package-lock.json',JSON.stringify(lock,null,2)+'\n');
let script=await fs.readFile('scripts/package.mjs','utf8');script=script.replaceAll('FrameStudio-1.0.0-portable','FrameStudio-1.1.0-portable').replaceAll("version:'1.0.0'","version:'1.1.0'").replace('qa/studio-demo.png','qa/v11-main.png').replace('qa/示例工程_叠加与口型.l2dstudio','qa/v11-示例工程.l2dstudio');await fs.writeFile('scripts/package.mjs',script);
const files=unzipSync(await fs.readFile('qa/示例工程_叠加与口型.l2dstudio'));const project=JSON.parse(strFromU8(files['project.json']));project.tracks.forEach((tr,i)=>{tr.type='generic';tr.name='轨道 '+(i+1);});files['project.json']=strToU8(JSON.stringify(project));await fs.writeFile('qa/v11-示例工程.l2dstudio',zipSync(files,{level:1}));
let readme=await fs.readFile('README.md','utf8');readme=readme.replace('Studio 1.0','Studio 1.1');readme=readme.replace('## 功能',`## 1.1 更新与升级

已有 1.0 便携版：先关闭帧间，将“帧间_1.1_轻量更新补丁.zip”解压到 **帧间.exe 所在目录**，覆盖同名文件后重新启动。补丁只包含程序文件，不覆盖 data 中的模型、音频和草稿。完整 1.1 便携版用于首次使用；已有工程可以直接打开。

- 全部为通用轨道，默认名“轨道 1 / 2 / …”，直接点击名称输入自定义名字；动作、表情、参数、音频可混放，轨道名称不决定行为。
- 参数面板和曲线编辑器均有关闭按钮；再次点击当前工具也可收起；Esc 关闭编辑面板。记录关键帧不再强行展开曲线编辑器。
- 浅色 Material Design 3 风格，默认收起属性面板，简化装饰与说明。
- 暂停时不重绘；播放与界面刷新分离；素材列表复用；关闭效果时跳过后期。默认 720 像素长边预览，可切换清晰度；导出与截图仍用画布原始尺寸。
- 项目编辑采用结构共享，调灯光、构图、轨道名称不重算物理；长距离跳转分批计算并缓存物理状态，避免连续阻塞界面。

## 功能`);await fs.writeFile('README.md',readme);
