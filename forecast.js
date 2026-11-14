// ===== Forecast =====
// Looks ahead at your next few paydays using the shifts you've entered.
// All money is cents (integers). Dates are "YYYY-MM-DD" strings.

const ASSUMED_TAKE_HOME = 0.85; // used until a real paycheck lines up with your shifts
const DEFAULT_SHIFT_HOURS = 6;  // used by the what-if buttons when no shifts are entered yet

// Extra shifts from the +1 / −1 buttons (just for trying ideas, not saved)
let whatIfShifts = 0;

// Paydays whose breakdown is open, so a re-render doesn't close them
const openPaydays = new Set();

// ===== Settings =====
// Saved in data.forecast. null means "work it out automatically".

function forecastSettings() {
  if (!data.forecast) data.forecast = {};
  const s = data.forecast;
  if (s.takeHomePercent === undefined) s.takeHomePercent = null;
  if (s.spendingCents === undefined) s.spendingCents = null;
  if (s.payLagDays === undefined) s.payLagDays = 0;
  if (s.paydays === undefined) s.paydays = 6;
  if (!s.payOverrides) s.payOverrides = {}; // payday date -> pay you typed in
  return s;
}

// ===== Shift helpers =====

function allShifts() {
  return data.shifts || [];
}

// Hours worked in [start, end) (end not included)
function hoursBetween(start, end) {
  return sum(allShifts().filter(s => s.date >= start && s.date < end), s => s.hours);
}

// The work dates a payday pays for: the pay period that ends "payLagDays" before it
function workWindow(payday) {
  const end = addDays(payday, -forecastSettings().payLagDays);
  return { start: addDays(end, -data.payFrequencyDays), end };
}

// Average length of the shifts you've entered
function averageShiftHours() {
  const shifts = allShifts();
  if (shifts.length === 0) return DEFAULT_SHIFT_HOURS;
  return sum(shifts, s => s.hours) / shifts.length;
}

// Pay-stub check: does a paycheck match the shifts logged for it?
function paystubCheck(paycheck) {
  const rate = data.hourlyRateCents;
  const w = workWindow(paycheck.date);
  const hours = hoursBetween(w.start, w.end);
  if (!(rate > 0) || hours <= 0) return null;
  const expected = Math.round(hours * rate * getTakeHome().rate);
  return { hours, expected, short: expected - paycheck.amountCents >= Math.max(1000, expected * 0.1) };
}

function paystubNote(paycheck) {
  const check = paystubCheck(paycheck);
  if (!check) return '';
  return `<div class="muted small${check.short ? ' over' : ''}">${check.hours} h logged · expected about ${formatMoney(check.expected)}${check.short ? ' · check your pay stub' : ''}</div>`;
}

// ===== Take-home rate =====
// Compares real paychecks with hours × rate for the shifts they paid for.
// Kept between 50% and 100%: a higher number usually means some shifts weren't entered.

function learnedTakeHome() {
  const rate = data.hourlyRateCents;
  let actual = 0;
  let gross = 0;
  let matched = 0;
  if (rate > 0) {
    data.paychecks.forEach(p => {
      const w = workWindow(p.date);
      const hours = hoursBetween(w.start, w.end);
      if (hours <= 0) return;
      actual += p.amountCents;
      gross += hours * rate;
      matched++;
    });
  }
  if (matched === 0) return { rate: ASSUMED_TAKE_HOME, matched: 0, capped: false };
  const raw = actual / gross;
  return { rate: Math.min(Math.max(raw, 0.5), 1), matched, capped: raw > 1 || raw < 0.5 };
}

function getTakeHome() {
  const custom = forecastSettings().takeHomePercent;
  const learned = learnedTakeHome();
  return custom ? { ...learned, rate: custom / 100, custom: true } : { ...learned, custom: false };
}

// ===== Paycheck range =====
// Min, max and average of your last 6 paychecks (null if you have none)

function getPaycheckRange() {
  const recent = sortedPaychecks().slice(0, 6);
  if (recent.length === 0) return null;
  const amounts = recent.map(p => p.amountCents);
  return {
    min: Math.min(...amounts),
    max: Math.max(...amounts),
    avg: Math.round(sum(amounts, a => a) / amounts.length)
  };
}

// Average of the last 4 paychecks (0 if none)
function averageRecentPaycheck() {
  const recent = sortedPaychecks().slice(0, 4);
  if (recent.length === 0) return 0;
  return Math.round(sum(recent, p => p.amountCents) / recent.length);
}

// ===== Spending =====
// What you'll spend each pay period: your own number, your planned category amounts,
// or the average of your last 3 finished pay periods.
// Advance repayments are left out of the average, because the forecast takes them separately.

function expectedSpending(summary) {
  const custom = forecastSettings().spendingCents;
  if (custom !== null) return { cents: custom, how: 'the amount you set' };

  // Bills are subtracted on their own, so leave them out of the planned amounts
  const planned = sum(data.categories, c => Math.max(c.plannedCents -
    sum(data.bills.filter(b => String(b.categoryId) === String(c.id)), b => b.amountCents), 0));
  if (planned > 0) return { cents: planned, how: 'your planned category amounts' };

  const finished = summary ? summary.periods.slice(0, -1).slice(-3) : [];
  if (finished.length === 0) return { cents: 0, how: 'no finished pay periods yet' };
  const skipIds = ['Loans & Advances', 'Savings'].map(findCategoryByName).filter(Boolean).map(c => String(c.id));
  const perPeriod = finished.map(p => sum(
    data.expenses.filter(e => e.date >= p.start && e.date < p.end && !skipIds.includes(String(e.categoryId)) && !e.goalId && !e.fundId),
    e => e.amountCents
  ));
  return {
    cents: Math.round(sum(perPeriod, c => c) / perPeriod.length),
    how: `the average of your last ${perPeriod.length} pay period${perPeriod.length === 1 ? '' : 's'} (not counting advance repayments)`
  };
}

// Pay advances that come out of the next paycheck
// (a repayment in "Loans & Advances" clears everything advanced before it)
function owedAdvances() {
  const loans = findCategoryByName('Loans & Advances');
  const lastRepayment = loans
    ? data.expenses.filter(e => String(e.categoryId) === String(loans.id)).map(e => e.date).sort().pop() || ''
    : '';
  return sum(data.income.filter(x => x.advance && x.date > lastRepayment), x => x.amountCents);
}

// ===== What-if =====

// How much the extra (or fewer) shifts add to the next paycheck
function whatIfCents(takeHome) {
  return Math.round(whatIfShifts * averageShiftHours() * data.hourlyRateCents * takeHome);
}

function renderWhatIf(takeHome) {
  const label = $('fc-whatif-label');
  if (whatIfShifts === 0) {
    label.textContent = 'No change';
    return;
  }
  const count = `${whatIfShifts > 0 ? '+' : '−'}${Math.abs(whatIfShifts)} shift${Math.abs(whatIfShifts) === 1 ? '' : 's'}`;
  if (!(data.hourlyRateCents > 0)) {
    label.textContent = `${count} (set your pay per hour in Forecast settings)`;
    return;
  }
  const cents = whatIfCents(takeHome);
  label.textContent = `${count}: ${cents >= 0 ? '+' : '−'}${formatMoney(Math.abs(cents))} next payday`;
}

// ===== Timeline =====

// The first payday to show: your next payday, or (with no paychecks yet)
// one pay period after your first upcoming shift
function firstForecastPayday() {
  const missed = missedPayday(); // paycheck not added yet: still show it
  if (missed) return missed;
  const next = getNextPayday();
  if (next) return next;
  const upcoming = allShifts().filter(s => s.date >= today()).map(s => s.date).sort();
  const first = upcoming[0] || allShifts().map(s => s.date).sort().pop();
  if (!first) return null;
  let payday = addDays(first, data.payFrequencyDays + forecastSettings().payLagDays);
  while (payday < today()) payday = addDays(payday, data.payFrequencyDays); // never a payday that's already past
  return payday;
}

// Works out every payday in the forecast. Each one includes what it's based on,
// so the breakdown can explain it.
function buildForecast(summary, takeHome) {
  const settings = forecastSettings();
  const freq = data.payFrequencyDays;
  const start = firstForecastPayday();
  if (!start) return [];

  const rate = data.hourlyRateCents;
  const range = getPaycheckRange();
  const spending = expectedSpending(summary);
  const cur = summary ? summary.current : null;

  // Semester funds keep filling until their goal is met
  const fundSaved = {};
  data.funds.forEach(f => fundSaved[f.id] = (summary && summary.fundSaved[f.id]) || 0);

  // Starting point: what's left now, minus the spending still expected before payday.
  // Below zero means SpotMe (or an overdraft) is covering it, and it's taken from the next paycheck.
  const leftNow = cur ? cur.leftCents : 0;
  const daysToPayday = Math.max(daysBetween(today(), start), 0);
  const spendBeforePayday = cur ? Math.round(spending.cents * Math.min(daysToPayday / freq, 1)) : 0;
  let balance = leftNow - spendBeforePayday;
  let worstBalance = balance;

  // About how many hours a normal paycheck is, to spot paydays with shifts still missing
  const typicalHours = rate > 0 ? averageRecentPaycheck() / (rate * takeHome) : 0;

  const paydays = [];
  for (let i = 0; i < settings.paydays; i++) {
    const payday = addDays(start, i * freq);
    const periodEnd = addDays(payday, freq);
    const startBalance = balance;

    // Pay: what you typed in, or shifts × rate × take-home, or your recent average
    const w = workWindow(payday);
    const hours = hoursBetween(w.start, w.end);
    let income;
    let payHow;
    let custom = false;
    let fewShifts = false;
    if (settings.payOverrides[payday] !== undefined) {
      income = settings.payOverrides[payday];
      payHow = 'the amount you set for this payday';
      custom = true;
    } else if (hours > 0 && rate > 0) {
      income = Math.round(hours * rate * takeHome);
      payHow = `${hours} h of shifts (${formatShortDate(w.start)} – ${formatShortDate(addDays(w.end, -1))}) × ${formatMoney(rate)} × ${Math.round(takeHome * 100)}% take-home`;
      if (typicalHours > 0 && hours < typicalHours / 2) {
        fewShifts = true;
        payHow += `. That's fewer hours than usual (about ${Math.round(typicalHours)} h): add the rest of your shifts, or type this payday's pay below`;
      }
    } else {
      income = averageRecentPaycheck();
      payHow = hours > 0
        ? 'your average paycheck (set your pay per hour to use your shifts)'
        : `your average paycheck (no shifts entered for ${formatShortDate(w.start)} – ${formatShortDate(addDays(w.end, -1))})`;
    }
    const whatIf = i === 0 && !custom ? whatIfCents(takeHome) : 0;
    income = Math.max(income + whatIf, 0);
    // Worst case: paid as little as your lowest recent paycheck (unless you set the amount)
    const worstIncome = custom || !range ? income : Math.max(Math.min(range.min, income - whatIf) + whatIf, 0);

    const billsDue = data.bills
      .map(b => ({ name: b.name, cents: billDatesInPeriod(b, { start: i === 0 && cur && cur.end > payday ? cur.end : payday, end: periodEnd }).length * b.amountCents }))
      .filter(b => b.cents > 0);

    const fundParts = [];
    data.funds.forEach(f => {
      const add = Math.max(Math.min(f.perPaycheckCents, f.goalCents - fundSaved[f.id]), 0);
      fundSaved[f.id] += add;
      if (add > 0) fundParts.push({ name: f.name, cents: add });
    });

    const advances = i === 0 ? owedAdvances() : 0;
    const ruleIncome = incomeRulesBetween(i === 0 && cur && cur.end > payday ? cur.end : payday, periodEnd);
    const tax = Math.round((income + ruleIncome) * data.taxPercent / 100);
    const out = sum(billsDue, b => b.cents) + sum(fundParts, f => f.cents) + spending.cents + advances + tax;

    balance += income + ruleIncome - out;
    worstBalance += worstIncome + ruleIncome - out;

    paydays.push({
      payday, startBalance, income, payHow, custom, fewShifts, whatIf, worstIncome,
      leftNow: i === 0 ? leftNow : null,
      spendBeforePayday: i === 0 ? spendBeforePayday : 0,
      daysToPayday,
      billsDue, fundParts, spending, advances, out, balance, worstBalance, ruleIncome, tax
    });
  }
  return paydays;
}

// One line of the breakdown: label, amount and (optional) explanation
function breakdownLine(label, cents, sign, note) {
  return `<li><span>${label}</span><span class="fc-amount">${sign}${formatMoney(Math.abs(cents))}</span>${note ? `<span class="fc-note muted small">${escapeHtml(note)}</span>` : ''}</li>`;
}

function renderTimeline(summary, takeHome) {
  const out = $('fc-timeline');
  if (data.paychecks.length === 0 && allShifts().length === 0) {
    out.innerHTML = '<p class="muted small">Add a paycheck or your upcoming shifts to see a forecast.</p>';
    return;
  }
  const paydays = buildForecast(summary, takeHome);
  if (paydays.length === 0) {
    out.innerHTML = '';
    return;
  }

  // What's real vs. estimated, said once at the top
  const now = paydays[0].leftNow;
  const intro = `<p class="fc-now">Today you have <strong class="${now < 0 ? 'negative' : ''}">${formatMoney(now)}</strong>${now < 0 && data.spotMeLimitCents ? ' (SpotMe is covering it)' : ''}. Everything below is an estimate.</p>`;

  out.innerHTML = intro + paydays.map((p, i) => {
    let rowClass = '';
    let flag = '';
    if (p.balance < 0) {
      rowClass = ' fc-negative';
      flag = 'Goes negative';
    } else if (p.worstBalance < 0) {
      rowClass = ' fc-tight';
      flag = 'Could go negative';
    }

    // First payday: start from your real balance today, then the spending expected before payday.
    // Later paydays: start from what the previous one left.
    const startLines = i === 0
      ? [
          breakdownLine('You have today', p.leftNow, p.leftNow < 0 ? '−' : '', p.leftNow < 0 ? 'Real, from your data. SpotMe is covering it.' : 'Real, from your data'),
          breakdownLine('Spending until payday', p.spendBeforePayday, '−', `Estimate: ${p.daysToPayday} days of your usual spending`)
        ]
      : [breakdownLine(`Left after ${formatShortDate(paydays[i - 1].payday)}`, p.startBalance, p.startBalance < 0 ? '−' : '', 'Estimate, carried over')];
    const lines = [
      ...startLines,
      breakdownLine('Pay', p.income, '+', p.payHow + (p.whatIf ? ` (includes what-if ${p.whatIf > 0 ? '+' : '−'}${formatMoney(Math.abs(p.whatIf))})` : '')),
      ...(p.ruleIncome ? [breakdownLine('Repeating income', p.ruleIncome, '+', 'Your repeating extra income')] : []),
      ...p.billsDue.map(b => breakdownLine(`Bill: ${escapeHtml(b.name)}`, b.cents, '−')),
      ...p.fundParts.map(f => breakdownLine(`Fund: ${escapeHtml(f.name)}`, f.cents, '−')),
      breakdownLine(paydays[i + 1] ? `Spending after payday (${formatShortDate(p.payday)} – ${formatShortDate(paydays[i + 1].payday)})` : 'Spending after payday', p.spending.cents, '−', `Based on ${p.spending.how}`),
      ...(p.advances ? [breakdownLine('Pay advances paid back', p.advances, '−', 'Advances taken since your last repayment')] : []),
      ...(p.tax ? [breakdownLine('Set aside for taxes', p.tax, '−', `${data.taxPercent}% of pay`)] : [])
    ];
    const worstNote = p.worstIncome < p.income
      ? `<p class="muted small">If this paycheck is as low as your lowest recent one (${formatMoney(p.worstIncome)}), you'd have ${formatMoney(p.worstBalance)} left.</p>`
      : '';

    const inputId = `fc-pay-${p.payday}`;
    return `<details class="fc-row${rowClass}" data-fc-payday="${p.payday}"${openPaydays.has(p.payday) ? ' open' : ''}>
      <summary>
        <span class="fc-date">${formatDate(p.payday)}</span>
        <span class="fc-balance">≈ ${formatMoney(p.balance)} left</span>
        <span class="fc-detail muted small">Pay +${formatMoney(p.income)}${p.custom ? ' (yours)' : p.fewShifts ? ' (shifts missing?)' : ''} · Out −${formatMoney(p.out)}</span>
        ${flag ? `<span class="fc-flag">${flag}</span>` : ''}
      </summary>
      <div class="fc-breakdown">
        <ul class="fc-lines">${lines.join('')}
          <li class="fc-total"><span>About this much left until the next payday</span><span class="fc-amount">${formatMoney(p.balance)}</span></li>
        </ul>
        ${worstNote}
        <label for="${inputId}">Pay for this payday ($)</label>
        <div class="row">
          <input id="${inputId}" type="number" inputmode="decimal" step="0.01" min="0" placeholder="${centsToInput(p.income)}" value="${p.custom ? centsToInput(p.income) : ''}">
          <button type="button" class="small-btn" data-fc-save="${p.payday}">Set</button>
          ${p.custom ? `<button type="button" class="small-btn" data-fc-clear="${p.payday}">Use estimate</button>` : ''}
        </div>
      </div>
    </details>`;
  }).join('');
}

// ===== Shift list =====
// Each upcoming shift shows which payday it should be paid on

function paydayForShift(date) {
  const first = firstForecastPayday();
  if (!first) return null;
  for (let i = 0; i < 26; i++) {
    const payday = addDays(first, i * data.payFrequencyDays);
    const w = workWindow(payday);
    if (date >= w.start && date < w.end) return payday;
    if (date < w.start) return null;
  }
  return null;
}

function renderShiftList() {
  const now = today();
  const upcoming = allShifts().filter(s => s.date >= now).sort((a, b) => a.date.localeCompare(b.date));
  const pastCount = allShifts().length - upcoming.length;

  $('shift-list').innerHTML = upcoming.map(s => {
    const paidOn = paydayForShift(s.date);
    return listItem(
      `${formatDate(s.date)} · ${Number(s.hours)} hour${s.hours === 1 ? '' : 's'}${paidOn ? `<div class="muted small">Paid ${formatDate(paidOn)}</div>` : ''}`,
      deleteButton('shifts', s.id)
    );
  }).join('') +
    (upcoming.length === 0 ? '<li class="muted">No upcoming shifts yet.</li>' : '') +
    (pastCount > 0 ? `<li class="muted small">${pastCount} past shift${pastCount === 1 ? '' : 's'} (used to check paychecks and learn your take-home pay)</li>` : '');
}

// ===== Render =====
// Called by render() in app.js, and on its own by the forecast controls

// Fills a settings box, but leaves it alone while you're typing in it
function setField(id, value) {
  if (document.activeElement !== $(id)) $(id).value = value;
}

function renderForecast(summary) {
  const settings = forecastSettings();
  setField('fc-rate', data.hourlyRateCents ? centsToInput(data.hourlyRateCents) : '');
  setField('fc-takehome-input', settings.takeHomePercent || '');
  setField('fc-spending-input', settings.spendingCents !== null ? centsToInput(settings.spendingCents) : '');
  setField('fc-lag', settings.payLagDays);
  setField('fc-count', String(settings.paydays));

  const takeHome = getTakeHome();
  const learned = learnedTakeHome();
  const learnedText = learned.matched > 0
    ? `Learned: ${Math.round(learned.rate * 100)}% from ${learned.matched} paycheck${learned.matched === 1 ? '' : 's'}${learned.capped ? ' (limited to 50–100%; a missing shift can throw it off)' : ''}.`
    : `Using ${Math.round(ASSUMED_TAKE_HOME * 100)}% until a paycheck lines up with shifts you entered.`;
  $('fc-takehome').textContent = takeHome.custom
    ? `Using your ${settings.takeHomePercent}%. Leave blank to go back to auto. ${learnedText}`
    : `Auto. ${learnedText}`;

  const spending = expectedSpending(summary);
  $('fc-spending-note').textContent = settings.spendingCents !== null
    ? 'Using your amount. Leave blank to go back to auto.'
    : `Auto: ${formatMoney(spending.cents)}, based on ${spending.how}.`;

  const range = getPaycheckRange();
  $('fc-range').textContent = range
    ? `Your last ${Math.min(sortedPaychecks().length, 6)} paychecks: ${formatMoney(range.min)} – ${formatMoney(range.max)} (average ${formatMoney(range.avg)})`
    : 'Add a paycheck to see your usual range.';

  renderWhatIf(takeHome.rate);
  renderTimeline(summary, takeHome.rate);
  renderShiftList();
}

// ===== Events =====

// Saves a forecast setting and redraws
function saveForecastSetting(change) {
  change(forecastSettings());
  saveData();
  render();
}

$('shift-form').addEventListener('submit', e => {
  e.preventDefault();
  const date = $('shift-date').value;
  const hours = parseFloat($('shift-hours').value);
  if (!date || !(hours > 0)) {
    $('shift-hours').focus();
    return;
  }
  if (!data.shifts) data.shifts = [];
  data.shifts.push({ id: newId(), date, hours });
  saveData();
  $('shift-hours').value = '';
  $('shift-date').value = addDays(date, 1); // ready for the next day's shift
  render();
});

$('fc-rate').addEventListener('change', e => {
  data.hourlyRateCents = Math.max(dollarsToCents(e.target.value) || 0, 0);
  saveData();
  render();
});

$('fc-takehome-input').addEventListener('change', e => saveForecastSetting(s => {
  const percent = Math.round(parseFloat(e.target.value));
  s.takeHomePercent = percent >= 1 && percent <= 100 ? percent : null;
}));

$('fc-spending-input').addEventListener('change', e => saveForecastSetting(s => {
  const cents = dollarsToCents(e.target.value);
  s.spendingCents = cents >= 0 ? cents : null;
}));

$('fc-lag').addEventListener('change', e => saveForecastSetting(s => {
  const days = parseInt(e.target.value, 10);
  s.payLagDays = days >= 0 && days <= 14 ? days : 0;
}));

$('fc-count').addEventListener('change', e => saveForecastSetting(s => {
  s.paydays = Number(e.target.value) || 6;
}));

$('fc-reset').addEventListener('click', () => {
  if (!confirm('Reset forecast settings to automatic? Your shifts stay.')) return;
  saveForecastSetting(s => {
    s.takeHomePercent = null;
    s.spendingCents = null;
    s.payLagDays = 0;
    s.paydays = 6;
    s.payOverrides = {};
  });
});

$('fc-plus').addEventListener('click', () => {
  whatIfShifts++;
  renderForecast(lastSummary);
});

$('fc-minus').addEventListener('click', () => {
  whatIfShifts--;
  renderForecast(lastSummary);
});

// Remember which paydays are open
$('fc-timeline').addEventListener('toggle', e => {
  const payday = e.target.dataset && e.target.dataset.fcPayday;
  if (!payday) return;
  if (e.target.open) openPaydays.add(payday);
  else openPaydays.delete(payday);
}, true);

// "Set" / "Use estimate" for one payday's pay
$('fc-timeline').addEventListener('click', e => {
  const button = e.target.closest('button');
  if (!button) return;
  const { fcSave, fcClear } = button.dataset;
  if (fcSave) {
    const cents = dollarsToCents($(`fc-pay-${fcSave}`).value);
    if (!(cents >= 0)) return;
    saveForecastSetting(s => s.payOverrides[fcSave] = cents);
  } else if (fcClear) {
    saveForecastSetting(s => delete s.payOverrides[fcClear]);
  }
});
