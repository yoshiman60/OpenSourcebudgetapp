# Budget App – Spec

## Instructions for Claude Code
Be token-efficient:
- Reply in as few words as possible. No preamble, recaps, or explanations unless I ask.
- Don't repeat code back to me; just make the edits.
- Read only the files you need. Don't scan the whole project.
- Make the smallest change that works. Don't refactor unrequested code.
- Ask at most one question, only if truly blocked.
- When done, reply with one line: what changed.

## Goal
A simple personal budget app for a college student with a part-time job. It tracks spending against each paycheck, so I always know what's left until the next payday.

## Tech
- One-page web app: `index.html`, `style.css`, `app.js`. No frameworks, no build step.
- Data is saved in the browser's localStorage. No backend, no login.
- Mobile-friendly, since I'll mostly use it on my phone.
- Uses a dark theme.

## Core Features (MVP)
1. **Paychecks**: enter the amount and date of each paycheck. Set how often I get paid (weekly or every two weeks) so the app can predict the next payday.
2. **Categories**: start with the defaults (Rent, Food, Gas, School, Music Gear, Fun, Savings). Each category has a planned amount per paycheck, and I can add, edit or delete categories.
3. **Expenses**: quick-add an expense with an amount, a category and an optional note. The date defaults to today. The form needs 3 taps or fewer.
4. **Dashboard**:
   - Money left this pay period (large, at the top).
   - Days until the next payday.
   - A safe-to-spend-per-day number: money left ÷ days left.
   - A progress bar for each category showing spent vs. planned (green under 75%, yellow from 75–100%, red when over).
5. **History**: a list of past expenses, filterable by pay period and category. Each expense can be edited or deleted.
6. **Bills**: recurring bills (amount, due day) that are subtracted from the right pay period automatically.

## Nice-to-Have (after MVP)
- A savings goal with a progress bar.
- A spending pie chart for each pay period.
- Export and import data as JSON for backup.
- Installable as a PWA so it works offline from my phone's home screen.

## Rules
- Store all money as cents (integers) to avoid rounding bugs.
- Keep the code simple and well-organized. I'm learning.
- Build the MVP features one at a time, in the order above.
