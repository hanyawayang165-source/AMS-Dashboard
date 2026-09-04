/*************************************************************
 * ADAPTER NETLIFY — HANYA aktif kalau file ini dijalankan DI LUAR
 * Apps Script (google.script.run bawaan tidak tersedia). Meniru API
 * google.script.run.withSuccessHandler().withFailureHandler().fn(args)
 * memakai fetch() ke Web App Apps Script. Di dalam Apps Script
 * (script.google.com/.../exec), blok ini tidak melakukan apa-apa.
 *************************************************************/
(function initGasRunAdapter_() {
  if (typeof google !== 'undefined' && google.script && google.script.run) {
    return; // sedang jalan di dalam Apps Script -- pakai bawaan, shim nonaktif
  }

  // URL Deploy > Manage deployments > Web app di Apps Script Editor AMS.
  var GAS_WEBAPP_URL_ = 'https://script.google.com/macros/s/AKfycbwh9YcVNmGKG5sNIJ2oZ-DXH0XjOa7NF9H649Z7POe16gc2wXFM-R3lpdKZVsroXcO7oA/exec';

  // Peta nama fungsi -> urutan nama parameter yang diharapkan doPost() di Code.gs.
  // Kalau nanti ada fungsi BARU yang dipanggil lewat google.script.run tapi
  // belum terdaftar di sini, adapter akan memberi pesan error yang jelas
  // (bukan diam-diam gagal), supaya gampang diperbaiki.
  var GAS_PARAM_MAP_ = {
  getAllData: ['token', 'department'],
  getArchivedPeriods: ['token'],
  getArchivedData: ['periodKey', 'token'],
  getPeriodMeta: ['periodKey', 'token'],
  generateAttendanceLogExcel: ['periodKey', 'employeeName', 'dayStart', 'dayEnd', 'token'],
  archiveCurrentPeriod: ['token'],
  mulaiPeriodeBaru: ['token'],
  deleteArchivedPeriod: ['periodKey', 'token'],
  login: ['username', 'password'],
  logout: ['token'],
  saveJadwal: ['rowIndex', 'dayIndex', 'kode', 'token'],
  saveRealisasi: ['rowIndex', 'dayIndex', 'kode', 'token'],
  saveRealisasiBatch: ['updates', 'token'],
  addEmployee: ['nama', 'jabatan', 'nik', 'department', 'token'],
  deleteEmployee: ['nama', 'token', 'confirmDataLoss'],
  setEmployeeNik: ['nama', 'nik', 'token'],
  getDaftarKaryawan: ['token'],
  deleteUnassignedEmployee: ['namaList', 'token'],
  assignEmployeeToJadwal: ['namaList', 'token'],
  setEmployeeMasterData: ['nama', 'fields', 'token'],
  changeOwnPassword: ['oldPassword', 'newPassword', 'token'],
  generateJadwalTemplateExcel: ['token'],
  uploadJadwal: ['base64Data', 'filename', 'token'],
  uploadRealisasi: ['base64Data', 'filename', 'token'],
  uploadFingerAbsen: ['base64Data', 'filename', 'token'],
  exportSheetPdf: ['sheetName', 'token'],
  getUsersList: ['token'],
  getRolesList: ['token'],
  addUserWeb: ['nama', 'username', 'password', 'role', 'token'],
  setUserStatus: ['username', 'status', 'token'],
  resetUserPasswordByAdmin: ['username', 'newPassword', 'token'],
  getRolePermissionsMatrix: ['token'],
  setRolePermissions: ['roleName', 'menuKeys', 'token'],
  addRole: ['roleName', 'deskripsi', 'token'],
  getMyMenuPermissions: ['token'],
  generateReportExcel: ['reportType', 'title', 'columns', 'rows', 'token'],
  generateReportPdf: ['reportType', 'title', 'columns', 'rows', 'token'],
  confirmSendEmailReport: ['tglMulai', 'tglAkhir', 'tujuanEmail', 'token'],
  getJamKerjaSettings: ['token'], setJamKerjaSettings: ['settings', 'token'],
  chatWithAI: ['pesan', 'token'],
  getPengajuanPendingCount: ['token'],
  getPengajuanList: ['status', 'token'],
  getPengajuanListSafe: ['status', 'token'],
  approvePengajuan: ['id', 'token'],
  getAuditLog: ['token', 'filter'],
  rejectPengajuan: ['id', 'catatan', 'token']
};
  function callGasAction_(actionName, args, onSuccess, onFailure) {
    var paramNames = GAS_PARAM_MAP_[actionName];
    if (!paramNames) {
      const msg = 'Adapter Netlify: aksi "' + actionName + '" belum terdaftar di GAS_PARAM_MAP_ (app.js).';
      console.error(msg);
      if (onFailure) onFailure({ message: msg });
      return;
    }
    var body = { action: actionName };
    paramNames.forEach(function (name, i) { body[name] = args[i]; });

    fetch(GAS_WEBAPP_URL_, {
      method: 'POST',
      // WAJIB text/plain (bukan application/json) supaya browser tidak
      // melakukan preflight OPTIONS -- Apps Script tidak bisa menjawabnya.
      // Lihat catatan CORS di kepala Code.gs.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    })
      .then(function (res) { return res.json(); })
      .then(function (json) {
        if (json.success) { if (onSuccess) onSuccess(json.data); }
        else { if (onFailure) onFailure({ message: json.error || 'Terjadi kesalahan di server.' }); }
      })
      .catch(function (err) {
        if (onFailure) onFailure({ message: 'Gagal terhubung ke server Apps Script: ' + err.message });
      });
  }

  function makeRunProxy_(successFn, failureFn) {
    return new Proxy({}, {
      get: function (target, prop) {
        if (prop === 'withSuccessHandler') return function (fn) { return makeRunProxy_(fn, failureFn); };
        if (prop === 'withFailureHandler') return function (fn) { return makeRunProxy_(successFn, fn); };
        return function () {
          callGasAction_(prop, Array.prototype.slice.call(arguments), successFn, failureFn);
        };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = makeRunProxy_(null, null);
})();

  let STATE = null;
  let SESSION = null; // { token, username, nama, role }
  const POLL_INTERVAL_MS = 20000;
  let pollTimer = null;
  const SESSION_STORAGE_KEY = 'rekap_session_v1';
  let currentViewPeriodKey = 'active'; // 'active' atau periodKey arsip
  let currentDeptFilter = 'ALL'; // 'ALL' atau nama Department yang dipilih di dropdown
  let avgJamKerjaMode = 'hari'; // 'hari' | 'minggu' | 'bulan' — untuk card Rata-rata Jam Kerja / Orang

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    document.getElementById('hamburgerBtn').addEventListener('click', openSidebar);
    document.getElementById('sidebarCloseBtn').addEventListener('click', closeSidebar);
    document.getElementById('sidebarOverlay').addEventListener('click', closeSidebar);
    document.getElementById('pickerCancel').addEventListener('click', closePicker);
    document.getElementById('gateLoginSubmit').addEventListener('click', submitGateLogin);
    document.getElementById('gatePassword').addEventListener('keydown', e => { if (e.key === 'Enter') submitGateLogin(); });
    document.getElementById('addEmployeeCancel').addEventListener('click', closeAddEmployeePicker);
    document.getElementById('addEmployeeSubmit').addEventListener('click', submitAddEmployee);
    document.getElementById('deleteArchiveCancel').addEventListener('click', closeDeleteArchivePicker);
    document.getElementById('deleteArchiveSubmit').addEventListener('click', submitDeleteArchive);
    document.getElementById('deleteArchiveConfirmInput').addEventListener('keydown', e => { if (e.key === 'Enter') submitDeleteArchive(); });
    document.getElementById('deleteEmployeeCancel').addEventListener('click', closeDeleteEmployeePicker);
    document.getElementById('deleteEmployeeSubmit').addEventListener('click', submitDeleteEmployee);
    document.getElementById('nikCancel').addEventListener('click', closeNikPicker);
    document.getElementById('nikSubmit').addEventListener('click', submitNik);
    document.getElementById('karyawanCancel').addEventListener('click', closeKaryawanPicker);
    document.getElementById('karyawanSubmit').addEventListener('click', submitKaryawanData);
    document.getElementById('changePasswordCancel').addEventListener('click', closeChangePasswordPicker);
    document.getElementById('changePasswordSubmit').addEventListener('click', submitChangePassword);
    document.getElementById('nikInput').addEventListener('keydown', e => { if (e.key === 'Enter') submitNik(); });
    document.getElementById('refreshBtn').addEventListener('click', () => loadData(true));
    document.getElementById('aiChatSend').addEventListener('click', sendAIChatMessage);
    document.getElementById('aiChatClose').addEventListener('click', closeAIChatPicker);
    document.getElementById('aiChatInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendAIChatMessage(); });
    initAIChatDrag_();
    document.getElementById('addUserCancel').addEventListener('click', closeAddUserPicker);
    document.getElementById('addUserSubmit').addEventListener('click', submitAddUser);
    document.getElementById('resetUserPasswordCancel').addEventListener('click', closeResetUserPasswordPicker);
    document.getElementById('resetUserPasswordSubmit').addEventListener('click', submitResetUserPassword);
    document.getElementById('addRoleCancel').addEventListener('click', closeAddRolePicker);
    document.getElementById('addRoleSubmit').addEventListener('click', submitAddRole);
    document.getElementById('rejectPengajuanCancel').addEventListener('click', closeRejectPengajuanPicker);
    document.getElementById('rejectPengajuanSubmit').addEventListener('click', submitRejectPengajuan);
    restoreSession();
  });

const TAB_TITLES_ = {
  dashboard: 'Dashboard', jadwal: 'Jadwal Kerja', input: 'Input Realisasi',
  pengajuanizin: 'Pengajuan Izin', // ===== TAMBAHAN PENGAJUAN IZIN =====
  rekap: 'Rekap Karyawan', logabsensi: 'Log Absensi', daftarkaryawan: 'Daftar Karyawan',
  reportsummary: 'Summary Report', reportdetail: 'Detail Report',
  reportdept: 'Department Report', reportexception: 'Exception Report',
  settingaccount: 'Setting - Account', settinghakakses: 'Setting - Hak Akses',
  settingjamkerja: 'Setting - Jam Kerja', settingjadwalkerja: 'Setting - Jadwal Kerja',
  settingassignjadwal: 'Setting - Assign Karyawan ke Jadwal',
  settinglibur: 'Setting - Hari Libur', settingfingerprint: 'Setting - Integrasi Fingerprint',
  settingauditlog: 'Setting - Audit Log'
};

  function initTabs() {
    document.querySelectorAll('.nav-group-toggle').forEach(toggle => {
      toggle.addEventListener('click', () => {
        const group = toggle.closest('.nav-group');
        const wasOpen = group.classList.contains('open');
        document.querySelectorAll('.nav-group').forEach(g => g.classList.remove('open'));
        if (!wasOpen) group.classList.add('open');
      });
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectTab_(btn.dataset.tab);
        closeSidebar();
      });
    });
  }

  function selectTab_(tabName) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
    const content = document.getElementById('tab-' + tabName);
    if (btn) btn.classList.add('active');
    if (content) content.classList.add('active');

    const parentGroup = btn ? btn.closest('.nav-group') : null;
    document.querySelectorAll('.nav-group').forEach(g => g.classList.remove('open'));
    if (parentGroup) parentGroup.classList.add('open');

    const titleEl = document.getElementById('topbarTabTitle');
    if (titleEl) titleEl.textContent = TAB_TITLES_[tabName] || 'Dashboard';

    if (tabName === 'daftarkaryawan') loadDaftarKaryawan();
    if (tabName === 'pengajuanizin') loadPengajuanList_(); // ===== TAMBAHAN PENGAJUAN IZIN =====
    if (tabName.indexOf('report') === 0) initReportFilters_(tabName);
    if (tabName === 'settingaccount') loadUsersList();
    if (tabName === 'settingjamkerja') loadJamKerjaSettings();
    if (tabName === 'settinghakakses') loadHakAksesMatrix();
    if (tabName === 'settingassignjadwal') loadUnassignedEmployees_();
    if (tabName === 'settingauditlog') loadAuditLog_();
  }

  function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebarOverlay').classList.add('open');
  }

  function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('open');
  }

  function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (SESSION && currentViewPeriodKey === 'active') loadData(false); // jangan polling kalau sedang lihat arsip / belum login
    }, POLL_INTERVAL_MS);
  }

  /** Deteksi pesan error yang berarti sesi login sudah tidak valid, supaya otomatis diarahkan balik ke gate. */
  function isAuthError_(message) {
    const m = String(message || '');
    return m.indexOf('login') !== -1 || m.indexOf('Sesi') !== -1;
  }

  function loadData(showToast) {
    if (!SESSION) { showLoginGate(); return; }
    if (currentViewPeriodKey !== 'active') {
      loadArchivedData_(currentViewPeriodKey, showToast);
      return;
    }
    google.script.run
      .withSuccessHandler(data => {
        STATE = data;
        renderAll();
        if (showToast) toast('Data terbaru dimuat');
      })
      .withFailureHandler(err => {
        toast('Gagal memuat data: ' + err.message, true);
        if (isAuthError_(err.message)) doLogout();
      })
      .getAllData(SESSION.token, currentDeptFilter);
  }
  /* ============ ARSIP PERIODE ============ */

  function loadArchivedPeriodsList() {
    if (!SESSION) return;
    google.script.run
      .withSuccessHandler(list => {
        const optionsHtml = '<option value="active">Periode Aktif</option>' +
          list.map(p => `<option value="${escapeHtml(p.key)}">📁 ${escapeHtml(p.period)}</option>`).join('');

        const sel = document.getElementById('periodSelector');
        const prevValue = sel.value;
        sel.innerHTML = optionsHtml;
        if (sel.querySelector(`option[value="${prevValue}"]`)) sel.value = prevValue;

        const logSel = document.getElementById('logPeriodSelect');
        if (logSel) {
          const prevLog = logSel.value;
          logSel.innerHTML = optionsHtml;
          logSel.value = selectHasOption_(logSel, prevLog) ? prevLog : 'active';
          onLogPeriodChange();
        }
      })
      .withFailureHandler(() => { /* diamkan kalau gagal, tidak kritikal */ })
      .getArchivedPeriods(SESSION.token);
  }
/** Dipakai SEMUA success handler mutasi (save cell, upload, tambah/hapus karyawan, dst)
 *  supaya filter Department yang sedang aktif tetap "nempel" setelah aksi apapun,
 *  bukannya balik ke "Semua Department" karena backend selalu balikin data unfiltered. */
function applyStateAndRerender_(data) {
  if (currentDeptFilter && currentDeptFilter !== 'ALL' && currentViewPeriodKey === 'active') {
    google.script.run
      .withSuccessHandler(filteredData => {
        STATE = filteredData;
        renderAll();
      })
      .withFailureHandler(err => {
        STATE = data;
        renderAll();
        toast('Aksi berhasil, tapi gagal menerapkan ulang filter Department: ' + err.message, true);
      })
      .getAllData(SESSION.token, currentDeptFilter);
  } else {
    STATE = data;
    renderAll();
  }
}

function populateDepartmentFilterOptions_() {
  const sel = document.getElementById('departmentFilterSelector');
  if (!sel) return;
  const depts = Array.from(new Set(
    (DAFTAR_KARYAWAN_DATA || []).map(k => (k.department || '').trim()).filter(Boolean)
  )).sort();
  const prevValue = sel.value || currentDeptFilter;
  sel.innerHTML = '<option value="ALL">Semua Department</option>' +
    depts.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('');
  sel.value = selectHasOption_(sel, prevValue) ? prevValue : 'ALL';
  currentDeptFilter = sel.value;
}

function onDepartmentFilterChange() {
  currentDeptFilter = document.getElementById('departmentFilterSelector').value;
  if (currentViewPeriodKey !== 'active') {
    toast('Filter Department saat ini hanya berlaku untuk Periode Aktif.', true);
  }
  loadData(true);
}
  /* ============ LAPORAN LOG ABSENSI (EXCEL) ============ */

  function selectHasOption_(selectEl, value) {
    return Array.from(selectEl.options).some(o => o.value === value);
  }

  function onLogPeriodChange() {
    if (!SESSION) return;
    const periodKey = document.getElementById('logPeriodSelect').value;
    google.script.run
      .withSuccessHandler(meta => {
        populateLogEmployeeOptions_(meta.employees);
        populateLogDayOptions_(meta.dayCount, meta.dayNames);
      })
      .withFailureHandler(err => toast('Gagal memuat data periode: ' + err.message, true))
      .getPeriodMeta(periodKey, SESSION.token);
  }

  function populateLogEmployeeOptions_(employees) {
    const sel = document.getElementById('logEmployeeSelect');
    const prevValue = sel.value;
    sel.innerHTML = '<option value="ALL">Semua Karyawan</option>' +
      employees.map(e => `<option value="${escapeHtml(e.nama)}">${escapeHtml(e.nama)} (${escapeHtml(e.jabatan)})</option>`).join('');
    sel.value = selectHasOption_(sel, prevValue) ? prevValue : 'ALL';
  }

  function populateLogDayOptions_(dayCount, dayNames) {
    const startSel = document.getElementById('logDayStart');
    const endSel = document.getElementById('logDayEnd');
    let optionsHtml = '';
    for (let i = 0; i < dayCount; i++) {
      optionsHtml += `<option value="${i + 1}">${i + 1} ${escapeHtml(dayNames[i] || '')}</option>`;
    }
    startSel.innerHTML = optionsHtml;
    endSel.innerHTML = optionsHtml;
    startSel.value = '1';
    endSel.value = String(dayCount);
  }

  function downloadAttendanceLog() {
    const periodKey = document.getElementById('logPeriodSelect').value;
    const employeeName = document.getElementById('logEmployeeSelect').value;
    const dayStart = parseInt(document.getElementById('logDayStart').value, 10);
    const dayEnd = parseInt(document.getElementById('logDayEnd').value, 10);

    if (!dayStart || !dayEnd || dayStart > dayEnd) {
      toast('Rentang tanggal tidak valid', true);
      return;
    }

    const btn = document.getElementById('downloadLogBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Membuat Excel...';

    google.script.run
      .withSuccessHandler(result => {
        btn.disabled = false;
        btn.textContent = '⬇ Download Excel';
        triggerBase64Download(result.base64, result.filename, result.mimeType);
        toast('Excel berhasil dibuat: ' + result.filename);
      })
      .withFailureHandler(err => {
        btn.disabled = false;
        btn.textContent = '⬇ Download Excel';
        toast('Gagal membuat Excel: ' + err.message, true);
      })
      .generateAttendanceLogExcel(periodKey, employeeName, dayStart, dayEnd, SESSION.token);
  }

  function onPeriodSelectorChange() {
    currentViewPeriodKey = document.getElementById('periodSelector').value;
    updateArchiveModeUI_();
    loadData(true);
  }

  function loadArchivedData_(periodKey, showToast) {
    if (!SESSION) { showLoginGate(); return; }
    google.script.run
      .withSuccessHandler(data => {
        STATE = data;
        renderAll();
        if (showToast) toast('Data arsip "' + data.period + '" dimuat');
      })
      .withFailureHandler(err => {
        toast('Gagal memuat data arsip: ' + err.message, true);
        if (isAuthError_(err.message)) doLogout();
      })
      .getArchivedData(periodKey, SESSION.token);
  }

  function updateArchiveModeUI_() {
    const viewingArchive = currentViewPeriodKey !== 'active';
    document.getElementById('archiveBanner').classList.toggle('hidden', !viewingArchive);
    const deleteBtn = document.getElementById('deleteArchiveBtn');
    if (deleteBtn) {
      const canDelete = viewingArchive && !!SESSION && SESSION.role === 'Super Admin';
      deleteBtn.classList.toggle('hidden', !canDelete);
    }
    const deptSel = document.getElementById('departmentFilterSelector');
    if (deptSel) deptSel.disabled = viewingArchive;
    updateInputEditability();
  }
  function triggerArchivePeriod() {
    if (!SESSION || SESSION.role !== 'Super Admin') {
      toast('Hanya admin yang boleh mengarsipkan periode', true);
      return;
    }
    const periodLabel = (STATE && STATE.period) ? STATE.period : 'periode aktif saat ini';
    const confirmed = confirm(
      'Arsipkan data "' + periodLabel + '" sekarang?\n\n' +
      'Ini akan menyimpan salinan Jadwal, Realisasi, Dashboard, dan Rekap saat ini ' +
      'supaya bisa dilihat lagi nanti. Data aktif TIDAK akan dihapus/direset oleh proses ini.'
    );
    if (!confirmed) return;

    const btn = document.getElementById('archiveBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Mengarsipkan...';

    google.script.run
      .withSuccessHandler(res => {
        btn.disabled = false;
        btn.textContent = '🗄 Arsipkan Periode Ini';
        toast('Periode "' + res.period + '" berhasil diarsipkan');
        loadArchivedPeriodsList();
      })
      .withFailureHandler(err => {
        btn.disabled = false;
        btn.textContent = '🗄 Arsipkan Periode Ini';
        toast('Gagal mengarsipkan: ' + err.message, true);
      })
      .archiveCurrentPeriod(SESSION.token);
  }
  function triggerMulaiPeriodeBaru() {
  if (!SESSION || SESSION.role !== 'Super Admin') {
    toast('Hanya admin yang boleh memulai periode baru', true);
    return;
  }
  const periodLabel = (STATE && STATE.period) ? STATE.period : 'periode aktif saat ini';
  const confirmed = confirm(
    'Mulai periode baru?\n\n' +
    'Ini akan OTOMATIS:\n' +
    '1) Mengarsipkan data "' + periodLabel + '" (aman, tersimpan di arsip)\n' +
    '2) Mengosongkan Jadwal & Realisasi untuk bulan berikutnya\n\n' +
    'Setelah ini, Anda tetap perlu mengisi/upload Jadwal shift untuk bulan baru. Lanjutkan?'
  );
  if (!confirmed) return;

  const btn = document.getElementById('mulaiPeriodeBaruBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Memproses...';

  google.script.run
    .withSuccessHandler(data => {
      btn.disabled = false;
      btn.textContent = '🔄 Mulai Periode Baru';
      applyStateAndRerender_(data);
      loadArchivedPeriodsList();
      const info = data.mulaiPeriodeBaruInfo;
      if (info) {
        toast('Periode "' + info.periodeLama + '" diarsipkan. Periode aktif sekarang: "' + info.periodeBaru + '" (' + info.jumlahHari + ' hari). Silakan upload Jadwal shift baru.');
      }
    })
    .withFailureHandler(err => {
      btn.disabled = false;
      btn.textContent = '🔄 Mulai Periode Baru';
      toast('Gagal memulai periode baru: ' + err.message, true);
    })
    .mulaiPeriodeBaru(SESSION.token);
}
  /* ============ HAPUS ARSIP (PERMANEN) ============ */

  let deleteArchiveTarget = null;

  function triggerDeleteArchive() {
    if (currentViewPeriodKey === 'active') return;
    if (!SESSION || SESSION.role !== 'Super Admin') {
      toast('Hanya admin yang boleh menghapus arsip', true);
      return;
    }
    const periodLabel = (STATE && STATE.period) ? STATE.period : currentViewPeriodKey;
    deleteArchiveTarget = { periodKey: currentViewPeriodKey, periodLabel: periodLabel };

    document.getElementById('deleteArchiveWarning').textContent =
      'Anda akan menghapus PERMANEN arsip periode "' + periodLabel + '" beserta semua sheet Jadwal/Realisasi/Dashboard/Rekap-nya. Tindakan ini TIDAK BISA DIBATALKAN. Untuk melanjutkan, ketik ulang persis nama periode di atas pada kolom di bawah:';
    document.getElementById('deleteArchiveConfirmInput').value = '';
    document.getElementById('deleteArchiveError').textContent = '';
    document.getElementById('deleteArchivePicker').classList.remove('hidden');
    document.getElementById('deleteArchiveConfirmInput').focus();
  }

  function closeDeleteArchivePicker() {
    document.getElementById('deleteArchivePicker').classList.add('hidden');
    deleteArchiveTarget = null;
  }

  function submitDeleteArchive() {
    if (!deleteArchiveTarget || !SESSION) return;
    const typed = document.getElementById('deleteArchiveConfirmInput').value.trim();
    if (typed !== deleteArchiveTarget.periodLabel) {
      document.getElementById('deleteArchiveError').textContent = 'Teks yang diketik tidak cocok dengan nama periode. Coba lagi.';
      return;
    }

    const btn = document.getElementById('deleteArchiveSubmit');
    btn.disabled = true;
    btn.textContent = '⏳ Menghapus...';

    google.script.run
      .withSuccessHandler(res => {
        btn.disabled = false;
        btn.textContent = 'Hapus Permanen';
        closeDeleteArchivePicker();
        toast('Arsip periode "' + res.period + '" berhasil dihapus permanen');
        currentViewPeriodKey = 'active';
        document.getElementById('periodSelector').value = 'active';
        updateArchiveModeUI_();
        loadData(true);
        loadArchivedPeriodsList();
      })
      .withFailureHandler(err => {
        btn.disabled = false;
        btn.textContent = 'Hapus Permanen';
        document.getElementById('deleteArchiveError').textContent = err.message;
      })
      .deleteArchivedPeriod(deleteArchiveTarget.periodKey, SESSION.token);
  }

  /* ============ AUTH (Login Gate — seluruh tampilan wajib login) ============ */

      function restoreSession() {
    let stored = null;
    try {
      const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (raw) stored = JSON.parse(raw);
    } catch (e) { stored = null; }

    if (!stored || !stored.token) {
      showLoginGate();
      return;
    }

    SESSION = stored;
    showAppShell();
    postLoginLoad_();
  }
  function showLoginGate() {
    if (pollTimer) clearInterval(pollTimer);
    document.getElementById('appShell').classList.add('hidden');
    document.getElementById('loginGate').classList.remove('hidden');
    document.getElementById('gateUsername').value = '';
    document.getElementById('gatePassword').value = '';
    document.getElementById('gateLoginError').textContent = '';
    setTimeout(() => {
      const el = document.getElementById('gateUsername');
      if (el) el.focus();
    }, 50);
  }

  function showAppShell() {
    document.getElementById('loginGate').classList.add('hidden');
    document.getElementById('appShell').classList.remove('hidden');
    renderAuthArea();
    applyMenuPermissions_();
  }

  function renderAuthArea() {
    const el = document.getElementById('authArea');
    if (SESSION) {
      el.innerHTML = `
      <span class="user-badge">
        👤 ${escapeHtml(SESSION.nama)} <span class="role-tag">${escapeHtml(SESSION.role)}</span>
      </span>
      <button class="btn btn-ghost" onclick="openChangePasswordPicker()">🔑 Ganti Password</button>
      <button class="btn btn-logout" onclick="doLogout()">Logout</button>`;
    } else {
      el.innerHTML = '';
    }
    updateInputEditability();
  }
  function postLoginLoad_(retriesLeft) {
    if (retriesLeft === undefined) retriesLeft = 6;
    google.script.run
      .withSuccessHandler(data => {
        STATE = data;
        renderAll();
        loadArchivedPeriodsList();
        startPolling();
        startPengajuanBadgePolling_();
        loadUnassignedEmployees_();
      })
      .withFailureHandler(err => {
        if (retriesLeft > 0 && isAuthError_(err.message)) {
          setTimeout(() => postLoginLoad_(retriesLeft - 1), 1200);
        } else {
          toast('Gagal memuat data: ' + err.message, true);
          if (isAuthError_(err.message)) doLogout();
        }
      })
      .getAllData(SESSION.token, currentDeptFilter);
  }
      function submitGateLogin() {
    const username = document.getElementById('gateUsername').value.trim();
    const password = document.getElementById('gatePassword').value;
    if (!username || !password) {
      document.getElementById('gateLoginError').textContent = 'Username dan password wajib diisi.';
      return;
    }
    const btn = document.getElementById('gateLoginSubmit');
    btn.disabled = true;
    btn.textContent = 'Memproses...';

    google.script.run
      .withSuccessHandler(res => {
        btn.disabled = false;
        btn.textContent = 'Masuk';
        SESSION = res;
        try {
          sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(SESSION));
        } catch (e) {
          console.warn('sessionStorage tidak bisa diakses (diblokir browser), sesi tetap jalan di memori:', e);
        }
        showAppShell();
        toast('Login berhasil, selamat datang ' + res.nama);
        postLoginLoad_();
      })
      .withFailureHandler(err => {
        btn.disabled = false;
        btn.textContent = 'Masuk';
        document.getElementById('gateLoginError').textContent = err.message;
      })
      .login(username, password);
  }
  function doLogout() {
    const token = SESSION ? SESSION.token : null;
    SESSION = null;
    if (pengajuanBadgePollTimer) clearInterval(pengajuanBadgePollTimer); // ===== TAMBAHAN PENGAJUAN IZIN =====
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch (e) {
      console.warn('sessionStorage tidak bisa diakses (diblokir browser):', e);
    }
    showLoginGate();
    toast('Anda telah logout');
    if (token) google.script.run.logout(token);
  }

  function updateInputEditability() {
    const isArchiveView = currentViewPeriodKey !== 'active';
    const canEdit = !!SESSION && !isArchiveView;
    const canEditJadwal = !!SESSION && SESSION.role === 'Super Admin' && !isArchiveView;

    document.querySelectorAll('#tab-input .day-cell').forEach(cell => {
      cell.classList.toggle('editable', canEdit);
      cell.classList.toggle('locked', !canEdit);
    });

    document.querySelectorAll('#tab-jadwal .day-cell').forEach(cell => {
      cell.classList.toggle('editable', canEditJadwal);
      cell.classList.toggle('locked', !canEditJadwal);
    });

    const hint = document.getElementById('inputHint');
    if (hint) {
      if (isArchiveView) {
        hint.textContent = 'Anda sedang melihat data arsip (read-only) — data tidak bisa diubah. Pilih "Periode Aktif" untuk kembali mengedit.';
      } else if (SESSION) {
        hint.textContent = SESSION.role === 'Super Admin'
          ? 'Klik sel pada tabel untuk mengubah status kehadiran, atau upload file Excel sekaligus lewat tombol di atas.'
          : 'Klik sel pada tabel untuk mengubah status kehadiran karyawan di tanggal tersebut.';
      } else {
        hint.textContent = 'Anda harus login dulu (tombol 🔒 Login di kanan atas) untuk bisa mengubah data.';
      }
    }

    const jadwalHint = document.getElementById('uploadHint');
    if (jadwalHint) {
      jadwalHint.textContent = isArchiveView
        ? 'Anda sedang melihat data arsip (read-only).'
        : (canEditJadwal
          ? 'Klik sel untuk ubah shift langsung. Atau download template Excel kosong, isi manual, lalu upload lagi. Karyawan dicocokkan berdasarkan nama.'
          : 'Login sebagai admin untuk bisa mengubah Jadwal, tambah karyawan, atau upload file.');
    }

    const uploadBtn = document.getElementById('uploadJadwalBtn');
    if (uploadBtn) uploadBtn.disabled = isArchiveView;

    const uploadRealisasiBtn = document.getElementById('uploadRealisasiBtn');
    if (uploadRealisasiBtn) uploadRealisasiBtn.disabled = isArchiveView;
    const uploadFingerBtn = document.getElementById('uploadFingerBtn');
    if (uploadFingerBtn) uploadFingerBtn.disabled = isArchiveView;
    const addEmployeeBtn = document.getElementById('addEmployeeBtn');
    if (addEmployeeBtn) addEmployeeBtn.classList.toggle('hidden', !canEditJadwal);
    const deleteEmployeeBtn = document.getElementById('deleteEmployeeBtn');
    if (deleteEmployeeBtn) deleteEmployeeBtn.classList.toggle('hidden', !canEditJadwal);
    const canArchive = !!SESSION && SESSION.role === 'Super Admin' && !isArchiveView;

    const archiveBtn = document.getElementById('archiveBtn');
    if (archiveBtn) {
      archiveBtn.classList.toggle('hidden', !canArchive);
    }

    const mulaiPeriodeBaruBtn = document.getElementById('mulaiPeriodeBaruBtn');
    if (mulaiPeriodeBaruBtn) {
      mulaiPeriodeBaruBtn.classList.toggle('hidden', !canArchive);
    }
  }

  /* ============ RENDER ============ */

  function renderAll() {
    const archiveTag = STATE.isArchived ? ' 📁 (ARSIP)' : '';
    document.getElementById('periodText').textContent =
      'Departemen Housekeeping - PT Swadharma Primautama  |  ' + (STATE.period || '') + archiveTag +
      (STATE.departmentFilter ? ('  |  Department: ' + STATE.departmentFilter) : '');
    document.getElementById('lastUpdate').textContent =
      'Update: ' + new Date(STATE.lastUpdate).toLocaleTimeString('id-ID');
    renderAlignmentWarnings_();
    renderCards();
    renderLegend('legendJadwal', STATE.shiftCodes);
    renderLegend('legendRealisasi', STATE.statusCodes);
    const jadwalEditable = !!SESSION && SESSION.role === 'Super Admin' && currentViewPeriodKey === 'active';
    renderGrid('jadwalWrap', STATE.jadwal, STATE.dayCount, STATE.dayNames, STATE.shiftCodes, jadwalEditable, 'jadwal');
    renderGrid('realisasiWrap', STATE.realisasi, STATE.dayCount, STATE.dayNames, STATE.statusCodes, true, 'realisasi');
    renderRekapTable('rekapWrap', STATE.rekap, true);
    renderRekapTable('dashRekapWrap', STATE.rekap, false);
    renderCharts();
    renderRankLists();
    updateInputEditability();
    filterJadwalTable();
    filterRealisasiTable();
    filterRekapTable();
  }
  /* ============ PENCARIAN / FILTER NAMA KARYAWAN ============ */

  function filterJadwalTable() {
    filterTableByName_('jadwalWrap', 'searchJadwal');
  }

  function filterRealisasiTable() {
    filterTableByName_('realisasiWrap', 'searchRealisasi');
  }

  function filterRekapTable() {
    filterTableByName_('rekapWrap', 'searchRekap');
  }

  function filterTableByName_(wrapId, searchInputId) {
    const input = document.getElementById(searchInputId);
    if (!input) return;
    const query = input.value.trim().toLowerCase();

    const wrap = document.getElementById(wrapId);
    if (!wrap) return;
    const rows = wrap.querySelectorAll('tbody tr');
    let visibleCount = 0;

    rows.forEach(tr => {
      const name = tr.dataset.name || '';
      const match = !query || name.includes(query);
      tr.style.display = match ? '' : 'none';
      if (match) visibleCount++;
    });

    // Tampilkan pesan "tidak ditemukan" kalau hasil pencarian kosong
    let emptyRow = wrap.querySelector('.no-results-row');
    const tbody = wrap.querySelector('tbody');
    if (tbody) {
      if (query && visibleCount === 0) {
        if (!emptyRow) {
          const colCount = (wrap.querySelector('thead tr') || {}).children ? wrap.querySelector('thead tr').children.length : 5;
          emptyRow = document.createElement('tr');
          emptyRow.className = 'no-results-row';
          emptyRow.innerHTML = `<td colspan="${colCount}">Tidak ada karyawan dengan nama "${escapeHtml(input.value.trim())}"</td>`;
          tbody.appendChild(emptyRow);
        }
      } else if (emptyRow) {
        emptyRow.remove();
      }
    }
  }

  /* ============ CHARTS (Tren Harian, Plan vs Actual, Jam Kerja & Lembur) ============ */

  let chartTrenHarian = null;
  let chartPlanActual = null;
  let chartJamKerja = null;
  let chartAbsenPie = null;
  let currentPeriod = 'all';   // 'all' atau 'week-0', 'week-1', dst
  let currentTrenType = 'line'; // 'line' atau 'bar'

  function ensurePeriodOptions(dayCount) {
    const sel = document.getElementById('periodFilter');
    if (sel.dataset.builtFor === String(dayCount)) return;
    const weeks = Math.ceil(dayCount / 7);
    let html = `<option value="all">Semua Hari (1-${dayCount})</option>`;
    for (let w = 0; w < weeks; w++) {
      const start = w * 7 + 1;
      const end = Math.min((w + 1) * 7, dayCount);
      html += `<option value="week-${w}">Minggu ${w + 1} (Tgl ${start}-${end})</option>`;
    }
    sel.innerHTML = html;
    sel.dataset.builtFor = String(dayCount);
    sel.value = (currentPeriod === 'all' || sel.querySelector(`option[value="${currentPeriod}"]`)) ? currentPeriod : 'all';
    currentPeriod = sel.value;
  }

  function getPeriodIndices(dayCount) {
    if (currentPeriod === 'all') {
      return Array.from({ length: dayCount }, (_, i) => i);
    }
    const w = parseInt(currentPeriod.split('-')[1], 10);
    const start = w * 7;
    const end = Math.min(start + 7, dayCount);
    return Array.from({ length: Math.max(end - start, 0) }, (_, i) => start + i);
  }

  function onPeriodFilterChange() {
    currentPeriod = document.getElementById('periodFilter').value;
    renderCharts();
  }

  function onChartTypeChange() {
    currentTrenType = document.getElementById('trenChartType').value;
    renderCharts();
  }

  /**
   * Cari card pembungkus canvas "Plan vs Actual" (referensi posisi yang sudah
   * ada di Index.html), lalu sisipkan card baru berisi canvas untuk grafik
   * Jam Kerja & Lembur tepat setelahnya. Dibuat sekali saja (idempotent) —
   * kalau elemennya sudah ada, langsung dipakai lagi tanpa dibuat ulang.
   * Ini membuat Index.html TIDAK PERLU diedit sama sekali.
   */
  function ensureJamKerjaChartCard_() {
    let canvas = document.getElementById('chartJamKerja');
    if (canvas) return canvas;

    const refCanvas = document.getElementById('chartPlanActual') || document.getElementById('chartTrenHarian');
    if (!refCanvas) return null; // halaman belum siap / struktur tidak ditemukan

    // Cari elemen "card" pembungkus canvas referensi (naik maksimal 3 level cari class 'card')
    let refCard = refCanvas;
    for (let i = 0; i < 4; i++) {
      if (!refCard.parentElement) break;
      refCard = refCard.parentElement;
      if (refCard.classList && (refCard.classList.contains('card') || refCard.classList.contains('chart-card') || refCard.classList.contains('panel'))) break;
    }

    const newCard = document.createElement('div');
    newCard.className = refCard.className || 'card';
    newCard.id = 'jamKerjaChartCard';
    newCard.innerHTML = `
      <h3 style="margin:0 0 10px;font-size:14px;color:#1e293b;">⏱ Tren Jam Kerja &amp; Lembur Harian</h3>
      <div style="position:relative;height:260px;">
        <canvas id="chartJamKerja"></canvas>
      </div>
    `;

    if (refCard.parentElement) {
      refCard.parentElement.insertBefore(newCard, refCard.nextSibling);
    } else {
      // fallback: taruh setelah referensi langsung kalau parent tidak ditemukan
      refCanvas.parentElement.appendChild(newCard);
    }

    return document.getElementById('chartJamKerja');
  }

  function renderCharts() {
    if (typeof Chart === 'undefined' || !STATE.trenHarian) return;
    const t = STATE.trenHarian;
    ensurePeriodOptions(t.dayCount);
    const idx = getPeriodIndices(t.dayCount);
    const pick = arr => idx.map(i => arr[i]);
    const labels = idx.map(i => (i + 1) + ' ' + (t.dayNames[i] || ''));

    const trenCtx = document.getElementById('chartTrenHarian');
    if (chartTrenHarian) chartTrenHarian.destroy();
    chartTrenHarian = new Chart(trenCtx, {
      type: currentTrenType,
      data: {
        labels: labels,
        datasets: [
          { label: 'Hadir', data: pick(t.hadir), borderColor: '#22c55e', backgroundColor: '#22c55e', tension: 0.25, pointRadius: 2, fill: false }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
        plugins: { legend: { display: false } }
      }
    });

    const planCtx = document.getElementById('chartPlanActual');
    if (chartPlanActual) chartPlanActual.destroy();
    chartPlanActual = new Chart(planCtx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          { label: 'Plan (Terjadwal)', data: pick(t.planCount), backgroundColor: '#93c5fd' },
          { label: 'Actual (Hadir)', data: pick(t.actualCount), backgroundColor: '#2563eb' }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } }
      }
    });

    // Grafik: Tren Jam Kerja (garis, sumbu kiri) & Jumlah Lembur (bar, sumbu kanan)
    if (t.totalJamKerjaPerHari && t.lembur) {
      const jkCanvas = ensureJamKerjaChartCard_();
      if (jkCanvas) {
        if (chartJamKerja) chartJamKerja.destroy();
        chartJamKerja = new Chart(jkCanvas, {
          data: {
            labels: labels,
            datasets: [
              {
                type: 'line',
                label: 'Total Jam Kerja (jam)',
                data: pick(t.totalJamKerjaPerHari),
                borderColor: '#0ea5e9',
                backgroundColor: '#0ea5e9',
                tension: 0.25,
                pointRadius: 2,
                yAxisID: 'y'
              },
              {
                type: 'bar',
                label: 'Jumlah Karyawan Lembur',
                data: pick(t.lembur),
                backgroundColor: '#c026d3',
                yAxisID: 'y1'
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
              y: { type: 'linear', position: 'left', beginAtZero: true, title: { display: true, text: 'Jam Kerja' } },
              y1: { type: 'linear', position: 'right', beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: 'Jumlah Karyawan' }, grid: { drawOnChartArea: false } }
            },
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } } }
          }
        });
      }
    }
  }

  /* ============ TOP 5 TERENDAH / TERBAIK ============ */

  function renderRankLists() {
    const rekap = (STATE.rekap || []).filter(r =>
      r.nama && String(r.nama).trim() !== '' && typeof r.persenKehadiran === 'number'
    );
    if (!rekap.length) return;

    const sorted = [...rekap].sort((a, b) => b.persenKehadiran - a.persenKehadiran);

    const best = sorted.slice(0, 5);
    const worst = [...sorted].reverse().slice(0, 5);

    renderRankBlock('rankBest', best, 'best');
    renderRankBlock('rankWorst', worst, 'worst');
  }

  function renderRankBlock(wrapId, rows, kind) {
    const el = document.getElementById(wrapId);
    el.innerHTML = rows.map((r, i) => {
      const pct = (r.persenKehadiran * 100).toFixed(1) + '%';
      return `
        <div class="rank-row rank-${kind}">
          <div class="rank-badge">${i + 1}</div>
          <div class="rank-info">
            <div class="rank-name">${escapeHtml(r.nama)}</div>
            <div class="rank-sub">${escapeHtml(r.jabatan)} · Alfa: ${r.alfa}</div>
          </div>
          <div class="rank-pct">${pct}</div>
        </div>`;
    }).join('') || '<p class="muted">Belum ada data.</p>';
  }

  /* ============ CARDS DASHBOARD (ringkasan + rincian absen + rata-rata jam kerja) ============ */
  function renderAlignmentWarnings_() {
    const el = document.getElementById('alignmentWarningBanner');
    if (!el) return;
    const warnings = STATE.alignmentWarnings || [];
    if (!warnings.length) {
      el.classList.add('hidden');
      el.innerHTML = '';
      return;
    }
    el.innerHTML =
      '⚠️ <strong>Peringatan: Baris Jadwal &amp; Realisasi Tidak Sejajar</strong>' +
      '<ul style="margin:6px 0 0 20px;padding:0;">' +
      warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('') +
      '</ul>';
    el.classList.remove('hidden');
  }
  function renderCards() {
    const d = STATE.dashboard;

    const rekapForTotals_ = (STATE.rekap || []).filter(r => r.nama && String(r.nama).trim() !== '');
    const totalAlfa = rekapForTotals_.reduce((s, r) => s + (Number(r.alfa) || 0), 0);
    const totalIzin = rekapForTotals_.reduce((s, r) => s + (Number(r.izin) || 0), 0);
    const totalSakit = rekapForTotals_.reduce((s, r) => s + (Number(r.sakit) || 0), 0);
    const totalTidakHadir = totalAlfa + totalIzin + totalSakit;

    const cardsData = [
      { label: 'Total Karyawan', value: d['TOTAL KARYAWAN'] },
      { label: 'Total Hari Kerja Terjadwal', value: d['TOTAL HARI KERJA TERJADWAL'] },
      { label: 'Total Hadir Aktual', value: d['TOTAL HADIR AKTUAL'], color: '#22c55e' },
      { label: 'Rata-rata Kehadiran', value: d['RATA-RATA KEHADIRAN'] },
      { label: 'Total Tidak Hadir (Alfa/Izin/Sakit)', value: totalTidakHadir, color: '#ef4444' },
      { label: 'Total OFF (Libur)', value: d['TOTAL OFF (LIBUR)'] }
    ];

    let html = cardsData.map(c => `
      <div class="card">
        <div class="card-label">${c.label}</div>
        <div class="card-value" style="color:${c.color || '#1e293b'}">${c.value ?? '-'}</div>
      </div>
    `).join('');

    const jk = STATE.jamKerjaRingkasan;
    if (jk) {
      const kurang = jk.totalKekuranganJam;
      const kurangColor = kurang > 0 ? '#ef4444' : '#22c55e';
      html += `
        <div class="card">
          <div class="card-label">Total Jam Kerja</div>
          <div class="card-value" style="color:#0ea5e9">${jk.totalJamKerja} jam</div>
        </div>
        <div class="card">
          <div class="card-label">Target Jam Kerja</div>
          <div class="card-value" style="color:#64748b">${jk.totalTargetJam} jam</div>
        </div>
        <div class="card">
          <div class="card-label">Kekurangan Jam</div>
          <div class="card-value" style="color:${kurangColor}">${kurang > 0 ? kurang : 0} jam</div>
        </div>
        <div class="card">
          <div class="card-label-row">
            <span class="card-label">Rata-rata Jam Kerja / Orang</span>
            <select id="avgJamKerjaFilter" onchange="onAvgJamKerjaFilterChange()">
              <option value="hari" ${avgJamKerjaMode === 'hari' ? 'selected' : ''}>Per Hari</option>
              <option value="minggu" ${avgJamKerjaMode === 'minggu' ? 'selected' : ''}>Per Minggu</option>
              <option value="bulan" ${avgJamKerjaMode === 'bulan' ? 'selected' : ''}>Per Bulan</option>
            </select>
          </div>
          <div class="card-value" style="color:#0ea5e9" id="avgJamKerjaValue">-</div>
        </div>
      `;
    }

    document.getElementById('cards').innerHTML = html;
    if (jk) computeAndShowAvgJamKerja_();
    renderAbsenPieChart_(totalAlfa, totalIzin, totalSakit);
  }

  function renderAbsenPieChart_(totalAlfa, totalIzin, totalSakit) {
    if (typeof Chart === 'undefined') return;
    const canvas = document.getElementById('chartAbsenPie');
    if (!canvas) return;

    if (chartAbsenPie) chartAbsenPie.destroy();

    const total = totalAlfa + totalIzin + totalSakit;
    if (total === 0) {
      chartAbsenPie = new Chart(canvas, {
        type: 'pie',
        data: { labels: ['Belum ada data'], datasets: [{ data: [1], backgroundColor: ['#e2e8f0'] }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } }, tooltip: { enabled: false } }
        }
      });
      return;
    }

    chartAbsenPie = new Chart(canvas, {
      type: 'pie',
      data: {
        labels: ['Alfa', 'Izin', 'Sakit'],
        datasets: [{
          data: [totalAlfa, totalIzin, totalSakit],
          backgroundColor: ['#ef4444', '#3b82f6', '#f59e0b']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } },
          tooltip: {
            callbacks: {
              label: ctx => {
                const val = ctx.raw;
                const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
                return `${ctx.label}: ${val} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }

  function onAvgJamKerjaFilterChange() {
    avgJamKerjaMode = document.getElementById('avgJamKerjaFilter').value;
    computeAndShowAvgJamKerja_();
  }

  function computeAndShowAvgJamKerja_() {
    const el = document.getElementById('avgJamKerjaValue');
    if (!el) return;

    const rekap = (STATE.rekap || []).filter(r => r.nama && String(r.nama).trim() !== '');
    const totalJamKerja = rekap.reduce((s, r) => s + (Number(r.totalJamKerja) || 0), 0);
    const totalHariKerja = rekap.reduce((s, r) => s + (Number(r.totalHariKerja) || 0), 0);
    const jumlahKaryawan = rekap.length;

    const avgPerHari = totalHariKerja > 0 ? (totalJamKerja / totalHariKerja) : 0;

    let displayValue = 0;
    let unitLabel = '';

    if (avgJamKerjaMode === 'hari') {
      displayValue = avgPerHari;
      unitLabel = 'jam / hari / orang';
    } else if (avgJamKerjaMode === 'minggu') {
      displayValue = avgPerHari * 7;
      unitLabel = 'jam / minggu / orang';
    } else {
      displayValue = jumlahKaryawan > 0 ? (totalJamKerja / jumlahKaryawan) : 0;
      unitLabel = 'jam / bulan / orang';
    }

    el.innerHTML = displayValue.toFixed(2) + ' <span class="card-unit">' + unitLabel + '</span>';
  }

  function renderLegend(elId, codes) {
    const el = document.getElementById(elId);
    const seenLabels = new Set();
    el.innerHTML = Object.entries(codes)
      .filter(([code, info]) => {
        if (code === '') return false;
        if (seenLabels.has(info.label)) return false;
        seenLabels.add(info.label);
        return true;
      })
      .map(([code, info]) => `
        <span class="legend-item">
          <span class="legend-dot" style="background:${info.color}"></span>
          ${code} = ${info.label}
        </span>`).join('');
  }

  function renderGrid(wrapId, employees, dayCount, dayNames, codeMap, editable, cellType) {
    let html = '<table><thead><tr><th class="name-col">Nama Karyawan</th><th>Jabatan</th>';
    for (let i = 0; i < dayCount; i++) {
      html += `<th>${i + 1}<br><span class="muted">${dayNames[i] || ''}</span></th>`;
    }
    html += '</tr></thead><tbody>';

    employees.forEach(emp => {
      html += `<tr data-name="${escapeHtml((emp.nama || '').toLowerCase())}"><td class="name-col">${escapeHtml(emp.nama)}</td><td>${escapeHtml(emp.jabatan)}</td>`;
      emp.days.forEach((val, dayIndex) => {
        const code = normalizeCode(val);
        const info = codeMap[code] || codeMap[''] || { color: '#94a3b8' };
        const bg = code ? hexToRgba(info.color, 0.18) : 'transparent';
        const fg = code ? info.color : '#cbd5e1';
        const label = code || '·';
        const cellAttrs = editable
          ? `data-type="${cellType}" data-row="${emp.rowIndex}" data-day="${dayIndex}" data-name="${escapeHtml(emp.nama)}" data-daynum="${dayIndex + 1}" onclick="openPicker(this)"`
          : '';
        html += `<td class="day-cell" style="background:${bg};color:${fg}" ${cellAttrs}>${label}</td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    document.getElementById(wrapId).innerHTML = html;
  }

  function normalizeCode(v) {
    if (v === null || v === undefined) return '';
    v = String(v).trim().toUpperCase();
    if (v === '1' || v === '1.0') return '1';
    return v;
  }

  function renderRekapTable(wrapId, rows, full) {
    const cols = ['No', 'Nama', 'NIK', 'Jabatan', 'Jadwal', 'Hadir', 'Alfa', 'Izin', 'Sakit', 'Cuti', 'OFF', '% Hadir', 'Rank', 'Jam Kerja', 'Target Jam', 'Kekurangan Jam'];
    let html = '<table><thead><tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>';
    const canEditNik = !!SESSION && SESSION.role === 'Super Admin' && currentViewPeriodKey === 'active';
    rows.forEach(r => {
      const pct = (typeof r.persenKehadiran === 'number') ? (r.persenKehadiran * 100).toFixed(1) + '%' : r.persenKehadiran;
      const nik = r.nik || '';
      const nikCellAttrs = canEditNik
        ? `class="nik-cell" onclick="openNikPicker(${JSON.stringify(r.nama)})"`
        : 'class="nik-cell readonly"';
      const nikLabel = nik ? escapeHtml(nik) : (canEditNik ? '+ isi NIK' : '-');

      const jamKerja = (typeof r.totalJamKerja === 'number') ? r.totalJamKerja : '-';
      const targetJam = (typeof r.targetJamKerja === 'number') ? r.targetJamKerja : '-';
      const kekuranganCell = (typeof r.kekuranganJam === 'number')
        ? `<span style="color:${r.kekuranganJam > 0 ? '#ef4444' : '#22c55e'}">${r.kekuranganJam}</span>`
        : '-';

      html += `<tr data-name="${escapeHtml((r.nama || '').toLowerCase())}">
        <td>${r.no}</td>
        <td class="name-col">${escapeHtml(r.nama)}</td>
        <td ${nikCellAttrs}>${nikLabel}</td>
        <td>${escapeHtml(r.jabatan)}</td>
        <td>${r.jadwal}</td>
        <td>${r.hadir}</td>
        <td>${r.alfa}</td>
        <td>${r.izin}</td>
        <td>${r.sakit}</td>
        <td>${r.cuti}</td>
        <td>${r.off}</td>
        <td>${pct}</td>
        <td>${r.rank}</td>
        <td>${jamKerja}</td>
        <td>${targetJam}</td>
        <td>${kekuranganCell}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    document.getElementById(wrapId).innerHTML = html;
  }

  /* ============ INPUT REALISASI (klik sel, butuh login) ============ */

  let pickerTarget = null;

  function openPicker(cell) {
    if (currentViewPeriodKey !== 'active') {
      toast('Data arsip bersifat read-only, tidak bisa diubah', true);
      return;
    }
    const type = cell.dataset.type || 'realisasi';
    if (!SESSION) {
      toast('Silakan login dulu untuk mengubah data', true);
      showLoginGate();
      return;
    }
    if (type === 'jadwal' && SESSION.role !== 'Super Admin') {
      toast('Hanya admin yang boleh mengubah Jadwal', true);
      return;
    }
    pickerTarget = {
      type: type,
      rowIndex: parseInt(cell.dataset.row, 10),
      dayIndex: parseInt(cell.dataset.day, 10),
      nama: cell.dataset.name,
      dayNum: cell.dataset.daynum,
      cellEl: cell
    };
    document.getElementById('pickerTitle').textContent =
      `${pickerTarget.nama} — Tanggal ${pickerTarget.dayNum}` + (type === 'jadwal' ? ' (Jadwal Shift)' : '');

    const codeMap = type === 'jadwal' ? STATE.shiftCodes : STATE.statusCodes;
    const optionsEl = document.getElementById('pickerOptions');
    optionsEl.innerHTML = '';
    Object.entries(codeMap).forEach(([code, info]) => {
      const btn = document.createElement('button');
      btn.textContent = code ? `${code} — ${info.label}` : 'Kosongkan';
      btn.onclick = () => submitStatus(code);
      optionsEl.appendChild(btn);
    });
    if (type === 'jadwal') {
      const clearBtn = document.createElement('button');
      clearBtn.textContent = 'Kosongkan';
      clearBtn.onclick = () => submitStatus('');
      optionsEl.appendChild(clearBtn);
    }

    document.getElementById('statusPicker').classList.remove('hidden');
  }

  function closePicker() {
    document.getElementById('statusPicker').classList.add('hidden');
    pickerTarget = null;
  }

  function submitStatus(code) {
    if (!pickerTarget || !SESSION) return;
    const { type, rowIndex, dayIndex, cellEl } = pickerTarget;
    closePicker();
    cellEl.style.opacity = '0.4';

    const successHandler = data => {
      applyStateAndRerender_(data);
      toast('Tersimpan');
    };
    const failureHandler = err => {
      cellEl.style.opacity = '1';
      toast('Gagal menyimpan: ' + err.message, true);
      if (String(err.message).indexOf('login') !== -1 || String(err.message).indexOf('Sesi') !== -1) {
        doLogout();
      }
    };

    if (type === 'jadwal') {
      google.script.run
        .withSuccessHandler(successHandler)
        .withFailureHandler(failureHandler)
        .saveJadwal(rowIndex, dayIndex, code, SESSION.token);
    } else {
      google.script.run
        .withSuccessHandler(successHandler)
        .withFailureHandler(failureHandler)
        .saveRealisasi(rowIndex, dayIndex, code, SESSION.token);
    }
  }

  /* ============ TAMBAH KARYAWAN ============ */

  function openAddEmployeePicker() {
    if (currentViewPeriodKey !== 'active') {
      toast('Sedang melihat data arsip, tidak bisa tambah karyawan. Pilih "Periode Aktif" dulu.', true);
      return;
    }
    if (!SESSION || SESSION.role !== 'Super Admin') {
      toast('Hanya admin yang boleh menambah karyawan', true);
      return;
    }
    document.getElementById('newEmployeeNama').value = '';
    document.getElementById('newEmployeeNik').value = '';
    document.getElementById('newEmployeeDept').value = '';
    document.getElementById('newEmployeeJabatan').value = '';
    document.getElementById('addEmployeeError').textContent = '';
    document.getElementById('addEmployeePicker').classList.remove('hidden');
    document.getElementById('newEmployeeNama').focus();
  }
  function closeAddEmployeePicker() {
    document.getElementById('addEmployeePicker').classList.add('hidden');
  }

  function submitAddEmployee() {
    const nama = document.getElementById('newEmployeeNama').value.trim();
    const nik = document.getElementById('newEmployeeNik').value.trim();
    const department = document.getElementById('newEmployeeDept').value.trim();
    const jabatan = document.getElementById('newEmployeeJabatan').value.trim();
    if (!nama) {
      document.getElementById('addEmployeeError').textContent = 'Nama karyawan wajib diisi.';
      return;
    }
    const btn = document.getElementById('addEmployeeSubmit');
    btn.disabled = true;

    google.script.run
      .withSuccessHandler(data => {
        btn.disabled = false;
        closeAddEmployeePicker();
        applyStateAndRerender_(data);
        loadArchivedPeriodsList();
        loadDaftarKaryawan();
        loadUnassignedEmployees_();
        toast('Karyawan "' + nama + '" berhasil ditambahkan. Karyawan baru masuk sebagai "Belum Terjadwal" — assign lewat menu Setting > Assign Karyawan ke Jadwal.');
      })
      .withFailureHandler(err => {
        btn.disabled = false;
        document.getElementById('addEmployeeError').textContent = err.message;
      })
      .addEmployee(nama, jabatan, nik, department, SESSION ? SESSION.token : null);
  }
/* ============ HAPUS KARYAWAN (RESIGN) ============ */

let deleteEmployeeNeedsForce = false;

function openDeleteEmployeePicker() {
  if (currentViewPeriodKey !== 'active') {
    toast('Sedang melihat data arsip, tidak bisa hapus karyawan. Pilih "Periode Aktif" dulu.', true);
    return;
  }
  if (!SESSION || SESSION.role !== 'Super Admin') {
    toast('Hanya admin yang boleh menghapus karyawan', true);
    return;
  }
  populateDeleteEmployeeOptions_();
  deleteEmployeeNeedsForce = false;
  document.getElementById('deleteEmployeeWarning').textContent = '';
  document.getElementById('deleteEmployeeWarning').classList.add('hidden');
  document.getElementById('deleteEmployeeError').textContent = '';
  const btn = document.getElementById('deleteEmployeeSubmit');
  btn.disabled = false;
  btn.textContent = 'Hapus Karyawan';
  document.getElementById('deleteEmployeePicker').classList.remove('hidden');
}

function closeDeleteEmployeePicker() {
  document.getElementById('deleteEmployeePicker').classList.add('hidden');
  deleteEmployeeNeedsForce = false;
}

function populateDeleteEmployeeOptions_() {
  const sel = document.getElementById('deleteEmployeeSelect');
  const rekap = (STATE.rekap || []).filter(r => r.nama && String(r.nama).trim() !== '');
  sel.innerHTML = rekap.map(r =>
    `<option value="${escapeHtml(r.nama)}">${escapeHtml(r.nama)} (${escapeHtml(r.jabatan)})</option>`
  ).join('');
}

function submitDeleteEmployee() {
  if (!SESSION) return;
  const sel = document.getElementById('deleteEmployeeSelect');
  const nama = sel.value;
  if (!nama) {
    document.getElementById('deleteEmployeeError').textContent = 'Pilih karyawan yang akan dihapus.';
    return;
  }

  const btn = document.getElementById('deleteEmployeeSubmit');
  btn.disabled = true;
  btn.textContent = deleteEmployeeNeedsForce ? '⏳ Menghapus paksa...' : '⏳ Menghapus...';
  document.getElementById('deleteEmployeeError').textContent = '';

  google.script.run
    .withSuccessHandler(data => {
      btn.disabled = false;
      btn.textContent = 'Hapus Karyawan';
      closeDeleteEmployeePicker();
      applyStateAndRerender_(data);
      loadArchivedPeriodsList();
      loadDaftarKaryawan();
      loadUnassignedEmployees_();
      toast('Karyawan "' + nama + '" berhasil dihapus.');
    })
    .withFailureHandler(err => {
      const msg = String(err.message || '');
      if (!deleteEmployeeNeedsForce && msg.indexOf('Realisasi') !== -1) {
        deleteEmployeeNeedsForce = true;
        document.getElementById('deleteEmployeeWarning').textContent =
          msg + '\n\nKlik "Hapus Paksa" sekali lagi untuk tetap menghapus karyawan ini beserta data Realisasinya.';
        document.getElementById('deleteEmployeeWarning').classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = '⚠ Hapus Paksa';
      } else {
        btn.disabled = false;
        btn.textContent = deleteEmployeeNeedsForce ? '⚠ Hapus Paksa' : 'Hapus Karyawan';
        document.getElementById('deleteEmployeeError').textContent = msg;
      }
    })
    .deleteEmployee(nama, SESSION.token, deleteEmployeeNeedsForce);
}  /* ============ EDIT NIK KARYAWAN ============ */

  let nikTarget = null;

  function openNikPicker(nama) {
    if (currentViewPeriodKey !== 'active') {
      toast('Sedang melihat data arsip, NIK tidak bisa diubah dari sini.', true);
      return;
    }
    if (!SESSION || SESSION.role !== 'Super Admin') {
      toast('Hanya admin yang boleh mengubah NIK', true);
      return;
    }
    const rekapRow = (STATE.rekap || []).find(r => r.nama === nama);
    nikTarget = nama;

    document.getElementById('nikPickerTitle').textContent = 'Edit NIK — ' + nama;
    document.getElementById('nikInput').value = rekapRow ? (rekapRow.nik || '') : '';
    document.getElementById('nikError').textContent = '';
    document.getElementById('nikPicker').classList.remove('hidden');
    document.getElementById('nikInput').focus();
  }

  function closeNikPicker() {
    document.getElementById('nikPicker').classList.add('hidden');
    nikTarget = null;
  }

  function submitNik() {
    if (!nikTarget || !SESSION) return;
    const nik = document.getElementById('nikInput').value.trim();
    const btn = document.getElementById('nikSubmit');
    btn.disabled = true;

    google.script.run
      .withSuccessHandler(data => {
        btn.disabled = false;
        closeNikPicker();
        applyStateAndRerender_(data);
        toast('NIK tersimpan');
      })
      .withFailureHandler(err => {
        btn.disabled = false;
        document.getElementById('nikError').textContent = err.message;
      })
      .setEmployeeNik(nikTarget, nik, SESSION.token);
  }
  /* ============ KEPEGAWAIAN: DAFTAR KARYAWAN ============ */

  let DAFTAR_KARYAWAN_DATA = [];
  let karyawanTarget = null;

  function loadDaftarKaryawan() {
    if (!SESSION) return;
    const wrap = document.getElementById('daftarKaryawanWrap');
    if (wrap) wrap.innerHTML = '<p class="muted">Memuat data...</p>';
    google.script.run
      .withSuccessHandler(list => {
        DAFTAR_KARYAWAN_DATA = list || [];
        renderDaftarKaryawanTable();
      })
      .withFailureHandler(err => {
        toast('Gagal memuat Daftar Karyawan: ' + err.message, true);
        if (isAuthError_(err.message)) doLogout();
      })
      .getDaftarKaryawan(SESSION.token);
  }

  function renderDaftarKaryawanTable() {
    const canEdit = !!SESSION && SESSION.role === 'Super Admin';
    const cols = ['NIK', 'Nama', 'Department', 'Jabatan', 'Shift', 'Status Karyawan', 'Tanggal Registrasi', 'Status Jadwal'];
    let html = '<table><thead><tr>' + cols.map(c => `<th>${c}</th>`).join('') + (canEdit ? '<th>Aksi</th>' : '') + '</tr></thead><tbody>';

    DAFTAR_KARYAWAN_DATA.forEach(k => {
      const isBelumTerjadwal = k.statusAssignment === 'Belum Terjadwal';
      const assignBadge = isBelumTerjadwal
        ? '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;">⏳ Belum Terjadwal</span>'
        : '<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;">✔ Aktif Terjadwal</span>';

      html += `<tr data-name="${escapeHtml((k.nama || '').toLowerCase())}">
        <td>${k.nik ? escapeHtml(k.nik) : '-'}</td>
        <td class="name-col">${escapeHtml(k.nama)}</td>
        <td>${k.department ? escapeHtml(k.department) : '-'}</td>
        <td>${escapeHtml(k.jabatan)}</td>
        <td>${k.shift ? escapeHtml(k.shift) : '-'}</td>
        <td>${k.statusKaryawan ? escapeHtml(k.statusKaryawan) : '-'}</td>
        <td>${k.tanggalRegistrasi ? escapeHtml(k.tanggalRegistrasi) : '-'}</td>
        <td>${assignBadge}</td>
        ${canEdit ? `<td><button class="btn btn-ghost" onclick='openEditKaryawanPicker(${JSON.stringify(k.nama)})'>✏ Edit</button></td>` : ''}
      </tr>`;
    });
    html += '</tbody></table>';
    const wrap = document.getElementById('daftarKaryawanWrap');
    if (wrap) wrap.innerHTML = html;
    filterDaftarKaryawanTable();
  }

  function filterDaftarKaryawanTable() {
    filterTableByName_('daftarKaryawanWrap', 'searchDaftarKaryawan');
  }

  function openEditKaryawanPicker(nama) {
    if (!SESSION || SESSION.role !== 'Super Admin') {
      toast('Hanya admin yang boleh mengubah data kepegawaian', true);
      return;
    }
    const k = DAFTAR_KARYAWAN_DATA.find(x => x.nama === nama) || {};
    karyawanTarget = nama;
    document.getElementById('karyawanPickerTitle').textContent = 'Edit Data Karyawan — ' + nama;
    document.getElementById('karyawanNikInput').value = k.nik || '';
    document.getElementById('karyawanDeptInput').value = k.department || '';
    document.getElementById('karyawanShiftInput').value = k.shift || '';
    document.getElementById('karyawanStatusInput').value = k.statusKaryawan || 'Aktif';
    document.getElementById('karyawanTglInput').value = ddmmyyyyToInputDate_(k.tanggalRegistrasi);
    document.getElementById('karyawanError').textContent = '';
    document.getElementById('karyawanPicker').classList.remove('hidden');
  }

  function closeKaryawanPicker() {
    document.getElementById('karyawanPicker').classList.add('hidden');
    karyawanTarget = null;
  }

  function submitKaryawanData() {
    if (!karyawanTarget || !SESSION) return;
    const fields = {
      nik: document.getElementById('karyawanNikInput').value.trim(),
      department: document.getElementById('karyawanDeptInput').value.trim(),
      shift: document.getElementById('karyawanShiftInput').value.trim(),
      statusKaryawan: document.getElementById('karyawanStatusInput').value,
      tanggalRegistrasi: inputDateToDdmmyyyy_(document.getElementById('karyawanTglInput').value)
    };
    const btn = document.getElementById('karyawanSubmit');
    btn.disabled = true;

    google.script.run
      .withSuccessHandler(list => {
        btn.disabled = false;
        closeKaryawanPicker();
        DAFTAR_KARYAWAN_DATA = list || [];
        renderDaftarKaryawanTable();
        toast('Data karyawan tersimpan');
      })
      .withFailureHandler(err => {
        btn.disabled = false;
        document.getElementById('karyawanError').textContent = err.message;
      })
      .setEmployeeMasterData(karyawanTarget, fields, SESSION.token);
  }

  function ddmmyyyyToInputDate_(tglStr) {
    const parts = String(tglStr || '').split('/');
    return parts.length === 3 ? (parts[2] + '-' + parts[1] + '-' + parts[0]) : '';
  }

  function inputDateToDdmmyyyy_(inputValue) {
    if (!inputValue) return '';
    const [y, m, d] = inputValue.split('-');
    return d + '/' + m + '/' + y;
  }
/* ============ GANTI PASSWORD ============ */

  function openChangePasswordPicker() {
    if (!SESSION) return;
    document.getElementById('oldPasswordInput').value = '';
    document.getElementById('newPasswordInput').value = '';
    document.getElementById('newPasswordConfirmInput').value = '';
    document.getElementById('changePasswordError').textContent = '';
    document.getElementById('changePasswordPicker').classList.remove('hidden');
    document.getElementById('oldPasswordInput').focus();
  }

  function closeChangePasswordPicker() {
    document.getElementById('changePasswordPicker').classList.add('hidden');
  }

  function submitChangePassword() {
    if (!SESSION) return;
    const oldPassword = document.getElementById('oldPasswordInput').value;
    const newPassword = document.getElementById('newPasswordInput').value;
    const confirmPassword = document.getElementById('newPasswordConfirmInput').value;
    const errEl = document.getElementById('changePasswordError');

    if (!oldPassword || !newPassword || !confirmPassword) {
      errEl.textContent = 'Semua kolom wajib diisi.';
      return;
    }
    if (newPassword.length < 6) {
      errEl.textContent = 'Password baru minimal 6 karakter.';
      return;
    }
    if (newPassword !== confirmPassword) {
      errEl.textContent = 'Konfirmasi password baru tidak cocok.';
      return;
    }

    const btn = document.getElementById('changePasswordSubmit');
    btn.disabled = true;
    btn.textContent = '⏳ Menyimpan...';

    google.script.run
      .withSuccessHandler(() => {
        btn.disabled = false;
        btn.textContent = 'Simpan Password Baru';
        closeChangePasswordPicker();
        toast('Password berhasil diganti. Gunakan password baru saat login berikutnya.');
      })
      .withFailureHandler(err => {
        btn.disabled = false;
        btn.textContent = 'Simpan Password Baru';
        errEl.textContent = err.message;
      })
      .changeOwnPassword(oldPassword, newPassword, SESSION.token);
  }
  /* ============ UPLOAD JADWAL (EXCEL) ============ */

  function triggerJadwalUpload() {
    if (currentViewPeriodKey !== 'active') {
      toast('Sedang melihat data arsip, tidak bisa upload jadwal. Pilih "Periode Aktif" dulu.', true);
      return;
    }
    if (!SESSION) {
      toast('Silakan login dulu untuk upload jadwal', true);
      showLoginGate();
      return;
    }
    document.getElementById('jadwalFileInput').click();
  }

  function downloadJadwalTemplate() {
    const btn = document.getElementById('downloadTemplateBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Membuat template...';

    google.script.run
      .withSuccessHandler(result => {
        btn.disabled = false;
        btn.textContent = '⬇ Template Excel';
        triggerBase64Download(result.base64, result.filename, result.mimeType);
        toast('Template berhasil dibuat: ' + result.filename);
      })
      .withFailureHandler(err => {
        btn.disabled = false;
        btn.textContent = '⬇ Template Excel';
        toast('Gagal membuat template: ' + err.message, true);
      })
      .generateJadwalTemplateExcel(SESSION ? SESSION.token : null, currentDeptFilter);
  }

  function handleJadwalFileSelected(evt) {
    const file = evt.target.files[0];
    if (!file) return;
    evt.target.value = '';

    if (!SESSION) {
      toast('Sesi login habis, silakan login ulang', true);
      showLoginGate();
      return;
    }
    if (!/\.xlsx$/i.test(file.name)) {
      toast('File harus berformat .xlsx', true);
      return;
    }

    const btn = document.getElementById('uploadJadwalBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Memproses...';
    toast('Mengunggah dan membaca "' + file.name + '"...');

    const reader = new FileReader();
    reader.onload = () => {
      const base64Data = reader.result.split(',')[1];
      google.script.run
        .withSuccessHandler(data => {
          btn.disabled = false;
          btn.textContent = '⬆ Upload Jadwal (Excel)';
          applyStateAndRerender_(data);
          const info = data.uploadInfo || { matched: 0, notFound: [] };
          let msg = 'Jadwal terupdate: ' + info.matched + ' karyawan cocok.';
          if (info.notFound && info.notFound.length) {
            msg += ' Tidak ditemukan: ' + info.notFound.join(', ');
            toast(msg, true);
          } else {
            toast(msg);
          }
        })
        .withFailureHandler(err => {
          btn.disabled = false;
          btn.textContent = '⬆ Upload Jadwal (Excel)';
          toast('Gagal upload jadwal: ' + err.message, true);
        })
        .uploadJadwal(base64Data, file.name, SESSION.token);
    };
    reader.onerror = () => {
      btn.disabled = false;
      btn.textContent = '⬆ Upload Jadwal (Excel)';
      toast('Gagal membaca file dari komputer Anda.', true);
    };
    reader.readAsDataURL(file);
  }

  /* ============ UPLOAD REALISASI (EXCEL) ============ */

  function triggerRealisasiUpload() {
    if (currentViewPeriodKey !== 'active') {
      toast('Sedang melihat data arsip, tidak bisa upload realisasi. Pilih "Periode Aktif" dulu.', true);
      return;
    }
    if (!SESSION || SESSION.role !== 'Super Admin') {
      toast('Hanya admin yang boleh upload realisasi', true);
      return;
    }
    document.getElementById('realisasiFileInput').click();
  }

  function handleRealisasiFileSelected(evt) {
    const file = evt.target.files[0];
    if (!file) return;
    evt.target.value = '';

    if (!SESSION) {
      toast('Sesi login habis, silakan login ulang', true);
      showLoginGate();
      return;
    }
    if (!/\.xlsx$/i.test(file.name)) {
      toast('File harus berformat .xlsx', true);
      return;
    }

    const btn = document.getElementById('uploadRealisasiBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Memproses...';
    toast('Mengunggah dan membaca "' + file.name + '"...');

    const reader = new FileReader();
    reader.onload = () => {
      const base64Data = reader.result.split(',')[1];
      google.script.run
        .withSuccessHandler(data => {
          btn.disabled = false;
          btn.textContent = '⬆ Upload Realisasi (Excel)';
          applyStateAndRerender_(data);
          const info = data.uploadInfo || { matched: 0, notFound: [] };
          let msg = 'Realisasi terupdate: ' + info.matched + ' karyawan cocok.';
          if (info.notFound && info.notFound.length) {
            msg += ' Tidak ditemukan: ' + info.notFound.join(', ');
            toast(msg, true);
          } else {
            toast(msg);
          }
        })
        .withFailureHandler(err => {
          btn.disabled = false;
          btn.textContent = '⬆ Upload Realisasi (Excel)';
          toast('Gagal upload realisasi: ' + err.message, true);
        })
        .uploadRealisasi(base64Data, file.name, SESSION.token);
    };
    reader.onerror = () => {
      btn.disabled = false;
      btn.textContent = '⬆ Upload Realisasi (Excel)';
      toast('Gagal membaca file dari komputer Anda.', true);
    };
    reader.readAsDataURL(file);
  }

  /* ============ UPLOAD ABSEN FINGER (XLS/XLSX) ============ */

  function triggerFingerUpload() {
    if (currentViewPeriodKey !== 'active') {
      toast('Sedang melihat data arsip, tidak bisa upload absen finger. Pilih "Periode Aktif" dulu.', true);
      return;
    }
    if (!SESSION || SESSION.role !== 'Super Admin') {
      toast('Hanya admin yang boleh upload absen finger', true);
      return;
    }
    document.getElementById('fingerFileInput').click();
  }

  function handleFingerFileSelected(evt) {
    const file = evt.target.files[0];
    if (!file) return;
    evt.target.value = '';

    if (!SESSION) {
      toast('Sesi login habis, silakan login ulang', true);
      showLoginGate();
      return;
    }
    if (!/\.(xls|xlsx)$/i.test(file.name)) {
      toast('File harus berformat .xls atau .xlsx', true);
      return;
    }

    const btn = document.getElementById('uploadFingerBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Memproses...';
    toast('Mengunggah dan membaca "' + file.name + '"...');

    const reader = new FileReader();
    reader.onload = () => {
      const base64Data = reader.result.split(',')[1];
      google.script.run
        .withSuccessHandler(data => {
          btn.disabled = false;
          btn.textContent = '📇 Upload Absen Finger';
          applyStateAndRerender_(data);
          const info = data.uploadFingerInfo || { filled: 0, filledOvertime: 0, skippedAlreadyFilled: 0, notFound: [], outOfRangeDay: [] };
          let msg = 'Absen finger diproses: ' + info.filled + ' sel Realisasi terisi otomatis' +
            (info.filledOvertime ? ' (' + info.filledOvertime + ' di antaranya lembur/kode "2")' : '') + ', ' +
            info.skippedAlreadyFilled + ' dilewati (sudah ada isi manual).';
          let hasWarning = false;
          if (info.notFound && info.notFound.length) {
            msg += ' Nama tidak cocok: ' + info.notFound.join(', ') + '.';
            hasWarning = true;
          }
          if (info.outOfRangeDay && info.outOfRangeDay.length) {
            msg += ' Tanggal di luar rentang periode: ' + info.outOfRangeDay.join(', ') + '.';
            hasWarning = true;
          }
          toast(msg, hasWarning);
        })
        .withFailureHandler(err => {
          btn.disabled = false;
          btn.textContent = '📇 Upload Absen Finger';
          toast('Gagal upload absen finger: ' + err.message, true);
        })
        .uploadFingerAbsen(base64Data, file.name, SESSION.token);
    };
    reader.onerror = () => {
      btn.disabled = false;
      btn.textContent = '📇 Upload Absen Finger';
      toast('Gagal membaca file dari komputer Anda.', true);
    };
    reader.readAsDataURL(file);
  }
  /* ============ DOWNLOAD PDF ============ */

  function downloadPdf(sheetName) {
    const btn = event.target;
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = '⏳ Membuat PDF...';

    google.script.run
      .withSuccessHandler(result => {
        btn.disabled = false;
        btn.textContent = originalText;
        triggerBase64Download(result.base64, result.filename, result.mimeType);
        toast('PDF berhasil dibuat: ' + result.filename);
      })
      .withFailureHandler(err => {
        btn.disabled = false;
        btn.textContent = originalText;
        toast('Gagal membuat PDF: ' + err.message, true);
      })
      .exportSheetPdf(sheetName, SESSION ? SESSION.token : null);
  }

  function triggerBase64Download(base64, filename, mimeType) {
    const byteChars = atob(base64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /* ============ UTIL ============ */

  function toast(msg, isError) {
    const el = document.getElementById('statusToast');
    el.textContent = msg;
    el.style.background = isError ? '#dc2626' : '#1e293b';
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2600);
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
/** Ubah string "yyyy-MM-dd" (format tanggal dari backend Pengajuan Izin) jadi "dd/mm/yyyy". */
  function formatTglIndo_(str) {
    const s = String(str || '').trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return s || '-';
    return m[3] + '/' + m[2] + '/' + m[1];
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  /* ============ REPORT (Summary/Detail/Department/Exception) ============ */

let REPORT_LAST = { summary: null, detail: null, dept: null, exception: null };

function initReportFilters_(tabName) {
  if (!STATE) return;
  if (tabName === 'reportsummary') {
    ensureDaftarKaryawanLoaded_(() => renderFilterCheckboxes_('reportSummaryJabatanFilter', getJabatanList_()));
  }
  if (tabName === 'reportdept') {
    ensureDaftarKaryawanLoaded_(() => renderFilterCheckboxes_('reportDeptFilter', getDepartmentList_()));
  }
  if (tabName === 'reportdetail') {
    populateReportEmployeeSelect_();
    populateReportDayOptions_('reportDetailDayStart', 'reportDetailDayEnd');
  }
  if (tabName === 'reportexception') {
    populateReportDayOptions_('reportExceptionDayStart', 'reportExceptionDayEnd');
  }
}

function ensureDaftarKaryawanLoaded_(cb) {
  if (DAFTAR_KARYAWAN_DATA && DAFTAR_KARYAWAN_DATA.length) { cb(); return; }
  if (!SESSION) { cb(); return; }
  google.script.run
    .withSuccessHandler(list => { DAFTAR_KARYAWAN_DATA = list || []; cb(); })
    .withFailureHandler(() => cb())
    .getDaftarKaryawan(SESSION.token);
}

function getJabatanList_() {
  const set = new Set();
  (STATE.rekap || []).forEach(r => { if (r.nama && r.jabatan) set.add(r.jabatan); });
  return Array.from(set).sort();
}

function getDepartmentMap_() {
  const map = {};
  (DAFTAR_KARYAWAN_DATA || []).forEach(k => { map[k.nama] = k.department || ''; });
  return map;
}

function getDepartmentList_() {
  const deptMap = getDepartmentMap_();
  const set = new Set();
  (STATE.rekap || []).forEach(r => {
    if (!r.nama) return;
    set.add(deptMap[r.nama] || r.jabatan || 'Tanpa Department');
  });
  return Array.from(set).sort();
}

function renderFilterCheckboxes_(containerId, values) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!values.length) { el.innerHTML = '<span class="muted">Tidak ada data</span>'; return; }
  el.innerHTML = values.map(v => `<label class="chk-item"><input type="checkbox" value="${escapeHtml(v)}" checked> ${escapeHtml(v)}</label>`).join('');
}

function getCheckedValues_(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return [];
  return Array.from(el.querySelectorAll('input[type="checkbox"]:checked')).map(i => i.value);
}

function populateReportEmployeeSelect_() {
  const sel = document.getElementById('reportDetailEmployee');
  if (!sel) return;
  const rekap = (STATE.rekap || []).filter(r => r.nama && String(r.nama).trim() !== '');
  sel.innerHTML = rekap.map(r => `<option value="${escapeHtml(r.nama)}">${escapeHtml(r.nama)} (${escapeHtml(r.jabatan)})</option>`).join('');
}

function populateReportDayOptions_(startId, endId) {
  const dayCount = STATE.dayCount || 0;
  const dayNames = STATE.dayNames || [];
  let optionsHtml = '';
  for (let i = 0; i < dayCount; i++) optionsHtml += `<option value="${i + 1}">${i + 1} ${escapeHtml(dayNames[i] || '')}</option>`;
  const s = document.getElementById(startId), e = document.getElementById(endId);
  if (s) { s.innerHTML = optionsHtml; s.value = '1'; }
  if (e) { e.innerHTML = optionsHtml; e.value = String(dayCount); }
}

/* ---- Builders: hitung data laporan dari STATE yang sudah dimuat ---- */

function buildSummaryReport_() {
  const jabatanChecked = getCheckedValues_('reportSummaryJabatanFilter');
  const rekap = (STATE.rekap || []).filter(r => r.nama && String(r.nama).trim() !== '' && (!jabatanChecked.length || jabatanChecked.includes(r.jabatan)));
  const totalKaryawan = rekap.length;
  const sum = f => rekap.reduce((s, r) => s + (Number(r[f]) || 0), 0);
  const totalHadir = sum('hadir'), totalAlfa = sum('alfa'), totalIzin = sum('izin'), totalSakit = sum('sakit');
  const avgPct = totalKaryawan ? (rekap.reduce((s, r) => s + (Number(r.persenKehadiran) || 0), 0) / totalKaryawan * 100).toFixed(1) : '0.0';

  const byJabatan = {};
  rekap.forEach(r => {
    const j = r.jabatan || '-';
    if (!byJabatan[j]) byJabatan[j] = { n: 0, jadwal: 0, hadir: 0, alfa: 0, izin: 0, sakit: 0, cuti: 0, off: 0, pctSum: 0 };
    const b = byJabatan[j];
    b.n++; b.jadwal += Number(r.jadwal) || 0; b.hadir += Number(r.hadir) || 0;
    b.alfa += Number(r.alfa) || 0; b.izin += Number(r.izin) || 0; b.sakit += Number(r.sakit) || 0;
    b.cuti += Number(r.cuti) || 0; b.off += Number(r.off) || 0; b.pctSum += Number(r.persenKehadiran) || 0;
  });
  const columns = ['Jabatan', 'Jumlah Karyawan', 'Jadwal', 'Hadir', 'Alfa', 'Izin', 'Sakit', 'Cuti', 'OFF', 'Rata-rata % Hadir'];
  const rows = Object.keys(byJabatan).sort().map(j => {
    const b = byJabatan[j];
    return [j, b.n, b.jadwal, b.hadir, b.alfa, b.izin, b.sakit, b.cuti, b.off, ((b.pctSum / b.n) * 100).toFixed(1) + '%'];
  });

  const extraHtml = `<div class="cards report-summary-cards">
    <div class="card"><div class="card-label">Total Karyawan</div><div class="card-value">${totalKaryawan}</div></div>
    <div class="card"><div class="card-label">Total Hadir</div><div class="card-value" style="color:#22c55e">${totalHadir}</div></div>
    <div class="card"><div class="card-label">Total Alfa/Izin/Sakit</div><div class="card-value" style="color:#ef4444">${totalAlfa + totalIzin + totalSakit}</div></div>
    <div class="card"><div class="card-label">Rata-rata % Hadir</div><div class="card-value">${avgPct}%</div></div>
  </div>`;
  return { title: 'Summary Report - ' + (STATE.period || ''), columns, rows, extraHtml };
}

function buildDetailReport_() {
  const nama = document.getElementById('reportDetailEmployee').value;
  const dayStart = parseInt(document.getElementById('reportDetailDayStart').value, 10) || 1;
  const dayEnd = parseInt(document.getElementById('reportDetailDayEnd').value, 10) || (STATE.dayCount || 1);
  const emp = (STATE.realisasi || []).find(e => e.nama === nama);
  const jadwalEmp = (STATE.jadwal || []).find(e => e.nama === nama);
  const rekapRow = (STATE.rekap || []).find(r => r.nama === nama);
  const dayNames = STATE.dayNames || [];

    const jamScanEmp = (STATE.jamScan || []).find(e => e.nama === nama);
    const columns = ['Tanggal', 'Hari', 'Jam Masuk', 'Jam Keluar', 'Keterangan'];
    const rows = [];
    for (let d = dayStart; d <= dayEnd; d++) {
      const idx = d - 1;
      const rCode = emp ? normalizeCode(emp.days[idx]) : '';
      const rLabel = (STATE.statusCodes[rCode] || {}).label || '';
      const scanRaw = jamScanEmp ? String(jamScanEmp.days[idx] || '') : '';
      const scanParts = scanRaw.split(' - ');
      const jamMasuk = (scanParts[0] || '').trim();
      const jamKeluar = (scanParts[1] || '').trim();
      rows.push([
        d,
        dayNames[idx] || '',
        (jamMasuk && jamMasuk !== '-') ? jamMasuk : '-',
        (jamKeluar && jamKeluar !== '-') ? jamKeluar : '-',
        rLabel || '-'
      ]);
    }

  const extraHtml = rekapRow ? `<div class="cards report-summary-cards">
    <div class="card"><div class="card-label">Nama</div><div class="card-value" style="font-size:16px">${escapeHtml(nama)}</div></div>
    <div class="card"><div class="card-label">Jabatan</div><div class="card-value" style="font-size:16px">${escapeHtml(rekapRow.jabatan)}</div></div>
    <div class="card"><div class="card-label">% Hadir</div><div class="card-value">${(rekapRow.persenKehadiran * 100).toFixed(1)}%</div></div>
    <div class="card"><div class="card-label">Alfa/Izin/Sakit</div><div class="card-value" style="color:#ef4444">${rekapRow.alfa}/${rekapRow.izin}/${rekapRow.sakit}</div></div>
    <div class="card"><div class="card-label">Jam Kerja</div><div class="card-value">${typeof rekapRow.totalJamKerja === 'number' ? rekapRow.totalJamKerja : '-'}</div></div>
  </div>` : '';
  return { title: 'Detail Report - ' + (nama || '-') + ' (' + (STATE.period || '') + ')', columns, rows, extraHtml };
}

function buildDepartmentReport_() {
  const deptChecked = getCheckedValues_('reportDeptFilter');
  const deptMap = getDepartmentMap_();
  const byDept = {};
  (STATE.rekap || []).filter(r => r.nama && String(r.nama).trim() !== '').forEach(r => {
    const dept = deptMap[r.nama] || r.jabatan || 'Tanpa Department';
    if (deptChecked.length && !deptChecked.includes(dept)) return;
    if (!byDept[dept]) byDept[dept] = { n: 0, jadwal: 0, hadir: 0, alfa: 0, izin: 0, sakit: 0, cuti: 0, off: 0, pctSum: 0 };
    const b = byDept[dept];
    b.n++; b.jadwal += Number(r.jadwal) || 0; b.hadir += Number(r.hadir) || 0;
    b.alfa += Number(r.alfa) || 0; b.izin += Number(r.izin) || 0; b.sakit += Number(r.sakit) || 0;
    b.cuti += Number(r.cuti) || 0; b.off += Number(r.off) || 0; b.pctSum += Number(r.persenKehadiran) || 0;
  });
  const columns = ['Department', 'Jumlah Karyawan', 'Jadwal', 'Hadir', 'Alfa', 'Izin', 'Sakit', 'Cuti', 'OFF', 'Rata-rata % Hadir'];
  const rows = Object.keys(byDept).sort().map(dept => {
    const b = byDept[dept];
    return [dept, b.n, b.jadwal, b.hadir, b.alfa, b.izin, b.sakit, b.cuti, b.off, ((b.pctSum / b.n) * 100).toFixed(1) + '%'];
  });
  return { title: 'Department Report - ' + (STATE.period || ''), columns, rows, extraHtml: '' };
}

function buildExceptionReport_() {
  const jenisChecked = getCheckedValues_('reportExceptionJenisFilter');
  const dayStart = parseInt(document.getElementById('reportExceptionDayStart').value, 10) || 1;
  const dayEnd = parseInt(document.getElementById('reportExceptionDayEnd').value, 10) || (STATE.dayCount || 1);
  const dayNames = STATE.dayNames || [];
  const columns = ['No', 'Tanggal', 'Nama', 'Jabatan', 'Jenis', 'Keterangan'];
  const rows = [];
  let no = 1;

  (STATE.realisasi || []).forEach(emp => {
    const jadwalEmp = (STATE.jadwal || []).find(e => e.nama === emp.nama);
    for (let d = dayStart; d <= dayEnd; d++) {
      const idx = d - 1;
      const rCode = normalizeCode(emp.days[idx]);
      const label = (STATE.statusCodes[rCode] || {}).label || '';
      const jCode = jadwalEmp ? normalizeCode(jadwalEmp.days[idx]) : '';
      let jenis = null;
      if (/alfa/i.test(label)) jenis = 'Alfa';
      else if (/izin/i.test(label)) jenis = 'Izin';
      else if (/sakit/i.test(label)) jenis = 'Sakit';
      else if (!rCode && jCode && jCode !== 'OFF') jenis = 'Tidak Finger';
      if (jenis && jenisChecked.includes(jenis)) {
        rows.push([no++, d + ' ' + (dayNames[idx] || ''), emp.nama, emp.jabatan, jenis, label || '-']);
      }
    }
  });
  return { title: 'Exception Report - ' + (STATE.period || ''), columns, rows, extraHtml: '' };
}

/* ---- Preview / Print / Export generik untuk ke-4 report ---- */

function renderReportTable_(wrapId, extraWrapId, result) {
  const extraWrap = document.getElementById(extraWrapId);
  if (extraWrap) extraWrap.innerHTML = result.extraHtml || '';
  let html = '<table><thead><tr>' + result.columns.map(c => `<th>${escapeHtml(String(c))}</th>`).join('') + '</tr></thead><tbody>';
  if (!result.rows.length) {
    html += `<tr><td colspan="${result.columns.length}" class="muted" style="padding:20px;">Tidak ada data untuk filter ini.</td></tr>`;
  } else {
    result.rows.forEach(row => { html += '<tr>' + row.map(c => `<td>${escapeHtml(String(c))}</td>`).join('') + '</tr>'; });
  }
  html += '</tbody></table>';
  document.getElementById(wrapId).innerHTML = html;
}

function previewReport_(kind) {
  if (!SESSION) { toast('Silakan login dulu', true); return; }
  if (!STATE) { toast('Data belum dimuat', true); return; }
  if (kind === 'detail' && !document.getElementById('reportDetailEmployee').value) {
    toast('Pilih karyawan terlebih dahulu', true); return;
  }
  const builders = { summary: buildSummaryReport_, detail: buildDetailReport_, dept: buildDepartmentReport_, exception: buildExceptionReport_ };
  const wrapIds = { summary: 'reportSummaryWrap', detail: 'reportDetailWrap', dept: 'reportDeptWrap', exception: 'reportExceptionWrap' };
  const extraIds = { summary: 'reportSummaryExtra', detail: 'reportDetailExtra', dept: 'reportDeptExtra', exception: 'reportExceptionExtra' };
  const result = builders[kind]();
  REPORT_LAST[kind] = result;
  renderReportTable_(wrapIds[kind], extraIds[kind], result);
  toast('Preview siap: ' + result.title);
}

function printReport_(kind) {
  const result = REPORT_LAST[kind];
  if (!result) { toast('Klik Preview terlebih dahulu', true); return; }
  const w = window.open('', '_blank');
  const rowsHtml = result.rows.map(row => '<tr>' + row.map(c => `<td>${escapeHtml(String(c))}</td>`).join('') + '</tr>').join('');
  w.document.write(`<html><head><title>${escapeHtml(result.title)}</title>
    <style>body{font-family:Arial,sans-serif;padding:20px;color:#1e293b;}h2{margin-bottom:4px;}p{color:#64748b;margin-top:0;}
    table{border-collapse:collapse;width:100%;font-size:12px;}th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;}th{background:#f1f5f9;}</style>
    </head><body><h2>${escapeHtml(result.title)}</h2>
    <p>PT Swadharma Primautama - Departemen Housekeeping | Dicetak: ${new Date().toLocaleString('id-ID')}</p>
    <table><thead><tr>${result.columns.map(c => `<th>${escapeHtml(String(c))}</th>`).join('')}</tr></thead>
    <tbody>${rowsHtml || '<tr><td colspan="' + result.columns.length + '">Tidak ada data</td></tr>'}</tbody></table></body></html>`);
  w.document.close(); w.focus();
  setTimeout(() => w.print(), 300);
}

function exportReport_(kind, format) {
  const result = REPORT_LAST[kind];
  if (!result) { toast('Klik Preview terlebih dahulu', true); return; }
  if (!SESSION) { toast('Silakan login dulu', true); return; }
  const btn = document.getElementById('reportBtn_' + kind + '_' + format);
  if (btn) { btn.disabled = true; btn.dataset.origText = btn.textContent; btn.textContent = '⏳ Memproses...'; }
  const fn = format === 'excel' ? 'generateReportExcel' : 'generateReportPdf';
  google.script.run
    .withSuccessHandler(res => {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.origText; }
      triggerBase64Download(res.base64, res.filename, res.mimeType);
      toast(result.title + ' berhasil diexport');
    })
    .withFailureHandler(err => {
      if (btn) { btn.disabled = false; btn.textContent = btn.dataset.origText; }
      toast('Gagal export: ' + err.message, true);
    })[fn](kind, result.title, result.columns, result.rows, SESSION.token);
}
/* ============ CHATBOT AI ============ */

function initAIChatDrag_() {
  const box = document.getElementById('aiChatBoxEl');
  const handle = document.getElementById('aiChatDragHandle');
  if (!box || !handle) return;
  let dragging = false;
  let offsetX = 0, offsetY = 0;

  function getPoint(e) { return e.touches ? e.touches[0] : e; }

  function onPointerDown(e) {
    dragging = true;
    const rect = box.getBoundingClientRect();
    const p = getPoint(e);
    offsetX = p.clientX - rect.left;
    offsetY = p.clientY - rect.top;
    box.style.left = rect.left + 'px';
    box.style.top = rect.top + 'px';
    box.style.right = 'auto';
    box.style.bottom = 'auto';
    box.classList.add('dragging');
    document.addEventListener('mousemove', onPointerMove);
    document.addEventListener('touchmove', onPointerMove, { passive: false });
    document.addEventListener('mouseup', onPointerUp);
    document.addEventListener('touchend', onPointerUp);
  }

  function onPointerMove(e) {
    if (!dragging) return;
    if (e.touches) e.preventDefault();
    const p = getPoint(e);
    const maxLeft = Math.max(4, window.innerWidth - box.offsetWidth - 4);
    const maxTop = Math.max(4, window.innerHeight - box.offsetHeight - 4);
    const newLeft = Math.min(Math.max(4, p.clientX - offsetX), maxLeft);
    const newTop = Math.min(Math.max(4, p.clientY - offsetY), maxTop);
    box.style.left = newLeft + 'px';
    box.style.top = newTop + 'px';
  }

  function onPointerUp() {
    dragging = false;
    box.classList.remove('dragging');
    document.removeEventListener('mousemove', onPointerMove);
    document.removeEventListener('touchmove', onPointerMove);
    document.removeEventListener('mouseup', onPointerUp);
    document.removeEventListener('touchend', onPointerUp);
  }

  handle.addEventListener('mousedown', onPointerDown);
  handle.addEventListener('touchstart', onPointerDown, { passive: true });
}
function openAIChatPicker() {
  if (!SESSION) {
    toast('Silakan login dulu untuk pakai chatbot AI', true);
    showLoginGate();
    return;
  }
  document.getElementById('aiChatPicker').classList.remove('hidden');
  document.getElementById('aiChatInput').focus();
}

function closeAIChatPicker() {
  document.getElementById('aiChatPicker').classList.add('hidden');
}

function appendAIChatMsg_(teks, sender) {
  const log = document.getElementById('aiChatLog');
  const div = document.createElement('div');
  div.className = 'ai-chat-msg ' + sender;
  div.textContent = teks;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function sendAIChatMessage() {
  if (!SESSION) return;
  const input = document.getElementById('aiChatInput');
  const pesan = input.value.trim();
  if (!pesan) return;

  appendAIChatMsg_(pesan, 'user');
  input.value = '';
  input.disabled = true;
  document.getElementById('aiChatConfirmArea').classList.add('hidden');
  document.getElementById('aiChatConfirmArea').innerHTML = '';

  const thinkingMsg = document.createElement('div');
  thinkingMsg.className = 'ai-chat-msg bot';
  thinkingMsg.textContent = '⏳ Berpikir...';
  document.getElementById('aiChatLog').appendChild(thinkingMsg);
  document.getElementById('aiChatLog').scrollTop = document.getElementById('aiChatLog').scrollHeight;

  google.script.run
    .withSuccessHandler(res => {
      input.disabled = false;
      input.focus();
      thinkingMsg.remove();

      if (res.action === 'konfirmasi_kirim_email') {
        appendAIChatMsg_(res.teks, 'bot');
        const area = document.getElementById('aiChatConfirmArea');
        area.innerHTML = `
          <div style="margin-bottom:8px;">${escapeHtml(res.teks)}</div>
          <button class="btn btn-primary" id="aiChatConfirmYes">✔ Ya, Kirim</button>
          <button class="btn btn-ghost" id="aiChatConfirmNo">Batal</button>
        `;
        area.classList.remove('hidden');
        document.getElementById('aiChatConfirmYes').onclick = () => {
          area.innerHTML = '⏳ Mengirim email...';
          google.script.run
            .withSuccessHandler(r => {
              area.classList.add('hidden');
              area.innerHTML = '';
              appendAIChatMsg_('✅ Email berhasil dikirim ke ' + r.tujuanEmail, 'bot');
            })
            .withFailureHandler(err => {
              area.classList.add('hidden');
              area.innerHTML = '';
              appendAIChatMsg_('❌ Gagal kirim email: ' + err.message, 'bot');
            })
            .confirmSendEmailReport(res.tglMulai, res.tglAkhir, res.tujuanEmail, SESSION.token);
        };
        document.getElementById('aiChatConfirmNo').onclick = () => {
          area.classList.add('hidden');
          area.innerHTML = '';
          appendAIChatMsg_('Baik, dibatalkan.', 'bot');
        };
      } else {
        appendAIChatMsg_(res.teks, 'bot');
      }
    })
    .withFailureHandler(err => {
      input.disabled = false;
      thinkingMsg.remove();
      appendAIChatMsg_('❌ ' + err.message, 'bot');
    })
    .chatWithAI(pesan, SESSION.token);
}
    /* ============ HAK AKSES: FILTER SIDEBAR SESUAI PERMISSION ============ */

  function applyMenuPermissions_() {
    if (!SESSION) return;
    google.script.run
      .withSuccessHandler(allowedKeys => {
        const allowedSet = new Set(allowedKeys || []);
        document.querySelectorAll('.tab-btn[data-tab]').forEach(btn => {
          btn.style.display = allowedSet.has(btn.dataset.tab) ? '' : 'none';
        });
        document.querySelectorAll('.nav-group').forEach(group => {
          const anyVisible = Array.from(group.querySelectorAll('.tab-btn[data-tab]')).some(b => b.style.display !== 'none');
          group.style.display = anyVisible ? '' : 'none';
        });
      })
      .withFailureHandler(() => { /* gagal ambil permission -> biarkan semua menu tampil (fail-open, aman) */ })
      .getMyMenuPermissions(SESSION.token);
  }

  /* ============ SETTING » ACCOUNT ============ */

  let USERS_LIST_DATA = [];

  function loadUsersList() {
    if (!SESSION) return;
    document.getElementById('settingUsersWrap').innerHTML = '<p class="muted">Memuat...</p>';
    google.script.run
      .withSuccessHandler(list => { USERS_LIST_DATA = list || []; renderUsersTable(); })
      .withFailureHandler(err => toast('Gagal memuat daftar user: ' + err.message, true))
      .getUsersList(SESSION.token);
  }

  function renderUsersTable() {
    const canEdit = !!SESSION && SESSION.role === 'Super Admin';
    const cols = ['Username', 'Nama', 'Role', 'Status'];
    let html = '<table><thead><tr>' + cols.map(c => `<th>${c}</th>`).join('') + (canEdit ? '<th>Aksi</th>' : '') + '</tr></thead><tbody>';
    USERS_LIST_DATA.forEach(u => {
      const isNonaktif = u.status === 'Nonaktif';
      html += `<tr>
        <td>${escapeHtml(u.username)}</td>
        <td class="name-col">${escapeHtml(u.nama)}</td>
        <td>${escapeHtml(u.role)}</td>
        <td>${isNonaktif ? '<span style="color:#dc2626;font-weight:600;">Nonaktif</span>' : '<span style="color:#16a34a;font-weight:600;">Aktif</span>'}</td>
        ${canEdit ? `<td style="white-space:nowrap;">
          <button class="btn btn-ghost" onclick='openResetUserPasswordPicker(${JSON.stringify(u.username)})'>🔑 Reset Password</button>
          <button class="btn ${isNonaktif ? 'btn-add' : 'btn-danger'}" onclick='toggleUserStatus(${JSON.stringify(u.username)}, ${JSON.stringify(isNonaktif ? "Aktif" : "Nonaktif")})'>${isNonaktif ? '✔ Aktifkan' : '🚫 Nonaktifkan'}</button>
        </td>` : ''}
      </tr>`;
    });
    html += '</tbody></table>';
    document.getElementById('settingUsersWrap').innerHTML = html;
  }

  function openAddUserPicker() {
    if (!SESSION || SESSION.role !== 'Super Admin') { toast('Hanya admin yang boleh menambah user', true); return; }
    document.getElementById('newUserNama').value = '';
    document.getElementById('newUserUsername').value = '';
    document.getElementById('newUserPassword').value = '';
    document.getElementById('addUserError').textContent = '';
    const sel = document.getElementById('newUserRole');
    google.script.run
      .withSuccessHandler(roles => {
        const base = [{ roleName: 'admin' }, { roleName: 'input' }];
        const extra = (roles || []).filter(r => r.roleName !== 'Super Admin' && r.roleName !== 'input');
        sel.innerHTML = base.concat(extra).map(r => `<option value="${escapeHtml(r.roleName)}">${escapeHtml(r.roleName)}</option>`).join('');
      })
      .withFailureHandler(() => { sel.innerHTML = '<option value="input">input</option><option value="admin">admin</option>'; })
      .getRolesList(SESSION.token);
    document.getElementById('addUserPicker').classList.remove('hidden');
  }
  function closeAddUserPicker() { document.getElementById('addUserPicker').classList.add('hidden'); }

  function submitAddUser() {
    const nama = document.getElementById('newUserNama').value.trim();
    const username = document.getElementById('newUserUsername').value.trim();
    const password = document.getElementById('newUserPassword').value;
    const role = document.getElementById('newUserRole').value;
    if (!nama || !username || !password) {
      document.getElementById('addUserError').textContent = 'Semua kolom wajib diisi.';
      return;
    }
    const btn = document.getElementById('addUserSubmit');
    btn.disabled = true;
    google.script.run
      .withSuccessHandler(list => {
        btn.disabled = false;
        closeAddUserPicker();
        USERS_LIST_DATA = list || [];
        renderUsersTable();
        toast('User "' + username + '" berhasil ditambahkan.');
      })
      .withFailureHandler(err => {
        btn.disabled = false;
        document.getElementById('addUserError').textContent = err.message;
      })
      .addUserWeb(nama, username, password, role, SESSION.token);
  }

  function toggleUserStatus(username, newStatus) {
    if (!SESSION) return;
    google.script.run
      .withSuccessHandler(list => {
        USERS_LIST_DATA = list || [];
        renderUsersTable();
        toast('Status user "' + username + '" diubah jadi ' + newStatus);
      })
      .withFailureHandler(err => toast('Gagal mengubah status: ' + err.message, true))
      .setUserStatus(username, newStatus, SESSION.token);
  }

  let resetUserPasswordTarget = null;
  function openResetUserPasswordPicker(username) {
    resetUserPasswordTarget = username;
    document.getElementById('resetUserPasswordTitle').textContent = 'Reset Password — ' + username;
    document.getElementById('resetUserPasswordInput').value = '';
    document.getElementById('resetUserPasswordError').textContent = '';
    document.getElementById('resetUserPasswordPicker').classList.remove('hidden');
  }
  function closeResetUserPasswordPicker() {
    document.getElementById('resetUserPasswordPicker').classList.add('hidden');
    resetUserPasswordTarget = null;
  }

  function submitResetUserPassword() {
    if (!resetUserPasswordTarget || !SESSION) return;
    const pass = document.getElementById('resetUserPasswordInput').value;
    if (!pass || pass.length < 6) {
      document.getElementById('resetUserPasswordError').textContent = 'Password minimal 6 karakter.';
      return;
    }
    const btn = document.getElementById('resetUserPasswordSubmit');
    btn.disabled = true;
    google.script.run
      .withSuccessHandler(() => {
        btn.disabled = false;
        closeResetUserPasswordPicker();
        toast('Password user berhasil direset.');
      })
      .withFailureHandler(err => {
        btn.disabled = false;
        document.getElementById('resetUserPasswordError').textContent = err.message;
      })
      .resetUserPasswordByAdmin(resetUserPasswordTarget, pass, SESSION.token);
  }

  /* ============ SETTING » JAM KERJA ============ */

let JAMKERJA_SETTINGS_DATA = [];

function loadJamKerjaSettings() {
  if (!SESSION) return;
  const wrap = document.getElementById('settingJamKerjaWrap');
  if (wrap) wrap.innerHTML = '<p class="muted">Memuat...</p>';
  google.script.run
    .withSuccessHandler(list => { JAMKERJA_SETTINGS_DATA = list || []; renderJamKerjaSettingsForm(); })
    .withFailureHandler(err => toast('Gagal memuat Setting Jam Kerja: ' + err.message, true))
    .getJamKerjaSettings(SESSION.token);
}

function renderJamKerjaSettingsForm() {
  const canEdit = !!SESSION && SESSION.role === 'Super Admin';
  let html = '<table><thead><tr><th>Kode Shift</th><th>Label</th><th>Jam Masuk Standar</th><th>Jam Pulang Standar</th></tr></thead><tbody>';
  JAMKERJA_SETTINGS_DATA.forEach(s => {
    html += `<tr data-kode="${escapeHtml(s.kodeShift)}">
      <td><strong>${escapeHtml(s.kodeShift)}</strong></td>
      <td>${escapeHtml(s.label)}</td>
      <td><input type="time" class="jk-jam-masuk" value="${escapeHtml(s.jamMasuk)}" ${canEdit ? '' : 'disabled'}></td>
      <td><input type="time" class="jk-jam-pulang" value="${escapeHtml(s.jamPulang)}" ${canEdit ? '' : 'disabled'}></td>
    </tr>`;
  });
  html += '</tbody></table>';
  if (canEdit) {
    html += '<div style="margin-top:12px;"><button class="btn btn-primary" id="saveJamKerjaBtn" onclick="saveJamKerjaSettings()">💾 Simpan Setting Jam Kerja</button></div>';
  }
  const wrap = document.getElementById('settingJamKerjaWrap');
  if (wrap) wrap.innerHTML = html;
}

function saveJamKerjaSettings() {
  if (!SESSION || SESSION.role !== 'Super Admin') return;
  const wrap = document.getElementById('settingJamKerjaWrap');
  const rows = wrap.querySelectorAll('tbody tr');
  const settings = Array.from(rows).map(tr => ({
    kodeShift: tr.dataset.kode,
    jamMasuk: tr.querySelector('.jk-jam-masuk').value,
    jamPulang: tr.querySelector('.jk-jam-pulang').value
  }));

  const btn = document.getElementById('saveJamKerjaBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Menyimpan...';

  google.script.run
    .withSuccessHandler(list => {
      btn.disabled = false;
      btn.textContent = '💾 Simpan Setting Jam Kerja';
      JAMKERJA_SETTINGS_DATA = list || [];
      renderJamKerjaSettingsForm();
      toast('Setting Jam Kerja berhasil disimpan.');
    })
    .withFailureHandler(err => {
      btn.disabled = false;
      btn.textContent = '💾 Simpan Setting Jam Kerja';
      toast('Gagal menyimpan: ' + err.message, true);
    })
    .setJamKerjaSettings(settings, SESSION.token);
}
  /* ============ SETTING » ASSIGN KARYAWAN KE JADWAL ============ */

  let UNASSIGNED_EMPLOYEES_DATA = [];

  function loadUnassignedEmployees_() {
    if (!SESSION) return;
    const wrap = document.getElementById('assignJadwalWrap');
    if (wrap) wrap.innerHTML = '<p class="muted">Memuat...</p>';
    const periodLabelEl = document.getElementById('assignJadwalPeriodLabel');
    if (periodLabelEl) periodLabelEl.textContent = (STATE && STATE.period) ? STATE.period : '-';

    google.script.run
      .withSuccessHandler(list => {
        DAFTAR_KARYAWAN_DATA = list || [];
        UNASSIGNED_EMPLOYEES_DATA = DAFTAR_KARYAWAN_DATA.filter(k => k.statusAssignment === 'Belum Terjadwal');
        renderUnassignedEmployeesTable_();
        updateAssignJadwalBadge_();
        populateDepartmentFilterOptions_();
      })
      .withFailureHandler(err => {
        toast('Gagal memuat karyawan belum terjadwal: ' + err.message, true);
        if (isAuthError_(err.message)) doLogout();
      })
      .getDaftarKaryawan(SESSION.token);
  }

  function renderUnassignedEmployeesTable_() {
    const wrap = document.getElementById('assignJadwalWrap');
    if (!wrap) return;
    if (!UNASSIGNED_EMPLOYEES_DATA.length) {
      wrap.innerHTML = '<p class="muted">Semua karyawan sudah ter-assign ke Jadwal. Tidak ada yang perlu diproses.</p>';
      return;
    }
    let html = '<table><thead><tr><th><input type="checkbox" id="assignSelectAll" onclick="toggleAssignSelectAll_(this)"></th><th>NIK</th><th class="name-col">Nama</th><th>Jabatan</th></tr></thead><tbody>';
    UNASSIGNED_EMPLOYEES_DATA.forEach(k => {
      html += `<tr>
        <td><input type="checkbox" class="assign-jadwal-chk" value="${escapeHtml(k.nama)}"></td>
        <td>${k.nik ? escapeHtml(k.nik) : '-'}</td>
        <td class="name-col">${escapeHtml(k.nama)}</td>
        <td>${k.jabatan ? escapeHtml(k.jabatan) : '-'}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
  }

  function toggleAssignSelectAll_(cb) {
    document.querySelectorAll('.assign-jadwal-chk').forEach(el => { el.checked = cb.checked; });
  }

  function submitAssignSelected_() {
    if (!SESSION || SESSION.role !== 'Super Admin') { toast('Hanya admin yang boleh melakukan assign', true); return; }
    const selected = Array.from(document.querySelectorAll('.assign-jadwal-chk:checked')).map(el => el.value);
    if (!selected.length) { toast('Pilih minimal 1 karyawan terlebih dahulu', true); return; }
    if (!confirm('Assign ' + selected.length + ' karyawan ke Jadwal periode aktif ("' + (STATE && STATE.period ? STATE.period : '-') + '")?')) return;

    const btn = document.getElementById('assignSelectedBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Memproses...';

    google.script.run
      .withSuccessHandler(data => {
        btn.disabled = false;
        btn.textContent = '➕ Assign ke Jadwal Periode Aktif';
        applyStateAndRerender_(data);
        loadUnassignedEmployees_();
        const info = data.assignInfo || { assigned: [], skipped: [] };
        let msg = info.assigned.length + ' karyawan berhasil masuk Jadwal.';
        if (info.skipped && info.skipped.length) {
          msg += ' Dilewati: ' + info.skipped.map(s => s.nama + ' (' + s.alasan + ')').join(', ');
          toast(msg, true);
        } else {
          toast(msg);
        }
      })
      .withFailureHandler(err => {
        btn.disabled = false;
        btn.textContent = '➕ Assign ke Jadwal Periode Aktif';
        toast('Gagal assign karyawan: ' + err.message, true);
      })
      .assignEmployeeToJadwal(selected, SESSION.token);
  }
  function submitDeleteUnassignedSelected_() {
  if (!SESSION || SESSION.role !== 'Super Admin') { toast('Hanya admin yang boleh melakukan hapus', true); return; }
  const selected = Array.from(document.querySelectorAll('.assign-jadwal-chk:checked')).map(el => el.value);
  if (!selected.length) { toast('Pilih minimal 1 karyawan terlebih dahulu', true); return; }
  if (!confirm('Hapus permanen ' + selected.length + ' karyawan dari Daftar Karyawan? Tindakan ini tidak bisa dibatalkan.')) return;

  const btn = document.getElementById('deleteUnassignedBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Menghapus...';

  google.script.run
    .withSuccessHandler(data => {
      btn.disabled = false;
      btn.textContent = '🗑️ Hapus Terpilih';
      applyStateAndRerender_(data);
      loadUnassignedEmployees_();
      const info = data.deleteUnassignedInfo || { deleted: [], skipped: [] };
      let msg = info.deleted.length + ' karyawan berhasil dihapus.';
      if (info.skipped && info.skipped.length) {
        msg += ' Dilewati: ' + info.skipped.map(s => s.nama + ' (' + s.alasan + ')').join(', ');
        toast(msg, true);
      } else {
        toast(msg);
      }
    })
    .withFailureHandler(err => {
      btn.disabled = false;
      btn.textContent = '🗑️ Hapus Terpilih';
      toast('Gagal menghapus karyawan: ' + err.message, true);
      if (isAuthError_(err.message)) doLogout();
    })
    .deleteUnassignedEmployee(selected, SESSION.token);
}
  function updateAssignJadwalBadge_() {
    const badge = document.getElementById('assignJadwalBadge');
    if (!badge) return;
    const count = UNASSIGNED_EMPLOYEES_DATA.length;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.toggle('hidden', count === 0);
  }
  /* ============ SETTING » HAK AKSES ============ */

  let HAKAKSES_DATA = null;

  function loadHakAksesMatrix() {
    if (!SESSION) return;
    document.getElementById('settingHakAksesWrap').innerHTML = '<p class="muted">Memuat...</p>';
    google.script.run
      .withSuccessHandler(data => { HAKAKSES_DATA = data; renderHakAksesMatrix(); })
      .withFailureHandler(err => toast('Gagal memuat hak akses: ' + err.message, true))
      .getRolePermissionsMatrix(SESSION.token);
  }

  function renderHakAksesMatrix() {
    if (!HAKAKSES_DATA) return;
    const roles = HAKAKSES_DATA.roles.filter(r => r.roleName !== 'Super Admin');
    const menus = HAKAKSES_DATA.menus;
    const permMap = {};
    HAKAKSES_DATA.permissions.forEach(p => { permMap[p.roleName + '|' + p.menuKey] = p.canView; });

    if (!roles.length) {
      document.getElementById('settingHakAksesWrap').innerHTML = '<p class="muted">Belum ada role selain admin. Klik "➕ Tambah Role" untuk membuat role baru.</p>';
      return;
    }

    let html = '<table><thead><tr><th class="name-col">Menu</th>' + roles.map(r => `<th>${escapeHtml(r.roleName)}</th>`).join('') + '</tr></thead><tbody>';
    menus.forEach(m => {
      html += `<tr><td class="name-col">${escapeHtml(m.label)}</td>`;
      roles.forEach(r => {
        const checked = permMap[r.roleName + '|' + m.key] ? 'checked' : '';
        html += `<td><input type="checkbox" data-role="${escapeHtml(r.roleName)}" data-menu="${m.key}" ${checked}></td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    document.getElementById('settingHakAksesWrap').innerHTML = html;
  }

  function saveHakAksesMatrix() {
    if (!SESSION || !HAKAKSES_DATA) return;
    const table = document.querySelector('#settingHakAksesWrap table');
    if (!table) { toast('Tidak ada role untuk disimpan.', true); return; }
    const roles = HAKAKSES_DATA.roles.filter(r => r.roleName !== 'Super Admin');
    const btn = document.getElementById('saveHakAksesBtn');
    btn.disabled = true;
    btn.textContent = '⏳ Menyimpan...';

    const tasks = roles.map(r => ({
      roleName: r.roleName,
      menuKeys: Array.from(table.querySelectorAll(`input[data-role="${CSS.escape(r.roleName)}"]:checked`)).map(cb => cb.dataset.menu)
    }));

    function runNext(i) {
      if (i >= tasks.length) {
        btn.disabled = false;
        btn.textContent = '💾 Simpan Perubahan';
        toast('Hak akses berhasil disimpan.');
        loadHakAksesMatrix();
        return;
      }
      google.script.run
        .withSuccessHandler(() => runNext(i + 1))
        .withFailureHandler(err => {
          btn.disabled = false;
          btn.textContent = '💾 Simpan Perubahan';
          toast('Gagal menyimpan hak akses (' + tasks[i].roleName + '): ' + err.message, true);
        })
        .setRolePermissions(tasks[i].roleName, tasks[i].menuKeys, SESSION.token);
    }
    runNext(0);
  }

  function openAddRolePicker() {
    if (!SESSION || SESSION.role !== 'Super Admin') { toast('Hanya admin yang boleh menambah role', true); return; }
    document.getElementById('newRoleName').value = '';
    document.getElementById('newRoleDeskripsi').value = '';
    document.getElementById('addRoleError').textContent = '';
    document.getElementById('addRolePicker').classList.remove('hidden');
  }
  function closeAddRolePicker() { document.getElementById('addRolePicker').classList.add('hidden'); }

  function submitAddRole() {
    const roleName = document.getElementById('newRoleName').value.trim();
    const deskripsi = document.getElementById('newRoleDeskripsi').value.trim();
    if (!roleName) { document.getElementById('addRoleError').textContent = 'Nama role wajib diisi.'; return; }
    const btn = document.getElementById('addRoleSubmit');
    btn.disabled = true;
    google.script.run
      .withSuccessHandler(() => {
        btn.disabled = false;
        closeAddRolePicker();
        toast('Role "' + roleName + '" berhasil ditambahkan.');
        loadHakAksesMatrix();
      })
      .withFailureHandler(err => {
        btn.disabled = false;
        document.getElementById('addRoleError').textContent = err.message;
      })
      .addRole(roleName, deskripsi, SESSION.token);}

/* ============ PENGAJUAN IZIN (Notifikasi + Approve/Reject) — REBUILD v2 (fix onclick) ============ */

let PENGAJUAN_LIST_DATA = [];
let pengajuanBadgePollTimer = null;
let rejectPengajuanTarget = null;
let pengajuanWrapListenerAttached_ = false;

function startPengajuanBadgePolling_() {
  loadPengajuanBadgeCount_();
  if (pengajuanBadgePollTimer) clearInterval(pengajuanBadgePollTimer);
  pengajuanBadgePollTimer = setInterval(loadPengajuanBadgeCount_, 60000);
}

function loadPengajuanBadgeCount_() {
  if (!SESSION || SESSION.role !== 'Super Admin') return;
  google.script.run
    .withSuccessHandler(res => {
      const badge = document.getElementById('pengajuanBadge');
      if (!badge) return;
      const count = res.count || 0;
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.classList.toggle('hidden', count === 0);
    })
    .withFailureHandler(() => { /* diamkan, tidak kritikal */ })
    .getPengajuanPendingCount(SESSION.token);
}

/** Pasang SEKALI SAJA event delegation untuk tombol Approve/Reject di dalam tabel. */
function ensurePengajuanWrapListener_() {
  if (pengajuanWrapListenerAttached_) return;
  const wrap = document.getElementById('pengajuanWrap');
  if (!wrap) return;
  wrap.addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn || !wrap.contains(btn)) return;
    const id = btn.dataset.id;
    const nama = btn.dataset.nama || '';
    if (btn.dataset.action === 'approve') approvePengajuan_(id);
    else if (btn.dataset.action === 'reject') openRejectPengajuanPicker(id, nama);
  });
  pengajuanWrapListenerAttached_ = true;
}

/**
 * Muat daftar pengajuan sesuai filter status. Selalu berakhir di salah satu
 * dari tiga state: tabel terisi, pesan kosong, atau pesan error dengan
 * tombol "Coba Lagi" — TIDAK PERNAH dibiarkan macet di "Memuat...".
 */
function loadPengajuanList_() {
  if (!SESSION || SESSION.role !== 'Super Admin') return;
  ensurePengajuanWrapListener_();
  const wrap = document.getElementById('pengajuanWrap');
  if (wrap) wrap.innerHTML = '<p class="muted">⏳ Memuat daftar pengajuan...</p>';

  const statusSel = document.getElementById('pengajuanStatusFilter');
  const statusFilter = statusSel ? statusSel.value : 'Pending';

  google.script.run
    .withSuccessHandler(listJson => {
      let list = [];
      try {
        list = listJson ? JSON.parse(listJson) : [];
      } catch (e) {
        console.error('Gagal parse JSON pengajuan:', e, listJson);
        renderPengajuanError_('Data dari server tidak valid (gagal di-parse). Coba refresh.');
        return;
      }
      PENGAJUAN_LIST_DATA = list || [];
      renderPengajuanTable_();
      loadPengajuanBadgeCount_();
    })
    .withFailureHandler(err => {
      renderPengajuanError_(err.message);
      toast('Gagal memuat daftar pengajuan: ' + err.message, true);
      if (isAuthError_(err.message)) doLogout();
    })
    .getPengajuanListSafe(statusFilter, SESSION.token);
}

function renderPengajuanError_(message) {
  const wrap = document.getElementById('pengajuanWrap');
  if (!wrap) return;
  wrap.innerHTML =
    '<div style="padding:20px;text-align:center;">' +
    '<p style="color:#dc2626;margin-bottom:10px;">⚠ ' + escapeHtml(message) + '</p>' +
    '<button class="btn btn-ghost" onclick="loadPengajuanList_()">⟳ Coba Lagi</button>' +
    '</div>';
}

function pengajuanStatusBadge_(status) {
  const map = {
    'Pending': 'background:#fef3c7;color:#92400e;',
    'Approved': 'background:#dcfce7;color:#166534;',
    'Rejected': 'background:#fee2e2;color:#991b1b;'
  };
  const style = map[status] || 'background:#e2e8f0;color:#334155;';
  return `<span style="${style}padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;">${escapeHtml(status || '-')}</span>`;
}

/** Escape untuk dipakai di DALAM atribut HTML (data-id, data-nama, dst) — beda dari escapeHtml biasa karena kutip juga di-escape. */
function escapeAttrPengajuan_(str) {
  return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function renderPengajuanTable_() {
  ensurePengajuanWrapListener_();
  const cols = ['Nama', 'Jenis', 'Tgl Mulai', 'Tgl Akhir', 'Status', 'Alasan', 'Lampiran', 'Diajukan Pada', 'Aksi'];
  let html = '<table><thead><tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>';

  if (!PENGAJUAN_LIST_DATA.length) {
    html += `<tr><td colspan="${cols.length}" class="muted" style="padding:20px;text-align:center;">Tidak ada pengajuan untuk filter ini.</td></tr>`;
  } else {
    PENGAJUAN_LIST_DATA.forEach(p => {
      const isPending = p.status === 'Pending';
      const idAttr = escapeAttrPengajuan_(p.id);
      const namaAttr = escapeAttrPengajuan_(p.nama);
      let aksiCell;
      if (isPending) {
        aksiCell = `
          <button class="btn btn-add" data-action="approve" data-id="${idAttr}">✔ Approve</button>
          <button class="btn btn-danger" data-action="reject" data-id="${idAttr}" data-nama="${namaAttr}">✘ Reject</button>`;
      } else {
        const prosesInfo = p.diprosesOleh ? `oleh ${escapeHtml(p.diprosesOleh)}` : '';
        const prosesTgl = p.diprosesPada ? new Date(p.diprosesPada).toLocaleString('id-ID') : '';
        const catatan = p.catatanAdmin ? `<br><span class="muted">Catatan: ${escapeHtml(p.catatanAdmin)}</span>` : '';
        aksiCell = `<span class="muted">${prosesInfo} ${prosesTgl}</span>${catatan}`;
      }
      html += `<tr>
        <td class="name-col">${escapeHtml(p.nama)}</td>
        <td>${escapeHtml(p.jenis)}</td>
        <td>${escapeHtml(p.tglMulai)}</td>
        <td>${escapeHtml(p.tglAkhir)}</td>
        <td>${pengajuanStatusBadge_(p.status)}</td>
        <td>${escapeHtml(p.alasan)}</td>
        <td>${p.lampiranUrl ? `<a href="${escapeHtml(p.lampiranUrl)}" target="_blank" rel="noopener">Lihat</a>` : '-'}</td>
        <td>${p.diajukanPada ? new Date(p.diajukanPada).toLocaleString('id-ID') : '-'}</td>
        <td style="white-space:nowrap;">${aksiCell}</td>
      </tr>`;
    });
  }
  html += '</tbody></table>';
  const wrap = document.getElementById('pengajuanWrap');
  if (wrap) wrap.innerHTML = html;
}

function approvePengajuan_(id) {
  if (!SESSION) return;
  if (!confirm('Setujui pengajuan ini? Realisasi karyawan akan otomatis ditandai sesuai jenis pengajuan pada rentang tanggalnya.')) return;

  google.script.run
    .withSuccessHandler(() => { toast('Pengajuan disetujui.'); loadPengajuanList_(); })
    .withFailureHandler(err => toast('Gagal menyetujui: ' + err.message, true))
    .approvePengajuan(id, SESSION.token);
}

/* ---- Reject via modal (pengganti prompt() bawaan browser) ---- */

function openRejectPengajuanPicker(id, nama) {
  rejectPengajuanTarget = id;
  document.getElementById('rejectPengajuanTitle').textContent = '✘ Tolak Pengajuan — ' + nama;
  document.getElementById('rejectPengajuanCatatan').value = '';
  document.getElementById('rejectPengajuanError').textContent = '';
  document.getElementById('rejectPengajuanPicker').classList.remove('hidden');
  document.getElementById('rejectPengajuanCatatan').focus();
}

function closeRejectPengajuanPicker() {
  document.getElementById('rejectPengajuanPicker').classList.add('hidden');
  rejectPengajuanTarget = null;
}

function submitRejectPengajuan() {
  if (!rejectPengajuanTarget || !SESSION) return;
  const catatan = document.getElementById('rejectPengajuanCatatan').value.trim();
  const btn = document.getElementById('rejectPengajuanSubmit');
  btn.disabled = true;
  btn.textContent = '⏳ Memproses...';

  google.script.run
    .withSuccessHandler(() => {
      btn.disabled = false;
      btn.textContent = 'Tolak Pengajuan';
      closeRejectPengajuanPicker();
      toast('Pengajuan ditolak.');
      loadPengajuanList_();
    })
    .withFailureHandler(err => {
      btn.disabled = false;
      btn.textContent = 'Tolak Pengajuan';
      document.getElementById('rejectPengajuanError').textContent = err.message;
    })
    .rejectPengajuan(rejectPengajuanTarget, catatan, SESSION.token);
}
  

      /* ============ DOWNLOAD DASHBOARD SEBAGAI PDF (screenshot HTML, bukan sheet) ============ */

async function downloadDashboardPdf() {
  if (typeof html2canvas === 'undefined' || typeof jspdf === 'undefined') {
    toast('Library PDF belum termuat, coba refresh halaman.', true);
    return;
  }

  const btn = document.getElementById('downloadDashboardPdfBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Membuat PDF...';

  const target = document.getElementById('tab-dashboard');
  if (!target) {
    btn.disabled = false;
    btn.textContent = originalText;
    toast('Elemen Dashboard tidak ditemukan.', true);
    return;
  }

  try {
    const canvas = await html2canvas(target, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      scrollY: -window.scrollY
    });

    const imgData = canvas.toDataURL('image/png');
    const { jsPDF } = jspdf;

    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 0;

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    const periodLabel = (STATE && STATE.period) ? STATE.period.replace(/[^\w]+/g, '_') : 'Dashboard';
    const dateStr = new Date().toISOString().slice(0, 10);
    pdf.save('Dashboard_' + periodLabel + '_' + dateStr + '.pdf');

    toast('PDF Dashboard berhasil dibuat.');
  } catch (err) {
    toast('Gagal membuat PDF: ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}
/* ============ SETTING » AUDIT LOG ============ */

let AUDIT_LOG_DATA = [];

function loadAuditLog_() {
  if (!SESSION) return;
  const wrap = document.getElementById('auditLogWrap');
  if (wrap) wrap.innerHTML = '<p class="muted">⏳ Memuat...</p>';

  const filter = {
    modul: document.getElementById('auditLogModulFilter').value,
    tanggalMulai: document.getElementById('auditLogTglMulai').value || null,
    tanggalAkhir: document.getElementById('auditLogTglAkhir').value || null,
    limit: 300
  };

  google.script.run
    .withSuccessHandler(result => {
      AUDIT_LOG_DATA = result.logs || [];
      populateAuditLogModulFilter_(result.modulList || []);
      renderAuditLogTable_();
      const infoEl = document.getElementById('auditLogCountInfo');
      if (infoEl) infoEl.textContent = 'Menampilkan ' + AUDIT_LOG_DATA.length + ' dari ' + (result.total || 0) + ' total log.';
    })
    .withFailureHandler(err => {
      if (wrap) wrap.innerHTML = '<p class="login-error">Gagal memuat Audit Log: ' + escapeHtml(err.message) + '</p>';
      toast('Gagal memuat Audit Log: ' + err.message, true);
      if (isAuthError_(err.message)) doLogout();
    })
    .getAuditLog(SESSION.token, filter);
}

function populateAuditLogModulFilter_(modulList) {
  const sel = document.getElementById('auditLogModulFilter');
  if (!sel) return;
  const prevValue = sel.value;
  sel.innerHTML = '<option value="ALL">Semua Modul</option>' +
    modulList.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  sel.value = selectHasOption_(sel, prevValue) ? prevValue : 'ALL';
}

function renderAuditLogTable_() {
  const wrap = document.getElementById('auditLogWrap');
  if (!wrap) return;

  const kw = (document.getElementById('searchAuditLog').value || '').trim().toLowerCase();
  const rows = kw
    ? AUDIT_LOG_DATA.filter(l =>
        (l.nama || '').toLowerCase().includes(kw) ||
        (l.username || '').toLowerCase().includes(kw) ||
        (l.target || '').toLowerCase().includes(kw) ||
        (l.detail || '').toLowerCase().includes(kw))
    : AUDIT_LOG_DATA;

  if (!rows.length) {
    wrap.innerHTML = '<p class="muted" style="padding:20px;text-align:center;">Tidak ada log untuk filter ini.</p>';
    return;
  }

  const cols = ['Waktu', 'User', 'Role', 'Aksi', 'Modul', 'Target', 'Detail'];
  let html = '<table><thead><tr>' + cols.map(c => `<th>${c}</th>`).join('') + '</tr></thead><tbody>';

  rows.forEach(l => {
    const waktu = new Date(l.timestamp);
    const waktuStr = isNaN(waktu.getTime()) ? l.timestamp : waktu.toLocaleString('id-ID');
    html += `<tr>
      <td>${escapeHtml(waktuStr)}</td>
      <td>${escapeHtml(l.nama || l.username)}</td>
      <td>${escapeHtml(l.role)}</td>
      <td>${escapeHtml(l.aksi)}</td>
      <td>${escapeHtml(l.modul)}</td>
      <td>${escapeHtml(l.target)}</td>
      <td>${escapeHtml(l.detail)}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  wrap.innerHTML = html;
}

function filterAuditLogTable_() {
  renderAuditLogTable_();
}
