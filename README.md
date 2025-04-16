# Drive Private Video Downloader

**Short Description**  
A Chrome extension that lets you download private/shared videos directly from Google Drive by intercepting and extracting the video stream URLs.

---

## Details

### Overview
Drive Private Video Downloader hooks into Chrome’s debugging protocol to monitor network requests made by Google Drive’s video player. When you navigate to a Drive video (even if it’s shared privately), the extension captures the media streaming data, extracts the highest‑quality progressive download URL, and presents it in a simple popup for one‑click downloading.

### Features
- **Private/Shared Videos**: Works on videos shared privately (not just publicly published ones).  
- **One‑Click Download**: Automatically lists available videos in the popup with a download button.  
- **Auto‑Popup**: When new video sources are detected, the extension can automatically open its popup.  
- **Enable/Disable Toggle**: Turn the extension on or off per‑tab without needing to uninstall or reload manually.  
- **Retry Button**: Quickly reload the current Drive tab if streams aren’t detected initially.  
- **Lightweight UI**: Dark‑themed, compact popup with scrollable list of videos.

### Installation
1. Clone or download this repository.  
2. Open Chrome and navigate to `chrome://extensions/`.  
3. Enable **Developer mode** (toggle in the top right).  
4. Click **Load unpacked**, then select this project’s folder.  
5. The “Drive Private Video Downloader” icon will appear in your toolbar.

### Usage
1. Navigate to any Google Drive video URL (e.g. `https://drive.google.com/file/d/…/view`).  
2. Click the extension icon to open the popup.  
3. Click **ON** to enable capturing for the current tab. The extension will reload the tab automatically.  
4. As the video loads, the popup will list the video title(s) and a download button (⬇).  
5. Click the download button to save the video locally.

### How It Works
- **background.js** uses the Chrome Debugger API (`chrome.debugger`) to listen for `Network.requestWillBeSent` and `Network.responseReceived` events.  
- When it detects requests to `workspacevideo-pa.clients6.google.com`, it stores the request and retrieves its response body.  
- It parses the JSON response for `progressiveTranscodes` URLs (the direct MP4 links) and the video title.  
- **popup.js** polls the background script every second for captured requests, updates the UI with any new videos, and invokes `chrome.downloads.download` when you click a download button.  
- State (enabled/disabled) is persisted via `chrome.storage.local`, and you can toggle it per‑tab.

### Permissions
- `debugger` – to attach to the tab’s network events  
- `activeTab` – to detect and reload the active Drive tab  
- `downloads` – to programmatically download video files  
- `storage` – to save the extension’s enabled/disabled state  
- `<all_urls>` host permission – to allow the debugger to attach to any URL (required by the Debugger API)

---

### ⚠️ Important Notes
- **Requires valid file access permissions**  
- **Works only on Google Drive video file pages**  
- **Does NOT bypass Google security or DRM protections**  
- This is **not** a flaw in Google Drive’s copy‑protection or security model. See Google’s bug bounty invalid report on “Download/print/copy protection bypasses in Drive” for reference:  
  [Download/print/copy protection bypasses in Drive](https://bughunters.google.com/learn/invalid-reports/google-products/5300109711245312/download-print-copy-protection-bypasses-in-drive)

### Disclaimer
This project is intended for **educational purposes** and **personal use** of content you **legally control**. Respect all copyright laws and Google Drive’s Terms of Service.

---

## Contributing
1. Fork the repo.  
2. Create a feature branch (`git checkout -b feature/YourFeature`).  
3. Commit your changes and push to your branch.  
4. Open a pull request describing your enhancement or bugfix.

## License
This project is licensed under the MIT License. Feel free to use, modify, and distribute!

