// ===== Data =====
// All money is stored as cents (integers). Dates are "YYYY-MM-DD" strings.

const STORAGE_KEY = 'budgetApp';
const DEFAULT_CATEGORIES = [
  'Rent', 'Bills & Utilities', 'Groceries', 'Food', 'Gas', 'Transportation', 'School', 'Music Gear',
  'Fun', 'Subscriptions', 'Shopping', 'Health', 'Personal Care', 'Gifts & Giving', 'Cash', 'Loans & Advances',
  'Fees', 'Savings'
];
const CATEGORIES_VERSION = 3; // bump when DEFAULT_CATEGORIES gets new names

// A unique id for each saved item
let idCounter = 0;
function newId() {
  return Date.now().toString(36) + '-' + (idCounter++);
}

function defaultData() {
  return {
    payFrequencyDays: 14,
    paychecks: [],   // { id, amountCents, date }
    income: [],      // extra income: { id, amountCents, date, note }
    categories: DEFAULT_CATEGORIES.map(name => ({ id: newId(), name, plannedCents: 0 })),
    categoriesVersion: CATEGORIES_VERSION,
    expenses: [],    // { id, amountCents, categoryId, note, date }
    bills: [],       // { id, name, amountCents, dueDay, categoryId }
    funds: [],       // semester funds: { id, name, goalCents, perPaycheckCents, createdDate }
    ious: [],        // { id, person, amountCents, theyOweMe, note, date }
    shifts: [],      // upcoming work shifts for the forecast: { id, date, hours }
    merchantRules: {},     // bank import: merchant name -> category id you picked
    importedKeys: [],      // bank import: transactions already seen, so they aren't imported twice
    dismissedTips: [],     // ids of tips you hid
    lastBackupDate: null,
    savingsGoalName: '',
    savingsGoalCents: 0,
    savingsAdjustCents: 0, // set by "Match my savings balance" so the goal matches your real savings
    adjustments: [],       // balance fixes: { id, amountCents (+ or -), date, note }
    spotMeLimitCents: 0,   // overdraft coverage like Chime SpotMe (0 = none)
    spotMeCushionCents: 1000, // "Can I afford it?" keeps this much SpotMe free
    hourlyRateCents: 0,
    lowWarningCents: 1000, // warn when safe-per-day drops below this (0 = off)
    rollover: 'off'        // 'off' | 'next' | 'savings'
  };
}

// ===== Checking saved data =====
// A backup is only data, but a file from someone else could be booby-trapped
// (for example code hidden in a number field). Before anything is shown, every
// field is turned into the type the app expects: cents are whole numbers, dates
// are "YYYY-MM-DD", and everything else that isn't a number or true/false is plain text.

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const isDate = value => typeof value === 'string' && DATE_PATTERN.test(value);
const toCents = value => (Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0);

function cleanItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const clean = {};
  for (const [key, value] of Object.entries(item)) {
    if (key.endsWith('Cents')) {
      clean[key] = toCents(value);
    } else if (key === 'date') {
      if (!isDate(value)) return null; // an item without a real date is dropped
      clean[key] = value;
    } else if (key === 'createdDate') {
      clean[key] = isDate(value) ? value : today();
    } else if (key === 'targetDate') {
      clean[key] = isDate(value) ? value : null;
    } else if (key === 'hours' || key === 'dueDay') {
      const n = key === 'dueDay' ? Math.round(Number(value)) : Number(value);
      if (!Number.isFinite(n) || n <= 0) return null;
      clean[key] = key === 'dueDay' ? Math.min(n, 31) : n;
    } else if (typeof value === 'boolean' || value === null) {
      clean[key] = value;
    } else if (typeof value === 'number') {
      clean[key] = Number.isFinite(value) ? value : 0;
    } else if (value !== undefined) {
      clean[key] = String(value); // ids, names, notes: text only
    }
  }
  return clean;
}

// { text: text } maps, like merchantRules
function cleanTextMap(map) {
  const clean = {};
  if (map && typeof map === 'object') {
    for (const [key, value] of Object.entries(map)) clean[String(key)] = String(value);
  }
  return clean;
}

function sanitizeData(d) {
  const lists = ['paychecks', 'income', 'categories', 'expenses', 'bills', 'funds', 'ious', 'adjustments', 'shifts', 'goals'];
  for (const key of lists) {
    if (key in d) d[key] = Array.isArray(d[key]) ? d[key].map(cleanItem).filter(Boolean) : [];
  }
  // Fields the app always expects: drop or fill them in so a damaged file can't crash it
  for (const key of ['paychecks', 'income', 'expenses', 'adjustments', 'shifts', 'ious']) {
    if (key in d) d[key] = d[key].filter(x => isDate(x.date));
  }
  for (const key of lists) {
    if (!(key in d)) continue;
    d[key].forEach(x => {
      if (x.id === undefined) x.id = newId();
      if (['paychecks', 'income', 'expenses', 'adjustments', 'ious'].includes(key)) x.amountCents = toCents(x.amountCents);
      if (['categories', 'bills', 'funds', 'goals'].includes(key)) x.name = String(x.name ?? '');
    });
  }
  for (const key of Object.keys(d)) {
    if (key.endsWith('Cents')) d[key] = toCents(d[key]);
  }
  for (const key of ['importedKeys', 'dismissedTips', 'sweptPeriods']) {
    if (key in d) d[key] = Array.isArray(d[key]) ? d[key].map(String) : [];
  }
  d.payFrequencyDays = Number(d.payFrequencyDays) === 7 ? 7 : 14;
  if (!['off', 'next', 'savings'].includes(d.rollover)) d.rollover = 'off';
  d.merchantRules = cleanTextMap(d.merchantRules);
  d.savingsGoalName = String(d.savingsGoalName || '');
  d.categoriesVersion = Number(d.categoriesVersion) || 1;
  for (const key of ['lastBackupDate', 'nudgeDismissed']) {
    if (key in d) d[key] = isDate(d[key]) ? d[key] : null;
  }
  if ('defaultGoalId' in d) d.defaultGoalId = d.defaultGoalId === null ? null : String(d.defaultGoalId);
  if (d.roundUps) {
    d.roundUps = { enabled: d.roundUps.enabled === true, goalId: d.roundUps.goalId ? String(d.roundUps.goalId) : null };
  }
  if (d.forecast && typeof d.forecast === 'object') {
    const f = d.forecast;
    const percent = Number(f.takeHomePercent);
    const lag = parseInt(f.payLagDays, 10);
    const overrides = {};
    for (const [date, cents] of Object.entries(f.payOverrides || {})) {
      if (isDate(date)) overrides[date] = toCents(cents);
    }
    d.forecast = {
      takeHomePercent: percent >= 1 && percent <= 100 ? Math.round(percent) : null,
      spendingCents: f.spendingCents === null || f.spendingCents === undefined ? null : toCents(f.spendingCents),
      payLagDays: lag >= 0 && lag <= 14 ? lag : 0,
      paydays: [4, 6, 8].includes(Number(f.paydays)) ? Number(f.paydays) : 6,
      payOverrides: overrides
    };
  }
  return d;
}

// True while the app lock screen is up (lock.js). Until then `data` is only an empty placeholder.
let waitingForUnlock = false;

function loadData() {
  // App lock is on: the real data is encrypted and opens after the passcode (lock.js)
  if (localStorage.getItem('budgetApp-locked')) {
    waitingForUnlock = true;
    return defaultData();
  }
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return defaultData();
  let parsed;
  try {
    parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== 'object') throw new Error();
  } catch {
    // Unreadable save: keep a copy instead of losing it, and start fresh
    localStorage.setItem(STORAGE_KEY + '-unreadable', saved);
    return defaultData();
  }
  return prepareData(parsed);
}

// Checks saved data (from storage, a backup or the lock) and upgrades older saves
function prepareData(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaultData();
  // Merge with the defaults so older saves get any new fields
  const loaded = sanitizeData({ ...defaultData(), ...parsed });

  // Older saves: add any new default categories you don't have yet
  if ((parsed.categoriesVersion || 1) < CATEGORIES_VERSION) {
    for (const name of DEFAULT_CATEGORIES) {
      if (!loaded.categories.some(c => c.name.toLowerCase() === name.toLowerCase())) {
        loaded.categories.push({ id: newId(), name, plannedCents: 0 });
      }
    }
    loaded.categoriesVersion = CATEGORIES_VERSION;
  }
  return loaded;
}

function saveData() {
  if (waitingForUnlock) return; // never overwrite locked data with the empty placeholder
  if (lockIsOn()) saveLocked(JSON.stringify(data)); // lock.js encrypts it first
  else {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      alert("Couldn't save: this device's storage is full. Download a backup now.");
    }
  }
}

let data = loadData();

// ===== Helpers =====

// Shortcut for document.getElementById
const $ = id => document.getElementById(id);

// "12.34", "$1,234.5" -> cents (NaN if it isn't a number, or over $10 million)
function dollarsToCents(text) {
  const t = String(text ?? '').replace(/[$,\s]/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
  const cents = Math.round(Number((Number(t) * 100).toFixed(4))); // toFixed avoids 1.005 -> 100
  return Math.abs(cents) <= 1e9 ? cents : NaN;
}

// 1234 -> "12.34" (for putting back into an input)
function centsToInput(cents) {
  return (cents / 100).toFixed(2);
}

// 1234 -> "$12.34", -500 -> "-$5.00"
function formatMoney(cents) {
  const sign = cents < 0 ? '-' : '';
  return sign + '$' + (Math.abs(cents) / 100).toFixed(2);
}

// Date object -> "YYYY-MM-DD" (local time, not UTC)
function toDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// "YYYY-MM-DD" -> Date object at local midnight
function parseDate(text) {
  const [y, m, d] = text.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function today() {
  return toDateString(new Date());
}

function addDays(text, days) {
  const date = parseDate(text);
  date.setDate(date.getDate() + days);
  return toDateString(date);
}

function daysBetween(from, to) {
  return Math.round((parseDate(to) - parseDate(from)) / 86400000);
}

function formatDate(text) {
  return parseDate(text).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatShortDate(text) {
  return parseDate(text).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function sum(list, getCents) {
  return list.reduce((total, item) => total + getCents(item), 0);
}

function findById(list, id) {
  return list.find(item => String(item.id) === String(id));
}

function categoryName(id) {
  const category = findById(data.categories, id);
  return category ? category.name : 'Uncategorized';
}

// Makes user text safe to put inside HTML
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ===== Paychecks =====

// Newest paycheck first
function sortedPaychecks() {
  return [...data.paychecks].sort((a, b) => b.date.localeCompare(a.date));
}

// Next payday = latest paycheck + frequency, stepped forward until it's after today
// (a paycheck dated in the future doesn't count until its day)
function getNextPayday() {
  const latest = sortedPaychecks().find(p => p.date <= today());
  if (!latest) return null;

  const now = parseDate(today());
  const next = parseDate(latest.date);
  do {
    next.setDate(next.getDate() + data.payFrequencyDays);
  } while (next <= now);
  return toDateString(next);
}

// Put the latest paycheck's amount in the form, since it's usually similar
// The payday after your latest paycheck, if it has come without a new paycheck logged (null otherwise)
function missedPayday() {
  const latest = sortedPaychecks().find(p => p.date <= today());
  if (!latest) return null;
  const expected = addDays(latest.date, data.payFrequencyDays);
  return expected <= today() ? expected : null;
}

function fillLastAmount() {
  const latest = sortedPaychecks()[0];
  $('paycheck-amount').value = latest ? centsToInput(latest.amountCents) : '';
}

// ===== Pay periods =====
// Each paycheck starts a pay period that ends the day before the next paycheck.
// The newest one ends the day before the predicted next payday.

function getPeriods() {
  const pays = data.paychecks.filter(p => p.date <= today()).sort((a, b) => a.date.localeCompare(b.date));
  // The current period ends at the predicted payday, or sooner if a paycheck is already logged for an earlier day
  // A missed payday ends the period tomorrow, so the next pay period's bills aren't charged to this paycheck
  const predicted = missedPayday() ? addDays(today(), 1) : getNextPayday();
  const nextPayday = [predicted, ...data.paychecks.map(p => p.date).filter(d => d > today())].sort()[0];
  return pays.map((p, i) => ({
    id: String(p.id),
    start: p.date,
    end: i + 1 < pays.length ? pays[i + 1].date : nextPayday, // end is not included
    paycheckCents: p.amountCents
  }));
}

// The dates a bill is due inside a period (a bill on the 31st is due on the last day of shorter months)
function billDatesInPeriod(bill, period) {
  const dates = [];
  const day = parseDate(period.start);
  const end = parseDate(period.end);
  while (day < end) {
    const lastDayOfMonth = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
    const date = toDateString(day);
    // Bills count from the day they were added (older bills without a date count from the start)
    if (day.getDate() === Math.min(bill.dueDay, lastDayOfMonth) && !(bill.createdDate && date < bill.createdDate)) dates.push(date);
    day.setDate(day.getDate() + 1);
  }
  return dates;
}

// Works out the numbers for every pay period, oldest first.
// Goes in order because leftovers and semester funds build up over time.
function summarize() {
  const periods = getPeriods();
  const fundSaved = {};
  const fundSpent = {}; // paid out of each fund by expenses marked "Paid from semester fund"
  data.funds.forEach(f => { fundSaved[f.id] = 0; fundSpent[f.id] = 0; });
  let carry = 0;
  let savedFromLeftovers = 0;

  periods.forEach((p, i) => {
    const inPeriod = item => item.date >= p.start && item.date < p.end;

    p.carryInCents = carry; // only negatives carry unless rollover is "next" (see below)
    p.extraCents = sum(data.income.filter(inPeriod), x => x.amountCents);
    p.adjustCents = sum(data.adjustments.filter(inPeriod), x => x.amountCents);

    // Spending per category (expenses + bills)
    p.spentByCategory = {};
    const addSpending = (categoryId, cents) => {
      p.spentByCategory[categoryId] = (p.spentByCategory[categoryId] || 0) + cents;
    };

    const expenses = data.expenses.filter(inPeriod);
    expenses.forEach(e => addSpending(String(e.categoryId), e.amountCents));
    p.expenseCents = sum(expenses, e => e.amountCents);

    p.billCents = 0;
    data.bills.forEach(b => {
      const cents = billDatesInPeriod(b, p).length * b.amountCents;
      if (cents > 0) addSpending(String(b.categoryId), cents);
      p.billCents += cents;
    });

    // Semester funds take their share from every paycheck after they were created, until the goal is met
    p.fundCents = 0;
    data.funds.forEach(f => {
      if (p.end <= f.createdDate) return;
      const add = Math.min(f.perPaycheckCents, f.goalCents - fundSaved[f.id]);
      fundSaved[f.id] += add;
      p.fundCents += add;
    });
    // An expense paid from a fund uses the fund's saved money instead of this paycheck
    expenses.filter(e => e.fundId).forEach(e => {
      const f = data.funds.find(x => String(x.id) === String(e.fundId));
      if (!f) return;
      const use = Math.max(Math.min(e.amountCents, fundSaved[f.id] - fundSpent[f.id]), 0);
      fundSpent[f.id] += use;
      p.fundCents -= use;
    });

    p.leftCents = p.paycheckCents + p.extraCents + p.adjustCents + p.carryInCents - p.expenseCents - p.billCents - p.fundCents;

    // Leftovers from finished periods roll forward (or into savings)
    const isCurrent = i === periods.length - 1;
    if (!isCurrent) {
      // Going under (SpotMe/overdraft) always comes out of the next paycheck; leftovers only roll with "next"
      carry = data.rollover === 'next' ? p.leftCents : Math.min(p.leftCents, 0);
      if (data.rollover === 'savings' && p.leftCents > 0) savedFromLeftovers += p.leftCents;
    }
  });

  // Total saved = everything put in the "Savings" category + leftovers moved to savings
  // - money taken back out of savings (imported as income like "Transfer From Chime Savings")
  const savingsCategory = data.categories.find(c => c.name.trim().toLowerCase() === 'savings');
  const takenOutCents = sum(data.income.filter(x => /from .*savings/i.test(x.note || '')), x => x.amountCents);
  const savingsCents = savedFromLeftovers - takenOutCents + data.savingsAdjustCents +
    (savingsCategory ? sum(periods, p => p.spentByCategory[String(savingsCategory.id)] || 0) : 0);

  return { periods, current: periods[periods.length - 1] || null, fundSaved, fundSpent, savedFromLeftovers, savingsCents };
}

// How many finished pay periods in a row (most recent first) ended with money left
function getStreak(periods) {
  let streak = 0;
  for (let i = periods.length - 2; i >= 0; i--) {
    if (periods[i].leftCents < 0) break;
    streak++;
  }
  return streak;
}

// ===== Expenses =====

function addExpense(fields) {
  const expense = { id: newId(), ...fields };
  data.expenses.push(expense);
  // Round-ups (savings.js) add a small Savings expense next to it, if they're on
  const isSavings = categoryName(expense.categoryId).trim().toLowerCase() === 'savings';
  const roundUp = isSavings ? null : createRoundUp(expense);
  saveData();
  render();
  const saved = roundUp ? ` (+${formatMoney(roundUp.amountCents)} saved)` : '';
  showToast(`Added ${formatMoney(expense.amountCents)} to ${categoryName(expense.categoryId)}${saved}.`, () => {
    data.expenses = data.expenses.filter(e => e !== expense && e !== roundUp);
    saveData();
    render();
  });
}

// Adds an expense from an amount/note/date set of fields (Home card or the quick-add pop-up).
// Returns true if it was added.
function quickAddExpense(categoryId, ids = { amount: 'expense-amount', note: 'expense-note', date: 'expense-date' }) {
  const amountInput = $(ids.amount);
  const cents = dollarsToCents(amountInput.value);
  if (!(cents > 0)) {
    amountInput.focus();
    return false;
  }
  addExpense({ amountCents: cents, categoryId, note: $(ids.note).value.trim(), date: $(ids.date).value || today() });
  amountInput.value = '';
  $(ids.note).value = '';
  $(ids.date).value = today();
  return true;
}

// Floating "+" button: on Home the add card is right there, elsewhere it opens a pop-up
function openQuickAdd() {
  if (!$('tab-home').hidden) {
    $('expense-amount').focus();
    return;
  }
  $('qa-amount').value = '';
  $('qa-note').value = '';
  $('qa-date').value = today();
  $('quick-add-dialog').showModal();
  $('qa-amount').focus();
}

// The last few different expenses, for one-tap re-adding
let recentExpenses = [];
function getRecentExpenses() {
  const seen = new Set();
  const recent = [];
  for (let i = data.expenses.length - 1; i >= 0 && recent.length < 4; i--) {
    const e = data.expenses[i];
    const key = `${e.amountCents}|${e.categoryId}|${e.note}`;
    if (!seen.has(key) && findById(data.categories, e.categoryId)) {
      seen.add(key);
      recent.push(e);
    }
  }
  return recent;
}

// ===== Delete with undo =====

let toastTimer;
function showToast(message, onUndo) {
  const toast = $('toast');
  $('toast-message').textContent = message;
  $('toast-undo').hidden = !onUndo; // no Undo button for plain messages
  $('toast-undo').onclick = () => {
    onUndo();
    toast.hidden = true;
  };
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.hidden = true, 5000);
}

function removeWithUndo(listName, id) {
  const list = data[listName];
  const index = list.findIndex(item => String(item.id) === String(id));
  if (index === -1) return;
  const [removed] = list.splice(index, 1);
  // Deleting an expense also deletes its round-up
  const roundUps = listName === 'expenses' ? list.filter(e => e.roundUpOf !== undefined && String(e.roundUpOf) === String(id)) : [];
  if (roundUps.length) data.expenses = list.filter(e => !roundUps.includes(e));
  saveData();
  render();
  showToast('Removed.', () => {
    data[listName].splice(index, 0, removed);
    if (roundUps.length) data.expenses.push(...roundUps);
    saveData();
    render();
  });
}

// ===== Rendering =====

let lastSummary = null;

function render() {
  const summary = summarize();
  lastSummary = summary;
  fillCategorySelects();
  renderHome(summary);
  renderTips(summary); // in tips.js
  renderHistory(summary);
  renderBudget(summary);
  renderSavings(summary); // in savings.js
  renderPay();
  renderForecast(summary); // in forecast.js
  renderIous();
  renderLockSettings(); // in lock.js
}

// Small building blocks for list rows
function listItem(mainHtml, actionsHtml) {
  return `<li><div class="grow">${mainHtml}</div><div class="actions">${actionsHtml}</div></li>`;
}

function deleteButton(listName, id, label = 'Delete') {
  return `<button class="delete" data-delete="${listName}" data-id="${escapeHtml(id)}" aria-label="Delete">${label}</button>`;
}

function progressBar(fraction, color) {
  return `<div class="bar"><div class="bar-fill ${color}" style="width:${Math.min(fraction, 1) * 100}%"></div></div>`;
}

function fillCategorySelects() {
  const options = data.categories.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
  for (const id of ['bill-category', 'edit-category']) {
    const select = $(id);
    const previous = select.value;
    select.innerHTML = options;
    if ([...select.options].some(o => o.value === previous)) select.value = previous;
  }
}

function renderHome(summary) {
  const cur = summary.current;
  const pill = $('status-pill');

  if (!cur) {
    $('money-left').textContent = '—';
    $('days-left').textContent = '—';
    $('safe-per-day').textContent = '—';
    $('home-notes').textContent = '';
    // No paycheck yet: the pill opens the paycheck form
    pill.hidden = false;
    pill.className = 'status-pill warn';
    pill.textContent = 'Add your first paycheck →';
  } else {
    const daysLeft = daysBetween(today(), cur.end);
    const safePerDay = Math.floor(Math.max(cur.leftCents, 0) / daysLeft);

    $('money-left').textContent = formatMoney(cur.leftCents);
    $('money-left').classList.toggle('negative', cur.leftCents < 0);
    $('days-left').textContent = daysLeft;
    $('safe-per-day').textContent = formatMoney(safePerDay);

    // One status pill for all warnings: red if past the SpotMe limit, yellow otherwise
    const messages = [];
    let level = 'warn';

    // SpotMe covers you when money left goes below zero (it isn't counted as money to spend)
    const limit = data.spotMeLimitCents;
    const covered = Math.max(-cur.leftCents, 0);
    if (limit > 0 && covered > 0) { // only shown while it's covering you
      if (covered <= limit) {
        messages.push(`SpotMe covering ${formatMoney(covered)} · ${formatMoney(limit - covered)} left`);
      } else {
        messages.push(`${formatMoney(covered - limit)} past your ${formatMoney(limit)} SpotMe limit`);
        level = 'danger';
      }
    }
    if (data.lowWarningCents > 0 && safePerDay < data.lowWarningCents) {
      messages.push(`Only ${formatMoney(safePerDay)} a day until payday`);
    }
    const missed = missedPayday();
    if (missed) messages.unshift(`${missed === today() ? 'Payday today' : 'Payday was ' + formatDate(missed)}: add your paycheck →`);
    pill.hidden = messages.length === 0;
    pill.className = 'status-pill ' + level;
    pill.textContent = messages.join(' · ');

    const notes = [];
    const streak = getStreak(summary.periods);
    if (streak > 0) notes.push(`Under budget ${streak} pay period${streak === 1 ? '' : 's'} in a row`);
    if (cur.carryInCents) notes.push(`Includes ${formatMoney(cur.carryInCents)} carried over`);
    if (data.rollover === 'savings' && summary.savedFromLeftovers > 0) notes.push(`${formatMoney(summary.savedFromLeftovers)} saved from leftovers`);
    $('home-notes').textContent = notes.join(' · ');
  }

  // Quick-add buttons
  $('category-chips').innerHTML = data.categories
    .map(c => `<button class="chip" data-add-expense="${escapeHtml(c.id)}">${escapeHtml(c.name)}</button>`).join('');
  // Same chips in the quick-add pop-up
  $('qa-chips').innerHTML = data.categories
    .map(c => `<button type="button" class="chip" data-qa-add="${escapeHtml(c.id)}">${escapeHtml(c.name)}</button>`).join('');

  recentExpenses = getRecentExpenses();
  $('recent-wrap').hidden = recentExpenses.length === 0;
  $('recent-chips').innerHTML = recentExpenses
    .map((e, i) => `<button class="chip recent" data-recent="${i}">${escapeHtml(e.note || categoryName(e.categoryId))} ${formatMoney(e.amountCents)}</button>`).join('');

  // Category progress bars: green under 75%, yellow 75–100%, red when over.
  // Only categories with a plan or spending this period get a bar.
  const spentIn = c => cur ? (cur.spentByCategory[String(c.id)] || 0) : 0;
  const used = data.categories.filter(c => c.plannedCents > 0 || spentIn(c) > 0);
  const hiddenCount = data.categories.length - used.length;
  $('category-bars').innerHTML = used.map(c => {
    const spent = spentIn(c);
    const fraction = c.plannedCents > 0 ? spent / c.plannedCents : (spent > 0 ? 2 : 0);
    const color = fraction > 1 ? 'red' : fraction >= 0.75 ? 'yellow' : 'green';
    return `<div class="bar-row">
      <div class="bar-label"><span>${escapeHtml(c.name)}</span><span>${formatMoney(spent)} / ${formatMoney(c.plannedCents)}</span></div>
      ${progressBar(fraction, color)}
    </div>`;
  }).join('') + (hiddenCount > 0
    ? `<p class="muted small">${hiddenCount} unused categor${hiddenCount === 1 ? 'y' : 'ies'} hidden. Set planned amounts on the Budget tab.</p>`
    : '');

  renderAfford(summary);
}

function renderAfford(summary) {
  const out = $('afford-result');
  const price = dollarsToCents($('afford-amount').value);
  const cur = summary.current;
  if (!cur || !(price > 0)) {
    out.textContent = '';
    return;
  }
  const left = cur.leftCents - price;
  const days = daysBetween(today(), cur.end);
  const payday = formatShortDate(cur.end);

  // With SpotMe you can go below $0 until it runs out (keeping your chosen cushion free).
  // Without it, you can only spend what's left.
  const limit = data.spotMeLimitCents;
  const cushion = limit ? data.spotMeCushionCents : 0;
  const covered = Math.max(-left, 0);       // SpotMe used after buying it
  const spotMeLeft = limit - covered;       // SpotMe still free after buying it
  const usable = left + limit - cushion;    // what you could still spend until payday
  const perDay = Math.floor(usable / days);
  const minimum = data.lowWarningCents;

  // One short answer...
  let kind;
  let verdict;
  if (limit && spotMeLeft < 0) {
    kind = 'negative';
    verdict = `<strong>No.</strong> SpotMe can't cover it: you'd be ${formatMoney(-spotMeLeft)} past your ${formatMoney(limit)} limit.`;
  } else if (!limit && left < 0) {
    kind = 'negative';
    verdict = `<strong>No.</strong> You'd be ${formatMoney(-left)} short until ${payday}.`;
  } else if (usable < 0) {
    kind = 'negative';
    verdict = `<strong>No.</strong> It would leave only ${formatMoney(spotMeLeft)} of SpotMe, less than the ${formatMoney(cushion)} you keep free.`;
  } else if (minimum > 0 && perDay < minimum) {
    kind = 'tight';
    verdict = `<strong>Yes, but it's tight.</strong> You'd have ${formatMoney(perDay)} a day until ${payday}, less than the ${formatMoney(minimum)} a day you set as your low-money warning (in ⚙ Settings).`;
  } else {
    kind = 'positive';
    verdict = `<strong>Yes.</strong> You'd have ${formatMoney(perDay)} a day until ${payday}.`;
  }

  // ...then the numbers behind it
  const lines = [[covered > 0 ? 'After buying it' : 'Left after buying it', formatMoney(left)]];
  if (limit) lines.push(['SpotMe left', `${formatMoney(Math.max(spotMeLeft, 0))} of ${formatMoney(limit)}`]);
  if (usable >= 0) lines.push([`To spend per day (${days} days)`, formatMoney(perDay)]);

  const notes = [];
  if (kind !== 'negative') {
    if (covered > 0) notes.push(`SpotMe would cover ${formatMoney(covered)}, so your ${payday} paycheck would be that much smaller.`);
    if (cushion) notes.push(`"Per day" uses SpotMe but keeps ${formatMoney(cushion)} of it free.`);
  }

  out.className = kind;
  out.innerHTML = `<p>${verdict}</p>
    <ul class="afford-lines">${lines.map(([label, value]) => `<li><span>${label}</span><span>${value}</span></li>`).join('')}</ul>
    ${notes.length ? `<p class="muted small">${notes.join(' ')}</p>` : ''}`;
}

// The pay period picked in the History filter (null = current period)
let historyPeriod = null;
// The category picked in the History filter ('all' = every category)
let historyCategory = 'all';

function chip(label, selected, attribute, value) {
  return `<button class="chip${selected ? ' selected' : ''}" ${attribute}="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
}

function renderHistory(summary) {
  // Pay period filter (newest first). Defaults to the current period.
  let periodId = summary.current ? summary.current.id : 'all';
  if (historyPeriod === 'all' || summary.periods.some(p => p.id === historyPeriod)) periodId = historyPeriod;
  const period = summary.periods.find(p => p.id === periodId);

  $('history-period-chips').innerHTML = chip('All', periodId === 'all', 'data-history-period', 'all') + [...summary.periods].reverse()
    .map(p => chip(`${formatShortDate(p.start)} – ${formatShortDate(addDays(p.end, -1))}`, p.id === periodId, 'data-history-period', p.id)).join('');

  // Category filter: only categories with expenses in the picked period
  const inPeriod = data.expenses.filter(e => !period || (e.date >= period.start && e.date < period.end));
  const usedIds = new Set(inPeriod.map(e => String(e.categoryId)));
  const used = data.categories.filter(c => usedIds.has(String(c.id)));
  const categoryFilter = used.some(c => String(c.id) === historyCategory) ? historyCategory : 'all';
  $('history-category-chips').innerHTML = chip('All', categoryFilter === 'all', 'data-history-category', 'all') +
    used.map(c => chip(c.name, String(c.id) === categoryFilter, 'data-history-category', String(c.id))).join('');

  const shown = inPeriod
    .filter(e => categoryFilter === 'all' || String(e.categoryId) === categoryFilter)
    .reverse() // newest-added first within the same day
    .sort((a, b) => b.date.localeCompare(a.date));

  $('history-total').textContent = `${shown.length} expense${shown.length === 1 ? '' : 's'} · ${formatMoney(sum(shown, e => e.amountCents))}`;
  // Tap a row to edit it (Delete is in the edit pop-up)
  $('history-list').innerHTML = shown.map(e => `<li><button class="row-btn" data-edit-expense="${escapeHtml(e.id)}">
    <strong>${formatMoney(e.amountCents)}</strong> · ${escapeHtml(categoryName(e.categoryId))}
    <div class="muted small">${formatDate(e.date)}${e.note ? ' · ' + escapeHtml(e.note) : ''}</div>
  </button></li>`).join('') || '<li class="muted">No expenses here yet.</li>';

  renderPie(period ? [period] : summary.periods);
}

const PIE_COLORS = ['#4caf50', '#42a5f5', '#fbc02d', '#ab47bc', '#ef5350', '#26c6da', '#ff7043', '#8d6e63'];

// Pie chart of spending by category, drawn with a CSS conic-gradient
function renderPie(periods) {
  const totals = {};
  periods.forEach(p => {
    for (const [categoryId, cents] of Object.entries(p.spentByCategory)) {
      totals[categoryId] = (totals[categoryId] || 0) + cents;
    }
  });
  const slices = Object.entries(totals).filter(([, cents]) => cents > 0).sort((a, b) => b[1] - a[1]);
  const total = sum(slices, ([, cents]) => cents);

  $('pie-wrap').hidden = total === 0;
  $('pie-empty').hidden = total > 0;
  if (total === 0) return;

  let angle = 0;
  const stops = [];
  $('pie-legend').innerHTML = slices.map(([categoryId, cents], i) => {
    const color = PIE_COLORS[i % PIE_COLORS.length];
    const nextAngle = angle + (cents / total) * 360;
    stops.push(`${color} ${angle}deg ${nextAngle}deg`);
    angle = nextAngle;
    const percent = Math.round((cents / total) * 100);
    return `<li><span class="swatch" style="background:${color}"></span>${escapeHtml(categoryName(categoryId))} · ${formatMoney(cents)} (${percent}%)</li>`;
  }).join('');
  $('pie').style.background = `conic-gradient(${stops.join(', ')})`;
}

// ===== Plan from my spending =====
// Suggests each category's plan from what you really spent in your last 3 finished pay periods.

const AUTO_BUDGET_SKIP = ['loans & advances', 'savings']; // repayments and saving aren't spending plans
let showUnusedCategories = false;

// Average spent per pay period in a category (bills included), over the last 3 finished periods
function usualSpending(summary, category) {
  const finished = summary.periods.slice(0, -1).slice(-3);
  if (finished.length === 0) return 0;
  return Math.round(sum(finished, p => p.spentByCategory[String(category.id)] || 0) / finished.length);
}

function budgetSuggestions(summary) {
  return data.categories
    .filter(c => !AUTO_BUDGET_SKIP.includes(c.name.trim().toLowerCase()))
    .map(c => {
      const usual = usualSpending(summary, c);
      return { category: c, usual, suggested: usual > 0 ? Math.ceil(usual / 500) * 500 : 0 }; // round up to $5
    })
    .filter(s => s.usual > 0 || s.category.plannedCents > 0);
}

function renderAutoBudgetTotal() {
  const chosen = {};
  document.querySelectorAll('[data-auto-cat]').forEach(box => { if (box.checked) chosen[box.dataset.autoCat] = Number(box.dataset.cents); });
  const total = sum(data.categories, c => chosen[String(c.id)] ?? c.plannedCents);
  const pay = averageRecentPaycheck(); // forecast.js
  const over = total - pay;
  $('auto-budget-total').innerHTML = `New total: <strong>${formatMoney(total)}</strong>` + (pay > 0
    ? ` of your usual ${formatMoney(pay)} paycheck. ` + (over > 0
      ? `<span class="over">That's ${formatMoney(over)} more than you get paid. Uncheck or lower some categories.</span>`
      : `${formatMoney(-over)} left for savings and surprises.`)
    : '');
}

$('auto-budget-btn').addEventListener('click', () => {
  const summary = lastSummary;
  const finished = Math.min(Math.max(summary.periods.length - 1, 0), 3);
  if (finished === 0) {
    alert('You need at least one finished pay period first. Import a bank statement on the Pay tab, or log a couple of weeks of spending.');
    return;
  }
  const suggestions = budgetSuggestions(summary);
  $('auto-budget-intro').textContent = `Based on your last ${finished} pay period${finished === 1 ? '' : 's'}, rounded up to the next $5. Checked ones will change. Loans & Advances and Savings are left alone.`;
  $('auto-budget-list').innerHTML = suggestions.length ? suggestions.map((s, i) => {
    const changes = s.suggested !== s.category.plannedCents;
    return `<li class="auto-row">
      <input type="checkbox" id="auto-${i}" data-auto-cat="${escapeHtml(s.category.id)}" data-cents="${s.suggested}" ${changes ? 'checked' : 'disabled'}>
      <label for="auto-${i}"><strong>${escapeHtml(s.category.name)}</strong>: ${formatMoney(s.category.plannedCents)} → ${formatMoney(s.suggested)}
        <div class="muted small">You usually spend ${formatMoney(s.usual)}${changes ? '' : ' · already set'}</div></label>
    </li>`;
  }).join('') : '<li class="muted">No spending found in your finished pay periods.</li>';
  renderAutoBudgetTotal();
  $('auto-budget-dialog').showModal();
});

$('auto-budget-list').addEventListener('change', renderAutoBudgetTotal);

$('auto-budget-form').addEventListener('submit', e => {
  e.preventDefault();
  const before = data.categories.map(c => ({ id: c.id, plannedCents: c.plannedCents }));
  let count = 0;
  document.querySelectorAll('[data-auto-cat]').forEach(box => {
    if (!box.checked) return;
    findById(data.categories, box.dataset.autoCat).plannedCents = Number(box.dataset.cents);
    count++;
  });
  $('auto-budget-dialog').close();
  if (count === 0) return;
  saveData();
  render();
  showToast(`Updated ${count} categor${count === 1 ? 'y' : 'ies'}.`, () => {
    before.forEach(b => { const c = findById(data.categories, b.id); if (c) c.plannedCents = b.plannedCents; });
    saveData();
    render();
  });
});

$('show-unused').addEventListener('click', () => {
  showUnusedCategories = !showUnusedCategories;
  render();
});

function renderBudget(summary) {
  // Unused = nothing planned and nothing spent lately; hidden to keep the list short
  const cur = summary.current;
  const spentNow = c => cur ? (cur.spentByCategory[String(c.id)] || 0) : 0;
  const isUnused = c => c.plannedCents === 0 && spentNow(c) === 0 && usualSpending(summary, c) === 0;
  const unusedCount = data.categories.filter(isUnused).length;
  $('show-unused').hidden = unusedCount === 0;
  $('show-unused').textContent = showUnusedCategories ? 'Hide unused categories' : `Show ${unusedCount} unused categor${unusedCount === 1 ? 'y' : 'ies'}`;

  // Each row's inputs get ids so they can have real (hidden) labels
  $('category-list').innerHTML = data.categories.map((c, i) => (isUnused(c) && !showUnusedCategories) ? '' : `
    <li class="edit-row">
      <label for="cat-name-${i}" class="visually-hidden">Category name</label>
      <input id="cat-name-${i}" data-cat-name="${escapeHtml(c.id)}" value="${escapeHtml(c.name)}">
      <label for="cat-planned-${i}" class="visually-hidden">Planned per paycheck for ${escapeHtml(c.name)}</label>
      <input id="cat-planned-${i}" data-cat-planned="${escapeHtml(c.id)}" type="number" inputmode="decimal" step="0.01" min="0" value="${centsToInput(c.plannedCents)}">
      ${deleteButton('categories', c.id, '✕')}
      <p class="muted small cat-hint${c.plannedCents > 0 && spentNow(c) > c.plannedCents ? ' over' : ''}">${categoryHint(c, spentNow(c), usualSpending(summary, c))}</p>
    </li>`).join('');

  const planned = sum(data.categories, c => c.plannedCents);
  const pay = averageRecentPaycheck(); // forecast.js
  $('planned-total').textContent = `Planned: ${formatMoney(planned)}` + (pay > 0
    ? ` of your usual ${formatMoney(pay)} paycheck · ` + (planned > pay ? `${formatMoney(planned - pay)} over` : `${formatMoney(pay - planned)} not planned`)
    : '');

  $('bill-list').innerHTML = data.bills.map(b => listItem(
    `${escapeHtml(b.name)} · ${formatMoney(b.amountCents)}
     <div class="muted small">Due on day ${Number(b.dueDay)} ·${escapeHtml(categoryName(b.categoryId))}</div>`,
    deleteButton('bills', b.id)
  )).join('');

  $('fund-list').innerHTML = data.funds.map(f => {
    const saved = summary.fundSaved[f.id] || 0;
    const spent = summary.fundSpent[f.id] || 0;
    const done = saved >= f.goalCents;
    return listItem(
      `${escapeHtml(f.name)}${done ? ' · Done!' : ''}
       ${progressBar(saved / f.goalCents, 'green')}
       <div class="muted small">${formatMoney(saved)} of ${formatMoney(f.goalCents)} · ${formatMoney(f.perPaycheckCents)} per paycheck${spent ? ` · ${formatMoney(spent)} spent` : ''}</div>`,
      deleteButton('funds', f.id)
    );
  }).join('');
}

// "This period $34.00 of $40.00 · usually $41.20"
function categoryHint(c, spent, usual) {
  const parts = [`This period ${formatMoney(spent)}${c.plannedCents > 0 ? ' of ' + formatMoney(c.plannedCents) : ''}`];
  if (usual > 0) parts.push(`usually ${formatMoney(usual)}`);
  return parts.join(' · ');
}

function renderPay() {
  const next = getNextPayday();
  $('next-payday').textContent = next ? formatDate(next) : 'Add a paycheck';
  $('frequency').value = String(data.payFrequencyDays);

  $('paycheck-list').innerHTML = sortedPaychecks().map(p => listItem(
    `${formatDate(p.date)} · ${formatMoney(p.amountCents)}`,
    deleteButton('paychecks', p.id)
  )).join('');

  $('income-list').innerHTML = [...data.income].sort((a, b) => b.date.localeCompare(a.date)).map(x => listItem(
    `${formatDate(x.date)} · ${formatMoney(x.amountCents)}${x.note ? `<div class="muted small">${escapeHtml(x.note)}</div>` : ''}`,
    deleteButton('income', x.id)
  )).join('');

  $('adjustment-list').innerHTML = [...data.adjustments].sort((a, b) => b.date.localeCompare(a.date)).map(x => listItem(
    `${formatDate(x.date)} · ${x.amountCents > 0 ? '+' : ''}${formatMoney(x.amountCents)}<div class="muted small">${escapeHtml(x.note)}</div>`,
    deleteButton('adjustments', x.id)
  )).join('');

  $('rollover').value = data.rollover;
  $('low-warning-setting').value = centsToInput(data.lowWarningCents);
  $('spotme-limit').value = data.spotMeLimitCents ? centsToInput(data.spotMeLimitCents) : '';
  $('spotme-cushion').value = centsToInput(data.spotMeCushionCents);
}

function renderIous() {
  const owedToMe = sum(data.ious.filter(i => i.theyOweMe), i => i.amountCents);
  const iOwe = sum(data.ious.filter(i => !i.theyOweMe), i => i.amountCents);
  $('iou-totals').textContent = `Friends owe you ${formatMoney(owedToMe)} · You owe ${formatMoney(iOwe)}`;

  $('iou-list').innerHTML = data.ious.map(i => listItem(
    (i.theyOweMe
      ? `<strong>${escapeHtml(i.person)}</strong> owes you ${formatMoney(i.amountCents)}`
      : `You owe <strong>${escapeHtml(i.person)}</strong> ${formatMoney(i.amountCents)}`) +
    `<div class="muted small">${formatDate(i.date)}${i.note ? ' · ' + escapeHtml(i.note) : ''}</div>`,
    deleteButton('ious', i.id, 'Settled')
  )).join('');
}

const TAB_TITLES = { home: 'Home', history: 'History', budget: 'Budget', pay: 'Pay', settings: 'Settings' };

// Bottom tab bar (and the ⚙ button for Settings)
function showTab(name) {
  document.querySelectorAll('.tab').forEach(tab => tab.hidden = tab.id !== 'tab-' + name);
  document.querySelectorAll('[data-tab]').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === name));
  $('page-title').textContent = TAB_TITLES[name];
  $('fab').hidden = name === 'settings'; // no "+" on Settings
  window.scrollTo(0, 0);
}

// Empty date boxes start at today; the paycheck amount starts at the last paycheck
function setFormDefaults() {
  document.querySelectorAll('input[type=date]').forEach(input => {
    if (!input.value) input.value = today();
  });
  if (!$('paycheck-amount').value) fillLastAmount();
}

// ===== Events =====

// Adds a new item to data[listName] when a form is submitted.
// buildItem reads the form and returns the item's fields, or null if something's missing.
function onSubmit(formId, listName, buildItem) {
  const form = $(formId);
  form.addEventListener('submit', e => {
    e.preventDefault();
    const item = buildItem();
    if (!item) return;
    data[listName].push({ id: newId(), ...item });
    saveData();
    form.reset();
    setFormDefaults();
    render();
    // Forms inside a pop-up close it once the item is added
    const dialog = form.closest('dialog');
    if (dialog) dialog.close();
  });
}

onSubmit('paycheck-form', 'paychecks', () => {
  const amountCents = dollarsToCents($('paycheck-amount').value);
  if (!(amountCents > 0)) return null;
  return { amountCents, date: $('paycheck-date').value };
});

onSubmit('income-form', 'income', () => {
  const amountCents = dollarsToCents($('income-amount').value);
  if (!(amountCents > 0)) return null;
  return { amountCents, date: $('income-date').value, note: $('income-note').value.trim() };
});

onSubmit('category-form', 'categories', () => {
  const name = $('category-name').value.trim();
  if (!name) return null;
  showUnusedCategories = true; // so a new category with no plan doesn't vanish
  return { name, plannedCents: Math.max(dollarsToCents($('category-planned').value) || 0, 0) };
});

onSubmit('bill-form', 'bills', () => {
  const amountCents = dollarsToCents($('bill-amount').value);
  const dueDay = parseInt($('bill-day').value, 10);
  if (!(amountCents > 0) || !(dueDay >= 1 && dueDay <= 31)) return null;
  return { name: $('bill-name').value.trim(), amountCents, dueDay, categoryId: $('bill-category').value, createdDate: today() };
});

onSubmit('fund-form', 'funds', () => {
  const goalCents = dollarsToCents($('fund-goal').value);
  const perPaycheckCents = dollarsToCents($('fund-per').value);
  if (!(goalCents > 0) || !(perPaycheckCents > 0)) return null;
  return { name: $('fund-name').value.trim(), goalCents, perPaycheckCents, createdDate: today() };
});

onSubmit('iou-form', 'ious', () => {
  const amountCents = dollarsToCents($('iou-amount').value);
  if (!(amountCents > 0)) return null;
  return {
    person: $('iou-person').value.trim(),
    amountCents,
    theyOweMe: $('iou-direction').value === 'them',
    note: $('iou-note').value.trim(),
    date: today()
  };
});

// One click handler for all the buttons that are drawn by render()
document.addEventListener('click', e => {
  const button = e.target.closest('button');
  if (!button) return;
  const d = button.dataset;
  if (d.tab) showTab(d.tab);
  else if (d.addExpense) quickAddExpense(d.addExpense);
  else if (d.qaAdd) {
    if (quickAddExpense(d.qaAdd, { amount: 'qa-amount', note: 'qa-note', date: 'qa-date' })) $('quick-add-dialog').close();
  }
  else if (d.historyPeriod) {
    historyPeriod = d.historyPeriod;
    historyCategory = 'all';
    renderHistory(lastSummary);
  }
  else if (d.historyCategory) {
    historyCategory = d.historyCategory;
    renderHistory(lastSummary);
  }
  else if (button.classList.contains('dialog-cancel')) {
    e.preventDefault(); // don't submit the form it's in
    button.closest('dialog').close();
  }
  else if (d.recent) {
    const r = recentExpenses[Number(d.recent)];
    addExpense({ amountCents: r.amountCents, categoryId: r.categoryId, note: r.note, date: today() });
  }
  else if (d.delete) removeWithUndo(d.delete, d.id);
  else if (d.editExpense) openEditDialog(d.editExpense);
});

// Inline category edits on the Budget tab
document.addEventListener('change', e => {
  const d = e.target.dataset;
  if (d.catName) {
    const category = findById(data.categories, d.catName);
    category.name = e.target.value.trim() || category.name;
  } else if (d.catPlanned) {
    findById(data.categories, d.catPlanned).plannedCents = Math.max(dollarsToCents(e.target.value) || 0, 0);
  } else {
    return;
  }
  saveData();
  // Re-render after focus moves (e.g. Tab to the next box), then put focus back
  setTimeout(() => {
    const focusedId = document.activeElement && document.activeElement.id;
    render();
    if (focusedId && $(focusedId)) $(focusedId).focus();
  });
});

$('fab').addEventListener('click', openQuickAdd);

// Status pill only does something when there's no paycheck yet
$('status-pill').addEventListener('click', () => {
  if (lastSummary.current && !missedPayday()) return;
  showTab('pay');
  $('paycheck-amount').focus();
});

// "+ Add" buttons open their pop-up forms
$('open-bill-dialog').addEventListener('click', () => $('bill-dialog').showModal());
$('open-fund-dialog').addEventListener('click', () => $('fund-dialog').showModal());
$('open-iou-dialog').addEventListener('click', () => $('iou-dialog').showModal());

// Enter in the quick-add pop-up shouldn't submit (you pick a category to save)
$('quick-add-form').addEventListener('submit', e => e.preventDefault());

$('frequency').addEventListener('change', e => {
  data.payFrequencyDays = Number(e.target.value);
  saveData();
  render();
});

$('rollover').addEventListener('change', e => {
  data.rollover = e.target.value;
  saveData();
  render();
});

$('low-warning-setting').addEventListener('change', e => {
  data.lowWarningCents = Math.max(dollarsToCents(e.target.value) || 0, 0);
  saveData();
  render();
});

$('spotme-limit').addEventListener('change', e => {
  data.spotMeLimitCents = Math.max(dollarsToCents(e.target.value) || 0, 0);
  saveData();
  render();
});

$('spotme-cushion').addEventListener('change', e => {
  data.spotMeCushionCents = Math.max(dollarsToCents(e.target.value) || 0, 0);
  saveData();
  render();
});

// Adds an adjustment so "Left this pay period" matches your real bank balance.
// Useful when some transactions (like another card) aren't imported.
$('balance-match').addEventListener('click', () => {
  const actual = dollarsToCents($('balance-actual').value);
  const cur = lastSummary.current;
  if (!Number.isFinite(actual) || !cur) return;
  const difference = actual - cur.leftCents;
  if (difference === 0) return;
  const adjustment = { id: newId(), amountCents: difference, date: today(), note: `Matched bank balance of ${formatMoney(actual)}` };
  data.adjustments.push(adjustment);
  saveData();
  $('balance-actual').value = '';
  render();
  showToast(`Adjusted by ${formatMoney(difference)}.`, () => {
    data.adjustments = data.adjustments.filter(x => x !== adjustment);
    saveData();
    render();
  });
});

// Backup: download all data as a .json file
$('export-btn').addEventListener('click', async () => {
  // Locked with your passcode when the app lock is on (lock.js)
  const blob = new Blob([await makeBackupText()], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `budget-backup-${today()}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  data.lastBackupDate = today();
  saveData();
  render();
});

// Start over with the default categories and nothing else
$('erase-btn').addEventListener('click', () => {
  if (!confirm('Erase everything in this app and start over? Export a backup first if you might want it back.')) return;
  data = defaultData();
  saveData();
  localStorage.removeItem(STORAGE_KEY + '-unreadable');
  historyPeriod = null;
  historyCategory = 'all';
  document.querySelectorAll('form').forEach(form => form.reset());
  setFormDefaults();
  render();
});

// Restore: replace all data with a backup (picking and listing backups is in backups.js)
function restoreBackup(backup) {
  if (!confirm('Replace all your current data with this backup?')) return;
  // Checked and upgraded the same way as a normal save, then saved (encrypted if the lock is on)
  data = prepareData(JSON.parse(JSON.stringify(backup)));
  saveData();
  historyPeriod = null;
  historyCategory = 'all';
  render();
  alert('Backup restored.');
}
$('afford-amount').addEventListener('input', () => renderAfford(lastSummary));

// Edit expense pop-up
let editingId = null;

function openEditDialog(id) {
  const expense = findById(data.expenses, id);
  if (!expense) return;
  editingId = id;
  $('edit-amount').value = centsToInput(expense.amountCents);
  $('edit-category').value = String(expense.categoryId);
  if (!$('edit-category').value) $('edit-category').selectedIndex = 0; // its category was deleted
  $('edit-note').value = expense.note || '';
  $('edit-date').value = expense.date;
  $('edit-fund-wrap').hidden = data.funds.length === 0;
  $('edit-fund').innerHTML = '<option value="">No</option>' +
    data.funds.map(f => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)}</option>`).join('');
  $('edit-fund').value = expense.fundId ? String(expense.fundId) : '';
  $('edit-dialog').showModal();
}

$('edit-form').addEventListener('submit', e => {
  e.preventDefault();
  const expense = findById(data.expenses, editingId);
  const cents = dollarsToCents($('edit-amount').value);
  if (!expense || !(cents > 0)) return;
  expense.amountCents = cents;
  expense.categoryId = $('edit-category').value;
  expense.note = $('edit-note').value.trim();
  expense.date = $('edit-date').value || expense.date;
  if ($('edit-fund').value) expense.fundId = $('edit-fund').value;
  else delete expense.fundId;
  // Keep its round-up matching the new amount
  const roundUp = data.expenses.find(x => x.roundUpOf !== undefined && String(x.roundUpOf) === String(expense.id));
  if (roundUp) {
    const change = 100 - (cents % 100);
    if (change === 100) data.expenses = data.expenses.filter(x => x !== roundUp);
    else { roundUp.amountCents = change; roundUp.date = expense.date; }
  }
  saveData();
  $('edit-dialog').close();
  render();
});

$('edit-cancel').addEventListener('click', () => $('edit-dialog').close());

$('edit-delete').addEventListener('click', () => {
  $('edit-dialog').close();
  removeWithUndo('expenses', editingId);
});

// ===== Start =====

// Waits until tips.js and bank.js have loaded too
document.addEventListener('DOMContentLoaded', () => {
  if (waitingForUnlock) {
    showLockScreen(); // lock.js renders the app after the right passcode
    return;
  }
  setFormDefaults();
  render();
});

// Lets the app work offline once installed (needs https or localhost)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
