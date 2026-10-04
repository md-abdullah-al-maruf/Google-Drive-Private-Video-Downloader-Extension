# Drive Private Video Downloader

A Chrome extension that lets you download private/shared videos directly from Google Drive by detecting the video stream used by the Drive player.

---

## Details

### Overview

Drive Private Video Downloader detects video streams from Google Drive videos and lets you download them easily from a simple popup.

### Features

* **Private/Public Videos** – Works with videos you have access to.
* **Fast Download** – Downloads videos quickly.
* **Progress Display** – Shows download progress and percentage.
* **Pause / Resume / Cancel** – Easily control downloads.
* **Quality Info** – Shows video quality such as `720p` or `1080p`.
* **One-Click Download** – Download detected videos directly from the popup.
* **Auto-Popup** – Opens automatically when a video is detected.
* **ON/OFF Toggle** – Turn the extension on or off.
* **Reload** – Reload the Drive tab to detect videos again.
* **Download History** – Keeps detected videos until you clear them.
* **Cross-Tab Downloads** – Shows active downloads from other tabs.

### Installation

1. Clone or download this [**repository**](https://github.com/md-abdullah-al-maruf/Google-Drive-Private-Video-Downloader-Extension/archive/refs/heads/main.zip) and unzip it.
2. Open Chrome and go to **`chrome://extensions/`**.
3. Enable **Developer mode** (top right toggle).
4. Click **Load unpacked**, then select this project's folder.
5. The extension icon appears in your toolbar.

### Usage

1. Open a Google Drive video.
2. Click the extension icon.
3. Turn **ON** to detect the video.
4. Select the detected video and click **⬇ Download**.
5. Use **⏸ Pause**, **▶ Resume**, or **✕ Cancel** when needed.
6. The download progress is shown in the popup.
7. After the download finishes, the video is saved to your Downloads folder.

**Keep the Google Drive tab open while downloading.**

### How It Works

1. The extension detects the video being played on Google Drive.
2. It finds the available video stream and shows it in the popup.
3. You click **Download** to start the download.
4. The extension downloads the video and saves it as an `.mp4` file.

---

### Permissions

* **`debugger`** – to attach to the tab's network events
* **`activeTab`** – to detect and reload the active Drive tab
* **`scripting`** – to inject the chunked download function into the Drive tab
* **`downloads`** – to programmatically download video files
* **`storage`** – to save state (enabled/disabled, captured videos, progress)
* **`<all_urls>`** host permission – required by the Debugger API

---

### ⚠️ Important Notes

* **Requires valid file access permissions**
* **Works only on Google Drive video file pages**
* **Keep the Drive tab open while downloading** — closing it aborts active downloads. The extension shows a confirmation dialog and opens the popup if you try to close/reload during a download.
* **It does NOT bypass Google Drive Security**
* This is **not** a flaw in Google Drive's copy-protection or security model. See Google's bug bounty invalid report on "Download/print/copy protection bypasses in Drive" for reference: [**Download/print/copy protection bypasses in Drive**](https://bughunters.google.com/learn/invalid-reports/google-products/download-print-copy-protection-bypasses-in-drive)

### Disclaimer

This project is intended for **educational purposes** and **personal use** of content you **legally control**. Respect all copyright laws and Google Drive's Terms of Service.

---

## License

This project is licensed under the MIT License. Feel free to use, modify, and distribute!
