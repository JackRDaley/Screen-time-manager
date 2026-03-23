# Screen Time Blocker Extension

A lightweight Chrome extension that helps users stay focused by tracking time spent on specific websites and automatically blocking them once a limit is reached.

---

## Features

- Time Tracking  
  Tracks how long users spend on selected websites in real time.

- Automatic Blocking  
  Redirects the user to a custom block page when a time limit is exceeded.

- Domain-Based Control  
  Allows setting limits for individual websites (e.g., youtube.com, twitter.com).

- Usage Statistics  
  Stores daily usage data including time spent and visit counts per domain.

- Notifications  
  Alerts users when they are close to or have reached their limit.

- Custom UI  
  Includes a clean popup interface and a styled block page.

---

## Tech Stack

- JavaScript (Vanilla)
- Chrome Extensions API (Manifest V3)
- HTML and CSS

---

## Installation

### Option 1: Load Locally (Recommended for Development)

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/your-repo-name.git
   cd your-repo-name
   ```

2. Open Chrome and navigate to:
   ```
   chrome://extensions/
   ```

3. Enable Developer Mode:
   - Toggle the switch in the top-right corner

4. Load the extension:
   - Click "Load unpacked"
   - Select the project folder

5. The extension should now appear in your Chrome toolbar.

---

### Option 2: Install from Chrome Web Store

1. Visit the Chrome Web Store listing
2. Click "Add to Chrome"
3. Confirm installation

---

## How It Works

1. The user adds a domain and sets a time limit.
2. The extension detects the active tab and tracks time spent on that domain.
3. Once the time limit is exceeded:
   - The tab is redirected to a blocked page.
4. Usage data resets daily.

---

## Project Structure

```
├── manifest.json        # Extension configuration
├── background.js        # Core logic (tracking and enforcement)
├── popup.html           # Extension UI
├── popup.css            # Popup styling
├── popup.js             # Popup logic
├── blocked.html         # Blocked page
├── icons/               # Extension icons
└── assets/              # Images and UI assets
```

---

## Permissions Explained

- tabs  
  Used to detect the active tab and redirect it when necessary.

- storage  
  Stores user settings and usage data locally.

- alarms  
  Triggers periodic checks to enforce time limits.

- host_permissions  
  Allows access to URLs to determine the current domain.

- notifications  
  Notifies users when limits are reached.

---

## Key Concepts

### Domain Extraction
Extracts the hostname from a URL and normalizes it:
```
example.com
```

### Time Tracking
- Uses timestamps to calculate time spent on each domain
- Updates via tab events and background alarms

### Blocking Logic
```
if (timeSpent >= limit) {
    redirect to blocked page
}
```

---

## Known Issues / Future Improvements

- Add scheduling (daily or weekly limits)
- Improve domain management UI
- Add cross-device sync support
- Enhance notification system

---

## Contributing

Contributions are welcome. Feel free to fork the repository and submit pull requests.

---

## License

This project is licensed under the MIT License.

---

## Contact

For questions or feedback, refer to the Chrome Web Store listing or repository issues section.
