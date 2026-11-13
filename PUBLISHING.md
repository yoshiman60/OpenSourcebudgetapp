# Publishing the budget app safely

The code lives on GitHub (`yoshiman60/OpenSourcebudgetapp`). The best way to put it online is to let **Cloudflare Pages** publish straight from that repo: every push updates the site, and the app gets its own web address.

## 1. Why not GitHub Pages
Browsers keep saved data per web address (origin). Every project on `yoshiman60.github.io` shares one address, so another project there could read this app's data. Cloudflare Pages gives each project its own address (`your-budget.pages.dev`) for free. Netlify (`your-budget.netlify.app`) works the same way.

## 2. Connect the repo (one time)
1. Sign in at dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Pick the `OpenSourcebudgetapp` repo.
3. Build settings:
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: **/**
4. **Save and Deploy**. Your app is at `https://<project-name>.pages.dev`. Don't host anything else on that address.

The `_headers` file in the repo tells Cloudflare (and Netlify) to send the security rules with every page, including one that stops other sites from showing the app inside theirs.

## 3. Everything in the repo is public on the site
Cloudflare publishes every file in the repo, so anyone can open them at your address. The `.gitignore` keeps backups, bank statements (`.csv`, `.pdf`) and data files out of git. Still, never put personal files in the `budgetapp` folder.

## 4. Releasing an update (every time)
1. Make your changes.
2. If you changed any app file, bump the version at the top of `sw.js` (for example `budget-v19` → `budget-v20`). Phones then drop their old saved copy and load the new one.
3. Run the checks:
   ```
   powershell -ExecutionPolicy Bypass -File .\check.ps1
   ```
4. Open the app locally, click through each tab, and check the browser console for errors. Restore a backup and make sure the numbers look right.
5. Commit and push:
   ```
   git add -A
   git commit -m "What you changed"
   git push
   ```
6. Wait about a minute, open your `pages.dev` address, and check the console there too. If something broke, roll back to the previous version in Cloudflare (**Deployments** → **Rollback**), then fix it.

People's saved data stays on their own phones. An update doesn't erase it, and the app upgrades older saves automatically.

## 5. Drag-and-drop instead (optional)
If you'd rather not connect GitHub, run `prepare-upload.ps1`. It copies only the app's files into `gameideas\budgetapp-upload`, and you can drag that folder into Cloudflare Pages or Netlify.

## 6. Keep backups off the internet
Backups live in `Documents\Budget Backups`, outside the app folder. In the app, go to ⚙ Settings → Backup & restore and choose that folder.

## 7. Turn on the app lock
⚙ Settings → App lock. It encrypts your data on the device and asks for the passcode when you open the app. Backups saved while it's on need the same passcode to restore. Download an unlocked backup first and store it somewhere safe: a forgotten passcode can't be recovered.
