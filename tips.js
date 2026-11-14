// ===== Personalized tips =====
// Simple rules that look at your own spending and suggest what to do next.
// Everything is worked out on your device.
// Each tip: { id, text, action? }. The id is remembered when you tap Hide.

let currentTips = [];

// Expenses grouped by note/merchant (lowercase), e.g. "starbucks" -> [expenses]
function groupByNote(expenses) {
  const groups = new Map();
  for (const e of expenses) {
    const name = (e.note || '').trim().toLowerCase();
    if (!name) continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(e);
  }
  return groups;
}

// Same note, same amount, once a month for 2+ months = probably a subscription
function findSubscriptions() {
  const subscriptions = [];
  for (const [name, list] of groupByNote(data.expenses)) {
    if (list.length < 2) continue;
    const months = new Set(list.map(e => e.date.slice(0, 7)));
    const sameAmount = list.every(e => e.amountCents === list[0].amountCents);
    const alreadyBill = data.bills.some(b => b.name.toLowerCase() === name);
    if (months.size === list.length && sameAmount && !alreadyBill) subscriptions.push(list);
  }
  return subscriptions;
}

// Turns a subscription into a bill and removes the matching expenses (the bill covers them now)
function convertToBill(list) {
  const before = JSON.stringify(data); // for Undo
  const latest = list.reduce((a, b) => (a.date > b.date ? a : b));
  data.bills.push({
    id: newId(),
    name: latest.note,
    amountCents: latest.amountCents,
    dueDay: parseDate(latest.date).getDate(),
    categoryId: latest.categoryId,
    createdDate: list.reduce((a, b) => (a.date < b.date ? a : b)).date // it replaces these expenses, so it starts with the first one
  });
  data.expenses = data.expenses.filter(e => !list.includes(e));
  saveData();
  render();
  showToast(`${latest.note} is now a bill.`, () => {
    data = JSON.parse(before);
    saveData();
    render();
  });
}

function getTips(summary) {
  const tips = [];
  const add = (id, text, action) => {
    if (!data.dismissedTips.includes(id)) tips.push({ id, text, action });
  };
  const cur = summary.current;
  const periods = summary.periods;
  const latestPay = sortedPaychecks()[0];

  if (!cur) {
    add('start', 'Add your latest paycheck in the Pay tab, or import your bank CSV, to start getting tips.');
    return tips;
  }

  // Pay-stub check: latest paycheck much lower than the shifts logged for it
  const check = latestPay ? paystubCheck(latestPay) : null; // forecast.js
  if (check && check.short) {
    add(`paystub-${latestPay.id}`, `Your ${formatShortDate(latestPay.date)} paycheck was ${formatMoney(latestPay.amountCents)}, but your ${check.hours} h of logged shifts should pay about ${formatMoney(check.expected)}. Check your pay stub for missing hours.`);
  }

  const daysLeft = daysBetween(today(), cur.end);
  const daysTotal = daysBetween(cur.start, cur.end);
  const daysGone = Math.min(daysTotal, Math.max(1, daysBetween(cur.start, today()) + 1));
  const safePerDay = Math.floor(Math.max(cur.leftCents, 0) / daysLeft);

  // 1. Categories that are over (or almost over) their plan
  for (const c of data.categories) {
    if (c.plannedCents <= 0) continue;
    const spent = cur.spentByCategory[String(c.id)] || 0;
    if (spent > c.plannedCents) {
      add(`over-${c.id}-${cur.id}`, `You're ${formatMoney(spent - c.plannedCents)} over your ${c.name} plan this pay period. Take it from a category you haven't used much.`);
    } else if (spent >= c.plannedCents * 0.75 && daysLeft > 2) {
      const perDay = Math.floor((c.plannedCents - spent) / daysLeft);
      add(`near-${c.id}-${cur.id}`, `${c.name} is at ${Math.round((spent / c.plannedCents) * 100)}% with ${daysLeft} days left. That's ${formatMoney(perDay)} a day for ${c.name}.`);
    }
  }

  // 1b. Pay advances that will come out of the next paycheck
  // (a repayment clears everything advanced before it, so count advances since the last one)
  const loans = findCategoryByName('Loans & Advances');
  const lastRepayment = loans
    ? data.expenses.filter(e => String(e.categoryId) === String(loans.id)).map(e => e.date).sort().pop() || ''
    : '';
  const owedAdvances = sum(data.income.filter(x => x.advance && x.date > lastRepayment), x => x.amountCents);
  if (owedAdvances > 0) {
    add(`advance-${owedAdvances}-${lastRepayment}`, `${formatMoney(owedAdvances)} in pay advances will come out of your next paycheck (${formatDate(cur.end)}). Plan for it now so that check doesn't start short.`);
  }

  // 1c. Using SpotMe / overdraft
  const covered = Math.max(-cur.leftCents, 0);
  if (data.spotMeLimitCents > 0 && covered > 0) {
    add(`spotme-${covered}`, `SpotMe is covering ${formatMoney(covered)}. It's taken back from your next deposit, so your next paycheck will be about ${formatMoney(covered)} smaller.`);
  }

  // 2. Spending pace: will the money last until payday?
  // Only everyday spending counts toward the pace; one-time things like repayments,
  // fees and savings transfers would make it look like you spend that much every day
  const oneTimeIds = ['Loans & Advances', 'Fees', 'Savings'].map(findCategoryByName).filter(Boolean).map(c => String(c.id));
  const everydayCents = sum(
    data.expenses.filter(e => e.date >= cur.start && e.date < cur.end && !oneTimeIds.includes(String(e.categoryId))),
    e => e.amountCents
  );
  const available = cur.leftCents + everydayCents; // what was there for everyday spending
  const perDay = everydayCents / daysGone;
  // Skipped when you're already below zero (the SpotMe tip covers that)
  if (daysGone >= 2 && daysGone < daysTotal && everydayCents > 0 && available > 0 && cur.leftCents > 0) {
    const projected = perDay * daysTotal;
    if (projected > available) {
      const daysEarly = daysTotal - Math.floor(available / perDay);
      if (daysEarly > 0) {
        add(`pace-${cur.id}`, `At your pace so far (${formatMoney(Math.round(perDay))} a day), you'd run out about ${daysEarly} day${daysEarly === 1 ? '' : 's'} before payday. Try to stay under ${formatMoney(safePerDay)} a day.`);
      }
    } else if (daysGone >= 3) {
      add(`goodpace-${cur.id}`, `Nice pace! At ${formatMoney(Math.round(perDay))} a day you'd finish this pay period with about ${formatMoney(Math.round(available - projected))} left.`);
    }
  }

  // 3. A bill due in the next 3 days
  for (const b of data.bills) {
    for (const date of billDatesInPeriod(b, { start: today(), end: addDays(today(), 4) })) {
      const days = daysBetween(today(), date);
      add(`bill-${b.id}-${date}`, `${b.name} (${formatMoney(b.amountCents)}) is due ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}.`);
    }
  }

  // 4. Subscriptions you could plan for as bills
  for (const list of findSubscriptions()) {
    const s = list[0];
    add(`sub-${s.note.toLowerCase()}`, `${s.note} charges you ${formatMoney(s.amountCents)} every month. Add it as a bill so it's planned for, or cancel it if you don't use it.`,
      { label: 'Add as bill', run: () => convertToBill(list) });
  }

  // 5. Small purchases that add up (last 30 days)
  const monthAgo = addDays(today(), -30);
  let topHabit = null;
  for (const list of groupByNote(data.expenses.filter(e => e.date >= monthAgo)).values()) {
    const total = sum(list, e => e.amountCents);
    if (list.length >= 4 && total >= 1500 && (!topHabit || total > topHabit.total)) topHabit = { list, total };
  }
  if (topHabit) {
    const name = topHabit.list[0].note;
    add(`habit-${name.toLowerCase()}-${today().slice(0, 7)}`, `You went to ${name} ${topHabit.list.length} times in the last 30 days (${formatMoney(topHabit.total)}). Going half as often would save about ${formatMoney(Math.round(topHabit.total / 2))} a month.`);
  }

  // 5b. Bank and pay-advance fees (last 30 days)
  const fees = findCategoryByName('Fees');
  if (fees) {
    const feeCents = sum(data.expenses.filter(e => String(e.categoryId) === String(fees.id) && e.date >= monthAgo), e => e.amountCents);
    if (feeCents > 0) {
      add(`fees-${today().slice(0, 7)}`, `You paid ${formatMoney(feeCents)} in fees in the last 30 days. Pay advances and instant transfers usually cost a fee; waiting for payday, or keeping a small cushion in savings, avoids them.`);
    }
  }

  // 6. Plan bigger than the paycheck
  const planned = sum(data.categories, c => c.plannedCents);
  if (latestPay && planned > latestPay.amountCents) {
    add(`overplan-${planned}-${latestPay.amountCents}`, `Your category plan (${formatMoney(planned)}) is ${formatMoney(planned - latestPay.amountCents)} more than your last paycheck. Trim a category so the plan fits.`);
  }

  // 7. Friends who've owed you for 2+ weeks
  for (const i of data.ious) {
    const weeks = Math.floor(daysBetween(i.date, today()) / 7);
    if (i.theyOweMe && weeks >= 2) {
      add(`iou-${i.id}-${weeks}`, `${i.person} has owed you ${formatMoney(i.amountCents)} for ${weeks} weeks. Time for a friendly reminder?`);
    }
  }

  // 8. Category that jumped between the last two finished pay periods
  if (periods.length >= 3) {
    const last = periods[periods.length - 2];
    const before = periods[periods.length - 3];
    for (const c of data.categories) {
      const now = last.spentByCategory[String(c.id)] || 0;
      const then = before.spentByCategory[String(c.id)] || 0;
      if (then > 0 && now - then >= 2000 && now > then * 1.3) {
        add(`jump-${c.id}-${last.id}`, `You spent ${Math.round((now / then - 1) * 100)}% more on ${c.name} last pay period (${formatMoney(now)} vs ${formatMoney(then)}). Worth a look?`);
      }
    }
  }

  // 9. Leftovers that could be saving automatically
  const lastFinished = periods[periods.length - 2];
  // (Not when a balance adjustment shows some spending is missing; the leftover isn't real then)
  // (Not while the Home "move it to a goal" nudge is asking about the same leftover)
  if (data.rollover === 'off' && lastFinished && lastFinished.leftCents > 0 && cur.adjustCents >= 0 &&
      (data.sweptPeriods || []).includes(lastFinished.id)) {
    add('rollover', `You had ${formatMoney(lastFinished.leftCents)} left over last pay period. Set "Money left at the end of a pay period" to "Move it to savings" in ⚙ Settings.`);
  }

  // 10. Nothing planned for savings
  const savings = findCategoryByName('Savings');
  if (savings && savings.plannedCents === 0 && latestPay) {
    add('savings-plan', `Try planning 10% of each paycheck (${formatMoney(Math.round(latestPay.amountCents / 10))}) for Savings. Small amounts add up fast.`);
  }

  // 11. Backup reminder
  const backupAge = data.lastBackupDate ? daysBetween(data.lastBackupDate, today()) : Infinity;
  if (data.expenses.length >= 10 && backupAge > 30) {
    add(`backup-${today().slice(0, 7)}`, 'Your data only lives on this phone. Download a backup from ⚙ Settings.');
  }

  return tips;
}

function renderTips(summary) {
  currentTips = getTips(summary).slice(0, 5);
  $('tips-card').hidden = currentTips.length === 0;
  $('tips-list').innerHTML = currentTips.map((t, i) => `
    <li>
      <div>${escapeHtml(t.text)}</div>
      <div class="actions">
        ${t.action ? `<button class="small-btn" data-tip-action="${i}">${escapeHtml(t.action.label)}</button>` : ''}
        <button class="small-btn" data-tip-hide="${i}">Hide</button>
      </div>
    </li>`).join('');
}

document.addEventListener('click', e => {
  const button = e.target.closest('button');
  if (!button) return;
  const tip = currentTips[Number(button.dataset.tipAction ?? button.dataset.tipHide)];
  if (!tip) return;
  if (button.dataset.tipAction !== undefined) {
    tip.action.run();
  } else {
    data.dismissedTips.push(tip.id);
    saveData();
    render();
  }
});
