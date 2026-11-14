// ===== App lock =====
// Optional passcode. When it's on, your data is encrypted before it's saved on this
// device (AES-GCM with a key made from your passcode), so someone with your phone or
// another website on the same address only sees scrambled text.
// The passcode itself is never saved. Forget it and the data can't be recovered.

const LOCKED_KEY = 'budgetApp-locked';
const PBKDF2_ITERATIONS = 600000;    // slows down anyone guessing passcodes
const AUTO_LOCK_MINUTES = 5;         // lock again after being away this long

let lockKey = null;                  // the encryption key while unlocked (never saved)
let lockSalt = null;
let saveQueue = Promise.resolve();   // keeps encrypted saves in order
let failedTries = 0;
let triesBlockedUntil = 0;
let hiddenAt = 0;

// --- Encryption helpers ---

function toBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function fromBase64(text) {
  return Uint8Array.from(atob(text), c => c.charCodeAt(0));
}

async function deriveKey(passcode, salt, iterations = PBKDF2_ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passcode), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Text -> a locked "box" (JSON text) that only the passcode can open
async function encryptText(text, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
  return JSON.stringify({ app: 'budget', locked: 1, iterations: PBKDF2_ITERATIONS, salt: toBase64(salt), iv: toBase64(iv), data: toBase64(cipher) });
}

// Opens a box with a passcode. Throws if the passcode is wrong.
async function decryptBox(box, passcode) {
  const salt = fromBase64(box.salt);
  const key = await deriveKey(passcode, salt, Number(box.iterations) || PBKDF2_ITERATIONS);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(box.iv) }, key, fromBase64(box.data));
  return { text: new TextDecoder().decode(plain), key, salt };
}

function isLockedBox(value) {
  return Boolean(value && value.locked === 1 && value.salt && value.iv && value.data);
}

function storedBox() {
  try {
    return JSON.parse(localStorage.getItem(LOCKED_KEY));
  } catch {
    return null;
  }
}

// --- Used by app.js and backups.js ---

function lockIsOn() {
  return lockKey !== null;
}

// Encrypts and saves in the background (called by saveData)
function saveLocked(text) {
  const key = lockKey;
  const salt = lockSalt;
  saveQueue = saveQueue
    .then(async () => {
      localStorage.setItem(LOCKED_KEY, await encryptText(text, key, salt));
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_KEY + '-unreadable');
    })
    .catch(() => alert("Couldn't save: this device's storage may be full. Download a backup now."));
}

// What a backup file contains: locked with your passcode when the lock is on
async function makeBackupText() {
  return lockIsOn() ? encryptText(JSON.stringify(data), lockKey, lockSalt) : JSON.stringify(data, null, 2);
}

// Asks for a passcode in a pop-up. Resolves with the text, or null if cancelled.
function askPasscode(title) {
  return new Promise(resolve => {
    const dialog = $('passcode-dialog');
    $('passcode-dialog-title').textContent = title;
    $('passcode-input').value = '';
    dialog.returnValue = '';
    dialog.showModal();
    $('passcode-input').focus();
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok' ? $('passcode-input').value : null);
      $('passcode-input').value = '';
    }, { once: true });
  });
}

// --- Lock screen ---

function showLockScreen() {
  document.body.classList.add('locked');
  $('lock-screen').hidden = false;
  $('unlock-passcode').focus();
}

function lockNow() {
  // Wait for the last save, then reload: the key only lives in memory, so it's gone
  saveQueue.then(() => location.reload());
}

$('unlock-form').addEventListener('submit', async e => {
  e.preventDefault();
  const error = $('unlock-error');
  const passcode = $('unlock-passcode').value;
  if (Date.now() < triesBlockedUntil) {
    error.textContent = `Too many tries. Wait ${Math.ceil((triesBlockedUntil - Date.now()) / 1000)} seconds.`;
    return;
  }
  if (!isLockedBox(storedBox())) {
    error.textContent = "Your saved data is damaged and can't be opened. Erase and restore a backup.";
    return;
  }
  error.textContent = 'Unlocking…';
  $('unlock-btn').disabled = true;
  let opened = null;
  try {
    opened = await decryptBox(storedBox(), passcode);
    const loaded = prepareData(JSON.parse(opened.text)); // before anything changes, in case it's damaged
    lockKey = opened.key;
    lockSalt = opened.salt;
    failedTries = 0;
    data = loaded;
    waitingForUnlock = false;
    $('lock-screen').hidden = true;
    document.body.classList.remove('locked');
    error.textContent = '';
    setFormDefaults();
    render();
  } catch {
    if (opened) {
      error.textContent = 'The passcode is right, but the saved data is damaged. Erase and restore a backup.';
      $('unlock-btn').disabled = false;
      return;
    }
    failedTries++;
    // After 5 wrong tries, each new try has to wait a bit longer
    if (failedTries >= 5) triesBlockedUntil = Date.now() + 30000 * (failedTries - 4);
    error.textContent = 'Wrong passcode.';
  }
  $('unlock-btn').disabled = false;
  $('unlock-passcode').value = '';
});

$('unlock-erase').addEventListener('click', () => {
  if (!confirm('Erase ALL data in this app? Without the passcode it can\'t be recovered.')) return;
  if (!confirm('Are you sure? This can\'t be undone.')) return;
  localStorage.removeItem(LOCKED_KEY);
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_KEY + '-unreadable');
  location.reload();
});

// Lock again after being away for a while
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = Date.now();
  } else if (lockIsOn() && hiddenAt && Date.now() - hiddenAt > AUTO_LOCK_MINUTES * 60000) {
    lockNow();
  }
});

// --- Settings ---

function renderLockSettings() {
  const on = lockIsOn();
  $('lock-on-form').hidden = on;
  $('lock-on-controls').hidden = !on;
  $('lock-status').textContent = on
    ? `On. Your data is encrypted on this device, and the app locks after ${AUTO_LOCK_MINUTES} minutes away. Backups you save now need this passcode to restore.`
    : 'Off. Anyone who can open this app on your device can see your data.';
}

// Checks a passcode against the saved data (true if it's right)
async function passcodeIsRight(passcode) {
  try {
    await decryptBox(storedBox(), passcode);
    return true;
  } catch {
    return false;
  }
}

function checkNewPasscode(passcode, again) {
  if (passcode.length < 6) return 'Use at least 6 characters (a mix of letters and numbers is safest).';
  if (passcode !== again) return 'The two passcodes don\'t match.';
  return '';
}

$('lock-on-form').addEventListener('submit', async e => {
  e.preventDefault();
  const problem = checkNewPasscode($('lock-new').value, $('lock-confirm').value);
  if (problem) {
    alert(problem);
    return;
  }
  if (!confirm('If you forget this passcode, your data can\'t be recovered. Turn on the lock?')) return;
  lockSalt = crypto.getRandomValues(new Uint8Array(16));
  lockKey = await deriveKey($('lock-new').value, lockSalt);
  e.target.reset();
  saveData(); // now saved encrypted, and the readable copy is removed
  renderLockSettings();
  showToast('App lock is on.', null);
});

$('lock-change-form').addEventListener('submit', async e => {
  e.preventDefault();
  await saveQueue;
  if (!(await passcodeIsRight($('lock-current').value))) {
    alert('The current passcode is wrong.');
    return;
  }
  const problem = checkNewPasscode($('lock-change-new').value, $('lock-change-confirm').value);
  if (problem) {
    alert(problem);
    return;
  }
  lockSalt = crypto.getRandomValues(new Uint8Array(16));
  lockKey = await deriveKey($('lock-change-new').value, lockSalt);
  e.target.reset();
  saveData();
  showToast('Passcode changed. Older locked backups still use the old passcode.', null);
});

$('lock-off').addEventListener('click', async () => {
  await saveQueue;
  if (!(await passcodeIsRight($('lock-current').value))) {
    alert('Type your current passcode first.');
    return;
  }
  const oldKey = lockKey, oldSalt = lockSalt;
  lockKey = null;
  lockSalt = null;
  await saveQueue; // a locked save started during the check must finish first
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    lockKey = oldKey;
    lockSalt = oldSalt;
    alert("Couldn't turn the lock off: storage is full. Free up space and try again.");
    return;
  }
  localStorage.removeItem(LOCKED_KEY);
  $('lock-change-form').reset();
  renderLockSettings();
  showToast('App lock is off.', null);
});

$('lock-now').addEventListener('click', lockNow);
