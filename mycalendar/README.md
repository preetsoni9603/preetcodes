# My Calendar

Preet's personal day planner at **preetcodes.com/mycalendar**.

- **Dashboard:** Today, Tomorrow, Coming up (7 days), Important deadlines, Reminders, Next up.
- **Tasks:** Month, Week, Day and List views like Google Calendar. Click a date to open it, or an empty spot or hour to add a task there. Every task has a Name, Department, Due date, Time, Priority, a "Remind me" time and a note.
- **Departments:** School, Work, Personal and Job Search to start. Add, rename or remove them under Tasks → Departments.
- **Google Calendar sync:** tasks are copied to your primary Google Calendar with a reminder, so Google sends alerts to your phone and laptop. Your Google events also show in the planner.
- **Private:** password protected. Tasks are stored on your server, so every device you sign in on sees the same list.

## Files

| Path | What it does |
| --- | --- |
| `index.php` | Password gate, task storage API, Google sign-in and sync |
| `views/login.php`, `views/app.php` | Sign-in page and app page |
| `js/app.js`, `css/app.css` | The app |
| `sw.js`, `manifest.json`, `icon.svg` | Phone notifications and "Add to Home Screen" |

Nothing secret is in git. The password hash, Google keys and tokens are saved in `/home/<you>/.mycalendar-auth.json`, and tasks in `/home/<you>/.mycalendar-data.json`, both outside `public_html`. If the server can't write there, it uses `.auth.json` / `.data.json` in this folder, which `.htaccess` blocks from the web and `.gitignore` keeps out of git.

## First sign-in

1. Push to GitHub and deploy as usual (your `.cpanel.yml` copies everything into `public_html`).
2. Open `https://preetcodes.com/mycalendar/` and sign in with the starting password you were given.
3. Change it right away in **Settings → Password**.

Forgot the password? Delete `/home/<you>/.mycalendar-auth.json` in cPanel File Manager. The starting password works again, and you'll need to reconnect Google.

## Connect Google Calendar (one time, about 10 minutes)

1. Go to <https://console.cloud.google.com/> and create a project, for example "My Calendar".
2. Open **APIs & Services → Library**, search for **Google Calendar API** and click **Enable**.
3. Open **APIs & Services → OAuth consent screen** (also called "Google Auth Platform"):
   - User type: **External**. App name: My Calendar. Add your Gmail as the support and developer email.
   - Under **Data access / Scopes**, add `https://www.googleapis.com/auth/calendar.events`.
   - Under **Audience / Test users**, add your own Gmail.
   - Click **Publish app** so it is "In production". In "Testing" mode, Google signs you out every 7 days. Google will say the app is unverified, which is fine for personal use.
4. Open **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URI: `https://preetcodes.com/mycalendar/?action=gcallback`. The exact URI is shown in My Calendar → Settings, with a Copy button.
   - Click **Create** and copy the **Client ID** and **Client secret**.
5. In My Calendar, open **Settings → Google Calendar**, paste both, and click **Save keys**.
6. Click **Connect Google Calendar**, choose your Google account and allow access. If you see "Google hasn't verified this app", click **Advanced → Go to My Calendar**.
7. You're sent back to the app, and all your tasks are copied to Google Calendar.

Your server needs PHP's **curl** extension. Most cPanel hosts have it on. If Settings says it's missing, turn it on in cPanel → **Select PHP Version → Extensions**.

### What gets synced

- Each task becomes an event titled `[Department] Task name` on its due date and time (30 minutes long). A task with no time becomes an all-day event.
- The task's **Remind me** setting becomes the event's popup reminder. All-day tasks remind you at 5 PM the evening before.
- Urgent tasks are red in Google Calendar, High tasks are orange, and others are blue.
- Finishing a task adds ✓ to the title and turns off its reminder. Deleting a task deletes its event.
- Your other Google events appear in the planner (outlined in blue). Click one to open it in Google Calendar. They are read-only in the planner.

## Notifications on phone and laptop

- **Phone:** install the Google Calendar app, sign in with the same account, and allow notifications.
- **Laptop:** in Google Calendar on the web, go to **Settings → Notification settings** and choose **Desktop notifications**. The Google Calendar app on Windows or Mac also works.
- **In the planner itself:** Settings → **Turn on alerts** shows system notifications while My Calendar is open in a tab.

Only devices signed in to your Google account get these alerts, and only you can sign in to My Calendar.

## Local testing with XAMPP

Open `http://localhost/preetcodes/mycalendar/`. Google sign-in only works on the address you registered as the redirect URI. To test locally, also add `http://localhost/preetcodes/mycalendar/?action=gcallback` as a redirect URI in Google Cloud.
