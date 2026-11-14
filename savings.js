// ===== Savings goals =====
// A save is an expense in the "Savings" category with a goalId (and saveKind: 'save' | 'roundup' | 'sweep').
// A withdrawal is an income item with a goalId and withdrawal: true.
// Loaded right after app.js, so it can use app.js helpers like $, data, saveData, render and showToast.

const MILESTONES = [10, 25, 50, 75, 100];

// The nudge currently shown on Home (null = none)
let currentNudge = null;
// The goal being edited in the goal pop-up (null = new goal)
let editingGoalId = null;

// ===== Lookups =====

// Our own "Savings" category lookup (bank.js has one too, but it loads later)
function savingsCategory() {
  return (data.categories || []).find(c => c.name.trim().toLowerCase() === 'savings') || null;
}

function isSavingsExpense(expense) {
  const category = savingsCategory();
  return !!category && String(expense.categoryId) === String(category.id);
}

function getGoals() {
  return data.goals || [];
}

function findGoal(id) {
  return id == null ? null : findById(getGoals(), id) || null;
}

function defaultGoal() {
  return findGoal(data.defaultGoalId) || getGoals()[0] || null;
}

function isDefaultGoal(goal) {
  const def = defaultGoal();
  return !!def && String(def.id) === String(goal.id);
}

// Money taken out of savings outside the app (e.g. imported "Transfer From Chime Savings")
function isUntaggedTakeOut(income) {
  return !income.goalId && (income.fromSavings === true || /from .*savings/i.test(income.note || ''));
}

// Expenses that count toward a goal (its tagged saves, plus untagged Savings expenses for the default goal)
function goalSaves(goal) {
  const isDefault = isDefaultGoal(goal);
  return (data.expenses || []).filter(e =>
    e.goalId ? String(e.goalId) === String(goal.id) : isDefault && isSavingsExpense(e));
}

// Income that came out of a goal (its withdrawals, plus untagged "from savings" income for the default goal)
function goalWithdrawals(goal) {
  const isDefault = isDefaultGoal(goal);
  return (data.income || []).filter(x =>
    x.goalId ? String(x.goalId) === String(goal.id) : isDefault && isUntaggedTakeOut(x));
}

// How much is in a goal right now
function goalBalance(goal, summary) {
  const leftovers = isDefaultGoal(goal) && summary ? summary.savedFromLeftovers || 0 : 0;
  return (goal.startCents || 0) + leftovers +
    sum(goalSaves(goal), e => e.amountCents) - sum(goalWithdrawals(goal), x => x.amountCents);
}

// What's still needed to hit the target (0 if no target or reached)
function goalRemaining(goal, summary) {
  if (!(goal.targetCents > 0)) return 0;
  return Math.max(goal.targetCents - goalBalance(goal, summary), 0);
}

// ===== Setup and migration =====
// Adds the new keys if they're missing. The first time, turns the old single savings goal
// into a goal so its balance equals the old savings total. Safe to run every render.
function ensureGoals(summary) {
  let changed = false;

  if (!savingsCategory()) {
    data.categories.push({ id: newId(), name: 'Savings', plannedCents: 0 });
    changed = true;
  }
  if (!data.roundUps) { data.roundUps = { enabled: false, goalId: null }; changed = true; }
  if (!Array.isArray(data.sweptPeriods)) { data.sweptPeriods = []; changed = true; }
  if (data.nudgeDismissed === undefined) { data.nudgeDismissed = null; changed = true; }

  if (!Array.isArray(data.goals) || data.goals.length === 0) {
    const goal = {
      id: newId(),
      name: data.savingsGoalName || 'Savings',
      targetCents: data.savingsGoalCents || 0,
      targetDate: null,
      startCents: data.savingsAdjustCents || 0,
      baselineCents: 0,
      createdDate: today()
    };
    data.goals = [goal];
    data.defaultGoalId = goal.id;
    // Line up with the old total exactly (the old total also counted Savings bills, etc.)
    if (summary && Number.isFinite(summary.savingsCents)) {
      goal.startCents += summary.savingsCents - goalBalance(goal, summary);
    }
    goal.baselineCents = goalBalance(goal, summary);
    changed = true;
  }

  if (!findGoal(data.defaultGoalId)) { data.defaultGoalId = data.goals[0].id; changed = true; }
  if (changed) saveData();
}

// ===== Plans =====

// Paydays from the next one up to (and including) the target date
function paydaysUntil(dateText) {
  let payday = getNextPayday();
  if (!payday || !(data.payFrequencyDays > 0)) return 0;
  let count = 0;
  while (payday <= dateText) {
    count++;
    payday = addDays(payday, data.payFrequencyDays);
  }
  return count;
}

// Where the goal should be today on a straight line from (createdDate, baseline) to (targetDate, target)
function expectedBalance(goal) {
  const total = daysBetween(goal.createdDate, goal.targetDate);
  const elapsed = daysBetween(goal.createdDate, today());
  const fraction = total > 0 ? Math.min(Math.max(elapsed / total, 0), 1) : 1;
  const baseline = goal.baselineCents || 0;
  return Math.round(baseline + (goal.targetCents - baseline) * fraction);
}

// 'ahead' | 'on-track' | 'behind' (null if the goal has no target and date)
function goalStatus(goal, summary) {
  if (!(goal.targetCents > 0) || !goal.targetDate) return null;
  const balance = goalBalance(goal, summary);
  const expected = expectedBalance(goal);
  const margin = goal.targetCents * 0.05;
  if (balance > expected + margin) return 'ahead';
  if (balance < expected - margin) return 'behind';
  return 'on-track';
}

// Average saved per pay period since the goal was made (0 if nothing saved)
function goalPace(goal, summary) {
  const saved = sum(goalSaves(goal).filter(e => e.date >= goal.createdDate), e => e.amountCents);
  if (saved <= 0) return 0;
  const periods = summary ? summary.periods.filter(p => p.end > goal.createdDate).length : 0;
  return Math.round(saved / Math.max(periods, 1));
}

function goalPlanHtml(goal, summary) {
  const balance = goalBalance(goal, summary);
  if (!(goal.targetCents > 0)) return `${formatMoney(balance)} saved`;
  if (balance >= goal.targetCents) return 'Goal reached!';

  const remaining = goal.targetCents - balance;
  if (!goal.targetDate) {
    const pace = goalPace(goal, summary);
    let text = 'Add a target date to get a per-paycheck plan';
    if (pace > 0) text += ` · Saving about ${formatMoney(pace)} per paycheck (${Math.ceil(remaining / pace)} more to go)`;
    return text;
  }

  const paydays = paydaysUntil(goal.targetDate);
  const text = paydays > 0
    ? `Save ${formatMoney(Math.ceil(remaining / paydays))} per paycheck to hit ${formatMoney(goal.targetCents)} by ${formatShortDate(goal.targetDate)}`
    : `Save ${formatMoney(remaining)} to hit ${formatMoney(goal.targetCents)} by ${formatShortDate(goal.targetDate)}`;
  const status = goalStatus(goal, summary);
  const labels = { ahead: 'Ahead', 'on-track': 'On track', behind: 'Behind' };
  return `${text} <span class="goal-status ${status}">${labels[status]}</span>`;
}

// The goal furthest behind its plan, else the default goal
function goalMostBehind(summary) {
  let worst = null;
  let worstGap = 0;
  getGoals().forEach(goal => {
    if (goalStatus(goal, summary) !== 'behind') return;
    const gap = expectedBalance(goal) - goalBalance(goal, summary);
    if (gap > worstGap) { worst = goal; worstGap = gap; }
  });
  return worst || defaultGoal();
}

// Milestone percents a balance has reached
function reachedMilestones(goal, balance) {
  if (!(goal.targetCents > 0)) return [];
  return MILESTONES.filter(m => balance * 100 >= goal.targetCents * m);
}

// ===== Rendering =====

function renderSavings(summary) {
  ensureGoals(summary);
  fillGoalSelects();
  renderGoalList(summary);
  renderSavingsSummary(summary);
  renderNudge(summary);

  $('home-save-btn').hidden = !summary.current;
  $('roundup-enabled').checked = !!data.roundUps.enabled;
}

function goalOptions() {
  return getGoals().map(g => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`).join('');
}

// Fills the goal pickers, keeping what was picked if it still exists
function fillGoalSelects() {
  const options = goalOptions();
  for (const id of ['save-goal', 'withdraw-goal', 'roundup-goal']) {
    const select = $(id);
    const previous = select.value;
    select.innerHTML = options;
    if ([...select.options].some(o => o.value === previous)) select.value = previous;
    else if (defaultGoal()) select.value = String(defaultGoal().id);
  }
  const roundUpGoal = findGoal(data.roundUps.goalId) || defaultGoal();
  if (roundUpGoal) $('roundup-goal').value = String(roundUpGoal.id);
}

function renderGoalList(summary) {
  $('goal-list').innerHTML = getGoals().map(goal => {
    const balance = goalBalance(goal, summary);
    const hasTarget = goal.targetCents > 0;
    const amount = hasTarget ? `${formatMoney(balance)} of ${formatMoney(goal.targetCents)}` : formatMoney(balance);
    const reached = reachedMilestones(goal, balance);
    const milestones = hasTarget
      ? `<div class="milestones">${MILESTONES.map(m =>
          `<span class="milestone${reached.includes(m) ? ' reached' : ''}">${m}%</span>`).join('')}</div>`
      : '';
    const id = escapeHtml(goal.id);
    return `<li class="goal">
      <div class="goal-head"><strong>${escapeHtml(goal.name)}</strong>${isDefaultGoal(goal) ? ' <span class="goal-default">Default</span>' : ''} <span class="goal-amount">${amount}</span></div>
      ${hasTarget ? progressBar(Math.max(balance, 0) / goal.targetCents, 'green') : ''}
      <p class="goal-plan muted small">${goalPlanHtml(goal, summary)}</p>
      ${milestones}
      <div class="goal-actions"><button class="small-btn" data-save-goal="${id}">Save</button><button class="small-btn" data-edit-goal="${id}">Edit</button></div>
      <details class="more"><summary>History</summary><ul class="goal-history">${goalHistoryHtml(goal)}</ul></details>
    </li>`;
  }).join('');
}

// Saves (+) and withdrawals (−), newest first
function goalHistoryHtml(goal) {
  const rows = [
    ...goalSaves(goal).map(e => ({ date: e.date, cents: e.amountCents, note: e.note, plus: true })),
    ...goalWithdrawals(goal).map(x => ({ date: x.date, cents: x.amountCents, note: x.note, plus: false }))
  ].sort((a, b) => b.date.localeCompare(a.date));
  if (rows.length === 0) return '<li class="muted small">Nothing saved here yet.</li>';
  return rows.map(r => `<li><span class="${r.plus ? 'plus' : 'minus'}">${r.plus ? '+' : '−'}${formatMoney(r.cents)}</span>
    <span class="muted small">${formatShortDate(r.date)}${r.note ? ' · ' + escapeHtml(r.note) : ''}</span></li>`).join('');
}

// Is this expense a save (to any goal)?
function isSave(expense) {
  return !!expense.goalId || isSavingsExpense(expense);
}

function savesInPeriod(period) {
  return (data.expenses || []).filter(e => isSave(e) && e.date >= period.start && e.date < period.end);
}

// Consecutive pay periods (newest first) with at least one save
function savingStreak(periods) {
  let i = periods.length - 1;
  if (i >= 0 && savesInPeriod(periods[i]).length === 0) i--; // current period has no save yet
  let streak = 0;
  for (; i >= 0; i--) {
    if (savesInPeriod(periods[i]).length === 0) break;
    streak++;
  }
  return streak;
}

function renderSavingsSummary(summary) {
  const parts = [];
  if (summary.current) parts.push(`Saved this pay period ${formatMoney(sum(savesInPeriod(summary.current), e => e.amountCents))}`);
  const streak = savingStreak(summary.periods);
  if (streak > 0) parts.push(`Saving streak ${streak} pay period${streak === 1 ? '' : 's'}`);
  $('savings-summary').textContent = parts.join(' · ');
}

// ===== Home nudge =====

// Picks the one nudge to show (leftover sweep first, then under-budget save), or null
function pickNudge(summary) {
  const goal = defaultGoal();
  const cur = summary.current;
  if (!goal || !cur) return null;

  // a. Leftover sweep from the last finished pay period
  const last = summary.periods[summary.periods.length - 2];
  if (last && last.leftCents > 0 && !data.sweptPeriods.includes(last.id) &&
      data.rollover !== 'savings' && cur.adjustCents >= 0) {
    const dates = `${formatShortDate(last.start)} – ${formatShortDate(addDays(last.end, -1))}`;
    return {
      kind: 'sweep', period: last, goal, amountCents: last.leftCents, dates,
      text: `Your ${dates} pay period ended with ${formatMoney(last.leftCents)} left. Move it to ${goal.name}?`
    };
  }

  // b. Under budget: suggest saving half the extra
  if (data.nudgeDismissed === today()) return null;
  const daysLeft = Math.max(daysBetween(today(), cur.end), 1);
  let headroom;
  if (data.lowWarningCents > 0) {
    headroom = cur.leftCents - data.lowWarningCents * daysLeft;
  } else {
    const daysSoFar = Math.max(daysBetween(cur.start, today()) + 1, 1);
    // Everyday spending only: bills are already out of leftCents, and saves/repayments aren't a daily pace
    const oneTimeIds = ['Loans & Advances', 'Fees', 'Savings'].map(findCategoryByName).filter(Boolean).map(c => String(c.id));
    const spent = sum(data.expenses.filter(e => e.date >= cur.start && e.date < cur.end && !isSave(e) &&
      !oneTimeIds.includes(String(e.categoryId))), e => e.amountCents);
    headroom = Math.min(cur.leftCents - Math.ceil(Math.max(spent, 0) / daysSoFar) * daysLeft, cur.leftCents);
  }
  if (headroom <= 0) return null;

  const target = goalMostBehind(summary);
  const step = headroom < 1000 ? 100 : 500;
  let suggest = Math.floor(headroom / 2 / step) * step;
  if (target.targetCents > 0) suggest = Math.min(suggest, goalRemaining(target, summary));
  // Never push safe-per-day below the low warning
  while (suggest > 0 && Math.floor((cur.leftCents - suggest) / daysLeft) < data.lowWarningCents) suggest -= 100;
  if (suggest < 100) return null;

  return {
    kind: 'save', goal: target, amountCents: suggest,
    text: `You're ${formatMoney(headroom)} under budget. Save ${formatMoney(suggest)} to ${target.name}?`
  };
}

function renderNudge(summary) {
  currentNudge = pickNudge(summary);
  $('save-nudge').hidden = !currentNudge;
  $('save-nudge-text').textContent = currentNudge ? currentNudge.text : '';
}

// ===== Saving and withdrawing =====

// Adds a save to a goal and shows a toast with Undo (milestone toast if one was crossed)
function saveToGoal(goal, amountCents, note, kind = 'save', date = today(), extraUndo = null) {
  const category = savingsCategory();
  const before = goalBalance(goal, lastSummary);
  const expense = {
    id: newId(), amountCents, categoryId: category.id, note: note || `Saved to ${goal.name}`,
    date, goalId: goal.id, saveKind: kind
  };
  data.expenses.push(expense);
  saveData();
  render();

  const after = goalBalance(goal, lastSummary);
  const newMilestones = reachedMilestones(goal, after).filter(m => !reachedMilestones(goal, before).includes(m));
  const top = newMilestones[newMilestones.length - 1];
  const message = top ? `${goal.name} reached ${top}%!` : `Saved ${formatMoney(amountCents)} to ${goal.name}.`;
  showToast(message, () => {
    data.expenses = data.expenses.filter(e => e !== expense);
    if (extraUndo) extraUndo();
    saveData();
    render();
  });
}

// Called by addExpense in app.js. Adds the round-up save (doesn't save or render).
function createRoundUp(expense) {
  if (!data.roundUps || !data.roundUps.enabled || isSavingsExpense(expense)) return null;
  const cents = expense.amountCents % 100;
  if (!(expense.amountCents > 0) || cents === 0) return null;
  const goal = findGoal(data.roundUps.goalId) || defaultGoal();
  const category = savingsCategory();
  if (!goal || !category) return null;

  const roundUp = {
    id: newId(),
    amountCents: 100 - cents,
    categoryId: category.id,
    note: `Round-up: ${expense.note || categoryName(expense.categoryId)}`,
    date: expense.date,
    goalId: goal.id,
    saveKind: 'roundup',
    roundUpOf: expense.id
  };
  data.expenses.push(roundUp);
  return roundUp;
}

function openSaveDialog(goalId) {
  fillGoalSelects();
  const goal = findGoal(goalId) || defaultGoal();
  if (goal) $('save-goal').value = String(goal.id);
  $('save-amount').value = '';
  $('save-note').value = '';
  $('save-dialog').showModal();
  $('save-amount').focus();
}

// Opens the goal pop-up for a new goal (no id) or to edit one
function openGoalDialog(goalId) {
  const goal = findGoal(goalId);
  editingGoalId = goal ? goal.id : null;
  $('goal-form').reset();
  $('goal-dialog-title').textContent = goal ? 'Edit goal' : 'New goal';
  $('goal-form-id').value = goal ? goal.id : '';
  $('goal-form-name').value = goal ? goal.name : '';
  $('goal-form-target').value = goal && goal.targetCents > 0 ? centsToInput(goal.targetCents) : '';
  $('goal-form-date').value = goal && goal.targetDate ? goal.targetDate : '';
  $('goal-form-actual').value = goal ? centsToInput(goalBalance(goal, lastSummary)) : '';
  $('goal-form-actual-wrap').hidden = !goal;
  $('goal-form-default').checked = goal ? isDefaultGoal(goal) : getGoals().length === 0;
  $('goal-delete').hidden = !goal;
  $('goal-dialog').showModal();
  $('goal-form-name').focus();
}

// ===== Events =====

$('save-form').addEventListener('submit', e => {
  e.preventDefault();
  const amountCents = dollarsToCents($('save-amount').value);
  const goal = findGoal($('save-goal').value);
  if (!(amountCents > 0) || !goal) {
    $('save-amount').focus();
    return;
  }
  $('save-dialog').close();
  saveToGoal(goal, amountCents, $('save-note').value.trim());
});

$('withdraw-form').addEventListener('submit', e => {
  e.preventDefault();
  const goal = findGoal($('withdraw-goal').value);
  const amountCents = dollarsToCents($('withdraw-amount').value);
  const note = $('withdraw-note').value.trim();
  if (!goal || !(amountCents > 0) || !note) return;
  const balance = goalBalance(goal, lastSummary);
  if (amountCents > balance) {
    showToast(`${goal.name} only has ${formatMoney(balance)}.`, null);
    $('withdraw-amount').focus();
    return;
  }
  const income = {
    id: newId(), amountCents, date: today(), note: `Withdrew from ${goal.name}: ${note}`,
    goalId: goal.id, withdrawal: true
  };
  data.income.push(income);
  saveData();
  $('withdraw-form').reset();
  $('withdraw-dialog').close();
  render();
  showToast(`Withdrew ${formatMoney(amountCents)} from ${goal.name}.`, () => {
    data.income = data.income.filter(x => x !== income);
    saveData();
    render();
  });
});

$('goal-form').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('goal-form-name').value.trim();
  if (!name) return;
  const targetCents = Math.max(dollarsToCents($('goal-form-target').value) || 0, 0);
  const targetDate = $('goal-form-date').value || null;
  data.goals = getGoals();

  let goal = findGoal($('goal-form-id').value);
  if (goal) {
    goal.name = name;
    goal.targetCents = targetCents;
    goal.targetDate = targetDate;
    // "Actual balance": shift the starting amount so the balance matches
    const actual = dollarsToCents($('goal-form-actual').value);
    if (Number.isFinite(actual)) goal.startCents = (goal.startCents || 0) + actual - goalBalance(goal, lastSummary);
  } else {
    goal = { id: newId(), name, targetCents, targetDate, startCents: 0, baselineCents: 0, createdDate: today() };
    data.goals.push(goal);
  }
  if ($('goal-form-default').checked || !findGoal(data.defaultGoalId)) setDefaultGoal(goal);

  saveData();
  $('goal-dialog').close();
  render();
});

// Makes a goal the default without changing any goal's balance: the old default keeps its
// untagged records (they get tagged) and the leftovers saved so far; new ones go to the new default.
function setDefaultGoal(goal) {
  const old = findGoal(data.defaultGoalId);
  if (old && String(old.id) !== String(goal.id)) {
    goalSaves(old).forEach(x => x.goalId = old.id);
    goalWithdrawals(old).forEach(x => x.goalId = old.id);
    const leftovers = lastSummary ? lastSummary.savedFromLeftovers || 0 : 0;
    old.startCents = (old.startCents || 0) + leftovers;
    goal.startCents = (goal.startCents || 0) - leftovers;
  }
  data.defaultGoalId = goal.id;
}

$('goal-delete').addEventListener('click', () => {
  const goal = findGoal($('goal-form-id').value);
  if (!goal) return;
  const others = getGoals().filter(g => g !== goal);
  if (others.length === 0) {
    alert("You can't delete your only goal. Rename it instead.");
    return;
  }
  // Its saves move to the default goal (or the next goal if this one is the default)
  const moveTo = isDefaultGoal(goal) ? others[0] : defaultGoal();
  if (!confirm(`Delete "${goal.name}"? Its saves and withdrawals move to ${moveTo.name}.`)) return;

  // Untagged records belong to the default goal, so tag them before the default changes
  goalSaves(goal).forEach(x => x.goalId = moveTo.id);
  goalWithdrawals(goal).forEach(x => x.goalId = moveTo.id);
  moveTo.startCents = (moveTo.startCents || 0) + (goal.startCents || 0);
  if (isDefaultGoal(goal)) data.defaultGoalId = moveTo.id;
  if (data.roundUps && String(data.roundUps.goalId) === String(goal.id)) data.roundUps.goalId = null;
  data.goals = others;

  saveData();
  $('goal-dialog').close();
  render();
});

$('open-goal-dialog').addEventListener('click', () => openGoalDialog(null));

$('open-withdraw-dialog').addEventListener('click', () => {
  fillGoalSelects();
  $('withdraw-amount').value = '';
  $('withdraw-note').value = '';
  $('withdraw-dialog').showModal();
  $('withdraw-amount').focus();
});

$('home-save-btn').addEventListener('click', () => openSaveDialog());

$('qa-save-instead').addEventListener('click', () => {
  const typed = $('qa-amount').value;
  $('quick-add-dialog').close();
  openSaveDialog();
  $('save-amount').value = typed;
});

// Buttons drawn inside the goal list
document.addEventListener('click', e => {
  const button = e.target.closest('button');
  if (!button) return;
  if (button.dataset.saveGoal) openSaveDialog(button.dataset.saveGoal);
  else if (button.dataset.editGoal) openGoalDialog(button.dataset.editGoal);
});

$('save-nudge-yes').addEventListener('click', () => {
  const nudge = currentNudge;
  if (!nudge) return;
  if (nudge.kind === 'sweep') {
    const periodId = nudge.period.id;
    data.sweptPeriods = data.sweptPeriods || [];
    data.sweptPeriods.push(periodId);
    saveToGoal(nudge.goal, nudge.amountCents, `Leftover from ${nudge.dates}`, 'sweep', addDays(nudge.period.end, -1), () => {
      data.sweptPeriods = (data.sweptPeriods || []).filter(id => id !== periodId);
    });
  } else {
    saveToGoal(nudge.goal, nudge.amountCents, '');
  }
});

$('save-nudge-no').addEventListener('click', () => {
  const nudge = currentNudge;
  if (!nudge) return;
  if (nudge.kind === 'sweep') {
    data.sweptPeriods = data.sweptPeriods || [];
    data.sweptPeriods.push(nudge.period.id);
  } else {
    data.nudgeDismissed = today();
  }
  saveData();
  render();
});

// Round-up settings
$('roundup-enabled').addEventListener('change', e => {
  data.roundUps = data.roundUps || { enabled: false, goalId: null };
  data.roundUps.enabled = e.target.checked;
  data.roundUps.goalId = data.roundUps.goalId || $('roundup-goal').value || null;
  saveData();
  render();
});

$('roundup-goal').addEventListener('change', e => {
  data.roundUps = data.roundUps || { enabled: false, goalId: null };
  data.roundUps.goalId = e.target.value || null;
  saveData();
  render();
});
