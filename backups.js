// ===== Backup folder =====
// On Chrome/Edge (computer) you can link a folder once; the app then lists the backups
// in it, restores them and saves new ones straight into it.
// Other browsers (and phones) can't open folders, so they pick backup files instead.

const canUseFolders = 'showDirectoryPicker' in window;
let backupFolder = null; // the linked folder, once you've allowed access
let shownBackups = [];   // the backups in the list: { name, modified, backup }

// --- Remembering the folder between visits ---
// A folder can't be kept in localStorage, but it can be kept in IndexedDB.

function handleStore(mode, action) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('budgetApp', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('handles');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('handles', mode);
      const request = action(tx.objectStore('handles'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
    };
  });
}

const rememberFolder = folder => handleStore('readwrite', store => store.put(folder, 'backupFolder'));
const recallFolder = () => handleStore('readonly', store => store.get('backupFolder'));

// --- Reading backups ---

function isBackup(value) {
  return value && Array.isArray(value.paychecks) && Array.isArray(value.expenses);
}

// Reads backup files. Files that aren't budget backups are left out.
// Locked backups (saved with the app lock on) stay locked until you restore them.
async function readBackupFiles(files) {
  const backups = [];
  for (const file of files) {
    try {
      const backup = JSON.parse(await file.text());
      if (isBackup(backup)) backups.push({ name: file.name, modified: file.lastModified, backup });
      else if (isLockedBox(backup)) backups.push({ name: file.name, modified: file.lastModified, locked: backup });
    } catch {
      // not JSON, skip it
    }
  }
  return backups.sort((a, b) => b.modified - a.modified); // newest first
}

async function readFolder() {
  const files = [];
  for await (const entry of backupFolder.values()) {
    if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.json')) files.push(await entry.getFile());
  }
  return readBackupFiles(files);
}

// "4 paychecks · 37 expenses · Oct 1 – Nov 13"
function describeBackup(backup) {
  const dates = [...backup.paychecks, ...backup.expenses].map(x => x && x.date).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const range = dates.length ? ` · ${formatShortDate(dates[0])} – ${formatShortDate(dates[dates.length - 1])}` : '';
  return `${backup.paychecks.length} paychecks · ${backup.expenses.length} expenses${range}`;
}

function renderBackupList() {
  $('backup-list').innerHTML = shownBackups.map((b, i) => {
    const saved = new Date(b.modified).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return listItem(
      `${escapeHtml(b.name)}<div class="muted small">Saved ${saved} · ${b.locked ? 'Locked: needs the passcode it was saved with' : describeBackup(b.backup)}</div>`,
      `<button class="small-btn" data-restore-backup="${i}">Restore</button>`
    );
  }).join('');
}

// --- The linked folder ---

async function showFolder() {
  const status = $('folder-status');
  $('folder-save').hidden = !backupFolder;
  if (!backupFolder) {
    status.textContent = 'No folder chosen yet.';
    $('folder-pick').textContent = 'Choose backup folder';
    return;
  }
  // Browsers ask again for access after a restart; that needs a tap
  if (await backupFolder.queryPermission({ mode: 'readwrite' }) !== 'granted') {
    status.textContent = `Folder "${backupFolder.name}" needs your OK again.`;
    $('folder-pick').textContent = 'Reconnect folder';
    $('folder-save').hidden = true;
    return;
  }
  shownBackups = await readFolder();
  renderBackupList();
  status.textContent = `Folder "${backupFolder.name}" · ${shownBackups.length} backup${shownBackups.length === 1 ? '' : 's'}`;
  $('folder-pick').textContent = 'Change folder';
}

async function pickFolder() {
  try {
    // Reconnect the same folder if it only needs permission again
    if (backupFolder && await backupFolder.queryPermission({ mode: 'readwrite' }) !== 'granted') {
      if (await backupFolder.requestPermission({ mode: 'readwrite' }) === 'granted') return showFolder();
    }
    backupFolder = await window.showDirectoryPicker({ id: 'budget-backups', mode: 'readwrite' });
    await rememberFolder(backupFolder);
    await showFolder();
  } catch {
    // you closed the picker
  }
}

// Saves into the folder as budget-backup-2026-11-13-1530.json (the time keeps same-day backups apart)
async function saveToFolder() {
  const now = new Date();
  const time = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
  const name = `budget-backup-${today()}-${time}.json`;
  const file = await backupFolder.getFileHandle(name, { create: true });
  const writer = await file.createWritable();
  await writer.write(await makeBackupText()); // locked with your passcode if the app lock is on
  await writer.close();

  data.lastBackupDate = today();
  saveData();
  render();
  await showFolder();
  showToast(`Saved ${name}.`, null);
}

// ===== Backup events =====

$('folder-pick').addEventListener('click', pickFolder);
$('folder-save').addEventListener('click', () => saveToFolder().catch(() => alert("Couldn't save to the folder. Try reconnecting it.")));

// "Open backup files": list the picked files so you can look before restoring
$('import-file').addEventListener('change', async e => {
  const files = [...e.target.files];
  e.target.value = ''; // so picking the same files again still works
  if (files.length === 0) return;
  shownBackups = await readBackupFiles(files);
  if (shownBackups.length === 0) alert("None of those files are budget backups.");
  renderBackupList();
});

document.addEventListener('click', async e => {
  const button = e.target.closest('[data-restore-backup]');
  if (!button) return;
  const chosen = shownBackups[Number(button.dataset.restoreBackup)];
  if (!chosen.locked) {
    restoreBackup(chosen.backup);
    return;
  }
  // A locked backup: ask for the passcode it was saved with
  const passcode = await askPasscode('Passcode for this backup');
  if (passcode === null) return;
  try {
    const { text } = await decryptBox(chosen.locked, passcode);
    restoreBackup(JSON.parse(text));
  } catch {
    alert('Wrong passcode for this backup.');
  }
});

// ===== Start =====

$('folder-controls').hidden = !canUseFolders;
$('folder-unsupported').hidden = canUseFolders;
if (canUseFolders) {
  recallFolder()
    .then(folder => { backupFolder = folder || null; })
    .catch(() => {})
    .then(showFolder);
}
