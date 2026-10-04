document.addEventListener("DOMContentLoaded", () => {
    const header           = document.getElementById('header');
    const notDriveMessage  = document.getElementById('notDriveMessage');
    const downloadContainer = document.getElementById('downloadContainer');
    const otherTabContainer = document.getElementById('otherTabContainer');
    const otherTabSection  = document.getElementById('otherTabSection');
    const statusMessage    = document.getElementById('statusMessage');
    const statusDot        = document.getElementById('statusDot');
    const btnOn            = document.getElementById('btnOn');
    const btnOff           = document.getElementById('btnOff');
    const reloadBtn        = document.getElementById('reloadBtn');
    const clearHistoryBtn  = document.getElementById('clearHistoryBtn');
    const downloadAlert    = document.getElementById('downloadAlert');

    let activeTabId = null;
    let extensionEnabledCached = false;
    let pollIntervalId = null;
    const renderedItems = new Map();
    const renderedOtherItems = new Map();
    let downloadProgressCache = {};
    let capturedRequestsCache = {};
    let statusTimeoutId = null;

    function formatBytes(bytes) {
        if (!bytes || bytes <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        let val = bytes;
        let i = 0;
        while (val >= 1024 && i < units.length - 1) {
            val /= 1024;
            i++;
        }
        const decimals = (i === 0) ? 0 : (i === 1 ? 1 : 2);
        return val.toFixed(decimals) + ' ' + units[i];
    }

    function updateToggleUI(isEnabled) {
        btnOn.disabled  = isEnabled;
        btnOff.disabled = !isEnabled;
        reloadBtn.classList.toggle('hidden', !isEnabled);
        statusDot.classList.toggle('active', isEnabled);
    }

    function setStatus(text, isError, durationMs) {
        if (statusTimeoutId) {
            clearTimeout(statusTimeoutId);
            statusTimeoutId = null;
        }
        if (!text) {
            statusMessage.classList.add('hidden');
            statusMessage.textContent = '';
            return;
        }
        statusMessage.classList.remove('hidden');
        statusMessage.textContent = text;
        statusMessage.style.color = isError ? '#ff8888' : '#888';
        if (durationMs) {
            statusTimeoutId = setTimeout(() => {
                statusMessage.classList.add('hidden');
                statusMessage.textContent = '';
                statusTimeoutId = null;
            }, durationMs);
        }
    }

    function clearStatus() {
        if (statusTimeoutId) {
            clearTimeout(statusTimeoutId);
            statusTimeoutId = null;
        }
        statusMessage.classList.add('hidden');
        statusMessage.textContent = '';
    }

    function showEmptyState() {
        if (document.getElementById('emptyState')) return;
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.id = 'emptyState';
        empty.innerHTML =
            '<span class="icon">📡</span>' +
            'Waiting for video sources...<br>' +
            'Make sure the video is loading on the Drive page.<br>' +
            'If nothing appears, click <b>↻ Reload</b>.';
        downloadContainer.appendChild(empty);
    }

    function hideEmptyState() {
        const e = document.getElementById('emptyState');
        if (e) e.remove();
    }

    function createVideoItem(req, isOtherTab) {
        const item = document.createElement('div');
        item.className = 'video-item';
        item.dataset.requestId = req.requestId;
        if (isOtherTab) item.classList.add('other-tab');

        const row = document.createElement('div');
        row.className = 'video-row';

        const info = document.createElement('div');
        info.className = 'video-info';

        const title = document.createElement('div');
        title.className = 'video-title';
        title.textContent = req.videoTitle || 'Untitled';
        title.title = req.videoTitle || '';

        const meta = document.createElement('div');
        meta.className = 'video-meta';
        if (req.quality) {
            const badge = document.createElement('span');
            badge.className = 'quality-badge';
            badge.textContent = req.quality;
            meta.appendChild(badge);
        }
        const metaText = document.createElement('span');
        metaText.textContent = 'MP4 • progressive';
        meta.appendChild(metaText);

        info.appendChild(title);
        info.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'video-actions';

        const dlBtn = document.createElement('button');
        dlBtn.className = 'download-btn';
        dlBtn.textContent = '⬇ Download';
        dlBtn.setAttribute('aria-label', 'Download ' + (req.videoTitle || 'video'));
        dlBtn.disabled = isOtherTab;
        if (isOtherTab) {
            dlBtn.title = 'Switch to the source tab to download';
        }
        dlBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({
                type: 'startDownload',
                requestId: req.requestId
            }, (resp) => {
                if (chrome.runtime.lastError) return;
                if (resp && !resp.success) {
                    setStatus(resp.error || 'Could not start download.', true, 4000);
                }
            });
        });

        const pauseBtn = document.createElement('button');
        pauseBtn.className = 'ctrl-btn pause-btn hidden';
        pauseBtn.title = 'Pause';
        pauseBtn.textContent = '⏸';
        pauseBtn.setAttribute('aria-label', 'Pause download');
        pauseBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({
                type: 'pauseDownload',
                requestId: req.requestId
            }, () => { void chrome.runtime.lastError; });
        });

        const resumeBtn = document.createElement('button');
        resumeBtn.className = 'ctrl-btn resume-btn hidden';
        resumeBtn.title = 'Resume';
        resumeBtn.textContent = '▶';
        resumeBtn.setAttribute('aria-label', 'Resume download');
        resumeBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({
                type: 'resumeDownload',
                requestId: req.requestId
            }, () => { void chrome.runtime.lastError; });
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'ctrl-btn cancel-btn hidden';
        cancelBtn.title = 'Cancel';
        cancelBtn.textContent = '✕';
        cancelBtn.setAttribute('aria-label', 'Cancel download');
        cancelBtn.addEventListener('click', () => {
            chrome.runtime.sendMessage({
                type: 'cancelDownload',
                requestId: req.requestId
            }, () => { void chrome.runtime.lastError; });
        });

        actions.appendChild(dlBtn);
        actions.appendChild(pauseBtn);
        actions.appendChild(resumeBtn);
        actions.appendChild(cancelBtn);

        row.appendChild(info);
        row.appendChild(actions);

        const progressWrap = document.createElement('div');
        progressWrap.className = 'progress-wrap hidden';

        const progressBar = document.createElement('div');
        progressBar.className = 'progress-bar';
        const progressFill = document.createElement('div');
        progressFill.className = 'progress-fill';
        progressBar.appendChild(progressFill);

        const progressText = document.createElement('div');
        progressText.className = 'progress-text';
        const pp = document.createElement('span');
        pp.className = 'pp';
        pp.textContent = '0%';
        const ps = document.createElement('span');
        ps.className = 'ps';
        ps.textContent = 'Starting...';
        progressText.appendChild(pp);
        progressText.appendChild(ps);

        progressWrap.appendChild(progressBar);
        progressWrap.appendChild(progressText);

        item.appendChild(row);
        item.appendChild(progressWrap);

        return item;
    }

    function applyProgress(item, prog) {
        if (!prog) return;

        const progressWrap = item.querySelector('.progress-wrap');
        const progressFill = item.querySelector('.progress-fill');
        const dlBtn        = item.querySelector('.download-btn');
        const pauseBtn     = item.querySelector('.pause-btn');
        const resumeBtn    = item.querySelector('.resume-btn');
        const cancelBtn    = item.querySelector('.cancel-btn');
        const pp           = item.querySelector('.pp');
        const ps           = item.querySelector('.ps');

        const percent = Math.max(0, Math.min(100, prog.percent || 0));
        progressFill.style.width = percent + '%';
        pp.textContent = percent + '%';

        const doneStr = formatBytes(prog.completed || 0);
        const totStr  = formatBytes(prog.total || 0);
        const progressLabel = (!prog.total || prog.total === 0)
            ? doneStr + ' / calculating...'
            : doneStr + ' / ' + totStr;

        const st = prog.status;
        if (st === 'starting') {
            progressWrap.classList.remove('hidden');
            progressFill.className = 'progress-fill';
            progressFill.style.width = '0%';
            pp.textContent = '0%';
            ps.textContent = 'Starting...';
            dlBtn.classList.add('hidden');
            pauseBtn.classList.remove('hidden');
            resumeBtn.classList.add('hidden');
            cancelBtn.classList.remove('hidden');
            item.classList.add('is-active');
        } else if (st === 'downloading') {
            progressWrap.classList.remove('hidden');
            progressFill.className = 'progress-fill';
            ps.textContent = progressLabel;
            dlBtn.classList.add('hidden');
            pauseBtn.classList.remove('hidden');
            resumeBtn.classList.add('hidden');
            cancelBtn.classList.remove('hidden');
            item.classList.add('is-active');
        } else if (st === 'paused') {
            progressWrap.classList.remove('hidden');
            progressFill.className = 'progress-fill';
            ps.textContent = 'Paused at ' + progressLabel;
            dlBtn.classList.add('hidden');
            pauseBtn.classList.add('hidden');
            resumeBtn.classList.remove('hidden');
            cancelBtn.classList.remove('hidden');
            item.classList.add('is-active');
        } else if (st === 'completed') {
            progressWrap.classList.remove('hidden');
            progressFill.className = 'progress-fill completed';
            ps.textContent = 'Saved ' + doneStr + ' to your downloads';
            dlBtn.classList.remove('hidden');
            dlBtn.textContent = '⬇ Re-download';
            pauseBtn.classList.add('hidden');
            resumeBtn.classList.add('hidden');
            cancelBtn.classList.add('hidden');
            item.classList.remove('is-active');
        } else if (st === 'cancelled') {
            progressWrap.classList.remove('hidden');
            progressFill.className = 'progress-fill error';
            ps.textContent = 'Cancelled' + (prog.completed ? ' at ' + doneStr : '');
            dlBtn.classList.remove('hidden');
            dlBtn.textContent = 'Retry';
            pauseBtn.classList.add('hidden');
            resumeBtn.classList.add('hidden');
            cancelBtn.classList.add('hidden');
            item.classList.remove('is-active');
        } else if (st === 'interrupted') {
            progressWrap.classList.remove('hidden');
            progressFill.className = 'progress-fill error';
            ps.textContent = 'Interrupted: ' + (prog.error || 'Tab or worker was closed');
            dlBtn.classList.remove('hidden');
            dlBtn.textContent = 'Retry';
            pauseBtn.classList.add('hidden');
            resumeBtn.classList.add('hidden');
            cancelBtn.classList.add('hidden');
            item.classList.remove('is-active');
        } else if (st === 'error') {
            progressWrap.classList.remove('hidden');
            progressFill.className = 'progress-fill error';
            ps.textContent = 'Error: ' + (prog.error || 'Failed');
            dlBtn.classList.remove('hidden');
            dlBtn.textContent = 'Retry';
            pauseBtn.classList.add('hidden');
            resumeBtn.classList.add('hidden');
            cancelBtn.classList.add('hidden');
            item.classList.remove('is-active');
        }
    }

    function syncList(requests, progress) {
        const matching = [];
        const otherTabMatching = [];
        for (const requestId in requests) {
            const req = requests[requestId];
            if (!req.lastItagUrl || !req.videoTitle) continue;
            const enriched = Object.assign({ requestId: requestId }, req);
            if (req.tabId === activeTabId) {
                matching.push(enriched);
            } else {
                const p = progress && progress[requestId];
                if (p && (p.status === 'starting' || p.status === 'downloading' || p.status === 'paused')) {
                    otherTabMatching.push(enriched);
                }
            }
        }

        matching.sort((a, b) => {
            const ta = a.capturedAt || a.timestamp || 0;
            const tb = b.capturedAt || b.timestamp || 0;
            return tb - ta;
        });

        otherTabMatching.sort((a, b) => {
            const ta = a.capturedAt || a.timestamp || 0;
            const tb = b.capturedAt || b.timestamp || 0;
            return tb - ta;
        });

        if (matching.length === 0) {
            if (extensionEnabledCached && renderedItems.size === 0) {
                showEmptyState();
            }
        } else {
            hideEmptyState();
        }

        if (otherTabMatching.length === 0) {
            otherTabSection.classList.add('hidden');
            renderedOtherItems.forEach((el) => el.remove());
            renderedOtherItems.clear();
        } else {
            otherTabSection.classList.remove('hidden');
        }

        const seenIds = new Set();
        matching.forEach((req, idx) => {
            seenIds.add(req.requestId);
            let item = renderedItems.get(req.requestId);

            if (!item) {
                item = createVideoItem(req, false);
                renderedItems.set(req.requestId, item);
            } else {
                const titleEl = item.querySelector('.video-title');
                if (titleEl.textContent !== (req.videoTitle || 'Untitled')) {
                    titleEl.textContent = req.videoTitle || 'Untitled';
                    titleEl.title = req.videoTitle || '';
                }
                const badge = item.querySelector('.quality-badge');
                if (badge && req.quality && badge.textContent !== req.quality) {
                    badge.textContent = req.quality;
                }
            }

            const currentChildren = Array.from(downloadContainer.children);
            const expectedIndex = idx;
            if (currentChildren[expectedIndex] !== item) {
                if (expectedIndex === 0) {
                    downloadContainer.insertBefore(item, downloadContainer.firstChild);
                } else {
                    const prev = currentChildren[expectedIndex - 1];
                    if (prev.nextSibling) {
                        downloadContainer.insertBefore(item, prev.nextSibling);
                    } else {
                        downloadContainer.appendChild(item);
                    }
                }
            }

            if (progress && progress[req.requestId]) {
                applyProgress(item, progress[req.requestId]);
            }
        });

        for (const [rid, el] of renderedItems.entries()) {
            if (!seenIds.has(rid)) {
                el.remove();
                renderedItems.delete(rid);
            }
        }

        const seenOtherIds = new Set();
        otherTabMatching.forEach((req, idx) => {
            seenOtherIds.add(req.requestId);
            let item = renderedOtherItems.get(req.requestId);

            if (!item) {
                item = createVideoItem(req, true);
                renderedOtherItems.set(req.requestId, item);
            } else {
                const titleEl = item.querySelector('.video-title');
                if (titleEl.textContent !== (req.videoTitle || 'Untitled')) {
                    titleEl.textContent = req.videoTitle || 'Untitled';
                    titleEl.title = req.videoTitle || '';
                }
                const badge = item.querySelector('.quality-badge');
                if (badge && req.quality && badge.textContent !== req.quality) {
                    badge.textContent = req.quality;
                }
            }

            const currentChildren = Array.from(otherTabContainer.children);
            const expectedIndex = idx;
            if (currentChildren[expectedIndex] !== item) {
                if (expectedIndex === 0) {
                    otherTabContainer.insertBefore(item, otherTabContainer.firstChild);
                } else {
                    const prev = currentChildren[expectedIndex - 1];
                    if (prev.nextSibling) {
                        otherTabContainer.insertBefore(item, prev.nextSibling);
                    } else {
                        otherTabContainer.appendChild(item);
                    }
                }
            }

            if (progress && progress[req.requestId]) {
                applyProgress(item, progress[req.requestId]);
            }
        });

        for (const [rid, el] of renderedOtherItems.entries()) {
            if (!seenOtherIds.has(rid)) {
                el.remove();
                renderedOtherItems.delete(rid);
            }
        }

        let hasActive = false;
        if (progress) {
            for (const rid in progress) {
                const st = progress[rid] && progress[rid].status;
                if (st === 'starting' || st === 'downloading' || st === 'paused') {
                    hasActive = true;
                    break;
                }
            }
        }
        downloadAlert.classList.toggle('hidden', !hasActive);
    }

    function hasActiveDownloadOnTab(tabId) {
        for (const rid in downloadProgressCache) {
            const p = downloadProgressCache[rid];
            const st = p && p.status;
            const isSameTab = (capturedRequestsCache[rid] && capturedRequestsCache[rid].tabId === tabId);
            if (isSameTab && (st === 'starting' || st === 'downloading' || st === 'paused')) {
                return true;
            }
        }
        return false;
    }

    function handleStateChange(newState) {
        chrome.storage.local.set({ extensionEnabled: newState }, () => {
            extensionEnabledCached = newState;
            updateToggleUI(newState);
            if (!newState) {
                setStatus('Extension stopped. Click ON to start capturing.', false, 3000);
            } else {
                clearStatus();
            }
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (!tab) return;
                chrome.runtime.sendMessage({
                    type: "setEnabled",
                    enabled: newState,
                    tabId: tab.id,
                    url: tab.url
                }, (response) => {
                    if (chrome.runtime.lastError) return;
                    if (newState && response && response.success) {
                        if (!hasActiveDownloadOnTab(tab.id)) {
                            chrome.tabs.reload(tab.id);
                        }
                    }
                });
            });
        });
    }

    btnOn.addEventListener('click',  () => handleStateChange(true));
    btnOff.addEventListener('click', () => handleStateChange(false));

    reloadBtn.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].id) {
                if (hasActiveDownloadOnTab(tabs[0].id)) {
                    setStatus('Active download on this tab — reload blocked. Cancel the download first or use the browser reload.', true, 5000);
                    return;
                }
                chrome.tabs.reload(tabs[0].id);
                renderedItems.forEach(el => el.remove());
                renderedItems.clear();
                showEmptyState();
            }
        });
    });

    clearHistoryBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: "clearHistory" }, () => {
            renderedItems.forEach((el, rid) => {
                const st = (downloadProgressCache[rid] || {}).status;
                if (st !== 'starting' && st !== 'downloading' && st !== 'paused') {
                    el.remove();
                    renderedItems.delete(rid);
                }
            });
            if (renderedItems.size === 0) {
                showEmptyState();
            }
            setStatus('History cleared.', false, 2000);
        });
    });

    function startPolling() {
        if (pollIntervalId) clearInterval(pollIntervalId);
        pollIntervalId = setInterval(() => {
            chrome.runtime.sendMessage({ type: "getRequests" }, (resp) => {
                if (chrome.runtime.lastError || !resp || !resp.requests) return;
                capturedRequestsCache = resp.requests;
                chrome.runtime.sendMessage({ type: "getProgress" }, (progResp) => {
                    if (chrome.runtime.lastError) return;
                    downloadProgressCache = (progResp && progResp.progress) || {};
                    syncList(capturedRequestsCache, downloadProgressCache);
                });
            });
        }, 500);
    }

    function initialSync() {
        chrome.runtime.sendMessage({ type: "getRequests" }, (resp) => {
            if (chrome.runtime.lastError || !resp || !resp.requests) {
                startPolling();
                return;
            }
            capturedRequestsCache = resp.requests;
            chrome.runtime.sendMessage({ type: "getProgress" }, (progResp) => {
                if (chrome.runtime.lastError) {
                    startPolling();
                    return;
                }
                downloadProgressCache = (progResp && progResp.progress) || {};
                syncList(capturedRequestsCache, downloadProgressCache);
                startPolling();
            });
        });
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab || !tab.url || !tab.url.startsWith('https://drive.google.com/')) {
            header.classList.add('hidden');
            notDriveMessage.classList.remove('hidden');
            return;
        }

        header.classList.remove('hidden');
        notDriveMessage.classList.add('hidden');

        chrome.storage.local.get(['extensionEnabled'], (result) => {
            extensionEnabledCached = result.extensionEnabled !== undefined ? result.extensionEnabled : false;
            updateToggleUI(extensionEnabledCached);
            if (!extensionEnabledCached) {
                setStatus('Click ON to start capturing.', false);
            } else {
                showEmptyState();
            }
            activeTabId = tab.id;
            initialSync();
        });
    });
});
