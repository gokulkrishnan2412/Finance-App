# Finance-App

Finance application for lendings, bank loans, and Chits.

## GitHub Pages + Google Sheets setup

1. Create a Google Sheet and copy its ID from the URL. The ID is the text between `/d/` and `/edit`.
2. Open **Extensions -> Apps Script** in that Sheet.
3. Copy [google-apps-script/Code.gs](google-apps-script/Code.gs) into the Apps Script editor.
4. Replace `PASTE_YOUR_GOOGLE_SHEET_ID_HERE` with your Sheet ID, then save.
5. Select **Deploy -> New deployment**, choose **Web app**, set **Execute as** to yourself, and set access to **Anyone**.
6. Copy the deployment URL into `window.GOOGLE_SHEETS_WEB_APP_URL` in [frontend/config.js](frontend/config.js).
7. Push the repository to GitHub and enable **GitHub Pages** for the repository branch and `/frontend` folder, or publish the repository root if your Pages workflow copies `frontend`.

The Apps Script creates `Lendings`, `Loans`, and `Chits` tabs automatically. The frontend uses those Sheets instead of Flask and JSON whenever the URL in `config.js` is set. Keep the deployment URL private enough for your use and only store non-sensitive financial data because an **Anyone** web app is publicly reachable.

## Reports

**Export Data** downloads a CSV containing Daily, Weekly, and Monthly lendings. Import it into Google Sheets with **File -> Import -> Upload**.

**Export Loans CSV** downloads bank loans and their interest-payment history. Import it into a separate Sheet tab using the same process.

The Flask backend remains available for local development when `config.js` has an empty URL.
