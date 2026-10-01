// These are version-dependent directions, not a claim that OEM switches are enabled.
const guides=Object.freeze({
  xiaomi:{name:'小米 / Redmi / POCO',battery:'设置 → 应用设置 → 应用管理 → 小伴 → 省电策略 → 无限制',autostart:'设置 → 应用 → 权限 → 后台自启动（或授权管理 → 自启动管理）→ 允许小伴',notifications:'设置 → 通知与状态栏 → 应用通知 → 小伴',tips:['在最近任务中长按小伴卡片，按系统提示锁定，减少一键清理造成的中断。']},
  huawei:{name:'华为',battery:'设置 → 应用和服务 → 应用启动管理 → 小伴 → 关闭自动管理，允许后台活动',autostart:'同一启动管理页中，按需允许自动启动、关联启动',notifications:'设置 → 通知和状态栏 → 应用通知管理 → 小伴',tips:['部分版本路径为“设置 → 电池 → 应用启动管理”。']},
  honor:{name:'荣耀',battery:'设置 → 应用 → 应用启动管理（或电池 → 应用启动）→ 小伴 → 手动允许后台活动',autostart:'同一启动管理页中，按需允许自动启动、关联启动',notifications:'设置 → 通知和状态栏 → 应用通知 → 小伴',tips:['MagicOS 不同版本菜单名称可能不同。']},
  oppo:{name:'OPPO / 一加 / realme',battery:'设置 → 应用 → 应用管理 → 小伴 → 耗电管理（或电池使用情况）→ 允许后台运行',autostart:'设置 → 应用 → 自启动（或应用管理 → 小伴 → 自启动）→ 允许小伴',notifications:'设置 → 通知与状态栏 → 应用通知 → 小伴',tips:['在最近任务中打开小伴卡片菜单，按系统提示锁定。']},
  vivo:{name:'vivo / iQOO',battery:'设置 → 电池 → 后台耗电管理 → 小伴 → 允许后台高耗电',autostart:'设置 → 应用与权限 → 权限管理 → 自启动 → 允许小伴',notifications:'设置 → 通知与状态栏 → 应用通知管理 → 小伴',tips:['部分版本也可在 i管家 → 应用管理中查找自启动；最近任务中可按系统提示锁定小伴。']},
  samsung:{name:'三星',battery:'设置 → 应用程序 → 小伴 → 电池 → 不受限制',autostart:'设置 → 电池 → 后台使用限制 → 从休眠 / 深度休眠应用中移除小伴；按需加入从不休眠应用',notifications:'设置 → 通知 → 应用程序通知 → 小伴',tips:['部分 One UI 版本从“电池和设备维护”进入电池设置；三星通常没有单独的自启动开关。']},
  meizu:{name:'魅族',battery:'设置 → 电池（或电源管理）→ 应用耗电管理 → 小伴 → 允许后台运行',autostart:'手机管家 / 安全中心 → 权限管理 → 后台管理 / 自启动 → 允许小伴',notifications:'设置 → 通知和状态栏 → 通知管理 → 小伴',tips:['Flyme 不同版本入口名称不同，可在设置中搜索“后台”或“自启动”。']},
  asus:{name:'华硕',battery:'设置 → 应用和通知 → 小伴 → 电池 → 不受限制；或电池 → 电池优化 → 不优化小伴',autostart:'手机管家（Mobile Manager）→ PowerMaster → 自启动管理 → 允许小伴',notifications:'设置 → 应用和通知 → 小伴 → 通知',tips:['没有手机管家的版本可先检查应用电池设置。']},
  generic:{name:'Android',battery:'设置 → 应用 → 小伴 → 应用电池用量 → 不受限制；或电池 → 电池优化 → 不优化小伴',autostart:'原生 Android 通常没有自启动开关；检查小伴的应用电池用量，允许后台运行',notifications:'设置 → 应用 → 小伴 → 通知 → 允许通知',tips:['其他品牌可在手机设置中搜索“小伴”“电池优化”“后台运行”或“自启动”。']},
});
const aliases=new Map([
  ['xiaomi','xiaomi'],['redmi','xiaomi'],['poco','xiaomi'],['huawei','huawei'],['honor','honor'],
  ['oppo','oppo'],['oneplus','oppo'],['realme','oppo'],['vivo','vivo'],['iqoo','vivo'],
  ['samsung','samsung'],['meizu','meizu'],['asus','asus'],['google','generic'],['android','generic'],
]);
const normalize=value=>typeof value==='string'?value.trim().toLowerCase():'';
export const BACKGROUND_SETTINGS_KINDS=Object.freeze(['battery','autostart','notifications','app']);
export function isBackgroundSettingsKind(value){return BACKGROUND_SETTINGS_KINDS.includes(value);}
export function phoneSettingsGuide(device){
  const vendor=Object.hasOwn(guides,device?.vendor)?device.vendor:aliases.get(normalize(device?.brand))||aliases.get(normalize(device?.manufacturer))||'generic';
  const guide={vendor,...guides[vendor],tips:[...guides[vendor].tips]};
  if(vendor==='generic'){
    const label=(typeof device?.brand==='string'?device.brand:typeof device?.manufacturer==='string'?device.manufacturer:'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,32);
    if(label&&normalize(label)!=='android')guide.name=`${label} / Android`;
  }
  return guide;
}
export function batteryOptimizationLabel(exempt){return exempt===true?'已豁免系统电池优化':exempt===false?'仍受系统电池优化':'暂时无法读取';}
export function backgroundSettingsNotice(result){
  if(!result?.opened)return '暂时无法打开设置，请按下方路径在手机设置中手动查找小伴。';
  if(result.fallback)return result.route==='android-settings'?'已打开手机系统设置。此手机没有可直达的入口，请按下方路径手动查找小伴。':'已打开应用信息。此手机没有可直达的入口，请按下方路径手动检查；系统版本不同，菜单名称可能有变化。';
  return ({battery:'已打开电池设置。如显示应用列表，请选择“小伴”，再检查后台运行或省电限制。',autostart:'已打开启动 / 后台管理设置。如显示应用列表，请选择“小伴”。',notifications:'已打开小伴的通知设置，请允许任务结果通知。',app:'已打开小伴的应用信息。'})[result.kind]||'已打开系统设置，请查找小伴。';
}
