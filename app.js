// ===== Part 0: IndexedDB Data Layer =====
let _db = null;
const STORES = ['medicines', 'members', 'experiences', 'settings', 'healthRecords'];

function _idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('MedKitDB', 2);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      STORES.forEach(n => { if (!db.objectStoreNames.contains(n)) db.createObjectStore(n, n === 'settings' ? { keyPath: 'key' } : undefined); });
    };
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror = e => reject(e.target.error);
  });
}
function _idbPut(store, val, key) {
  return new Promise((res, rej) => {
    if (!_db) return res();
    const tx = _db.transaction(store, 'readwrite');
    key !== undefined ? tx.objectStore(store).put(val, key) : tx.objectStore(store).put(val);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
function _idbGet(store, key) {
  return new Promise((res, rej) => {
    if (!_db) return res(null);
    const r = _db.transaction(store, 'readonly').objectStore(store).get(key);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
function _idbGetAll(store) {
  return new Promise((res, rej) => {
    if (!_db) return res([]);
    const r = _db.transaction(store, 'readonly').objectStore(store).getAll();
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
function _idbClear(store) {
  return new Promise((res, rej) => {
    if (!_db) return res();
    const tx = _db.transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}

// In-memory cache
const _cache = { medicines: [], members: [], experiences: [], healthRecords: [] };
let _settingsCache = null;

const DB = {
  _g(k) { return _cache[k] || []; },
  _s(k, v) { _cache[k] = v; _idbPut(k, v, '_data').catch(console.error); },
  get medicines() { return (_cache.medicines || []).sort((a, b) => new Date(a.expiryDate || '2099-12-31') - new Date(b.expiryDate || '2099-12-31')); },
  set medicines(v) { _cache.medicines = v; _idbPut('medicines', v, '_data').catch(console.error); },
  get members() { return _cache.members || []; },
  set members(v) { _cache.members = v; _idbPut('members', v, '_data').catch(console.error); },
  get experiences() { return (_cache.experiences || []).sort((a, b) => new Date(b.date) - new Date(a.date)); },
  set experiences(v) { _cache.experiences = v; _idbPut('experiences', v, '_data').catch(console.error); },
  get healthRecords() { return (_cache.healthRecords || []).sort((a, b) => new Date(b.date) - new Date(a.date)); },
  set healthRecords(v) { _cache.healthRecords = v; _idbPut('healthRecords', v, '_data').catch(console.error); },
};

// ===== Part 1: Data Layer, Utils, Voice, Settings, Photo =====

// ===== Migration & Init =====
async function _loadSettings() {
  try {
    const all = await _idbGetAll('settings');
    const s = {};
    all.forEach(r => { if (r && r.key) s[r.key] = r.value; });
    _settingsCache = s;
  } catch { _settingsCache = {}; }
}

async function migrateFromLS() {
  let migrated = false;
  for (const k of ['medicines', 'members', 'experiences']) {
    const raw = localStorage.getItem('medkit_' + k);
    if (raw) {
      try {
        const data = JSON.parse(raw);
        if (data.length) { _cache[k] = data; await _idbPut(k, data, '_data'); migrated = true; }
        localStorage.removeItem('medkit_' + k);
      } catch {}
    }
  }
  const sRaw = localStorage.getItem('medkit_settings');
  if (sRaw) {
    try {
      const s = JSON.parse(sRaw);
      for (const [key, val] of Object.entries(s)) { await _idbPut('settings', { key, value: val }); }
      _settingsCache = s; localStorage.removeItem('medkit_settings'); migrated = true;
    } catch {}
  }
  return migrated;
}

async function initDB() {
  try {
    await _idbOpen();
    // Load existing IDB data
    for (const k of ['medicines', 'members', 'experiences', 'healthRecords']) {
      const d = await _idbGet(k, '_data');
      if (d && d.length) _cache[k] = d;
    }
    await _loadSettings();
    // Migrate from localStorage if IDB is empty
    if (!_cache.medicines.length && !_cache.members.length && !_cache.experiences.length && !_cache.healthRecords.length) {
      await migrateFromLS();
    }
  } catch (e) {
    console.warn('IndexedDB failed, fallback to localStorage:', e);
    // Fallback: try loading from localStorage
    for (const k of ['medicines', 'members', 'experiences']) {
      try { const d = JSON.parse(localStorage.getItem('medkit_' + k)); if (d) _cache[k] = d; } catch {}
    }
    try { _settingsCache = JSON.parse(localStorage.getItem('medkit_settings')) || {}; } catch { _settingsCache = {}; }
  }
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const $ = id => document.getElementById(id);
const esc = s => { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
const getM = id => DB.medicines.find(m => m.id === id);
const getMb = id => DB.members.find(m => m.id === id);
function expSt(d) {
  if (!d) return { s: 'none', l: '无日期', c: 'bg-gray-100 text-gray-500' };
  const t = new Date(); t.setHours(0, 0, 0, 0); const x = new Date(d); x.setHours(0, 0, 0, 0);
  const df = (x - t) / 864e5;
  if (df < 0) return { s: 'expired', l: '已过期', c: 'badge-expired' };
  if (df <= 30) return { s: 'warning', l: Math.ceil(df) + '天后过期', c: 'badge-warning' };
  return { s: 'ok', l: x.getFullYear() + '/' + (x.getMonth() + 1) + '/' + x.getDate() + '过期', c: 'badge-ok' };
}
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.remove('hidden'); setTimeout(() => t.classList.add('hidden'), 2000); }
function openM(h) { $('modalContent').innerHTML = h; $('modal').classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
function closeM() { $('modal').classList.add('hidden'); document.body.style.overflow = ''; }
$('modal').addEventListener('click', e => { if (e.target === $('modal')) closeM(); });

// ===== Voice Recognition =====
let _vrActive = {}, _vrRec = {};
function startVoice(fieldId) {
  const field = $(fieldId); if (!field) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { toast('你的浏览器不支持语音识别，请用 Chrome 或 Safari'); return; }
  if (_vrActive[fieldId]) { stopVoice(fieldId); return; }
  const btn = $(fieldId + '_mic'), rec = new SR();
  rec.lang = 'zh-CN'; rec.continuous = true; rec.interimResults = true;
  _vrActive[fieldId] = true; _vrRec[fieldId] = rec;
  if (btn) { btn.classList.remove('text-gray-400'); btn.classList.add('text-red-500','animate-pulse'); btn.innerHTML = '🔴'; }
  let finalTranscript = field.value || '';
  rec.onresult = e => { let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript; else interim += e.results[i][0].transcript; } field.value = finalTranscript + interim; };
  rec.onerror = e => { stopVoice(fieldId); if(e.error==='not-allowed') toast('请允许麦克风权限'); };
  rec.onend = () => { if (_vrActive[fieldId]) { try { rec.start(); } catch {} } };
  try { rec.start(); toast('🎤 开始录音...'); } catch { stopVoice(fieldId); }
}
function stopVoice(fieldId) {
  if (_vrRec[fieldId]) { _vrActive[fieldId] = false; try { _vrRec[fieldId].stop(); } catch {} delete _vrRec[fieldId]; }
  const btn = $(fieldId + '_mic');
  if (btn) { btn.classList.remove('text-red-500','animate-pulse'); btn.classList.add('text-gray-400'); btn.innerHTML = '🎤'; }
}
function voiceBtn(fieldId) {
  return '<button type="button" id="'+fieldId+'_mic" onclick="startVoice(\''+fieldId+'\')" class="shrink-0 w-9 h-9 rounded-lg bg-gray-100 text-gray-400 text-sm flex items-center justify-center hover:bg-gray-200 transition-colors" title="语音录入">🎤</button>';
}

// ===== Settings =====
function getSettings() {
  if (_settingsCache) return _settingsCache;
  try { return JSON.parse(localStorage.getItem('medkit_settings')) || {}; } catch { return {}; }
}
function saveSetting(k, v) {
  const s = getSettings(); s[k] = v; _settingsCache = s;
  if (_db) { _idbPut('settings', { key: k, value: v }).catch(() => { localStorage.setItem('medkit_settings', JSON.stringify(s)); }); }
  else { localStorage.setItem('medkit_settings', JSON.stringify(s)); }
}
function openSettings() {
  const s = getSettings();
  const storageHTML = (navigator.storage && navigator.storage.estimate)
    ? '<div class="bg-gray-50 rounded-xl p-4"><div class="text-sm font-medium text-gray-700 mb-1">💾 存储空间</div><div id="storageInfo" class="text-xs text-gray-500">计算中...</div></div>'
    : '';
  openM('<div class="p-5"><div class="flex items-center justify-between mb-5"><h2 class="text-lg font-bold">⚙️ 设置</h2><button onclick="closeM()" class="text-gray-400"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></div><div class="space-y-4"><div class="bg-blue-50 border border-blue-100 rounded-xl p-4"><div class="text-sm font-medium text-blue-800 mb-1">📷 拍照识别药品</div><div class="text-xs text-blue-600 mb-3">填入通义千问 API Key（免费申请），可在添加药品时拍照自动识别信息</div><label class="block text-sm font-medium text-gray-700 mb-1">API Key</label><div class="flex gap-2"><input id="apiKeyInput" type="password" value="'+esc(s.apiKey||'')+'" placeholder="sk-xxx" class="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"><button onclick="document.getElementById(\'apiKeyInput\').type=document.getElementById(\'apiKeyInput\').type===\'password\'?\'text\':\'password\'" class="shrink-0 px-3 text-gray-400 hover:text-gray-600 text-sm">👁</button></div><div class="text-xs text-gray-400 mt-2">Key 仅保存在你的浏览器本地</div><button onclick="saveSetting(\'apiKey\',document.getElementById(\'apiKeyInput\').value.trim());toast(\'已保存\')" class="w-full mt-3 bg-blue-600 text-white py-2.5 rounded-xl font-medium text-sm hover:bg-blue-700 active:scale-[0.98] transition-all">保存</button></div>'
  + storageHTML
  + '<div class="flex gap-2"><button onclick="exportData()" class="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">📤 导出备份</button><button onclick="document.getElementById(\'importFile\').click()" class="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50">📥 导入数据</button><input id="importFile" type="file" accept=".json" onchange="importData(event)" class="hidden"></div>'
  + '<button onclick="exportCSV()" class="w-full py-2.5 border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50">📊 导出为 Excel 表格</button>'
  + '<button onclick="exportPhotos()" class="w-full py-2.5 border border-gray-200 rounded-xl text-sm text-gray-700 hover:bg-gray-50">📷 导出照片</button>'
  + '<button onclick="clearAllData()" class="w-full py-2.5 border border-red-200 rounded-xl text-sm text-red-500 hover:bg-red-50">🗑️ 清除所有数据</button>'
  + '</div></div>');
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(est => {
      const el = $('storageInfo');
      if (el) el.textContent = '已使用 ' + (est.usage / 1048576).toFixed(2) + ' MB / 可用 ' + (est.quota / 1048576).toFixed(0) + ' MB';
    });
  }
}
async function clearAllData() {
  if (!confirm('⚠️ 确定要清除所有数据吗？此操作不可恢复！\n\n建议先导出备份。')) return;
  if (!confirm('再次确认：删除所有药品、成员、就医记录？')) return;
  try {
    await Promise.all(['medicines', 'members', 'experiences', 'settings', 'healthRecords'].map(s => _idbClear(s)));
    _cache.medicines = []; _cache.members = []; _cache.experiences = []; _cache.healthRecords = []; _settingsCache = {};
    closeM(); toast('已清除所有数据'); render();
  } catch (e) { toast('清除失败：' + e.message); }
}
function exportData() {
  toast('正在导出...');
  const data = { medicines: _cache.medicines, members: _cache.members, experiences: _cache.experiences, healthRecords: _cache.healthRecords || [], settings: _settingsCache || {}, exportedAt: new Date().toISOString(), version: 3 };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '药小记_'+new Date().toISOString().slice(0,10)+'.json'; a.click(); URL.revokeObjectURL(a.href); toast('已导出');
}
function importData(e) {
  const file = e.target.files[0]; if (!file) return;
  toast('正在导入...');
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const d = JSON.parse(ev.target.result);
      if (d.medicines && Array.isArray(d.medicines)) {
        const ids = new Set(_cache.medicines.map(m => m.id));
        _cache.medicines = [..._cache.medicines, ...d.medicines.filter(m => !ids.has(m.id))];
        DB.medicines = _cache.medicines;
      }
      if (d.members && Array.isArray(d.members)) {
        const ids = new Set(_cache.members.map(m => m.id));
        _cache.members = [..._cache.members, ...d.members.filter(m => !ids.has(m.id))];
        DB.members = _cache.members;
      }
      if (d.experiences && Array.isArray(d.experiences)) {
        const ids = new Set(_cache.experiences.map(m => m.id));
        _cache.experiences = [..._cache.experiences, ...d.experiences.filter(m => !ids.has(m.id))];
        DB.experiences = _cache.experiences;
      }
      if (d.healthRecords && Array.isArray(d.healthRecords)) {
        const ids = new Set(_cache.healthRecords.map(r => r.id));
        _cache.healthRecords = [..._cache.healthRecords, ...d.healthRecords.filter(r => !ids.has(r.id))];
        DB.healthRecords = _cache.healthRecords;
      }
      if (d.settings && typeof d.settings === 'object') {
        for (const [k, v] of Object.entries(d.settings)) { if (v) saveSetting(k, v); }
      }
      toast('导入成功'); closeM(); render();
    } catch (err) { toast('文件格式错误：' + err.message); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ===== CSV Export (Excel/WPS compatible) =====
function _csvLine(arr) { return arr.map(v => { const s = String(v == null ? '' : v); return '"' + s.replace(/"/g, '""') + '"'; }).join(','); }
function _csvDownload(filename, bom, content) {
  const blob = new Blob([bom, content], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}
function exportCSV() {
  const BOM = '\uFEFF';
  const date = new Date().toISOString().slice(0,10);

  // 1. 药品清单
  const medHeaders = ['药品名称','分类','功效/用途','过期日期','剩余数量','单位','备注','添加日期'];
  let medCSV = _csvLine(medHeaders) + '\n';
  DB.medicines.forEach(m => {
    medCSV += _csvLine([m.name, m.category, m.efficacy, m.expiryDate, m.quantity, m.unit, m.notes, m.addedDate]) + '\n';
  });
  _csvDownload('药品清单_' + date + '.csv', BOM, medCSV);

  // 2. 就医记录（按成员分组，组内按年份排序）
  const expHeaders = ['日期','医生','医院','科室','诊断','处方药品','评分','有效','避雷','效果描述','副作用','备注'];
  // 按成员分组
  const expByMember = {};
  DB.experiences.forEach(e => {
    const mb = getMb(e.memberId);
    const name = mb ? (MO[mb.relation]||'') + mb.name : '未知成员';
    if (!expByMember[name]) expByMember[name] = [];
    expByMember[name].push(e);
  });
  // 每个成员一个文件
  for (const [memberName, exps] of Object.entries(expByMember)) {
    // 按年份分组排序（年份降序）
    exps.sort((a, b) => {
      const ya = (a.date || '').slice(0, 4) || '0000';
      const yb = (b.date || '').slice(0, 4) || '0000';
      return yb.localeCompare(ya) || (b.date || '').localeCompare(a.date || '');
    });
    let expCSV = _csvLine(expHeaders) + '\n';
    exps.forEach(e => {
      const medNames = getExpMedNames(e);
      expCSV += _csvLine([e.date, e.doctorName, e.hospital, e.department, e.diagnosis, medNames.join('+'), e.rating || '', e.effective ? '是' : '', e.avoid ? '是' : '', e.effect, e.sideEffect, e.notes]) + '\n';
    });
    _csvDownload('就医记录_' + memberName + '_' + date + '.csv', BOM, expCSV);
  }

  // 3. 家庭成员
  if (_cache.members.length) {
    const mbHeaders = ['姓名','称谓','出生日期','备注'];
    let mbCSV = _csvLine(mbHeaders) + '\n';
    _cache.members.forEach(m => { mbCSV += _csvLine([m.name, m.relation, m.birthday, m.notes]) + '\n'; });
    _csvDownload('家庭成员_' + date + '.csv', BOM, mbCSV);
  }

  // 4. 健康档案（按成员分文件）
  const hrByMember = {};
  (_cache.healthRecords || []).forEach(r => {
    const mb = getMb(r.memberId);
    const name = mb ? (MO[mb.relation]||'') + mb.name : '未知成员';
    if (!hrByMember[name]) hrByMember[name] = [];
    hrByMember[name].push(r);
  });
  for (const [memberName, hrs] of Object.entries(hrByMember)) {
    hrs.sort((a, b) => (b.date||'').localeCompare(a.date||''));
    const hrHeaders = ['检查日期','医院','检查类型','指标名称','数值','参考范围','是否异常','备注'];
    let hrCSV = _csvLine(hrHeaders) + '\n';
    hrs.forEach(r => {
      if (r.indicators && r.indicators.length) {
        r.indicators.forEach(ind => {
          hrCSV += _csvLine([r.date, r.hospital, r.type||'', ind.name, ind.value, ind.refRange, ind.isAbnormal ? '是' : '否', r.notes||'']) + '\n';
        });
      } else {
        hrCSV += _csvLine([r.date, r.hospital, r.type||'', '', '', '', '', r.notes||'']) + '\n';
      }
    });
    _csvDownload('健康档案_' + memberName + '_' + date + '.csv', BOM, hrCSV);
  }

  toast('已导出 Excel 表格');
}

// ===== Photo Export (ZIP) =====
async function exportPhotos() {
  const allMeds = _cache.medicines || [];
  const allExps = _cache.experiences || [];
  let photoCount = 0;
  allMeds.forEach(m => { if (m.photos && m.photos.length) photoCount += m.photos.length; });
  allExps.forEach(e => { if (e.photos && e.photos.length) photoCount += e.photos.length; });
  (_cache.healthRecords || []).forEach(r => { if (r.pdfBase64) photoCount++; });

  if (!photoCount) { toast('没有照片可导出'); return; }
  if (typeof JSZip === 'undefined') { toast('需要网络加载 JSZip 库，请检查网络'); return; }

  toast('正在打包 ' + photoCount + ' 张照片...');

  const zip = new JSZip();
  const date = new Date().toISOString().slice(0, 10);

  // 药品照片
  allMeds.forEach(m => {
    if (!m.photos || !m.photos.length) return;
    const folder = zip.folder('药品照片');
    m.photos.forEach((b64, i) => {
      folder.file(m.name + '_' + (i + 1) + '.jpg', b64, { base64: true });
    });
  });

  // 就医记录照片（按成员 → 年份分文件夹）
  allExps.forEach(e => {
    if (!e.photos || !e.photos.length) return;
    const mb = getMb(e.memberId);
    const memberName = mb ? (MO[mb.relation]||'') + mb.name : '未知';
    const year = (e.date || '未知').slice(0, 4);
    const folder = zip.folder('就医照片').folder(memberName).folder(year + '年');
    const prefix = (e.date || '') + '_' + (e.doctorName || '');
    e.photos.forEach((b64, i) => {
      folder.file(prefix + '_' + (i + 1) + '.jpg', b64, { base64: true });
    });
  });

  // 健康档案PDF（按成员 → 年份分文件夹）
  const hrs = _cache.healthRecords || [];
  let hrPdfCount = 0;
  hrs.forEach(r => {
    if (!r.pdfBase64) return;
    const mb = getMb(r.memberId);
    const memberName = mb ? (MO[mb.relation]||'') + mb.name : '未知';
    const year = (r.date || '未知').slice(0, 4);
    const folder = zip.folder('健康档案').folder(memberName).folder(year + '年');
    const fname = (r.date||'报告') + '_' + (r.hospital||'未命名') + '.pdf';
    folder.file(fname, r.pdfBase64, { base64: true });
    hrPdfCount++;
  });
  photoCount += hrPdfCount;

  // 同时导出一个索引文件
  let indexContent = '=== 药小记照片索引 ===\n导出时间：' + new Date().toLocaleString('zh-CN') + '\n\n';
  indexContent += '【药品照片】\n';
  allMeds.forEach(m => {
    if (!m.photos || !m.photos.length) return;
    indexContent += '  ' + m.name + ' — ' + m.photos.length + ' 张';
    if (m.category) indexContent += '（' + m.category + '）';
    if (m.expiryDate) indexContent += '，过期：' + m.expiryDate;
    indexContent += '\n';
  });
  indexContent += '\n【就医照片】\n';
  const expGroups = {};
  allExps.forEach(e => {
    if (!e.photos || !e.photos.length) return;
    const mb = getMb(e.memberId);
    const name = mb ? (MO[mb.relation]||'') + mb.name : '未知';
    if (!expGroups[name]) expGroups[name] = [];
    expGroups[name].push(e);
  });
  for (const [memberName, exps] of Object.entries(expGroups)) {
    indexContent += '  ▸ ' + memberName + '\n';
    const byYear = {};
    exps.forEach(e => {
      const y = (e.date || '未知').slice(0, 4);
      if (!byYear[y]) byYear[y] = [];
      byYear[y].push(e);
    });
    for (const [year, items] of Object.entries(byYear)) {
      indexContent += '    ▸ ' + year + '年\n';
      items.forEach(e => {
        indexContent += '      ' + (e.date || '') + ' ' + (e.doctorName || '') + (e.diagnosis ? ' — ' + e.diagnosis : '') + ' — ' + e.photos.length + ' 张\n';
      });
    }
  }
  // 健康档案索引
  const hrGroups = {};
  hrs.forEach(r => {
    const mb = getMb(r.memberId);
    const name = mb ? (MO[mb.relation]||'') + mb.name : '未知';
    if (!hrGroups[name]) hrGroups[name] = [];
    hrGroups[name].push(r);
  });
  if (Object.keys(hrGroups).length) {
    indexContent += '\n【健康档案】\n';
    for (const [memberName, items] of Object.entries(hrGroups)) {
      indexContent += '  ▸ ' + memberName + '\n';
      const byYear = {};
      items.forEach(r => { const y = (r.date||'未知').slice(0,4); if(!byYear[y]) byYear[y]=[]; byYear[y].push(r); });
      for (const [year, items2] of Object.entries(byYear)) {
        indexContent += '    ▸ ' + year + '年\n';
        items2.forEach(r => {
          indexContent += '      ' + (r.date||'') + ' ' + (r.hospital||'') + (r.type?' ('+r.type+')':'');
          const abn = (r.indicators||[]).filter(i=>i.isAbnormal).length;
          if (abn) indexContent += ' — ' + abn + '项异常';
          if (r.pdfBase64) indexContent += ' [PDF]';
          indexContent += '\n';
        });
      }
    }
  }
  zip.file('照片索引.txt', indexContent);

  try {
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '药小记照片_' + date + '.zip';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('已导出 ' + photoCount + ' 张照片');
  } catch (err) { toast('导出失败：' + err.message); }
}

// ===== Photo Recognition =====
function openCamera() {
  const s = getSettings(); if (!s.apiKey) { toast('请先在设置中填入 API Key'); openSettings(); return; }
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment';
  input.onchange = e => { const file = e.target.files[0]; if (file) addPhotoToQueue(file); }; input.click();
}
function pickImage() {
  const s = getSettings(); if (!s.apiKey) { toast('请先在设置中填入 API Key'); openSettings(); return; }
  const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png, image/jpeg, image/gif, image/webp, image/bmp';
  input.onchange = e => { const file = e.target.files[0]; if (file) addPhotoToQueue(file); }; input.click();
}
let _photoQueue = [];
function addPhotoToQueue(file) { const r = new FileReader(); r.onload = e => { const img = new Image(); img.onload = () => { const cv = document.createElement('canvas'); let w=img.width,h=img.height; if(w>1024){h=h*1024/w;w=1024;} cv.width=w;cv.height=h; cv.getContext('2d').drawImage(img,0,0,w,h); _photoQueue.push(cv.toDataURL('image/jpeg',0.6).split(',')[1]); updatePhotoPreview(); }; img.src=e.target.result; }; r.readAsDataURL(file); }
function updatePhotoPreview() {
  let html = '';
  for (let i = 0; i < _photoQueue.length; i++) html += '<div class="relative inline-block w-16 h-16 rounded-lg overflow-hidden border-2 border-blue-200"><img src="data:image/jpeg;base64,'+_photoQueue[i]+'" class="w-full h-full object-cover"><button type="button" onclick="removePhoto('+i+')" class="absolute top-0 right-0 bg-red-500 text-white text-xs w-5 h-5 rounded-bl-lg flex items-center justify-center">✕</button></div>';
  html += '<button type="button" onclick="openCamera()" class="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 text-gray-400 flex items-center justify-center text-2xl">+</button>';
  const c = $('photoCounter');
  if (c) { const isVisitForm = !!$('comboList'); c.innerHTML = '<div class="flex gap-2 items-center flex-wrap mb-3">'+html+'</div><div class="text-sm text-gray-500 mb-3">已拍 '+_photoQueue.length+' 张</div>'+(_photoQueue.length?'<button type="button" onclick="'+(isVisitForm?'recognizePrescription':'recognizePhotos')+'()" class="w-full py-3 '+(isVisitForm?'bg-blue-600':'bg-green-600')+' text-white rounded-xl font-medium active:scale-[0.98] transition-all">🔍 '+(isVisitForm?'识别处方单':'开始识别')+'</button>':''); }
}
function removePhoto(i) { _photoQueue.splice(i, 1); updatePhotoPreview(); toast('已删除'); }
function recognizePhotos() { if (!_photoQueue.length) return; const s = getSettings(); if (!s.apiKey) { toast('请先设置 API Key'); return; } toast('📷 识别中...'); callVisionAPI(_photoQueue); }
function callVisionAPI(b64) {
  const s = getSettings();
  const imgs = b64.map(x => ({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + x } }));
  const prompt = '识别药品包装图片，提取JSON：{"name":"药品名","category":"分类(解热镇痛/感冒用药/抗生素/消化系统/心血管/皮肤外用/维生素/营养/眼科用药/止咳化痰/抗过敏/中药/其他)","efficacy":"功效","expiryDate":"过期日期YYYY-MM-DD(看不清为空串)","quantity":数字或null,"unit":"粒/片/支/袋/ml/g/瓶/盒/贴/包","notes":"其他"}\n非药品返回：{"error":"not_medicine","name":"内容描述"}';
  fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.apiKey },
    body: JSON.stringify({ model: 'qwen-vl-max', messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...imgs] }], max_tokens: 500 })
  }).then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d.error?.message||'HTTP '+r.status); }))
  .then(data => { try { const c = data.choices[0].message.content; const j = JSON.parse(c.match(/\{[\s\S]*\}/)[0]); if (j.error) { toast('非药品：'+j.name); return; } showRecognizeResult(j); } catch(e) { toast('解析失败'); } })
  .catch(err => { openM('<div class="p-5"><div class="flex items-center justify-between mb-4"><h2 class="text-lg font-bold text-red-600">❌ 识别出错</h2><button onclick="closeM()" class="text-gray-400">✕</button></div><div class="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 whitespace-pre-wrap break-all">'+esc(err.message)+'</div><button onclick="closeM()" class="w-full mt-4 py-2.5 border rounded-xl text-gray-600 text-sm">关闭</button></div>'); });
}
function showRecognizeResult(d) {
  const fs = [{ key:'name',label:'药品名称',type:'text'},{key:'category',label:'分类',type:'select',options:CATS},{key:'efficacy',label:'功效/用途',type:'text'},{key:'expiryDate',label:'过期日期',type:'date'},{key:'quantity',label:'剩余数量',type:'number'},{key:'unit',label:'单位',type:'select',options:UNITS},{key:'notes',label:'备注',type:'text'}];
  let h = '<div class="p-5"><div class="flex items-center justify-between mb-4"><h2 class="text-lg font-bold">✅ 识别结果</h2></div><div class="space-y-3" id="resultFields">';
  fs.forEach(f => { const v = d[f.key]; if (!v && v !== 0) return; let inp; if(f.type==='select') inp='<select data-key="'+f.key+'" class="result-field flex-1 border rounded-lg px-3 py-2 text-sm bg-white">'+f.options.map(o=>'<option value="'+o+'" '+(v===o?'selected':'')+'>'+o+'</option>').join('')+'</select>'; else if(f.type==='number') inp='<input data-key="'+f.key+'" type="number" value="'+esc(v)+'" class="result-field flex-1 border rounded-lg px-3 py-2 text-sm">'; else if(f.type==='date') inp='<input data-key="'+f.key+'" type="date" value="'+esc(v)+'" class="result-field flex-1 border rounded-lg px-3 py-2 text-sm">'; else inp='<input data-key="'+f.key+'" type="text" value="'+esc(v)+'" class="result-field flex-1 border rounded-lg px-3 py-2 text-sm">'; h+='<div class="flex items-center gap-3 bg-gray-50 rounded-xl p-3"><input type="checkbox" checked class="result-check w-5 h-5 accent-blue-600 shrink-0"><label class="text-sm font-medium text-gray-700 shrink-0 w-20">'+f.label+'</label>'+inp+'</div>'; });
  h += '</div><div class="flex gap-3 mt-4"><button onclick="applyRecognizeResult()" class="flex-1 py-3 bg-blue-600 text-white rounded-xl font-medium active:scale-[0.98] transition-all">✓ 确认填入</button><button onclick="closeM()" class="flex-1 py-3 border rounded-xl text-gray-600">取消</button></div></div>';
  openM(h);
}
let _recognizedData = null, _recognizedPhotos = null;
function applyRecognizeResult() {
  _recognizedData = {};
  document.querySelectorAll('.result-check').forEach(chk => { if(!chk.checked) return; const f = chk.closest('.bg-gray-50').querySelector('.result-field'); if(!f) return; const k=f.dataset.key, v=f.value.trim(); if(v) _recognizedData[k]=v; });
  _recognizedPhotos = [..._photoQueue]; // preserve recognition photos
  closeM();
  openMedForm();
  toast('✅ 已填入表单');
}
function updBdg() {
  const el = $('expiryBadge'); if (!el) return;
  const n = DB.medicines.filter(m => { const s = expSt(m.expiryDate); return s.s==='expired'||s.s==='warning'; }).length;
  if (n > 0) { el.classList.remove('hidden'); const c = $('expiryCount'); if(c) c.textContent = n; } else el.classList.add('hidden');
}

// ===== Constants =====
const CATS = ['感冒','肠胃','消炎','过敏','心血管','内分泌','皮肤','骨科','神经','维生素','儿童','其他'];
const FILTER_CATS = ['全部','感冒','肠胃','消炎','过敏','心血管','内分泌','皮肤','骨科','神经','维生素','儿童','其他'];
const RELS = ['本人','爸爸','妈妈','爷爷','奶奶','外公','外婆','丈夫','妻子','儿子','女儿','哥哥','姐姐','弟弟','妹妹','其他'];
const MO = {'本人':'🙋','爸爸':'👨','妈妈':'👩','爷爷':'👴','奶奶':'👵','外公':'👴','外婆':'👵','丈夫':'👨','妻子':'👩','儿子':'👦','女儿':'👧','哥哥':'👦','姐姐':'👧','弟弟':'👦','妹妹':'👧'};
const UNITS = ['粒','片','支','袋','ml','g','瓶','盒','贴','包'];
let curTab = 'home', medSearch = '', vFlt = '', vFltType = '', vGroup = 'time';
let _memberViewId = null, _memberSubTab = 'visits';
let _expandedMedId = null, _medCategoryFilter = '全部';
let _healthIndicators = []; // temp for health form

// ===== Smart Insights =====
function findDuplicates() { const ms=DB._g('medicines'), b={}; ms.forEach(m=>{const k=m.name.trim();if(!b[k])b[k]=[];b[k].push(m);}); return Object.entries(b).filter(([_,a])=>a.length>1).map(([name,items])=>({name,items})); }
function findMissingEfficacy() { return DB.medicines.filter(m => !m.efficacy||!m.efficacy.trim()); }
function findLowStock() { return DB.medicines.filter(m => m.quantity!=null && m.quantity>0 && m.quantity<=3 && expSt(m.expiryDate).s!=='expired'); }
function formatTimeAgo(d) { if(!d) return ''; const n=new Date(),x=new Date(d),df=Math.floor((n-x)/864e5); if(df<0) return d; if(df===0) return '今天'; if(df===1) return '昨天'; if(df<7) return df+'天前'; if(df<30) return Math.floor(df/7)+'周前'; return d; }
function getExpMedNames(e) { if(e.comboMedicines&&e.comboMedicines.length) return e.comboMedicines.map(c=>c.name||(getM(c.medicineId)?.name||'未知')); const m=getM(e.medicineId); return m?[m.name]:['未知药品']; }
function calcAge(birthday, refDate) {
  if (!birthday) return '';
  const b = new Date(birthday), r = refDate ? new Date(refDate) : new Date();
  let age = r.getFullYear() - b.getFullYear();
  const md = r.getMonth() - b.getMonth();
  if (md < 0 || (md === 0 && r.getDate() < b.getDate())) age--;
  if (age < 0) return '';
  if (age === 0) { const m = Math.floor((r - b) / 864e5 / 30.44); return m > 0 ? m + '个月' : ''; }
  return age + '岁';
}

// ===== Tab & Render =====
function switchTab(t) {
  curTab = t; medSearch = ''; vFlt = ''; vFltType = ''; vGroup = 'time';
  const tabs = { home:'tab-home', medicines:'tab-medicines', visits:'tab-visits', members:'tab-members' };
  Object.keys(tabs).forEach(x => { const el=$(tabs[x]); if(el) el.className='flex-1 flex flex-col items-center py-2 text-xs '+(x===t?'tab-active':'tab-inactive'); });
  render();
}
function render() {
  updBdg(); const a = $('app');
  if (curTab==='home') a.innerHTML=rHome();
  else if (curTab==='medicines') a.innerHTML=rMeds();
  else if (curTab==='members') a.innerHTML=rMbs();
  else if (curTab==='visits') a.innerHTML=rVisits();
  else if (curTab==='doctor') switchTab('medicines');
}

// ===== Part 2: Home Page =====
function rHome() {
  const meds = DB.medicines, members = DB.members, exps = DB.experiences;
  const expired = meds.filter(m => expSt(m.expiryDate).s === 'expired');
  const warn = meds.filter(m => expSt(m.expiryDate).s === 'warning');
  const dupes = findDuplicates(), missing = findMissingEfficacy();
  let h = '<div class="fade-in space-y-5">';

  // Insight cards (expiry / dupes / missing)
  if (expired.length || warn.length) {
    h += '<div class="insight-card insight-red p-3.5 flex items-center gap-3 cursor-pointer" onclick="switchTab(\'medicines\')">';
    h += '<div class="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center text-lg shrink-0">'+(expired.length?'🔴':'🟡')+'</div>';
    h += '<div class="flex-1 min-w-0"><div class="font-semibold text-sm text-red-800">药品过期提醒</div>';
    h += '<div class="text-xs text-red-600 mt-0.5">'+(expired.length?'已过期 '+expired.length+' 种':'')+(warn.length?(expired.length?'，':'即将过期 ')+warn.length+' 种':'')+'</div></div>';
    h += '<svg class="w-4 h-4 text-red-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg></div>';
  }
  if (dupes.length) {
    h += '<div class="insight-card insight-orange p-3.5 flex items-center gap-3 cursor-pointer" onclick="showDuplicates()">';
    h += '<div class="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-lg shrink-0">🔄</div>';
    h += '<div class="flex-1 min-w-0"><div class="font-semibold text-sm text-orange-800">发现重复药品</div>';
    h += '<div class="text-xs text-orange-600 mt-0.5">'+dupes.length+' 组名称相同的药品</div></div>';
    h += '<svg class="w-4 h-4 text-orange-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg></div>';
  }
  if (missing.length) {
    h += '<div class="insight-card insight-gray p-3.5 flex items-center gap-3 cursor-pointer" onclick="showMissingEfficacy()">';
    h += '<div class="w-10 h-10 rounded-xl bg-gray-200 flex items-center justify-center text-lg shrink-0">❓</div>';
    h += '<div class="flex-1 min-w-0"><div class="font-semibold text-sm text-gray-700">部分药品未填写用途</div>';
    h += '<div class="text-xs text-gray-500 mt-0.5">'+missing.length+' 种药品缺少功效信息</div></div>';
    h += '<svg class="w-4 h-4 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg></div>';
  }

  // CTA buttons
  h += '<div class="flex gap-3">';
  h += '<button onclick="openMedForm()" class="btn-primary flex-1 py-3.5 text-sm font-semibold flex items-center justify-center gap-2">📷 添加药品</button>';
  h += '<button onclick="openVisitForm()" class="btn-outline flex-1 py-3.5 text-sm font-semibold flex items-center justify-center gap-2">📝 记录就医</button>';
  h += '</div>';

  // Stat cards
  h += '<div class="grid grid-cols-3 gap-2.5">';
  h += '<button onclick="switchTab(\'medicines\')" class="stat-card p-3.5 text-center"><div class="text-2xl font-bold mb-0.5">'+meds.length+'</div><div class="text-xs text-gray-500">药品库</div></button>';
  h += '<button onclick="switchTab(\'members\')" class="stat-card p-3.5 text-center"><div class="text-2xl font-bold mb-0.5">'+members.length+'</div><div class="text-xs text-gray-500">家庭成员</div></button>';
  h += '<button onclick="switchTab(\'visits\')" class="stat-card p-3.5 text-center"><div class="text-2xl font-bold mb-0.5">'+exps.length+'</div><div class="text-xs text-gray-500">就医记录</div></button>';
  h += '</div>';

  // Avoid + Effective summary
  const avoids = exps.filter(e => e.avoid);
  const effective = exps.filter(e => e.effective && !e.avoid);
  if (avoids.length || effective.length) {
    h += '<div class="grid grid-cols-2 gap-2.5">';
    if (avoids.length) {
      h += '<div class="insight-card insight-red p-3 cursor-pointer" onclick="switchTab(\'visits\');vFltType=\'avoid\';render()">';
      h += '<div class="flex items-center gap-1.5 mb-1.5"><span class="text-sm">🚫</span><span class="font-semibold text-sm text-red-800">避雷</span><span class="text-xs text-red-400">'+avoids.length+'</span></div>';
      const dc={};avoids.forEach(e=>{const dn=e.doctorName||'?';if(!dc[dn])dc[dn]=0;dc[dn]++});
      h+='<div class="text-xs text-red-600 space-y-0.5">'+Object.entries(dc).slice(0,2).map(([n,c])=>'<div>• '+esc(n)+' '+c+'次</div>').join('')+'</div></div>';
    }
    if (effective.length) {
      h += '<div class="insight-card p-3 cursor-pointer" style="background:linear-gradient(135deg,#EAFBEE,#E0F8E4)" onclick="switchTab(\'visits\');vFltType=\'effective\';render()">';
      h += '<div class="flex items-center gap-1.5 mb-1.5"><span class="text-sm">✅</span><span class="font-semibold text-sm" style="color:#1B7A3D">有效药方</span><span class="text-xs" style="color:#6BCB8B">'+effective.length+'</span></div>';
      h += '<div class="text-xs space-y-0.5" style="color:#2D9A52">'+effective.slice(0,2).map(e=>'<div>• '+esc(e.diagnosis||getExpMedNames(e)[0]||'')+'</div>').join('')+'</div></div>';
    }
    h += '</div>';
  }

  // Recent medicines
  h += '<div><div class="flex items-center justify-between mb-2.5"><span class="font-semibold text-sm">最近添加</span>';
  if (meds.length) h += '<button onclick="switchTab(\'medicines\')" class="text-xs font-medium" style="color:var(--c-primary)">全部 →</button>';
  h += '</div>';
  if (meds.length) {
    h += '<div class="space-y-2">';
    meds.slice(-3).reverse().forEach(m => {
      const e = expSt(m.expiryDate);
      h += '<div class="card px-3.5 py-3 flex items-center gap-3"><div class="flex-1 min-w-0"><div class="text-sm font-medium">'+esc(m.name)+'</div>';
      h += '<div class="text-xs text-gray-400 mt-0.5">'+(m.category||'')+(m.quantity?' · 剩余'+m.quantity+(m.unit||''):'')+'</div></div>';
      if (m.expiryDate) h += '<span class="text-xs px-2.5 py-1 rounded-full '+e.c+' shrink-0 font-medium">'+e.l+'</span>';
      h += '</div>';
    });
    h += '</div>';
  } else {
    h += '<div class="card p-8 text-center"><div class="text-3xl mb-2">📦</div><div class="text-sm text-gray-400">还没有添加药品</div></div>';
  }
  h += '</div>';

  // Recent visits
  h += '<div><div class="flex items-center justify-between mb-2.5"><span class="font-semibold text-sm">就医动态</span>';
  if (exps.length) h += '<button onclick="switchTab(\'visits\')" class="text-xs font-medium" style="color:var(--c-primary)">全部 →</button>';
  h += '</div>';
  if (exps.length) {
    h += '<div class="space-y-2">';
    exps.slice(0,3).forEach(e => {
      const mb = getMb(e.memberId), medNames = getExpMedNames(e);
      const dotCls = e.avoid?'dot-avoid':e.effective?'dot-effective':'dot-normal';
      h += '<div class="card px-3.5 py-3 flex items-center gap-3">';
      h += '<div class="dot '+dotCls+'"></div>';
      h += '<div class="flex-1 min-w-0">';
      if (e.doctorName) h += '<div class="text-sm font-medium truncate">👨‍⚕️ '+esc(e.doctorName)+(e.diagnosis?' · '+esc(e.diagnosis):'')+'</div>';
      else h += '<div class="text-sm font-medium truncate">💊 '+esc(medNames.join(' + '))+'</div>';
      h += '<div class="text-xs text-gray-400 mt-0.5">';
      if (mb) h += (MO[mb.relation]||'')+' '+esc(mb.name);
      h += ' · '+formatTimeAgo(e.date);
      h += '</div></div></div>';
    });
    h += '</div>';
  } else {
    h += '<div class="card p-8 text-center"><div class="text-3xl mb-2">📝</div><div class="text-sm text-gray-400">还没有就医记录</div></div>';
  }
  h += '</div></div>';
  return h;
}

// ===== Duplicate / Missing Efficacy Detail Views =====
function showDuplicates() {
  const dupes = findDuplicates();
  let h = '<div class="p-5"><div class="flex items-center justify-between mb-4"><h2 class="text-lg font-bold">🔄 重复药品</h2><button onclick="closeM()" class="text-gray-400">✕</button></div>';
  if (!dupes.length) { h += '<p class="text-gray-400 text-center py-8">没有发现重复药品</p>'; }
  else {
    h += '<div class="space-y-4">';
    dupes.forEach(g => {
      h += '<div class="bg-orange-50 rounded-xl p-3"><div class="font-medium text-sm text-orange-800 mb-2">'+esc(g.name)+' ('+g.items.length+')</div><div class="space-y-2">';
      g.items.forEach(m => {
        const e = expSt(m.expiryDate);
        h += '<div class="bg-white rounded-lg p-2 flex items-center justify-between"><div><div class="text-sm">'+esc(m.name)+'</div><div class="text-xs text-gray-400">'+(m.efficacy||'')+' · 剩余'+(m.quantity!=null?m.quantity:'?')+(m.unit||'')+'</div></div>';
        if (m.expiryDate) h += '<span class="text-xs px-2 py-0.5 rounded-full '+e.c+'">'+e.l+'</span>';
        h += '</div>';
      });
      h += '</div><div class="text-xs text-orange-500">建议：合并数量或删除不需要的重复项</div></div>';
    });
    h += '</div>';
  }
  h += '</div>';
  openM(h);
}
function showMissingEfficacy() {
  const missing = findMissingEfficacy();
  let h = '<div class="p-5"><div class="flex items-center justify-between mb-4"><h2 class="text-lg font-bold">❓ 未填写用途的药品</h2><button onclick="closeM()" class="text-gray-400">✕</button></div>';
  if (!missing.length) { h += '<p class="text-gray-400 text-center py-8">所有药品都填写了用途</p>'; }
  else {
    h += '<div class="space-y-2">';
    missing.forEach(m => {
      h += '<div class="card p-3 flex items-center justify-between"><div class="flex-1"><div class="text-sm font-medium">'+esc(m.name)+'</div><div class="text-xs text-gray-400">'+(m.category||'未分类')+'</div></div>';
      h += '<button onclick="closeM();openMedForm(\''+m.id+'\')" class="text-xs text-blue-500 shrink-0 ml-2">编辑</button></div>';
    });
    h += '</div>';
  }
  h += '</div>';
  openM(h);
}

// ===== Part 3: Medicines (with search) + Members =====
function rMeds() {
  _expandedMedId = null;
  const allMs = DB.medicines;
  let h = '<div class="fade-in space-y-4">';

  // Search bar
  h += '<div class="sticky top-[52px] z-20 pb-2" style="background:var(--c-bg)">';
  h += '<div class="relative"><input type="text" id="medSearchInput" value="'+esc(medSearch)+'" placeholder="🔍 搜索药品名称、功效、备注..." oninput="medSearch=this.value.trim().toLowerCase();renderMedsList()" class="w-full border border-gray-200 rounded-xl px-4 py-2.5 pl-10 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm">';
  h += '<svg class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg></div>';
  // Category filter tabs — only show categories that have medicines
  const usedCats = [...new Set(allMs.map(m => m.category).filter(Boolean))];
  const visibleCats = ['全部', ...usedCats.filter(c => FILTER_CATS.includes(c))];
  if (_medCategoryFilter !== '全部' && !visibleCats.includes(_medCategoryFilter)) _medCategoryFilter = '全部';
  h += '<div class="flex gap-2 mt-2 overflow-x-auto pb-1" style="-webkit-overflow-scrolling:touch;scrollbar-width:none" id="catTabs">';
  visibleCats.forEach(c => {
    const active = _medCategoryFilter === c;
    h += '<button onclick="filterCat(\''+c+'\')" class="shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all '+(active?'bg-[#E8564A] text-white shadow-sm':'bg-white text-gray-500 border border-gray-200 hover:border-[#E8564A] hover:text-[#E8564A]')+'">'+c+'</button>';
  });
  h += '</div></div>';

  h += '<div id="medsList">';
  h += medsListHTML(allMs);
  h += '</div>';

  if (!allMs.length) {
    h = '<div class="fade-in text-center py-16"><div class="text-6xl mb-4">💊</div><p class="text-gray-400 mb-6">还没有添加药品</p><button onclick="openMedForm()" class="btn-primary px-6 py-2.5 font-medium transition-all">添加第一种药品</button></div>';
  }

  h += '<button onclick="openMedForm()" class="fixed bottom-20 right-4 w-14 h-14 btn-primary rounded-full shadow-lg flex items-center justify-center text-2xl z-20 active:scale-95 transition-all">+</button></div>';
  return h;
}
function filterCat(c) {
  _medCategoryFilter = c;
  curTab = 'meds'; // ensure we're on meds tab
  render(); // re-render entire page to update tab highlights + list
}
function renderMedsList() {
  const el = $('medsList'); if (!el) return;
  const allMs = DB.medicines;
  el.innerHTML = medsListHTML(allMs);
}
function medsListHTML(allMs) {
  const q = medSearch, cf = _medCategoryFilter;
  let ms = allMs;
  if (cf && cf !== '全部') ms = ms.filter(m => m.category && m.category.includes(cf));
  if (q) ms = ms.filter(m => m.name.toLowerCase().includes(q) || (m.efficacy||'').toLowerCase().includes(q) || (m.category||'').toLowerCase().includes(q) || (m.notes||'').toLowerCase().includes(q));
  if (!ms.length) return '<div class="text-center py-8 text-gray-400 text-sm">'+(q?'没有找到匹配的药品':'还没有添加药品')+'</div>';
  const exp = ms.filter(m => expSt(m.expiryDate).s === 'expired');
  const wrn = ms.filter(m => expSt(m.expiryDate).s === 'warning');
  let h = '';
  if (exp.length) h += '<div class="card p-3 mb-3" style="background:var(--c-primary-light)"><div class="text-sm font-medium mb-2" style="color:var(--c-primary)">🔴 已过期 ('+exp.length+')</div><div class="space-y-2">'+exp.map(mCard).join('')+'</div></div>';
  if (wrn.length) h += '<div class="card p-3 mb-3" style="background:#FFF8E1"><div class="text-sm font-medium mb-2" style="color:var(--c-orange)">🟡 即将过期 ('+wrn.length+')</div><div class="space-y-2">'+wrn.map(mCard).join('')+'</div></div>';
  if (q) h += '<div class="text-xs text-gray-400 mb-2">找到 '+ms.length+' 种药品</div>';
  else h += '<div class="text-xs text-gray-400 mb-2">全部药品 ('+ms.length+')</div>';
  h += '<div class="space-y-2">'+ms.map(mCard).join('')+'</div>';
  return h;
}
function mCard(m) {
  const e = expSt(m.expiryDate), d = e.s === 'expired';
  const expanded = _expandedMedId === m.id;
  const thumb = (m.photos && m.photos.length) ? '<img src="data:image/jpeg;base64,'+m.photos[0]+'" class="w-10 h-10 rounded-lg object-cover shrink-0 border border-gray-100">' : '';
  // Collapsed card
  let h = '<div class="card p-3 '+(d?'opacity-60':'')+' cursor-pointer transition-all" onclick="toggleMedExpand(\''+m.id+'\')">';
  h += '<div class="flex items-center gap-2"><div class="flex-1 min-w-0"><div class="flex items-center gap-2 mb-1 flex-wrap"><span class="font-semibold" style="color:var(--c-text)">'+esc(m.name)+'</span><span class="text-xs px-2 py-0.5 rounded-full '+e.c+'">'+e.l+'</span></div>';
  h += (m.category?'<div class="text-sm mb-1" style="color:var(--c-text2)">'+esc(m.category)+(m.efficacy?' · '+esc(m.efficacy):'')+'</div>':'');
  h += '<div class="flex items-center gap-3 text-sm" style="color:var(--c-text2)">'+(m.quantity!=null?'<span>📦 剩余'+m.quantity+(m.unit||'')+'</span>':'')+'</div>';
  h += '</div>'+thumb;
  if (!expanded) {
    h += '<svg class="w-4 h-4 text-gray-300 shrink-0 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>';
  }
  h += '</div>';
  // Expanded detail
  if (expanded) {
    h += '<div class="mt-3 pt-3 border-t border-gray-100 space-y-2">';
    const fields = [['分类',m.category],['功效/用途',m.efficacy],['剩余数量',m.quantity!=null?m.quantity+(m.unit||''):null],['过期日期',m.expiryDate],['备注',m.notes],['添加日期',m.addedDate]];
    fields.forEach(([label,val]) => { if(val) h += '<div class="flex text-sm"><span class="text-gray-400 shrink-0 w-20">'+label+'</span><span class="text-gray-700">'+esc(String(val))+'</span></div>'; });
    if (m.photos && m.photos.length) {
      h += '<div class="mt-2"><div class="text-sm text-gray-400 mb-1">📷 照片</div><div class="flex gap-2 flex-wrap">';
      m.photos.forEach((p,i) => { h += '<div class="relative group"><img src="data:image/jpeg;base64,'+p+'" class="w-16 h-16 rounded-lg object-cover cursor-pointer border border-gray-200" onclick="event.stopPropagation();viewPhotos(\''+m.id+'\')"><button type="button" onclick="event.stopPropagation();delMedPhoto(\''+m.id+'\','+i+')" class="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-4 h-4 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity leading-none">✕</button></div>'; });
      h += '</div></div>';
    }
    h += '<div class="flex gap-2 pt-2"><button onclick="event.stopPropagation();openMedForm(\''+m.id+'\')" class="flex-1 py-2 bg-blue-50 text-blue-600 rounded-xl text-sm font-medium active:scale-[0.98] transition-all">✏️ 编辑</button><button onclick="event.stopPropagation();delMed(\''+m.id+'\')" class="flex-1 py-2 bg-red-50 text-red-500 rounded-xl text-sm font-medium active:scale-[0.98] transition-all">🗑️ 删除</button></div>';
    h += '</div>';
  }
  h += '</div>';
  return h;
}
function toggleMedExpand(id) { _expandedMedId = _expandedMedId === id ? null : id; renderMedsList(); }
function delMedPhoto(medId, photoIdx) {
  const ms = DB._g('medicines');
  const m = ms.find(x => x.id === medId);
  if (!m || !m.photos) return;
  m.photos.splice(photoIdx, 1);
  DB.medicines = ms;
  toast('已删除照片');
  renderMedsList();
}
function openMedForm(id) {
  const m = id?getM(id):{}, isE = !!id;
  if (_recognizedData && !id) { Object.entries(_recognizedData).forEach(([k,v])=>{ if(!m[k]) m[k]=v; }); _recognizedData=null; }
  if (id && m.photos && m.photos.length) _photoQueue = [...m.photos]; else if (!id) _photoQueue = _recognizedPhotos ? [..._recognizedPhotos] : []; _recognizedPhotos = null;
  const co = CATS.map(c=>'<option value="'+c+'" '+(m.category===c?'selected':'')+'>'+c+'</option>').join('');
  const uo = UNITS.map(u=>'<option value="'+u+'" '+(m.unit===u?'selected':'')+'>'+u+'</option>').join('');
  openM('<div class="p-5"><div class="flex items-center justify-between mb-5"><h2 class="text-lg font-bold">'+(isE?'编辑药品':'添加药品')+'</h2><button onclick="closeM()" class="text-gray-400"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></div><form onsubmit="saveMed(event,\''+(id||'')+'\')" class="space-y-4"><div class="flex gap-2 justify-center"><button type="button" onclick="openCamera()" class="flex-1 py-3 bg-green-50 border border-green-200 rounded-xl text-green-700 font-medium active:scale-[0.98] transition-all text-sm">📷 拍照</button><button type="button" onclick="pickImage()" class="flex-1 py-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-700 font-medium active:scale-[0.98] transition-all text-sm">📁 从相册选择</button></div><div id="photoCounter"><div class="text-center py-3 text-gray-400 text-sm">点上方按钮拍摄或选择药品包装</div></div><div><label class="block text-sm font-medium text-gray-700 mb-1">药品名称 *</label><input name="name" value="'+esc(m.name)+'" required placeholder="如：布洛芬" class="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"></div><div class="grid grid-cols-2 gap-3"><div><label class="block text-sm font-medium text-gray-700 mb-1">分类</label><select name="category" class="w-full border border-gray-200 rounded-xl px-4 py-2.5 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"><option value="">选择分类</option>'+co+'</select></div><div><label class="block text-sm font-medium text-gray-700 mb-1">过期日期</label><input name="expiryDate" type="date" value="'+(m.expiryDate||'')+'" class="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"></div></div><div><label class="block text-sm font-medium text-gray-700 mb-1">功效/用途</label><div class="flex gap-2 items-end"><input id="med_efficacy" name="efficacy" value="'+esc(m.efficacy||'')+'" placeholder="如：退烧、缓解头痛" class="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500">'+voiceBtn('med_efficacy')+'</div></div><div class="grid grid-cols-2 gap-3"><div><label class="block text-sm font-medium text-gray-700 mb-1">剩余数量</label><input name="quantity" type="number" min="0" value="'+(m.quantity!=null?m.quantity:'')+'" placeholder="如：12" class="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"></div><div><label class="block text-sm font-medium text-gray-700 mb-1">单位</label><select name="unit" class="w-full border border-gray-200 rounded-xl px-4 py-2.5 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"><option value="">选择</option>'+uo+'</select></div></div><div><label class="block text-sm font-medium text-gray-700 mb-1">备注</label><div class="flex gap-2 items-end"><textarea id="med_notes" name="notes" rows="2" placeholder="用法用量等" class="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none">'+esc(m.notes||'')+'</textarea>'+voiceBtn('med_notes')+'</div></div><button type="submit" class="w-full bg-blue-600 text-white py-3 rounded-xl font-medium hover:bg-blue-700 active:scale-[0.98] transition-all">'+(isE?'保存修改':'添加药品')+'</button>'+(isE?'<button type="button" onclick="delMed(\''+id+'\');closeM()" class="w-full text-red-500 py-2 text-sm mt-1">删除此药品</button>':'')+'</form></div>');
  setTimeout(updatePhotoPreview, 50);
}
function saveMed(e, id) {
  e.preventDefault(); const f = e.target;
  const d = {name:f.name.value.trim(),category:f.category.value,efficacy:f.efficacy.value.trim(),expiryDate:f.expiryDate.value,quantity:f.quantity.value?parseInt(f.quantity.value):null,unit:f.unit.value,notes:f.notes.value.trim()};
  if (!d.name) return;
  d.photos = _photoQueue.length ? [..._photoQueue] : (id ? (getM(id)?.photos||[]) : []);
  _photoQueue = [];
  const ms = DB._g('medicines');
  if (id) { const i=ms.findIndex(m=>m.id===id); if(i>=0) ms[i]={...ms[i],...d}; }
  else { d.id=uid(); d.addedDate=new Date().toISOString().slice(0,10); ms.push(d); }
  DB.medicines = ms; closeM(); toast(id?'已更新':'已添加'); render();
}
function viewPhotos(medId) {
  const m = getM(medId);
  if (!m || !m.photos || !m.photos.length) return;
  let h = '<div class="p-5"><div class="flex items-center justify-between mb-4"><h2 class="text-lg font-bold">📷 '+esc(m.name)+'</h2><button onclick="closeM()" class="text-gray-400">✕</button></div><p class="text-xs text-gray-400 mb-3">点击图片可全屏查看</p>';
  h += '<div class="space-y-3">';
  m.photos.forEach((p, i) => {
    h += '<img src="data:image/jpeg;base64,'+p+'" class="w-full rounded-xl cursor-zoom-in" onclick="openM(\'<div class=bg-black flex items-center justify-center style=min-height:90vh><img src=data:image/jpeg;base64,'+p+'" class=max-w-full max-h-screen onclick=closeM() style=cursor:zoom-out></div>\')">';
  });
  h += '</div></div>';
  openM(h);
}
function delMed(id) {
  if (!confirm('确定删除这个药品吗？')) return;
  DB.medicines = DB._g('medicines').filter(m=>m.id!==id);
  DB.experiences = DB._g('experiences').filter(e=>e.medicineId!==id);
  toast('已删除'); render();
}

// ===== MEMBERS =====
function rMbs() {
  if (_memberViewId) return rMemberDetail(_memberViewId);
  const ms = DB.members;
  if (!ms.length) return '<div class="fade-in text-center py-16"><div class="text-6xl mb-4">👨‍👩‍👧‍👦</div><p class="text-gray-400 mb-6">添加家庭成员</p><button onclick="openMbForm()" class="bg-blue-600 text-white px-6 py-2.5 rounded-xl font-medium">添加成员</button></div>';
  let h = '<div class="fade-in grid grid-cols-2 gap-3">';
  ms.forEach(m => {
    const ec = DB.experiences.filter(e=>e.memberId===m.id).length;
    const hc = DB.healthRecords.filter(r=>r.memberId===m.id).length;
    const age = calcAge(m.birthday);
    h += '<div class="bg-white rounded-xl p-4 shadow-sm border border-gray-100 text-center cursor-pointer active:scale-[0.97] transition-transform" onclick="_memberViewId=\''+m.id+'\';_memberSubTab=\'visits\';render()">';
    h += '<div class="text-4xl mb-2">'+(MO[m.relation]||'👤')+'</div>';
    h += '<div class="font-semibold text-gray-800">'+esc(m.name)+'</div>';
    h += '<div class="text-sm text-gray-400">'+esc(m.relation||'')+'</div>';
    if(age) h += '<div class="text-xs text-gray-500 mt-0.5">'+age+'</div>';
    if(ec||hc) h += '<div class="flex justify-center gap-2 mt-1"><span class="text-xs text-blue-500">'+ec+'就医</span>'+(hc?'<span class="text-xs" style="color:var(--c-primary)">'+hc+'档案</span>':'')+'</div>';
    h += '</div>';
  });
  h += '</div><button onclick="openMbForm()" class="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 hover:border-blue-400 hover:text-blue-500 transition-colors mt-3">+ 添加成员</button>';
  return h;
}
// ===== Member Detail View =====
function rMemberDetail(memberId) {
  const mb = getMb(memberId);
  if (!mb) { _memberViewId = null; return rMbs(); }
  let h = '<div class="fade-in space-y-4">';
  h += '<div class="flex items-center gap-3">';
  h += '<button onclick="_memberViewId=null;render()" class="p-2 rounded-xl hover:bg-gray-100 transition-colors"><svg class="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg></button>';
  h += '<div class="flex items-center gap-2 flex-1"><span class="text-2xl">'+(MO[mb.relation]||'👤')+'</span><div><div class="font-bold text-base">'+esc(mb.name)+'</div><div class="text-xs text-gray-400">'+esc(mb.relation||'')+(mb.birthday?' · '+calcAge(mb.birthday):'')+'</div></div></div>';
  h += '<button onclick="_memberViewId=null;openMbForm(\''+memberId+'\')" class="p-2 text-gray-400 hover:text-blue-500"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>';
  h += '</div>';
  h += '<div class="flex gap-0.5 bg-gray-100 rounded-xl p-1">';
  h += '<button onclick="_memberSubTab=\'visits\';render()" class="flex-1 py-2.5 rounded-lg text-sm font-medium transition-all '+(_memberSubTab==='visits'?'bg-white shadow-sm text-gray-700':'text-gray-400')+'">📝 就医记录</button>';
  h += '<button onclick="_memberSubTab=\'health\';render()" class="flex-1 py-2.5 rounded-lg text-sm font-medium transition-all '+(_memberSubTab==='health'?'bg-white shadow-sm text-gray-700':'text-gray-400')+'">🏥 健康档案</button>';
  h += '</div>';
  if (_memberSubTab === 'visits') h += rMemberVisits(memberId);
  else h += rMemberHealth(memberId);
  h += '</div>';
  return h;
}
function rMemberVisits(memberId) {
  const exps = DB.experiences.filter(e => e.memberId === memberId);
  if (!exps.length) return '<div class="text-center py-12"><div class="text-5xl mb-3">📝</div><p class="text-gray-400 mb-4">还没有就医记录</p><button onclick="openVisitForm()" class="bg-blue-600 text-white px-6 py-2.5 rounded-xl font-medium">记录就医</button></div>';
  let h = '<div class="space-y-2"><button onclick="openVisitForm()" class="w-full py-3 btn-primary text-sm font-semibold">+ 记录就医</button>';
  exps.forEach(e => { h += visitCard(e); });
  h += '</div>';
  return h;
}
function rMemberHealth(memberId) {
  const hrs = DB.healthRecords.filter(r => r.memberId === memberId);
  let h = '<button onclick="openHealthForm(\''+memberId+'\')" class="w-full py-3 btn-primary text-sm font-semibold">+ 添加健康档案</button>';
  if (!hrs.length) return h + '<div class="text-center py-12"><div class="text-5xl mb-3">🏥</div><p class="text-gray-400">还没有健康档案</p><p class="text-xs text-gray-400 mt-1">上传体检报告 PDF，记录异常指标</p></div>';
  const groups = {};
  hrs.forEach(r => { const y = (r.date||'未知').slice(0,4); if(!groups[y]) groups[y]=[]; groups[y].push(r); });
  Object.keys(groups).sort().reverse().forEach(year => {
    h += '<div class="mb-4"><div class="group-header group-blue text-sm font-semibold text-gray-600 mb-2">'+year+'年 <span class="text-xs font-normal text-gray-400">'+groups[year].length+'份</span></div><div class="space-y-2 ml-1">';
    groups[year].forEach(r => {
      const abn = (r.indicators||[]).filter(i=>i.isAbnormal).length;
      h += '<div class="card px-3.5 py-3 cursor-pointer" onclick="viewHealthDetail(\''+r.id+'\')">';
      h += '<div class="flex items-center gap-3">';
      h += '<div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 '+(abn>0?'bg-red-50':'bg-green-50')+' text-lg">'+(abn>0?'🔴':'🟢')+'</div>';
      h += '<div class="flex-1 min-w-0">';
      h += '<div class="flex items-center justify-between"><span class="font-medium text-sm truncate">'+esc(r.hospital||'未填写医院')+'</span><span class="text-xs text-gray-400 shrink-0">'+(r.date||'')+'</span></div>';
      h += '<div class="flex items-center gap-2 mt-0.5 flex-wrap">';
      if(r.type) h += '<span class="text-xs px-2 py-0.5 rounded-full tag-blue">'+esc(r.type)+'</span>';
      if(r.pdfBase64) h += '<span class="text-xs text-gray-400">📄 PDF</span>';
      if(abn>0) h += '<span class="text-xs text-red-500 font-medium">'+abn+'项异常</span>';
      else if(r.indicators&&r.indicators.length) h += '<span class="text-xs text-green-600">全部正常</span>';
      h += '</div></div></div></div>';
    });
    h += '</div></div>';
  });
  return h;
}
function openMbForm(id) {
  const m = id?getMb(id):{}, isE = !!id;
  const ro = RELS.map(r=>'<option value="'+r+'" '+(m.relation===r?'selected':'')+'>'+r+'</option>').join('');
  openM('<div class="p-5"><div class="flex items-center justify-between mb-5"><h2 class="text-lg font-bold">'+(isE?'编辑成员':'添加成员')+'</h2><button onclick="closeM()" class="text-gray-400"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></div><form onsubmit="saveMb(event,\''+(id||'')+'\')" class="space-y-4"><div><label class="block text-sm font-medium text-gray-700 mb-1">姓名 *</label><input name="name" value="'+esc(m.name)+'" required class="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"></div><div class="grid grid-cols-2 gap-3"><div><label class="block text-sm font-medium text-gray-700 mb-1">称谓</label><select name="relation" class="w-full border border-gray-200 rounded-xl px-4 py-2.5 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"><option value="">选择称谓</option>'+ro+'</select></div><div><label class="block text-sm font-medium text-gray-700 mb-1">出生日期</label><input name="birthday" type="date" value="'+(m.birthday||'')+'" class="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"></div></div><div><label class="block text-sm font-medium text-gray-700 mb-1">备注</label><input name="notes" value="'+esc(m.notes||'')+'" placeholder="如：过敏史、慢性病等" class="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"></div><button type="submit" class="w-full bg-blue-600 text-white py-3 rounded-xl font-medium hover:bg-blue-700 active:scale-[0.98] transition-all">'+(isE?'保存修改':'添加成员')+'</button></form></div>');
}
function saveMb(e, id) {
  e.preventDefault(); const f = e.target;
  const d = {name:f.name.value.trim(),relation:f.relation.value,birthday:f.birthday.value||'',notes:f.notes.value.trim()};
  if (!d.name) return;
  const ms = DB.members;
  if (id) { const i=ms.findIndex(m=>m.id===id); if(i>=0) ms[i]={...ms[i],...d}; }
  else { d.id=uid(); ms.push(d); }
  DB.members = ms; closeM(); toast(id?'已更新':'已添加'); render();
}
function delMb(id) {
  if (!confirm('确定删除此成员？相关记录也会删除。')) return;
  DB.members = DB.members.filter(m=>m.id!==id);
  DB.experiences = DB.experiences.filter(e=>e.memberId!==id);
  DB.healthRecords = DB.healthRecords.filter(r=>r.memberId!==id);
  toast('已删除'); render();
}

// ===== Health Records =====
const HR_TYPES = ['年度体检','专项检查','其他'];
let _healthPdfBase64 = null; // temp for form

function openHealthForm(memberId, id) {
  const existing = id ? DB.healthRecords.find(r => r.id === id) : null;
  const isEdit = !!existing;
  _healthIndicators = existing && existing.indicators ? [...existing.indicators] : [];
  _healthPdfBase64 = existing && existing.pdfBase64 ? existing.pdfBase64 : null;

  const r = existing || {};
  const today = new Date().toISOString().slice(0,10);
  const typeOpts = HR_TYPES.map(t => '<option value="'+t+'" '+(r.type===t?'selected':'')+'>'+t+'</option>').join('');

  let h = '<div class="p-5"><div class="flex items-center justify-between mb-5"><h2 class="text-lg font-bold">'+(isEdit?'编辑健康档案':'🏥 添加健康档案')+'</h2><button onclick="closeM()" class="text-gray-400"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></div>';
  h += '<form onsubmit="saveHealth(event,\''+memberId+'\',\''+(id||'')+'\')" class="space-y-4">';

  // PDF upload
  h += '<div><label class="block text-sm font-medium text-gray-700 mb-1">📄 体检报告 PDF</label>';
  h += '<div id="pdfUploadArea" class="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/30 transition-colors" onclick="document.getElementById(\'pdfFileInput\').click()">';
  if (_healthPdfBase64) {
    h += '<div class="text-sm text-green-600 font-medium">✅ 已选择 PDF</div><div class="text-xs text-gray-400 mt-1">点击重新选择</div>';
  } else {
    h += '<div class="text-3xl mb-1">📄</div><div class="text-sm text-gray-400">点击上传 PDF 文件</div>';
  }
  h += '</div>';
  h += '<input id="pdfFileInput" type="file" accept=".pdf" onchange="handlePdfUpload(event)" class="hidden">';
  h += '</div>';

  // Basic info
  h += '<div class="space-y-3">';
  h += '<div><label class="block text-sm font-medium text-gray-700 mb-1">检查日期 *</label><input name="hrDate" type="date" value="'+(r.date||today)+'" required class="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"></div>';
  h += '<div><label class="block text-sm font-medium text-gray-700 mb-1">检查类型</label><select name="hrType" class="w-full border border-gray-200 rounded-xl px-4 py-2.5 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"><option value="">选择类型</option>'+typeOpts+'</select></div>';
  h += '</div>';

  h += '<div><label class="block text-sm font-medium text-gray-700 mb-1">医院名称</label><input name="hrHospital" value="'+esc(r.hospital||'')+'" placeholder="如：北京协和医院" class="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"></div>';

  // Indicators section
  h += '<div><div class="flex items-center justify-between mb-2"><label class="block text-sm font-medium text-gray-700">📊 异常指标</label><button type="button" onclick="addHealthIndicator()" class="text-xs font-medium" style="color:var(--c-primary)">+ 添加指标</button></div>';
  h += '<div id="indicatorsList"></div>';
  h += '</div>';

  // Notes
  h += '<div><label class="block text-sm font-medium text-gray-700 mb-1">备注（医生建议 / 需要复查的点）</label><div class="flex gap-2 items-end"><textarea name="hrNotes" rows="3" placeholder="如：3个月后复查肝功能、注意控制饮食..." class="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none">'+esc(r.notes||'')+'</textarea>'+voiceBtn('hrNotes')+'</div></div>';

  h += '<button type="submit" class="w-full bg-blue-600 text-white py-3 rounded-xl font-medium hover:bg-blue-700 active:scale-[0.98] transition-all">'+(isEdit?'保存修改':'保存健康档案')+'</button>';
  if (isEdit) h += '<button type="button" onclick="delHealth(\''+id+'\');closeM()" class="w-full text-red-500 py-2 text-sm mt-1">删除此档案</button>';
  h += '</form></div>';

  openM(h);
  setTimeout(renderIndicatorsList, 50);
}

function handlePdfUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  if (file.type !== 'application/pdf') { toast('请选择 PDF 文件'); return; }
  if (file.size > 20 * 1024 * 1024) { toast('文件过大，请控制在 20MB 以内'); return; }
  toast('正在读取 PDF...');
  const reader = new FileReader();
  reader.onload = ev => {
    const base64 = ev.target.result.split(',')[1];
    _healthPdfBase64 = base64;
    toast('✅ PDF 已加载 (' + (file.size/1024/1024).toFixed(1) + 'MB)');
    const area = $('pdfUploadArea');
    if (area) area.innerHTML = '<div class="text-sm text-green-600 font-medium">✅ ' + esc(file.name) + '</div><div class="text-xs text-gray-400 mt-1">' + (file.size/1024/1024).toFixed(1) + 'MB · 点击重新选择</div>';
  };
  reader.onerror = () => toast('读取文件失败');
  reader.readAsDataURL(file);
  e.target.value = '';
}

function addHealthIndicator() {
  _healthIndicators.push({ name: '', value: '', refRange: '', isAbnormal: true });
  renderIndicatorsList();
}
function removeHealthIndicator(idx) {
  _healthIndicators.splice(idx, 1);
  renderIndicatorsList();
}
function renderIndicatorsList() {
  const el = $('indicatorsList');
  if (!el) return;
  if (!_healthIndicators.length) {
    el.innerHTML = '<div class="text-sm text-gray-400 py-2 text-center">暂未添加指标，可根据体检报告手动录入异常项</div>';
    return;
  }
  let h = '<div class="space-y-2">';
  _healthIndicators.forEach((ind, i) => {
    h += '<div class="bg-gray-50 rounded-xl p-3 space-y-2">';
    h += '<div class="flex items-center justify-between"><span class="text-xs font-medium text-gray-500">指标 #'+(i+1)+'</span><button type="button" onclick="removeHealthIndicator('+i+')" class="text-gray-400 hover:text-red-500 text-xs">删除</button></div>';
    h += '<input type="text" placeholder="指标名称（如：谷丙转氨酶）" value="'+esc(ind.name)+'" oninput="_healthIndicators['+i+'].name=this.value" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">';
    h += '<div class="grid grid-cols-2 gap-2">';
    h += '<input type="text" placeholder="你的值（如：52）" value="'+esc(ind.value)+'" oninput="_healthIndicators['+i+'].value=this.value" class="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">';
    h += '<input type="text" placeholder="参考范围（如：0-40）" value="'+esc(ind.refRange)+'" oninput="_healthIndicators['+i+'].refRange=this.value" class="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">';
    h += '</div>';
    h += '<label class="flex items-center gap-2 text-sm"><input type="checkbox" '+(ind.isAbnormal?'checked':'')+' onchange="_healthIndicators['+i+'].isAbnormal=this.checked" class="accent-red-500"><span class="text-red-600 font-medium">异常</span><span class="text-gray-400 text-xs">（取消勾选表示正常）</span></label>';
    h += '</div>';
  });
  h += '</div>';
  el.innerHTML = h;
}

function saveHealth(e, memberId, id) {
  e.preventDefault();
  const f = e.target;
  const d = {
    memberId,
    date: f.hrDate.value,
    type: f.hrType.value,
    hospital: f.hrHospital.value.trim(),
    indicators: _healthIndicators.filter(i => i.name.trim()),
    notes: f.hrNotes.value.trim(),
    pdfBase64: _healthPdfBase64 || null
  };
  if (!d.date) return;
  const hrs = DB._g('healthRecords');
  if (id) {
    const idx = hrs.findIndex(r => r.id === id);
    if (idx >= 0) hrs[idx] = { ...hrs[idx], ...d };
  } else {
    d.id = uid();
    d.createdAt = new Date().toISOString();
    hrs.push(d);
  }
  try {
    DB.healthRecords = hrs;
  } catch(err) {
    toast('保存失败：' + err.message);
    console.error('saveHealth error:', err);
    return;
  }
  _healthIndicators = [];
  _healthPdfBase64 = null;
  closeM();
  toast(id ? '已更新' : '已保存');
  render();
}

function viewHealthDetail(id) {
  const r = DB.healthRecords.find(x => x.id === id);
  if (!r) return;
  const mb = getMb(r.memberId);
  const abnInds = (r.indicators||[]).filter(i => i.isAbnormal);
  const normalInds = (r.indicators||[]).filter(i => !i.isAbnormal);

  let h = '<div class="p-5"><div class="flex items-center justify-between mb-4">';
  h += '<h2 class="text-lg font-bold">健康档案详情</h2>';
  h += '<button onclick="closeM()" class="text-gray-400"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>';
  h += '</div>';

  // Tags
  h += '<div class="flex items-center gap-2 mb-4">';
  if (r.type) h += '<span class="text-xs px-2.5 py-1 rounded-full tag-blue font-medium">'+esc(r.type)+'</span>';
  if (r.pdfBase64) h += '<span class="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 font-medium">📄 PDF</span>';
  if (abnInds.length) h += '<span class="text-xs px-2.5 py-1 rounded-full tag-red font-medium">🔴 '+abnInds.length+'项异常</span>';
  else if (normalInds.length) h += '<span class="text-xs px-2.5 py-1 rounded-full tag-green font-medium">🟢 全部正常</span>';
  h += '</div>';

  // Info rows
  const rows = [];
  if (r.date) rows.push(['📅', '检查日期', r.date]);
  if (mb) rows.push(['👤', '成员', (MO[mb.relation]||'')+' '+esc(mb.name)]);
  if (r.hospital) rows.push(['🏥', '医院', esc(r.hospital)]);
  rows.forEach(([icon, label, val], i) => {
    const brd = i < rows.length-1 ? 'border-b border-gray-100' : '';
    h += '<div class="flex gap-3 px-4 py-3 '+brd+'"><span class="text-base shrink-0">'+icon+'</span><div><div class="text-xs text-gray-400">'+label+'</div><div class="text-sm font-medium mt-0.5">'+val+'</div></div></div>';
  });
  h += '</div>';

  // PDF preview
  if (r.pdfBase64) {
    h += '<div class="mb-4"><button onclick="viewHealthPdf(\''+r.id+'\')" class="w-full py-3 btn-outline text-sm font-semibold flex items-center justify-center gap-2">📄 查看 PDF 原件</button></div>';
  }

  // Abnormal indicators
  if (abnInds.length) {
    h += '<div class="mb-4"><div class="text-sm font-semibold text-red-700 mb-2">🔴 异常指标</div>';
    h += '<div class="space-y-2">';
    abnInds.forEach(ind => {
      h += '<div class="bg-red-50 rounded-xl p-3 flex items-center justify-between">';
      h += '<div><div class="text-sm font-medium text-red-800">'+esc(ind.name)+'</div>';
      h += '<div class="text-xs text-red-500">参考：'+esc(ind.refRange||'—')+'</div></div>';
      h += '<span class="text-sm font-bold text-red-600">'+esc(ind.value)+'</span>';
      h += '</div>';
    });
    h += '</div></div>';
  }

  // Normal indicators
  if (normalInds.length) {
    h += '<div class="mb-4"><div class="text-sm font-semibold text-green-700 mb-2">🟢 正常指标</div>';
    h += '<div class="space-y-1.5">';
    normalInds.forEach(ind => {
      h += '<div class="bg-green-50 rounded-lg px-3 py-2 flex items-center justify-between">';
      h += '<span class="text-sm text-green-800">'+esc(ind.name)+'</span>';
      h += '<span class="text-sm text-green-600">'+esc(ind.value)+'</span>';
      h += '</div>';
    });
    h += '</div></div>';
  }

  // Notes
  if (r.notes) {
    h += '<div class="p-3.5 rounded-xl text-sm mb-4 bg-gray-50 text-gray-600"><span class="font-medium">💬 备注</span><div class="mt-1 whitespace-pre-wrap">'+esc(r.notes)+'</div></div>';
  }

  // Actions
  h += '<div class="flex gap-3">';
  h += '<button onclick="closeM();openHealthForm(\''+r.memberId+'\',\''+r.id+'\')" class="flex-1 py-2.5 btn-outline text-sm font-medium">编辑</button>';
  h += '<button onclick="delHealth(\''+r.id+'\')" class="flex-1 py-2.5 text-sm font-medium text-red-500 rounded-xl border border-red-200 active:scale-[0.98] transition-all">删除</button>';
  h += '</div></div>';

  openM(h);
}

function viewHealthPdf(id) {
  const r = DB.healthRecords.find(x => x.id === id);
  if (!r || !r.pdfBase64) { toast('PDF 不存在'); return; }
  // Convert base64 to blob and open in new tab/iframe
  const binary = atob(r.pdfBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  // Try opening in new tab first
  const win = window.open(url, '_blank');
  if (!win) {
    // Fallback: show in modal with iframe
    let h = '<div class="p-5"><div class="flex items-center justify-between mb-3"><h2 class="text-lg font-bold">📄 PDF 原件</h2><button onclick="closeM()" class="text-gray-400">✕</button></div>';
    h += '<iframe src="'+url+'" class="w-full rounded-xl border border-gray-200" style="height:70vh"></iframe></div>';
    openM(h);
  }
}

function delHealth(id) {
  if (!confirm('确定删除这条健康档案？')) return;
  DB.healthRecords = DB._g('healthRecords').filter(r => r.id !== id);
  toast('已删除'); render();
}

// ===== Part 4: Visits (Doctor Records) =====
function rVisits() {
  const ms = DB.members, exps = DB.experiences;
  let h = '<div class="fade-in space-y-4">';
  h += '<button onclick="openVisitForm()" class="w-full py-3.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 active:scale-[0.98] transition-all text-base">+ 记录就医</button>';

  // Filter chips: by member
  h += '<div class="flex gap-2 overflow-x-auto pb-1">';
  h += '<button onclick="vFlt=\'\';render()" class="shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium '+(vFlt?'bg-white text-gray-500 shadow-sm':'text-white')+'" style="'+(vFlt?'':'background:linear-gradient(135deg,#E8564A,#F28077);box-shadow:0 2px 8px rgba(232,86,74,0.25)')+'">全部</button>';
  ms.forEach(m => { h += '<button onclick="vFlt=\''+m.id+'\';vFltType=\'\';render()" class="shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium '+(vFlt===m.id?'text-white':'bg-white text-gray-500 shadow-sm')+'" style="'+(vFlt===m.id?'background:linear-gradient(135deg,#E8564A,#F28077);box-shadow:0 2px 8px rgba(232,86,74,0.25)':'')+'">'+(MO[m.relation]||'👤')+' '+esc(m.name)+'</button>'; });
  h += '</div>';

  // Filter by type + Group by
  h += '<div class="flex gap-2 items-center justify-between">';
  h += '<div class="flex gap-1.5">';
  h += '<button onclick="vFltType=\'\';render()" class="px-3 py-1.5 rounded-lg text-xs font-medium '+(vFltType?'bg-white text-gray-400 shadow-sm':'text-white shadow-sm')+'" style="'+(vFltType?'':'background:#3A3A3A;box-shadow:0 2px 6px rgba(0,0,0,0.1)')+'">全部</button>';
  h += '<button onclick="vFltType=\'effective\';render()" class="px-3 py-1.5 rounded-lg text-xs font-medium '+(vFltType==='effective'?'text-white shadow-sm':'tag-green')+'" style="'+(vFltType==='effective'?'background:var(--c-green);box-shadow:0 2px 6px rgba(52,199,89,0.3)':'')+'">✅ 有效</button>';
  h += '<button onclick="vFltType=\'avoid\';render()" class="px-3 py-1.5 rounded-lg text-xs font-medium '+(vFltType==='avoid'?'text-white shadow-sm':'tag-red')+'" style="'+(vFltType==='avoid'?'background:var(--c-red);box-shadow:0 2px 6px rgba(255,59,48,0.3)':'')+'">🚫 避雷</button>';
  h += '</div>';
  h += '<div class="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">';
  h += '<button onclick="vGroup=\'time\';render()" class="px-2.5 py-1 rounded-md text-xs font-medium '+(vGroup==='time'?'bg-white shadow-sm text-gray-700':'text-gray-400')+'">时间</button>';
  h += '<button onclick="vGroup=\'member\';render()" class="px-2.5 py-1 rounded-md text-xs font-medium '+(vGroup==='member'?'bg-white shadow-sm text-gray-700':'text-gray-400')+'">成员</button>';
  h += '<button onclick="vGroup=\'diagnosis\';render()" class="px-2.5 py-1 rounded-md text-xs font-medium '+(vGroup==='diagnosis'?'bg-white shadow-sm text-gray-700':'text-gray-400')+'">病症</button>';
  h += '</div></div>';

  // Filter
  let filtered = exps;
  if (vFlt) filtered = filtered.filter(e => e.memberId === vFlt);
  if (vFltType === 'effective') filtered = filtered.filter(e => e.effective && !e.avoid);
  if (vFltType === 'avoid') filtered = filtered.filter(e => e.avoid);

  if (!filtered.length) {
    h += '<div class="text-center py-12"><div class="text-5xl mb-3">📝</div><p class="text-gray-400 mb-4">'+(vFltType==='avoid'?'暂无避雷记录':vFltType==='effective'?'暂无有效药方记录':'还没有就医记录')+'</p><button onclick="openVisitForm()" class="bg-blue-600 text-white px-6 py-2.5 rounded-xl font-medium">记录就医</button></div>';
  } if (vGroup === 'time') {
    h += '<div class="space-y-3">'+filtered.map(visitCard).join('')+'</div>';
  } else if (vGroup === 'member') {
    const groups = {};
    filtered.forEach(e => { const mb = getMb(e.memberId); const key = mb ? (MO[mb.relation]||'')+' '+mb.name : '未知'; if (!groups[key]) groups[key] = []; groups[key].push(e); });
    h += '<div class="space-y-4">';
    Object.entries(groups).forEach(([name, items]) => {
      h += '<div><div class="group-header group-blue text-sm font-semibold text-gray-600 mb-2 flex items-center gap-2">'+name+' <span class="text-xs font-normal text-gray-400">'+items.length+'条</span></div><div class="space-y-2 ml-2">'+items.map(visitCard).join('')+'</div></div>';
    });
    h += '</div>';
  } else if (vGroup === 'diagnosis') {
    const groups = {};
    filtered.forEach(e => { const d = e.diagnosis || '未记录'; if (!groups[d]) groups[d] = []; groups[d].push(e); });
    h += '<div class="space-y-4">';
    Object.entries(groups).sort((a,b) => new Date(b[1][0].date) - new Date(a[1][0].date)).forEach(([diag, items]) => {
      h += '<div><div class="group-header group-orange text-sm font-semibold text-gray-600 mb-2 flex items-center gap-2">🩺 '+esc(diag)+' <span class="text-xs font-normal text-gray-400">'+items.length+'条</span></div><div class="space-y-2 ml-2">'+items.map(visitCard).join('')+'</div></div>';
    });
    h += '</div>';
  }

  h += '</div>';
  return h;
}
function visitCard(e) {
  const mb = getMb(e.memberId);
  const isVisit = !!(e.doctorName || e.hospital);
  const dotCls = e.avoid?'dot-avoid':e.effective?'dot-effective':'dot-normal';
  let tag = '';
  if (e.avoid) tag = '<span class="text-xs tag-red px-2 py-0.5 rounded-full font-medium">🚫 避雷</span>';
  else if (e.effective) tag = '<span class="text-xs tag-green px-2 py-0.5 rounded-full font-medium">✅ 有效</span>';

  let h = '<div class="card px-3.5 py-3 cursor-pointer transition-all hover:shadow-md" onclick="viewVisitDetail(\''+e.id+'\')">';
  h += '<div class="flex items-center gap-2.5">';
  h += '<div class="dot '+dotCls+' mt-1"></div>';
  h += '<div class="flex-1 min-w-0">';
  // Line 1: name + date + tag
  h += '<div class="flex items-center justify-between gap-2">';
  if (isVisit) {
    h += '<span class="font-medium text-sm truncate">👨‍⚕️ '+esc(e.doctorName)+'</span>';
  } else {
    h += '<span class="font-medium text-sm truncate">'+esc(mb?mb.name:'')+'</span>';
  }
  h += '<span class="text-xs text-gray-400 shrink-0">'+(e.date||'')+'</span></div>';
  // Line 2: hospital or member
  if (isVisit && e.hospital) {
    h += '<div class="text-xs text-gray-400 mt-0.5 truncate">🏥 '+esc(e.hospital)+(e.department?' · '+esc(e.department):'')+'</div>';
  } else if (mb) {
    h += '<div class="text-xs text-gray-400 mt-0.5">'+(MO[mb.relation]||'👤')+' '+esc(mb.name)+'</div>';
  }
  // Line 3: diagnosis
  if (e.diagnosis) h += '<div class="text-xs text-gray-500 mt-0.5 truncate">🩺 '+esc(e.diagnosis)+'</div>';
  h += '</div>';
  if (tag) h += '<div class="shrink-0">'+tag+'</div>';
  h += '</div></div>';
  return h;
}

// ===== Visit Form =====
function openVisitForm(id) {
  const ms = DB.members, meds = DB.medicines;
  if (!ms.length) { openM('<div class="p-5 text-center py-8"><p class="text-gray-400 mb-4">请先添加家庭成员</p><button onclick="closeM();switchTab(\'members\')" class="text-blue-500">去添加 →</button></div>'); return; }

  let existing = id ? DB.experiences.find(e => e.id === id) : null;
  const isEdit = !!existing;

  // Load existing photos into queue
  if (existing?.photos?.length && !_photoQueue.length) _photoQueue = [...existing.photos];

  // Pre-fill from prescription recognition
  const rx = window._prescriptionData || null;
  let comboItems = [];
  if (rx && !id) {
    existing = { ...existing,
      memberId: rx._memberId || '',
      date: rx.date || '',
      doctorName: rx.doctorName || '',
      hospital: rx.hospital || '',
      department: rx.department || '',
      diagnosis: rx.diagnosis || '',
      notes: (rx.notes||'') + (rx.patientAge ? '\n就诊时年龄：'+rx.patientAge : ''),
    };
    if (rx._comboParsed) comboItems = rx._comboParsed.map(c => c.medicineId ? c : { medicineId: '', name: c.name });
    window._prescriptionData = null;
  }
  if (!isEdit && !rx) _photoQueue = [];

  const today = new Date().toISOString().slice(0,10);
  const mo = ms.map(m=>'<option value="'+m.id+'" '+(existing&&existing.memberId===m.id?'selected':'')+'>'+(MO[m.relation]||'👤')+' '+esc(m.name)+'</option>').join('');

  // Combo medicines: pre-fill from existing record
  if (existing) {
    if (existing.comboMedicines && existing.comboMedicines.length) {
      comboItems = existing.comboMedicines;
    } else if (existing.medicineId) {
      const med = getM(existing.medicineId);
      if (med) comboItems = [{ medicineId: existing.medicineId, name: med.name }];
    }
  }
  const comboData = JSON.stringify(comboItems).replace(/"/g, '&quot;');

  const ro = [[5,'⭐⭐⭐⭐⭐ 非常好'],[4,'⭐⭐⭐⭐ 比较好'],[3,'⭐⭐⭐ 一般'],[2,'⭐⭐ 效果差'],[1,'⭐ 无效/恶化']].map(([v,l])=>'<option value="'+v+'" '+(existing&&existing.rating===v?'selected':!existing&&v===3?'selected':'')+'>'+l+'</option>').join('');

  const h = '<div class="p-5"><div class="flex items-center justify-between mb-5"><h2 class="text-lg font-bold">'+(isEdit?'编辑就医记录':'📝 记录就医')+'</h2><button onclick="closeM()" class="text-gray-400"><svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></div>'+
    '<form onsubmit="saveVisit(event,\''+(id||'')+'\')" class="space-y-4">'+

    // Photos section
    '<div class="flex gap-2 justify-center"><button type="button" onclick="openCamera()" class="flex-1 py-3 bg-green-50 border border-green-200 rounded-xl text-green-700 font-medium active:scale-[0.98] transition-all text-sm">📷 拍照处方</button><button type="button" onclick="pickImage()" class="flex-1 py-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-700 font-medium active:scale-[0.98] transition-all text-sm">📁 选图</button></div>'+
    '<div id="photoCounter"><div class="text-center py-2 text-gray-400 text-xs">点上方按钮拍照处方单</div></div>'+

    // Member + Date
    '<div class="grid grid-cols-2 gap-3"><div><label class="block text-sm font-medium text-gray-700 mb-1">用药人 *</label><select name="memberId" required class="w-full border border-gray-200 rounded-xl px-4 py-2.5 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">'+mo+'</select></div>'+
    '<div><label class="block text-sm font-medium text-gray-700 mb-1">日期</label><input name="date" type="date" value="'+(existing?.date||today)+'" class="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500"></div></div>'+

    // Doctor info (collapsible section)
    '<div class="bg-gray-50 rounded-xl p-4 space-y-3"><div class="flex items-center justify-between"><span class="text-sm font-medium text-gray-700">👨‍⚕️ 医生信息</span><span class="text-xs text-gray-400">（选填，填写后自动归类为就医记录）</span></div>'+
    '<div class="grid grid-cols-2 gap-3"><div><label class="block text-xs font-medium text-gray-500 mb-1">医生姓名</label><input name="doctorName" value="'+esc(existing?.doctorName||'')+'" placeholder="如：张医生" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"></div>'+
    '<div><label class="block text-xs font-medium text-gray-500 mb-1">科室</label><input name="department" value="'+esc(existing?.department||'')+'" placeholder="如：内科" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"></div></div>'+
    '<div><label class="block text-xs font-medium text-gray-500 mb-1">医院</label><input name="hospital" value="'+esc(existing?.hospital||'')+'" placeholder="如：北京儿童医院" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"></div>'+
    '<div><label class="block text-xs font-medium text-gray-500 mb-1">诊断/症状</label><div class="flex gap-2 items-end"><input name="diagnosis" value="'+esc(existing?.diagnosis||'')+'" placeholder="如：感冒发烧" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">'+voiceBtn('v_diagnosis')+'</div></div></div>'+

    // Combo medicines
    '<div><label class="block text-sm font-medium text-gray-700 mb-1">💊 处方药品（可添加多种）</label>'+
    '<div id="comboList" data-combo=\''+comboData+'\'></div>'+
    '<div class="flex gap-2 mt-2"><select id="addMedSelect" class="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none"><option value="">选择药品添加...</option>'+meds.map(m=>'<option value="'+m.id+'">'+esc(m.name)+(m.category?' ('+m.category+')':'')+'</option>').join('')+'</select>'+
    '<button type="button" onclick="addComboMed()" class="px-3 py-2 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-100">+ 添加</button></div></div>'+

    // Rating
    '<div class="grid grid-cols-2 gap-3"><div><label class="block text-sm font-medium text-gray-700 mb-1">效果评分</label><select name="rating" class="w-full border border-gray-200 rounded-xl px-4 py-2.5 bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">'+ro+'</select></div>'+
    '<div class="flex flex-col justify-end gap-2"><label class="block"><input type="checkbox" name="effective" id="v_effective" '+(existing?.effective?'checked':'')+' class="mr-1.5 accent-green-600"><span class="text-sm text-green-700 font-medium">✅ 药方有效（推荐组合）</span></label>'+
    '<label class="block"><input type="checkbox" name="avoid" id="v_avoid" '+(existing?.avoid?'checked':'')+' class="mr-1.5 accent-red-600"><span class="text-sm text-red-700 font-medium">🚫 避雷（不推荐此医生）</span></label></div></div>'+

    // Effect + side effects + notes
    '<div><label class="block text-sm font-medium text-gray-700 mb-1">效果描述</label><div class="flex gap-2 items-end"><textarea name="effect" rows="2" placeholder="如：两天就退烧了" class="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none">'+esc(existing?.effect||'')+'</textarea>'+voiceBtn('v_effect')+'</div></div>'+
    '<div><label class="block text-sm font-medium text-gray-700 mb-1">副作用</label><div class="flex gap-2 items-center"><input name="sideEffect" value="'+esc(existing?.sideEffect||'')+'" placeholder="无则留空" class="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500">'+voiceBtn('v_sideEffect')+'</div></div>'+
    '<div><label class="block text-sm font-medium text-gray-700 mb-1">备注</label><div class="flex gap-2 items-end"><textarea name="notes" rows="2" placeholder="其他想记录的" class="w-full border border-gray-200 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none">'+esc(existing?.notes||'')+'</textarea>'+voiceBtn('v_notes')+'</div></div>'+

    '<button type="submit" class="w-full bg-blue-600 text-white py-3 rounded-xl font-medium hover:bg-blue-700 active:scale-[0.98] transition-all">'+(isEdit?'保存修改':'保存就医记录')+'</button></form></div>';

  openM(h);
  setTimeout(renderComboList, 50);
  setTimeout(updatePhotoPreview, 50);
}

// Combo medicine list management
let _comboMeds = [];
function renderComboList() {
  const el = $('comboList'); if (!el) return;
  const data = el.dataset.combo;
  if (data) { try { _comboMeds = JSON.parse(data); } catch { _comboMeds = []; } el.removeAttribute('data-combo'); }
  if (!_comboMeds.length) { el.innerHTML = '<div class="text-sm text-gray-400 py-2 text-center">暂未添加药品</div>'; return; }
  let h = '<div class="space-y-2">';
  _comboMeds.forEach((cm, i) => {
    h += '<div class="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2"><span class="flex-1 text-sm">💊 '+esc(cm.name)+'</span><button type="button" onclick="removeComboMed('+i+')" class="text-gray-400 hover:text-red-500 text-sm">✕</button></div>';
  });
  h += '</div>';
  el.innerHTML = h;
}
function addComboMed() {
  const sel = $('addMedSelect'); if (!sel || !sel.value) { toast('请选择药品'); return; }
  const med = getM(sel.value); if (!med) return;
  if (_comboMeds.some(cm => cm.medicineId === med.id)) { toast('已添加过此药品'); return; }
  _comboMeds.push({ medicineId: med.id, name: med.name });
  sel.value = '';
  renderComboList();
}
function removeComboMed(idx) { _comboMeds.splice(idx, 1); renderComboList(); }

function saveVisit(e, id) {
  e.preventDefault(); const f = e.target;
  const memberId = f.memberId.value;
  const date = f.date.value;
  const doctorName = f.doctorName.value.trim();
  const department = f.department.value.trim();
  const hospital = f.hospital.value.trim();
  const diagnosis = f.diagnosis.value.trim();
  const rating = parseInt(f.rating.value);
  const effective = f.effective.checked;
  const avoid = f.avoid.checked;
  const effect = f.effect.value.trim();
  const sideEffect = f.sideEffect.value.trim();
  const notes = f.notes.value.trim();

  // Build combo medicines
  let comboMedicines = [..._comboMeds];
  // Also check if there's a single medicine from legacy format
  let medicineId = '';
  if (comboMedicines.length === 1) medicineId = comboMedicines[0].medicineId;
  else if (comboMedicines.length === 0) { toast('请至少添加一种药品'); return; }

  const d = { memberId, date, doctorName, department, hospital, diagnosis, rating, effective, avoid, effect, sideEffect, notes, comboMedicines, medicineId, photos: _photoQueue.length ? [..._photoQueue] : (existing?.photos||[]) };
  _photoQueue = []; _comboMeds = [];

  const exps = DB.experiences;
  if (id) { const i = exps.findIndex(x => x.id === id); if (i >= 0) exps[i] = { ...exps[i], ...d }; }
  else { d.id = uid(); exps.push(d); }
  DB.experiences = exps;
  closeM(); toast(id ? '已更新' : '已记录'); render();
}
function recognizePrescription() {
  if (!_photoQueue.length) return;
  const s = getSettings();
  if (!s.apiKey) { toast('请先在设置中填入 API Key'); openSettings(); return; }
  toast('📷 正在识别处方单...');
  const imgs = _photoQueue.map(b64 => ({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } }));
  const prompt = '请识别处方单/病历图片，提取以下信息，严格按JSON返回：{"patientName":"患者姓名","patientAge":"患者年龄（如：3岁、8个月、35岁等）","date":"就诊日期YYYY-MM-DD","doctorName":"医生姓名","hospital":"医院名称","department":"科室","diagnosis":"诊断或症状","medicines":["药品1","药品2"],"notes":"其他信息如用法用量"}\n如果无法识别，返回：{"error":"无法识别","name":"内容描述"}';
  fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.apiKey },
    body: JSON.stringify({ model: 'qwen-vl-max', messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...imgs] }], max_tokens: 500 })
  }).then(r => r.ok ? r.json() : r.json().then(d => { throw new Error(d.error?.message||'HTTP '+r.status); }))
  .then(data => { try { const c = data.choices[0].message.content; const j = JSON.parse(c.match(/\{[\s\S]*\}/)[0]); if (j.error) { toast('无法识别：'+j.name); return; } showPrescriptionResult(j); } catch(e) { toast('解析失败'); } })
  .catch(err => { openM('<div class="p-5"><div class="flex items-center justify-between mb-4"><h2 class="text-lg font-bold text-red-600">❌ 识别出错</h2><button onclick="closeM()" class="text-gray-400">✕</button></div><div class="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 whitespace-pre-wrap break-all">'+esc(err.message)+'</div><button onclick="closeM()" class="w-full mt-4 py-2.5 border rounded-xl text-gray-600 text-sm">关闭</button></div>'); });
}
function showPrescriptionResult(d) {
  let h = '<div class="p-5"><div class="flex items-center justify-between mb-4"><h2 class="text-lg font-bold">📋 处方识别结果</h2><button onclick="closeM()" class="text-gray-400">✕</button></div><div class="space-y-3" id="rxFields">';
  const fields = [
    { key: 'patientName', label: '患者姓名', placeholder: '如：小明' },
    { key: 'patientAge', label: '患者年龄', placeholder: '如：3岁、8个月' },
    { key: 'date', label: '就诊日期', placeholder: 'YYYY-MM-DD' },
    { key: 'doctorName', label: '医生姓名', placeholder: '如：张医生' },
    { key: 'hospital', label: '医院', placeholder: '如：北京儿童医院' },
    { key: 'department', label: '科室', placeholder: '如：内科' },
    { key: 'diagnosis', label: '诊断/症状', placeholder: '如：感冒发烧' },
    { key: 'medicines', label: '药品列表', placeholder: '如：布洛芬, 阿莫西林' },
    { key: 'notes', label: '备注', placeholder: '用法用量等' }
  ];
  fields.forEach(f => {
    const v = d[f.key];
    if (!v || (Array.isArray(v) && !v.length)) return;
    const val = Array.isArray(v) ? v.join(', ') : v;
    h += '<div class="flex items-center gap-3 bg-gray-50 rounded-xl p-3"><input type="checkbox" checked class="rx-check w-5 h-5 rounded accent-blue-600 shrink-0"><label class="text-sm font-medium text-gray-700 shrink-0 w-20">'+f.label+'</label><input data-key="'+f.key+'" class="rx-field flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" value="'+esc(val)+'" placeholder="'+esc(f.placeholder)+'"></div>';
  });
  h += '</div><div class="flex gap-3 mt-4"><button onclick="applyPrescriptionResult()" class="flex-1 py-3 bg-blue-600 text-white rounded-xl font-medium active:scale-[0.98] transition-all">✓ 确认填入</button><button onclick="closeM()" class="flex-1 py-3 border rounded-xl text-gray-600">取消</button></div></div>';
  openM(h);
}
function applyPrescriptionResult() {
  const rxData = {};
  document.querySelectorAll('.rx-check').forEach(chk => {
    if (!chk.checked) return;
    const field = chk.closest('.bg-gray-50').querySelector('.rx-field');
    if (!field) return;
    const k = field.dataset.key, v = field.value.trim();
    if (!v) return;
    rxData[k] = v;
  });
  // Parse medicines into combo
  if (rxData.medicines) {
    const meds = DB.medicines;
    const parsed = [];
    rxData.medicines.split(/[,，、]/).map(s=>s.trim()).filter(Boolean).forEach(name => {
      const m = meds.find(md => md.name === name);
      if (m) parsed.push({ medicineId: m.id, name: m.name });
      else parsed.push({ medicineId: '', name });
    });
    rxData._comboParsed = parsed;
  }
  // Match or auto-create member
  if (rxData.patientName) {
    const ms = DB.members;
    let mb = ms.find(m => m.name === rxData.patientName);
    if (!mb) {
      mb = { id: uid(), name: rxData.patientName, relation: 'other', birthday: '', notes: '由处方识别自动添加，请补充完善' };
      ms.push(mb);
      DB.members = ms;
      rxData._autoCreatedMember = true;
    }
    rxData._memberId = mb.id;
  }
  window._prescriptionData = rxData;
  closeM();
  openVisitForm();
  toast('✅ 已填入表单' + (rxData._autoCreatedMember ? '，已自动添加成员"' + rxData.patientName + '"' : ''));
}
function viewVisitDetail(expId) {
  const e = DB.experiences.find(x => x.id === expId);
  if (!e) return;
  const mb = getMb(e.memberId), medNames = getExpMedNames(e);
  const stars = '⭐'.repeat(e.rating||0) + '☆'.repeat(5-(e.rating||0));
  let h = '<div class="p-5"><div class="flex items-center justify-between mb-5"><h2 class="text-lg font-bold">就医详情</h2><button onclick="closeM()" class="text-gray-300 hover:text-gray-500 transition-colors"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button></div>';
  // Tags row
  h += '<div class="flex items-center gap-2 mb-4">';
  if (e.avoid) h += '<span class="text-xs tag-red px-2.5 py-1 rounded-full font-medium">🚫 避雷</span>';
  if (e.effective) h += '<span class="text-xs tag-green px-2.5 py-1 rounded-full font-medium">✅ 有效</span>';
  if (e.photos&&e.photos.length) h += '<button onclick="viewVisitPhotos(\''+e.id+'\')" class="text-xs font-medium" style="color:var(--c-primary)">📷 照片('+e.photos.length+')</button>';
  h += '</div>';
  // Info list
  const rows = [];
  if (e.date) rows.push(['📅', '日期', e.date]);
  if (mb) { const age=calcAge(mb.birthday,e.date); rows.push(['👤', '患者', (MO[mb.relation]||'')+' '+esc(mb.name)+(age?' ('+age+')':'')]); }
  if (e.doctorName) rows.push(['👨‍⚕️', '医生', esc(e.doctorName)]);
  if (e.hospital) rows.push(['🏥', '医院', esc(e.hospital)+(e.department?' · '+esc(e.department):'')]);
  if (e.diagnosis) rows.push(['🩺', '诊断', esc(e.diagnosis)]);
  if (medNames.length) rows.push(['💊', '处方', esc(medNames.join(' + '))]);
  if (e.rating) rows.push(['⭐', '评分', stars+' '+e.rating+'/5']);
  h += '<div class="card px-0 py-0 overflow-hidden mb-4">';
  rows.forEach(([icon, label, val], i) => {
    const brd = i < rows.length-1 ? 'border-b border-gray-100' : '';
    h += '<div class="flex gap-3 px-4 py-3 '+brd+'"><span class="text-base shrink-0">'+icon+'</span><div><div class="text-xs text-gray-400">'+label+'</div><div class="text-sm font-medium mt-0.5">'+val+'</div></div></div>';
  });
  h += '</div>';
  // Detail notes
  if (e.effect) h += '<div class="p-3.5 rounded-xl text-sm mb-2" style="background:var(--c-green-bg);color:#1B7A3D"><span class="font-medium">✅ 效果</span><div class="mt-1">'+esc(e.effect)+'</div></div>';
  if (e.sideEffect) h += '<div class="p-3.5 rounded-xl text-sm mb-2" style="background:var(--c-orange-bg);color:#9A5F00"><span class="font-medium">⚠️ 副作用</span><div class="mt-1">'+esc(e.sideEffect)+'</div></div>';
  if (e.notes) h += '<div class="p-3.5 rounded-xl text-sm mb-2 bg-gray-50 text-gray-600"><span class="font-medium">💬 备注</span><div class="mt-1">'+esc(e.notes)+'</div></div>';
  // Actions
  h += '<div class="flex gap-3 mt-5"><button onclick="closeM();openVisitForm(\''+e.id+'\')" class="flex-1 py-2.5 btn-outline text-sm font-medium">编辑</button><button onclick="delExp(\''+e.id+'\')" class="flex-1 py-2.5 text-sm font-medium text-red-500 rounded-xl border border-red-200 active:scale-[0.98] transition-all">删除</button></div></div>';
  openM(h);
}
function viewVisitPhotos(expId) {
  const e = DB.experiences.find(x => x.id === expId);
  if (!e || !e.photos || !e.photos.length) return;
  let h = '<div class="p-5"><div class="flex items-center justify-between mb-4"><h2 class="text-lg font-bold">📷 就医记录</h2><button onclick="closeM()" class="text-gray-400">✕</button></div>';
  if (e.doctorName) h += '<div class="text-sm text-gray-600 mb-2">👨‍⚕️ '+esc(e.doctorName)+(e.diagnosis?' · '+esc(e.diagnosis):'')+'</div>';
  h += '<div class="text-xs text-gray-400 mb-3">'+(e.date||'')+'</div><div class="space-y-3">';
  e.photos.forEach(p => { h += '<img src="data:image/jpeg;base64,'+p+'" class="w-full rounded-xl">'; });
  h += '</div></div>';
  openM(h);
}
function delExp(id) {
  if (!confirm('确定删除这条记录？')) return;
  DB.experiences = DB.experiences.filter(e => e.id !== id);
  toast('已删除'); render();
}

// ===== Part 5: Doctor Mode + Init =====
function rDoc() {
  const meds = DB.medicines.filter(m => expSt(m.expiryDate).s !== 'expired');
  if (!meds.length) return '<div class="fade-in text-center py-16"><div class="text-6xl mb-4">📋</div><p class="text-gray-400 mb-4">还没有可用的药品</p><button onclick="switchTab(\'medicines\')" class="bg-blue-600 text-white px-6 py-2.5 rounded-xl font-medium">去添加药品</button></div>';

  let h = '<div class="fade-in space-y-4">';

  // Search bar for doctor mode
  h += '<div class="relative"><input type="text" id="docSearchInput" placeholder="🔍 搜索药品..." oninput="docSearch=this.value.trim().toLowerCase();renderDocList()" class="w-full border border-gray-200 rounded-xl px-4 py-2.5 pl-10 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm">';
  h += '<svg class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg></div>';

  // Info banner
  h += '<div class="bg-blue-50 border border-blue-100 rounded-xl p-4"><div class="flex items-center justify-between mb-2"><div class="text-blue-800 font-bold">📋 药小记 · 药品清单</div><div class="text-xs text-blue-400">'+new Date().toLocaleDateString('zh-CN')+'</div></div>';
  h += '<p class="text-blue-600 text-sm">展示给医生查看，搜索可快速查找药品。</p></div>';

  h += '<div id="docMedsList">';
  h += docListHTML(meds);
  h += '</div>';

  // Experience summary
  const ms = DB.members;
  const exps = DB.experiences.filter(e => e.doctorName);
  if (exps.length) {
    h += '<div class="bg-green-50 border border-green-100 rounded-xl p-4"><div class="text-green-800 font-semibold text-sm mb-3">📝 用药体验摘要</div>';
    ms.forEach(mb => {
      const mbExps = exps.filter(e => e.memberId === mb.id);
      if (!mbExps.length) return;
      h += '<div class="mb-3 last:mb-0"><div class="font-medium text-gray-700 text-sm mb-1">'+(MO[mb.relation]||'👤')+' '+esc(mb.name)+'</div><div class="space-y-1">';
      mbExps.slice(0,5).forEach(e => {
        const mns = getExpMedNames(e);
        h += '<div class="text-sm text-gray-600">👨‍⚕️'+esc(e.doctorName)+' · ⭐'+e.rating+' · '+esc(mns.join(' + '));
        if (e.effective) h += ' <span class="text-green-600">✅有效</span>';
        if (e.avoid) h += ' <span class="text-red-600">🚫避雷</span>';
        if (e.sideEffect) h += ' <span class="text-orange-500">(副作用:'+esc(e.sideEffect)+')</span>';
        h += '</div>';
      });
      h += '</div></div>';
    });
    h += '</div>';
  }

  // Avoid doctors warning
  const avoids = exps.filter(e => e.avoid);
  if (avoids.length) {
    const avoidDocs = {};
    avoids.forEach(e => { const dn = e.doctorName; if (!avoidDocs[dn]) avoidDocs[dn] = []; avoidDocs[dn].push(e); });
    h += '<div class="bg-red-50 border border-red-100 rounded-xl p-4"><div class="text-red-800 font-semibold text-sm mb-2">🚫 避雷提醒</div>';
    h += '<div class="text-xs text-red-600 space-y-1">';
    Object.entries(avoidDocs).forEach(([dn, es]) => {
      h += '<div>⚠️ <b>'+esc(dn)+'</b> ('+esc(es[0].hospital||'')+') — '+es.map(e=>esc(e.diagnosis||'未知')).join('、')+'</div>';
    });
    h += '</div></div>';
  }

  h += '<button onclick="exportText()" class="w-full py-3 bg-gray-800 text-white rounded-xl font-medium active:scale-[0.98] transition-all">📋 复制清单文字</button></div>';
  return h;
}
let docSearch = '';
function renderDocList() {
  const el = $('docMedsList'); if (!el) return;
  const allMeds = DB.medicines.filter(m => expSt(m.expiryDate).s !== 'expired');
  el.innerHTML = docListHTML(allMeds);
}
function docListHTML(allMeds) {
  const q = docSearch;
  const meds = q ? allMeds.filter(m => m.name.toLowerCase().includes(q)) : allMeds;
  if (!meds.length) return '<div class="text-center py-6 text-gray-400 text-sm">'+(q?'没有找到匹配的药品':'暂无药品')+'</div>';
  const groups = {};
  meds.forEach(m => { const c = m.category || '其他'; if (!groups[c]) groups[c] = []; groups[c].push(m); });
  let h = '';
  Object.keys(groups).sort().forEach(cat => {
    h += '<div class="bg-white rounded-xl p-4 shadow-sm border border-gray-100 mb-3"><div class="text-sm font-semibold text-gray-500 mb-2">'+cat+' ('+groups[cat].length+')</div><div class="space-y-2">';
    groups[cat].forEach(m => {
      h += '<div class="flex items-center justify-between py-1 border-b border-gray-50 last:border-0"><div><span class="font-medium text-gray-800">'+esc(m.name)+'</span>'+(m.efficacy?'<span class="text-gray-400 ml-2 text-sm">'+esc(m.efficacy)+'</span>':'')+'</div>';
      h += (m.quantity!=null?'<span class="text-sm font-medium shrink-0 ml-2 '+(m.quantity<=3?'text-red-500':'text-gray-500')+'">剩余'+m.quantity+(m.unit||'')+'</span>':'<span class="text-sm text-gray-300 shrink-0 ml-2">未记录</span>')+'</div>';
    });
    h += '</div></div>';
  });
  return h;
}
function exportText() {
  const meds = DB.medicines.filter(m => expSt(m.expiryDate).s !== 'expired');
  const groups = {};
  meds.forEach(m => { const c = m.category || '其他'; if (!groups[c]) groups[c] = []; groups[c].push(m); });
  let text = '📋 药小记 · 药品清单 (' + new Date().toLocaleDateString('zh-CN') + ')\n\n';
  Object.keys(groups).sort().forEach(cat => {
    text += '【' + cat + '】\n';
    groups[cat].forEach(m => { text += '  · ' + m.name; if(m.efficacy) text += ' - ' + m.efficacy; if(m.quantity!=null) text += ' (剩余'+m.quantity+(m.unit||'')+')'; text += '\n'; });
    text += '\n';
  });
  const exps = DB.experiences.filter(e => e.doctorName);
  if (exps.length) {
    text += '【用药体验】\n';
    exps.slice(0,10).forEach(e => {
      const mb = getMb(e.memberId), mns = getExpMedNames(e);
      text += '  '+(mb?mb.name:'')+' · '+e.doctorName+' · '+mns.join('+')+' · ⭐'+e.rating;
      if (e.effective) text += ' ✅有效';
      if (e.avoid) text += ' 🚫避雷';
      text += '\n';
    });
  }
  navigator.clipboard.writeText(text).then(() => toast('已复制到剪贴板')).catch(() => {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); toast('已复制到剪贴板');
  });
}

// ===== Init =====
(async () => { await initDB(); render(); })();

