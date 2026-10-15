# Backstock Manager

A simple web app for tracking stockroom (backstock) inventory. Receive deliveries, move stock to the shelf, look up counts, and print department reports as PDF.

No build step, no server, no database to set up. It's plain HTML, CSS and JavaScript.

## Features

- **Stock view** – every item with its on-hand count, grouped by department. Items at 0 are flagged **Out**, items at 3 or fewer are flagged **Low**.
- **Search** – type an item name to see its quantity instantly.
- **Departments** – add, rename and delete departments. Every department field is a dropdown, with "+ New department…" at the bottom.
- **Add / edit items** – name, department, quantity with − / + buttons, delete.
- **Receive a delivery** (adds to backstock)
  - **Photo** – snap the packing slip or invoice; Claude reads the items and counts *(needs an API key, see below)*.
  - **Type a list** – one item per line, e.g. `Whole milk 1 gal, Dairy, 24`.
  - **Form** – Name, Department, Qty rows.
- **Move to shelf** (subtracts from backstock) – typed list or form. It won't let you remove more than you have.
- **Review before saving** – photo and typed lists open a review table showing `before → after` for every row. Nothing changes until you confirm.
- **Reports** – totals per department and a full inventory table. **Download PDF** for all departments or just one.
- **Activity** – the last 40 deliveries, shelf pulls and edits.
- **Backup** – export / import all data as a JSON file from Settings (gear icon).

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
# any static server works, for example:
python3 -m http.server 8000
# then visit http://localhost:8000
```

### Publish with GitHub Pages

1. Push this folder to a GitHub repository.
2. In the repo go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, pick `main` and `/ (root)`, and save.
4. Your app will be live at `https://<your-username>.github.io/<repo-name>/` in a minute or two.

## Where data is stored

Inventory is saved in **your browser's local storage** on the device you use. That means:

- It survives page reloads and closing the browser.
- It is **not** shared between devices or browsers automatically. Use **Settings → Export backup** and **Import backup** to move it.
- Clearing your browser's site data erases it, so export a backup now and then.

## AI reading of photos and lists (optional)

Photo reading and smart list reading use the Anthropic API with **your own API key**.

1. Get a key at <https://console.anthropic.com/>.
2. In the app, open **Settings** (gear icon, top right), paste the key, and save.

The key is stored only in your browser and sent only to `api.anthropic.com`. Each photo or list you read is a paid API request on your account.

> **Security note:** because this is a browser-only app, anyone using that browser can read the key from local storage. Use it on your own device, and don't hard-code a key into the files you push to GitHub. For a shared or public deployment, put a small server in front of the API instead.

Without a key, typed lists are still read line by line (`name, department, qty` or `name - qty`) and the Photo option is hidden.

## Project structure

```
index.html          page layout
css/styles.css      styles (light and dark theme)
js/app.js           app logic: stock, receiving, shelf, reports, activity
js/standalone.js    storage (localStorage), Anthropic API calls, PDF download, settings
```

`app.js` gets storage, AI and downloads through `window.claude.use(...)`. `standalone.js` provides those when the page runs on a normal website, so the same `app.js` also runs inside Claude as an artifact.

## Libraries

- [jsPDF](https://github.com/parallax/jsPDF) and [jsPDF-AutoTable](https://github.com/simonbengtsson/jsPDF-AutoTable) for PDF reports (loaded from cdnjs)
- Fonts: IBM Plex Sans Condensed, Public Sans, IBM Plex Mono (Google Fonts)
