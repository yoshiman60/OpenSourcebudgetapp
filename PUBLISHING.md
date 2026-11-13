# Publishing the budget app safely

## 1. Make the upload folder
From the `budgetapp` folder run:

```
powershell -ExecutionPolicy Bypass -File .\prepare-upload.ps1
```

It creates `gameideas\budgetapp-upload` with only the app's files. Upload **that folder**, never `budgetapp` itself.

## 2. Give the app its own web address
Browsers keep saved data per web address (origin). Every project on `yourname.github.io` shares one address, so another project there could read this app's data.

Use a host that gives each project its own address, for free:
- **Cloudflare Pages**: `your-budget.pages.dev`
- **Netlify**: `your-budget.netlify.app`

Both let you drag and drop the `budgetapp-upload` folder. Don't put anything else on that address.

## 3. Keep backups off the internet
Backups now live in `Documents\Budget Backups`, outside the app folder. In the app, ⚙ Settings → Backup & restore → choose that folder.

## 4. Turn on the app lock
⚙ Settings → App lock. It encrypts your data on the device and asks for the passcode when you open the app. Backups saved while it's on need the same passcode to restore. Download an unlocked backup first and store it somewhere safe: a forgotten passcode can't be recovered.
