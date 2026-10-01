import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKGROUND_SETTINGS_KINDS, backgroundSettingsNotice, batteryOptimizationLabel, isBackgroundSettingsKind, phoneSettingsGuide } from '../src/platform/background-settings-guide.mjs';

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
