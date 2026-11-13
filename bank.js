// ===== Bank import =====
// Reads a CSV file downloaded from your bank's website. You review each row,
// then it becomes an expense, a paycheck or extra income. Nothing leaves your device.

// The file being reviewed: { headers, rows, transactions }
let bankImport = null;

// Words that suggest which category a purchase belongs to (only used if you have that category).
// Checked from top to bottom, so more specific rules come first.
const KEYWORD_RULES = {
  'Fees': /\bfees?\b|overdraft|service charge|spotme tip|late charge|interest charge/i,
  'Rent': /\brent\b|apartment|\bapts?\b|leasing|property|landlord|rentcafe/i,
  'Bills & Utilities': /electric|energy|\bfpl\b|\bwater\b|utilit|internet|comcast|xfinity|spectrum|at&t|verizon|t-mobile|tmobile|mint mobile|cricket|boost mobile|insurance|geico|progressive|state farm|allstate/i,
  'Subscriptions': /streaming|digital media|anthropic|claude|netflix|spotify|hulu|disney\+|disney plus|hbo|paramount|peacock|youtube|apple\.com|itunes|icloud|google storage|amazon prime|prime video|audible|patreon|chatgpt|openai|adobe|game pass|playstation plus|crunchyroll|twitch|duolingo|membership|subscription/i,
  'Groceries': /grocer|supermarket|safeway|kroger|publix|aldi|trader joe|whole foods|wegmans|\bh-?e-?b\b|food lion|winn.?dixie|sprouts|instacart|costco|sam'?s club/i,
  'Food': /restaurant|fast food|vending|zaxby|wendy'?s|mcdonald|starbucks|dunkin|chipotle|subway|taco|pizza|domino|papa john|burger|wendy|chick-fil|popeyes|\bkfc\b|panera|panda express|five guys|wingstop|sonic drive|arby|jersey mike|firehouse|cook out|whataburger|doordash|uber ?eats|grubhub|postmates|restaurant|cafe|coffee|diner|grill|bakery|boba|\btea\b|dining/i,
  'Gas': /shell|chevron|exxon|mobil\b|\bbp\b|arco|valero|speedway|circle ?k|sunoco|wawa|sheetz|racetrac|quiktrip|marathon|citgo|texaco|murphy usa|\bgas\b|fuel|petrol/i,
  'Transportation': /\buber\b|lyft|transit|\bmetro\b|bus pass|parking|parkmobile|\btolls?\b|sunpass|e-?zpass|amtrak|greyhound|car wash|jiffy lube|autozone|o'?reilly|advance auto|valvoline|\bdmv\b/i,
  'School': /universit|college|tuition|bookstore|chegg|campus|textbook|pearson|mcgraw|cengage|quizlet|course hero|coursera|udemy|school|student/i,
  'Health': /pharmacy|\bcvs\b|walgreens|rite aid|doctor|clinic|medical|dental|dentist|hospital|urgent care|optometr|planet fitness|\bgym\b|fitness|health/i,
  'Personal Care': /salon|barber|haircut|great clips|supercuts|\bnails?\b|\bspa\b|ulta|sephora|beauty|cosmetic/i,
  'Shopping': /specialty retail|discount store|big-box|department store|family dollar|pet store|petsmart|petco|chewy|smoke shop|vape|tobacco|amazon|amzn|walmart|target|best buy|ebay|etsy|shein|temu|old navy|nike|adidas|h&m|zara|\bross\b|tj ?maxx|marshalls|kohl|macy|dollar general|dollar tree|five below|gamestop|ikea|home depot|lowe'?s/i,
  'Music Gear': /guitar center|sweetwater|sam ash|reverb|musician'?s friend|music|strings|bandcamp/i,
  'Fun': /steam|playstation|xbox|nintendo|epic games|movie|cinema|theat|regal|\bamc\b|ticketmaster|eventbrite|stubhub|seatgeek|concert|bowling|arcade|topgolf|\bbar\b|\bpub\b|brewery|club|universal|seaworld|museum/i,
  'Gifts & Giving': /gift|donation|charity|gofundme|church|tithe|flowers/i,
  'Cash': /\batm\b|cash withdrawal/i
};
// Money moved into savings counts as saving, not as a skipped transfer
const SAVINGS_WORDS = /(to|into) .*savings|round ?up|save when i get paid|automatic savings/i;
// Pay advances: the advance is money in for the pay period it arrives,
// and the repayment comes out of your next paycheck, so it counts against that period
const ADVANCE_WORDS = /my ?pay (advance|repayment)|pay advance|advance repayment|spotme(?! tip)|earnin|brigit|dave inc/i;
// (Not "autopay" on its own: a phone bill on autopay is still spending)
const TRANSFER_WORDS = /transfer|xfer|moved (to|from)|secured deposit|payment thank you|credit (card|crd)|card payment|\bepay\b/i;
const PAYMENT_APP_WORDS = /venmo|zelle|cash ?app|paypal/i;
const PAYROLL_WORDS = /payroll|direct dep|dir dep|salary|paycheck|\badp\b|gusto|paychex/i;

// Splits CSV text into rows of cells. Handles "quoted, cells" and "" inside quotes.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

// "$1,234.56" -> 123456, "(12.00)" or "-12.00" -> -1200, "" -> 0
function parseBankAmount(text) {
  let t = String(text || '').trim();
  if (!t) return 0;
  let negative = false;
  if (/^\(.*\)$/.test(t)) { negative = true; t = t.slice(1, -1); }
  t = t.replace(/[$,\s]/g, '');
  if (t.startsWith('-')) { negative = true; t = t.slice(1); }
  if (t.endsWith('-')) { negative = true; t = t.slice(0, -1); }
  const cents = dollarsToCents(t);
  return negative ? -cents : cents;
}

// "11/05/2026", "11/5/26" or "2026-11-05" -> "2026-11-05" (null if it isn't a date)
function parseBankDate(text) {
  const t = String(text || '').trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return toDateString(new Date(+m[1], m[2] - 1, +m[3]));
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const year = +m[3] < 100 ? +m[3] + 2000 : +m[3];
    return toDateString(new Date(year, m[1] - 1, +m[2]));
  }
  return null;
}

// "POS DEBIT STARBUCKS #12345 SEATTLE WA" -> "Starbucks Seattle Wa"
// Anything after "•" is the bank's own category hint ("Zaxby's • Restaurants"), so it's left out.
function cleanMerchant(description) {
  const text = description.split('•')[0].toLowerCase()
    .replace(/authorized on \d+\/\d+/g, ' ')
    .replace(/\b(pos|debit|card|purchase|recurring|checkcard|visa|mastercard|ach|web|ppd|id)\b/g, ' ')
    .replace(/\b(sq|tst|sp|pp|paypal)\s*\*/g, ' ')
    .replace(/[#*:,]/g, ' ')
    .replace(/\d+\/\d+(\/\d+)?/g, ' ')
    .replace(/\b[\w-]*\d{3,}[\w-]*\b/g, ' ') // store numbers, card digits, phone numbers
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words = text.split(' ').slice(0, 4).filter(Boolean);
  return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || description.trim();
}

function findCategoryByName(name) {
  return data.categories.find(c => c.name.toLowerCase() === name.toLowerCase());
}

// Picks a starting choice for a transaction. You can change it before importing.
// Money out: a category id or 'skip'. Money in: 'paycheck', 'income' or 'skip'.
function guessChoice(t) {
  const amountCents = Math.abs(t.cents);
  const nearby = item => item.amountCents === amountCents && Math.abs(daysBetween(item.date, t.date)) <= 2;

  if (data.importedKeys.includes(t.key)) return { choice: 'skip', note: 'Already imported' };
  if (ADVANCE_WORDS.test(t.description)) {
    if (t.cents > 0) return { choice: 'income', note: 'Pay advance: comes out of your next paycheck' };
    const loans = findCategoryByName('Loans & Advances');
    if (loans) return { choice: String(loans.id), note: 'Pay advance repayment' };
  }
  const savings = findCategoryByName('Savings');
  if (t.cents < 0 && savings && SAVINGS_WORDS.test(t.description)) return { choice: String(savings.id), note: 'Moved to savings' };
  // Money moved into savings counts as spending, so money taken back out counts as money in
  if (t.cents > 0 && /from .*savings/i.test(t.description)) return { choice: 'income', note: 'Taken out of savings' };
  if (TRANSFER_WORDS.test(t.description)) return { choice: 'skip', note: 'Looks like a transfer between your accounts' };

  if (t.cents > 0) {
    if (data.paychecks.some(nearby) || data.income.some(nearby)) return { choice: 'skip', note: 'Looks like you added this already' };
    return { choice: PAYROLL_WORDS.test(t.description) ? 'paycheck' : 'income', note: '' };
  }

  if (data.expenses.some(e => !e.fromBank && nearby(e))) return { choice: 'skip', note: 'Looks like you added this already' };
  // e.g. the same purchase pasted earlier, now in the PDF
  if (data.expenses.some(e => e.fromBank && e.amountCents === amountCents && e.date === t.date)) return { choice: 'skip', note: 'Possible duplicate from another import' };
  // Pending purchases can post a day later, but it could also be a real second purchase, so just warn
  const nextDay = data.expenses.find(e => e.fromBank && e.amountCents === amountCents && Math.abs(daysBetween(e.date, t.date)) === 1);
  const dayWarning = nextDay ? `Same amount on ${formatShortDate(nextDay.date)}: skip it if it's the same purchase` : '';
  if (data.bills.some(b => b.name.toLowerCase() === t.merchant.toLowerCase())) return { choice: 'skip', note: 'Already counted as a bill' };

  // A category you picked for this merchant before
  const remembered = data.merchantRules[t.merchant];
  if (remembered && findById(data.categories, remembered)) return { choice: String(remembered), note: dayWarning };

  for (const [name, pattern] of Object.entries(KEYWORD_RULES)) {
    const category = findCategoryByName(name);
    if (category && pattern.test(t.description)) return { choice: String(category.id), note: dayWarning };
  }
  const fallback = findCategoryByName('Shopping') || findCategoryByName('Fun') || data.categories[0];
  const note = dayWarning || (PAYMENT_APP_WORDS.test(t.description) ? 'Payment app: check what this was (maybe an IOU?)' : 'Guessed');
  return fallback ? { choice: String(fallback.id), note } : { choice: 'skip', note: '' };
}

// Which column holds what. Guessed from the header names; you can change it.
function guessColumns(headers) {
  const find = pattern => headers.findIndex(h => pattern.test(h));
  const amount = find(/amount/i);
  const debit = find(/debit|withdrawal|money out/i);
  const credit = find(/credit|deposit|money in/i);
  return {
    date: Math.max(find(/date/i), 0),
    desc: Math.max(find(/desc|payee|merchant|name|memo|details/i), 0),
    amount: amount >= 0 ? amount : Math.max(debit, 0),
    credit: amount >= 0 ? -1 : credit
  };
}

function readMapping() {
  return {
    date: Number($('map-date').value),
    desc: Number($('map-desc').value),
    amount: Number($('map-amount').value),
    credit: Number($('map-credit').value),
    flip: $('map-flip').checked
  };
}

// Turns the CSV rows into transactions using the chosen columns.
// cents is positive for money in, negative for money out.
function buildTransactions() {
  const m = readMapping();
  return bankImport.rows.map(cells => {
    const date = parseBankDate(cells[m.date]);
    const description = (cells[m.desc] || '').trim();
    let cents;
    if (m.credit >= 0) {
      cents = Math.abs(parseBankAmount(cells[m.credit]) || 0) - Math.abs(parseBankAmount(cells[m.amount]) || 0);
    } else {
      cents = parseBankAmount(cells[m.amount]);
      if (m.flip) cents = -cents;
    }
    if (!date || !Number.isFinite(cents) || cents === 0) return null;

    const t = { date, description, cents, merchant: cleanMerchant(description), key: `${date}|${cents}|${description}` };
    return { ...t, ...guessChoice(t) };
  }).filter(Boolean);
}

function startBankImport(text) {
  const rows = parseCsv(text);
  // Some banks put a few summary lines above the real header row
  const headerIndex = rows.findIndex(r => r.length >= 3 && r.some(c => /date/i.test(c)));
  if (headerIndex === -1) {
    alert("Couldn't find a header row with a Date column in that file.");
    return;
  }
  const headers = rows[headerIndex].map(h => h.trim());
  showBankReview(headers, rows.slice(headerIndex + 1), null);
}

// Shows the review screen for a table of rows.
// flip: true/false sets "spending shows as positive numbers", null guesses it.
function showBankReview(headers, rows, flip) {
  bankImport = { headers, rows, transactions: [] };

  const options = headers.map((h, i) => `<option value="${i}">${escapeHtml(h || 'Column ' + (i + 1))}</option>`).join('');
  $('map-date').innerHTML = options;
  $('map-desc').innerHTML = options;
  $('map-amount').innerHTML = options;
  $('map-credit').innerHTML = '<option value="-1">None (one amount column)</option>' + options;

  const guess = guessColumns(headers);
  $('map-date').value = guess.date;
  $('map-desc').value = guess.desc;
  $('map-amount').value = guess.amount;
  $('map-credit').value = guess.credit;

  // If every amount is positive, the bank probably shows spending as positive numbers
  const amounts = bankImport.rows.map(r => parseBankAmount(r[guess.amount])).filter(Number.isFinite);
  $('map-flip').checked = flip !== null ? flip : guess.credit === -1 && amounts.length > 0 && amounts.every(a => a >= 0);

  $('bank-review').hidden = false;
  refreshBankReview();
}

function refreshBankReview() {
  bankImport.transactions = buildTransactions();
  renderBankReview();
}

function renderBankReview() {
  const list = bankImport.transactions;
  // Every row gets both lists, so you can fix a row whose money in/out was guessed wrong
  const options = `
    <optgroup label="Spending">${data.categories.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}</optgroup>
    <optgroup label="Money in"><option value="paycheck">Paycheck</option><option value="income">Extra income</option></optgroup>`;

  $('bank-list').innerHTML = list.map((t, i) => `
    <li>
      <div class="grow">
        <strong class="${t.cents > 0 ? 'positive' : ''}">${t.cents > 0 ? '+' : ''}${formatMoney(t.cents)}</strong> · ${escapeHtml(t.merchant)}
        <div class="muted small">${formatDate(t.date)}${t.note ? ' · ' + escapeHtml(t.note) : ''}</div>
      </div>
      <label class="visually-hidden" for="bank-row-${i}">What is this?</label>
      <select class="bank-choice" id="bank-row-${i}" data-bank-row="${i}">
        ${options}
        <option value="skip">Skip</option>
      </select>
    </li>`).join('') || '<li class="muted">No transactions found with these columns.</li>';

  list.forEach((t, i) => document.querySelector(`[data-bank-row="${i}"]`).value = t.choice);
  updateBankSummary();
}

function updateBankSummary() {
  const list = bankImport.transactions;
  const count = list.filter(t => t.choice !== 'skip').length;
  $('bank-summary').textContent = `${list.length} transactions found · ${count} will be imported. Skip anything you already added by hand.`;
  $('bank-import').textContent = `Import ${count}`;
}

function finishBankImport() {
  const before = JSON.stringify(data); // for Undo
  let count = 0;
  for (const t of bankImport.transactions) {
    data.importedKeys.push(t.key); // remembered even if skipped, so it isn't offered again
    if (t.choice === 'skip') continue;
    const amountCents = Math.abs(t.cents);
    if (t.choice === 'paycheck') {
      data.paychecks.push({ id: newId(), amountCents, date: t.date });
    } else if (t.choice === 'income') {
      const advance = ADVANCE_WORDS.test(t.description); // remembered for the "pay it back" tip
      data.income.push({ id: newId(), amountCents, date: t.date, note: t.merchant, advance });
    } else {
      data.expenses.push({ id: newId(), amountCents, categoryId: t.choice, note: t.merchant, date: t.date, fromBank: true });
      data.merchantRules[t.merchant] = t.choice; // use this category next time
    }
    count++;
  }
  saveData();
  closeBankImport();
  $('paste-text').value = '';
  $('paste-box').open = false;
  render();
  // Balance adjustments were standing in for missing transactions, so they may be stale now
  const reminder = data.adjustments.length ? ' Check your balance adjustments on this tab.' : '';
  showToast(`Imported ${count} transactions.${reminder}`, () => {
    data = JSON.parse(before);
    saveData();
    render();
  });
}

function closeBankImport() {
  bankImport = null;
  $('bank-review').hidden = true;
  $('bank-list').innerHTML = '';
}

// ===== PDF statements =====
// A PDF has no columns, just text placed on the page. We rebuild each line of text,
// keep the lines that start with a date and contain an amount, and turn them into
// Date / Description / Amount rows for the review screen.

const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
// Fingerprints of those exact files (from cdnjs), so a changed file is refused
const PDFJS_INTEGRITY = 'sha512-q+4liFwdPC/bNdhUpZx6aXDx/h77yEQtn4I1slHydcbZK34nLaR3cAeYSJshoxIOq3mjEf7xJE8YWIUHMn+oCQ==';
const PDFJS_WORKER_INTEGRITY = 'sha512-BbrZ76UNZq5BhH7LL7pn9A4TKQpQeNCHOo65/akfelcIBbcVvYWOFQKPXIrykE3qZxYjmDX573oa4Ywsc7rpTw==';
const MONEY_PATTERN = /\(?-?\$?\d{1,3}(?:,\d{3})*\.\d{2}\)?-?/g;
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// Loads the PDF reader library the first time it's needed
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PDFJS_URL;
    // The browser refuses to run the file if it isn't exactly the known pdf.js 3.11.174
    script.integrity = PDFJS_INTEGRITY;
    script.crossOrigin = 'anonymous';
    script.onload = async () => {
      try {
        // The helper ("worker") file gets the same check, then runs from a local copy
        const response = await fetch(PDFJS_WORKER_URL, { integrity: PDFJS_WORKER_INTEGRITY });
        const code = await response.blob();
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        resolve(window.pdfjsLib);
      } catch (error) {
        reject(error);
      }
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// Returns the PDF's text, one string per line, top to bottom
async function pdfToLines(file) {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
  const lines = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    const rows = []; // pieces of text that sit at the same height on the page
    for (const item of content.items) {
      if (!item.str.trim()) continue;
      const x = item.transform[4];
      const y = item.transform[5];
      let row = rows.find(r => Math.abs(r.y - y) < 3);
      if (!row) {
        row = { y, items: [] };
        rows.push(row);
      }
      row.items.push({ x, text: item.str.trim() });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const row of rows) lines.push(row.items.sort((a, b) => a.x - b.x).map(i => i.text).join(' '));
  }
  return lines;
}

// The latest full date in the statement, used to add the year to dates like "11/05"
function findStatementEndDate(text) {
  const dates = [];
  for (const m of text.matchAll(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g)) dates.push(parseBankDate(m[0]));
  for (const m of text.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/gi)) {
    dates.push(toDateString(new Date(+m[3], MONTH_NAMES.indexOf(m[1].toLowerCase()), +m[2])));
  }
  return dates.filter(d => d && d <= addDays(today(), 31)).sort().pop() || today();
}

function parseStatementLines(lines) {
  const endDate = findStatementEndDate(lines.join(' '));
  const endYear = parseDate(endDate).getFullYear();
  let section = null; // 'in' or 'out', from headings like "Deposits" or "Purchases"
  const found = [];

  for (const line of lines) {
    const m = line.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\s+(.*)$/);
    if (!m) {
      // Short lines without a date or amount are usually section headings.
      // (Lines with an amount, like "Deposits $1,296.86", are summary totals, not headings.)
      if (line.length < 60 && !line.match(MONEY_PATTERN)) {
        // Whole words only, so "Checking Account" doesn't count as "Checks"
        if (/\b(deposits?|credits?|additions?|refunds?)\b/i.test(line)) section = 'in';
        else if (/\b(withdrawals?|debits?|purchases?|payments?|checks?|fees?|charges?|spending)\b/i.test(line)) section = 'out';
      }
      continue;
    }

    const month = +m[1];
    const day = +m[2];
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const amounts = m[4].match(MONEY_PATTERN);
    if (!amounts) continue;

    // With 2+ amounts on a line, the last one is usually the running balance
    const cents = parseBankAmount(amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[0]);
    if (!Number.isFinite(cents) || cents === 0) continue;

    let date;
    if (m[3]) {
      date = parseBankDate(`${month}/${day}/${m[3]}`);
    } else {
      date = toDateString(new Date(endYear, month - 1, day));
      if (date > addDays(endDate, 7)) date = toDateString(new Date(endYear - 1, month - 1, day)); // December on a January statement
    }

    const description = m[4]
      .replace(MONEY_PATTERN, ' ')
      .replace(/^\d{1,2}[/-]\d{1,2}\s+/, '') // a second "posted" date
      .replace(/\s+/g, ' ')
      .trim();
    found.push({ date, description, cents, section });
  }

  // No headings? Trust the signs if the statement uses them; otherwise assume spending
  const usesSigns = found.some(f => f.cents < 0);
  return found.map(f => {
    const isIn = f.section ? f.section === 'in'
      : usesSigns ? f.cents > 0
      : PAYROLL_WORDS.test(f.description);
    return [f.date, f.description, centsToInput(isIn ? Math.abs(f.cents) : -Math.abs(f.cents))];
  });
}

async function startPdfImport(file) {
  $('bank-summary').textContent = 'Reading PDF…';
  let lines;
  try {
    lines = await pdfToLines(file);
  } catch {
    alert("Couldn't read that PDF. Check your internet connection the first time you import a PDF, or use a CSV.");
    return;
  }
  if (lines.length === 0) {
    alert('This PDF has no text in it (it may be a scan). Download the statement or a CSV from online banking instead.');
    return;
  }
  const rows = parseStatementLines(lines);
  if (rows.length === 0) {
    alert("Couldn't find any transactions in that PDF. Try a CSV export instead.");
    return;
  }
  showBankReview(['Date', 'Description', 'Amount'], rows, false);
}

// ===== Pasted transactions =====
// For when there's no statement yet: copy your activity from the bank's website or app
// and paste it. Works with one line per transaction ("Nov 12 Starbucks -$5.40") or
// with the date, store and amount on separate lines.

const MONTH_WORDS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
// The sign can have a space after it, like "- $19.16" or "+ $46.00"
const PASTE_MONEY = /[+-]?\s?\(?-?\$?\d{1,3}(?:,\d{3})*\.\d{2}\)?-?/g;
const MONEY_IN_WORDS = /payroll|direct dep|deposit|refund|received|cash ?out|reversal/i;

// A date with no year gets this year (or last year, if that would put it in the future)
function dateWithYear(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year) return toDateString(new Date(year < 100 ? year + 2000 : year, month - 1, day));
  const thisYear = parseDate(today()).getFullYear();
  const date = toDateString(new Date(thisYear, month - 1, day));
  return date > addDays(today(), 7) ? toDateString(new Date(thisYear - 1, month - 1, day)) : date;
}

// Reads a date at the start of a line: 11/05, 11/05/2026, 2026-11-05, Nov 5, Thu, November 5, 2026, Today, Yesterday.
// Returns { date, rest } or null.
function readLeadingDate(line) {
  let m = line.match(/^(today|yesterday)\b,?\s*(.*)$/i);
  if (m) return { date: m[1].toLowerCase() === 'today' ? today() : addDays(today(), -1), rest: m[2] };

  m = line.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?![\d.])\s*(.*)$/);
  if (m) return { date: dateWithYear(+m[1], +m[2], +m[3]), rest: m[4] };

  m = line.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?(?![\d.])\s*(.*)$/);
  if (m) {
    const date = dateWithYear(m[3] ? +m[3] : 0, +m[1], +m[2]);
    return date ? { date, rest: m[4] } : null;
  }

  m = line.match(new RegExp(`^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\\s+)?(${MONTH_WORDS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?![\\d.])(?:,?\\s+(\\d{4}))?,?\\s*(.*)$`, 'i'));
  if (m) {
    const date = dateWithYear(m[3] ? +m[3] : 0, MONTH_NAMES.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]);
    return date ? { date, rest: m[4] } : null;
  }
  return null;
}

function parsePastedText(text) {
  const found = [];
  let currentDate = null;
  let pending = []; // description lines waiting for their amount

  for (const rawLine of text.split(/\r?\n/)) {
    // Copied web pages can bring links along: "[Publix](https://...)" -> "Publix"
    let line = rawLine
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/^[*•]\s+/, '') // list bullets (not "-", which can be a minus sign)
      .trim();
    if (!line) continue;

    const dated = readLeadingDate(line);
    if (dated) {
      currentDate = dated.date;
      line = dated.rest;
      // A date on its own line is a heading, so text above it isn't part of the next transaction.
      // (A date inside a line, like "Nov 13 at 10:15 AM • Groceries", belongs to the store name above it.)
      if (!line.trim()) pending = [];
    }
    // Drop times and status words like "at 3:04 PM" or "Pending"
    line = line.replace(/\bat\s+\d{1,2}:\d{2}\s*(am|pm)?/gi, ' ')
      .replace(/\b\d{1,2}:\d{2}\s*(am|pm)\b/gi, ' ')
      .replace(/\b(pending|settled|completed|processing|posted)\b/gi, ' ')
      .trim();
    // A line that's only an icon starts a new transaction
    if (!/[a-z0-9]/i.test(line)) {
      if (!dated) pending = [];
      continue;
    }

    const amounts = line.match(PASTE_MONEY);
    const description = line.replace(PASTE_MONEY, ' ').replace(/\s+/g, ' ').trim();
    if (!amounts) {
      pending.push(description);
      pending = pending.slice(-2); // only the last couple of lines belong to the next amount
      continue;
    }
    if (!currentDate) continue;

    // With 2+ amounts on a line, the last one is usually a running balance
    const amountText = amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[0];
    const cents = parseBankAmount(amountText);
    if (!Number.isFinite(cents) || cents === 0) continue;
    const sign = amountText.startsWith('+') ? 1 : cents < 0 ? -1 : 0;

    found.push({ date: currentDate, description: [...pending, description].filter(Boolean).join(' ') || 'Unknown', cents: Math.abs(cents), sign });
    pending = [];
  }

  // Amounts without a + or -: if the bank only marks spending with "-", the rest is money in
  const onlyMinusSigns = found.some(f => f.sign < 0) && !found.some(f => f.sign > 0);
  return found.map(f => {
    const isIn = f.sign > 0 || (f.sign === 0 && (onlyMinusSigns || MONEY_IN_WORDS.test(f.description)));
    return [f.date, f.description, centsToInput(isIn ? f.cents : -f.cents)];
  });
}

// ===== Bank import events =====

$('paste-review').addEventListener('click', () => {
  const rows = parsePastedText($('paste-text').value);
  if (rows.length === 0) {
    alert("Couldn't find any transactions. Each one needs a date and an amount like $5.40.");
    return;
  }
  showBankReview(['Date', 'Description', 'Amount'], rows, false);
});

$('bank-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (isPdf) startPdfImport(file);
  else startBankImport(await file.text());
});

['map-date', 'map-desc', 'map-amount', 'map-credit', 'map-flip'].forEach(id =>
  $(id).addEventListener('change', refreshBankReview));

$('bank-list').addEventListener('change', e => {
  const row = e.target.dataset.bankRow;
  if (row === undefined) return;
  bankImport.transactions[Number(row)].choice = e.target.value;
  updateBankSummary();
});

$('bank-import').addEventListener('click', finishBankImport);
$('bank-cancel').addEventListener('click', closeBankImport);
