# Budget App: UI Review & Income Forecasting Plan

Nov 13, 2026

## UI improvements

The app hides too much behind menus and collapsible sections; the fixes below cut taps and clutter.

**Navigation**

1. **Bottom tab bar instead of the ☰ side menu.** The five tabs are hidden behind a tap; a bottom bar is easier to reach with a thumb and shows where you are.
2. **Merge IOUs into another tab.** It is a whole tab for one card; move it under Budget, or into a "More" tab with Settings.
3. **Floating "+" button on every tab** for adding an expense, the most-used action.

**Too many collapsible sections**

4. **Cut the collapsible sections.** There are about 25, some nested (the hours estimate sits inside "Add paycheck"). Show common actions; collapse only rare ones.
5. **Open forms in pop-ups.** Use the same pop-up style as "Edit expense" for adding bills, funds and IOUs, instead of forms that expand inside cards.

**Pay tab is overloaded**

6. **Move rare tools to a Settings screen** opened by a ⚙ icon in the top bar: settings, balance matching, backup and erase data.
7. **Move "Import from your bank" lower or behind a button.** It is rarely used but sits first on the Pay tab.
8. **Separate "Erase all data" from the backup buttons.** Put it at the very bottom and confirm before erasing.

**Home**

9. **Combine the warning lines into one status pill.** The low-money warning, SpotMe line and no-paycheck message stack up. Make the no-paycheck message a button that opens the paycheck form.
10. **Show the savings goal in one place.** It appears in Home's Details and on the Budget tab.
11. **Make adding an expense obvious.** Tapping a category saves the expense, but nothing says so; add a hint like "Tap a category to save."
12. **Hide or merge the extra Home cards** (Tips, Can I afford it, set-aside) so money left and the add-expense form stand out.

**Consistency**

13. **Give every input a real label.** Some inputs use only placeholder text, which vanishes when you type and hurts accessibility.
14. **Use chips for the History filters** (pay period, category) instead of dropdowns.

## Income prediction and planning features

These features turn past paychecks and upcoming shifts into a forecast you can plan around.

1. **Shift-based forecast.** Enter upcoming shifts (hours) and pay rate; the app predicts your next paychecks.
2. **Learned take-home rate.** Compare each hours estimate with the real paycheck to learn what you actually take home after taxes, so predictions get more accurate.
3. **Forecast timeline.** Show the next 4–8 paydays with predicted income, bills due, fund contributions and the projected balance after each. Flag any period that would go negative.
4. **Best and worst case.** Show a likely income range based on past paychecks, not a single number.
5. **What-if mode.** "+1 shift" and "−1 shift" buttons that instantly update the forecast.
6. **"When can I afford it?"** Upgrade "Can I afford it?" to give the date you can afford something, based on the forecast.
7. **Plan for big expenses.** Add expenses with a due date (tuition, textbooks, gear); the app says how much to set aside per paycheck.
8. **Tips average.** Use extra-income history to add expected tips to each forecast.
9. **Calendar view.** Paydays, bill due dates and planned purchases on one month view.

## Do these first

These give the biggest gain for the least work:

- [ ] Bottom tab bar
- [ ] Settings screen
- [ ] Cut the collapsible sections
- [ ] Shift-based forecast
- [ ] Forecast timeline
- [ ] What-if mode
