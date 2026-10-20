import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKGROUND_SETTINGS_KINDS, backgroundSettingsNotice, batteryOptimizationLabel, isBackgroundSettingsKind, phoneDeviceLabel, phoneSettingsGuide, phoneSystemLabel } from '../src/platform/background-settings-guide.mjs';

test('device labels use reported Build identity without inventing a retail model or MagicOS version',()=>{
  const native={manufacturer:'HONOR',brand:'HONOR',model:'PTP-AN00',androidRelease:'15',apiLevel:35};
  assert.equal(phoneDeviceLabel(native),'HONOR PTP-AN00');
  assert.equal(phoneSystemLabel(native),'Android 15 · API 35');
  assert.equal(phoneDeviceLabel({...native,model:'HONOR Magic7'}),'HONOR Magic7');
  assert.equal(phoneDeviceLabel({...native,brand:'',model:'PTP-AN00'}),'HONOR PTP-AN00');
  assert.equal(phoneSystemLabel({brand:'HONOR',model:'Magic7',apiLevel:36}),'Android · API 36');
  assert.doesNotMatch(phoneSystemLabel(native),/MagicOS/);
  assert.doesNotMatch(phoneDeviceLabel(native),/Magic7/);
});

test('older client identity remains usable and malformed metadata is bounded',()=>{
  assert.equal(phoneDeviceLabel({manufacturer:'HONOR',brand:'HONOR',apiLevel:35}),'HONOR');
  assert.equal(phoneSystemLabel({manufacturer:'HONOR',brand:'HONOR',apiLevel:35}),'Android · API 35');
  assert.equal(phoneDeviceLabel(null),'Android 设备');
  assert.equal(phoneSystemLabel(undefined),'Android');
  assert.equal(phoneSystemLabel({androidRelease:'16',apiLevel:'36'}),'Android 16');
  for(const apiLevel of [0,-1,Infinity,NaN,{},36.5])assert.equal(phoneSystemLabel({apiLevel}),'Android');
  assert.equal(phoneDeviceLabel({brand:'\u0000HONOR\n',model:'\u202ePTP-AN00\u2066'}),'HONOR PTP-AN00');
  assert.equal(phoneSystemLabel({androidRelease:'\u0000 16\n',apiLevel:36}),'Android 16 · API 36');
  assert.ok(phoneDeviceLabel({brand:'x'.repeat(1000),model:'y'.repeat(1000)}).length<=129);
  assert.ok(phoneSystemLabel({androidRelease:'x'.repeat(1000)}).length<=40);
});

test('phone guides recognize OEM and sub-brand names by exact normalized identity',()=>{
  const cases={Xiaomi:'xiaomi',Redmi:'xiaomi',POCO:'xiaomi',HUAWEI:'huawei',HONOR:'honor',OPPO:'oppo',OnePlus:'oppo',realme:'oppo',vivo:'vivo',iQOO:'vivo',samsung:'samsung',Meizu:'meizu',ASUS:'asus',Google:'generic'};
  for(const [brand,vendor] of Object.entries(cases))assert.equal(phoneSettingsGuide({brand:` ${brand} `}).vendor,vendor,brand);
  assert.equal(phoneSettingsGuide({manufacturer:'HUAWEI',brand:'HONOR'}).vendor,'honor');
  assert.equal(phoneSettingsGuide({manufacturer:'vivo'}).vendor,'vivo');
});

test('unknown and lookalike identities retain generic instructions without substring matching',()=>{
  for(const brand of ['fake-xiaomi','Honoré','oppo-other','__proto__','constructor'])assert.equal(phoneSettingsGuide({brand}).vendor,'generic');
  assert.equal(phoneSettingsGuide({vendor:'__proto__',brand:'Samsung'}).vendor,'samsung');
  assert.equal(phoneSettingsGuide(null).vendor,'generic');
  assert.equal(phoneSettingsGuide({vendor:'generic',brand:'Sony'}).name,'Sony / Android');
  assert.equal(phoneSettingsGuide({vendor:'generic',brand:'\u0000Sony\n'}).name,'Sony / Android');
  assert.ok(phoneSettingsGuide({vendor:'generic',brand:'a'.repeat(100)}).name.length<=42);
});

test('native recognized vendor selects its guide and callers cannot mutate shared directions',()=>{
  assert.equal(phoneSettingsGuide({vendor:'honor',manufacturer:'HUAWEI'}).vendor,'honor');
  const first=phoneSettingsGuide({vendor:'xiaomi'});first.tips.push('mutated');first.name='mutated';
  const second=phoneSettingsGuide({vendor:'xiaomi'});
  assert.ok(!second.tips.includes('mutated'));assert.notEqual(second.name,'mutated');
});

test('Honor directions distinguish Android optimization from MagicOS startup switches',()=>{
  const guide=phoneSettingsGuide({manufacturer:'HONOR',brand:'HONOR'});
  assert.equal(guide.vendor,'honor');
  assert.match(guide.name,/MagicOS/);
  assert.match(guide.battery,/电池优化.*所有应用.*小伴.*不允许优化/);
  assert.match(guide.autostart,/应用启动管理.*小伴.*关闭自动管理.*自启动.*关联启动.*后台活动/);
  assert.match(guide.notifications,/小伴.*允许通知/);
  assert.ok(guide.tips.some(tip=>/搜索.*应用启动管理/.test(tip)));
  assert.ok(guide.tips.some(tip=>/最近任务.*下拉加锁/.test(tip)));
  assert.ok(guide.tips.some(tip=>/重启.*强制停止.*重新打开/.test(tip)));
  assert.doesNotMatch(Object.values(guide).join(' '),/已允许|已解除|已开启|永久后台|保证不被清理/);
});

test('Honor navigation feedback cannot be mistaken for enabled OEM permissions',()=>{
  const direct=backgroundSettingsNotice({opened:true,kind:'autostart',route:'honor-autostart',fallback:false});
  assert.match(direct,/已打开.*管理设置.*小伴/);
  assert.doesNotMatch(direct,/已允许|已开启|已豁免|已解除/);
  const denied=backgroundSettingsNotice({opened:true,kind:'autostart',route:'android-app-details',fallback:true});
  assert.match(denied,/应用信息.*手动检查/);
  assert.doesNotMatch(denied,/已打开启动/);
});

test('all supported OEM guides have app-scoped battery, startup and notification directions',()=>{
  for(const vendor of ['xiaomi','huawei','honor','oppo','vivo','samsung','meizu','asus','generic']){
    const guide=phoneSettingsGuide({vendor});
    for(const kind of ['battery','autostart','notifications'])assert.ok(guide[kind].includes('小伴')||guide[kind].includes('同一启动管理页'),`${vendor} ${kind}`);
    assert.ok(guide.tips.length>0);
    assert.doesNotMatch(Object.values(guide).join(' '),/卸载|adb|PowerGenie|禁用全局/);
  }
  assert.match(phoneSettingsGuide({vendor:'samsung'}).autostart,/从不休眠/);
  assert.match(phoneSettingsGuide({vendor:'generic'}).autostart,/通常没有自启动开关/);
});

test('settings kinds form a fixed request whitelist',()=>{
  assert.deepEqual(BACKGROUND_SETTINGS_KINDS,['battery','autostart','notifications','app']);
  for(const kind of BACKGROUND_SETTINGS_KINDS)assert.equal(isBackgroundSettingsKind(kind),true);
  for(const kind of ['package','intent','component','permissions','Battery','battery ',{},null,undefined])assert.equal(isBackgroundSettingsKind(kind),false);
  assert.throws(()=>BACKGROUND_SETTINGS_KINDS.push('anything'),TypeError);
});

test('battery status distinguishes Android optimization exemption, restriction and unknown',()=>{
  assert.equal(batteryOptimizationLabel(true),'已豁免系统电池优化');
  assert.equal(batteryOptimizationLabel(false),'仍受系统电池优化');
  for(const value of [null,undefined,'true',1])assert.equal(batteryOptimizationLabel(value),'暂时无法读取');
  assert.doesNotMatch(batteryOptimizationLabel(true),/自启动|厂商|无限制/);
});

test('direct pages request user checking without claiming permissions were granted',()=>{
  assert.match(backgroundSettingsNotice({opened:true,kind:'battery',route:'android-battery-list',fallback:false}),/如显示应用列表.*小伴/);
  assert.match(backgroundSettingsNotice({opened:true,kind:'autostart',route:'xiaomi-autostart',fallback:false}),/启动.*设置/);
  assert.match(backgroundSettingsNotice({opened:true,kind:'notifications',route:'android-notifications',fallback:false}),/请允许/);
  for(const kind of BACKGROUND_SETTINGS_KINDS)assert.doesNotMatch(backgroundSettingsNotice({opened:true,kind,fallback:false}),/已解除|已允许|已豁免/);
});

test('settings fallback explains the actual generic page rather than a direct OEM entry',()=>{
  assert.match(backgroundSettingsNotice({opened:true,kind:'autostart',route:'android-app-details',fallback:true}),/已打开应用信息.*手动检查/);
  const general=backgroundSettingsNotice({opened:true,kind:'battery',route:'android-settings',fallback:true});
  assert.match(general,/已打开手机系统设置/);assert.doesNotMatch(general,/已打开应用信息/);
  for(const result of [null,undefined,{opened:false,kind:'battery',fallback:true}])assert.match(backgroundSettingsNotice(result),/暂时无法打开.*手动查找/);
});
