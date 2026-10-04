let capturedRequests = {};
let pollingTimers = {};
let autoPopupCount = {};
let extensionEnabled = false;
let downloadProgress = {};
let activeBeforeUnloadTabs = {};
const pendingTabs = new Set();
const attachedTabs = new Set();

const STORAGE_KEY_REQUESTS = 'capturedRequests';
const STORAGE_KEY_PROGRESS = 'downloadProgress';

function persistState() {
    try {
        chrome.storage.local.set({
            [STORAGE_KEY_REQUESTS]: capturedRequests,
            [STORAGE_KEY_PROGRESS]: downloadProgress
        });
    } catch (e) {}
}

function loadPersistedState(callback) {
    chrome.storage.local.get([STORAGE_KEY_REQUESTS, STORAGE_KEY_PROGRESS], (result) => {
        if (result[STORAGE_KEY_REQUESTS]) {
            capturedRequests = result[STORAGE_KEY_REQUESTS];
        }
        if (result[STORAGE_KEY_PROGRESS]) {
            const now = Date.now();
            Object.keys(result[STORAGE_KEY_PROGRESS]).forEach(rid => {
                const p = result[STORAGE_KEY_PROGRESS][rid];
                if (p && (p.status === 'starting' || p.status === 'downloading' || p.status === 'paused')) {
                    if (p.lastUpdated && (now - p.lastUpdated) < 24 * 60 * 60 * 1000) {
                        p.status = 'interrupted';
                        p.error = 'Service worker restarted during download. Click Retry to restart.';
                    }
                }
                downloadProgress[rid] = p;
            });
        }
        if (callback) callback();
    });
}

chrome.storage.local.get(['extensionEnabled'], (result) => {
    extensionEnabled = result.extensionEnabled || false;
    loadPersistedState();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "setEnabled") {
        extensionEnabled = message.enabled;
        chrome.storage.local.set({ extensionEnabled: extensionEnabled });

        if (message.enabled) {
            chrome.tabs.get(message.tabId, (tab) => {
                if (chrome.runtime.lastError || !tab) {
                    sendResponse({ success: false });
                    return;
                }
                if (tab.url && tab.url.includes("drive.google.com")) {
                    startAutoCaptureForTab(message.tabId);
                    pendingTabs.add(message.tabId);
                }
                sendResponse({ success: true });
            });
            return true;
        } else {
            autoPopupCount = {};
            pendingTabs.clear();
            Object.keys(pollingTimers).forEach(tabId => {
                cleanupTabDebugger(Number(tabId));
            });
            sendResponse({ success: true });
        }
        return true;
    }

    if (message.type === "getRequests") {
        sendResponse({ requests: capturedRequests });
        return;
    }

    if (message.type === "getProgress") {
        sendResponse({ progress: downloadProgress });
        return;
    }

    if (message.type === "startDownload") {
        const requestId = message.requestId;
        const req = capturedRequests[requestId];
        if (!req || !req.lastItagUrl) {
            sendResponse({ success: false, error: 'No URL captured for this request.' });
            return;
        }

        const existing = downloadProgress[requestId];
        if (existing && (existing.status === 'starting' || existing.status === 'downloading' || existing.status === 'paused')) {
            sendResponse({ success: false, error: 'Download already in progress.' });
            return;
        }

        downloadProgress[requestId] = {
            status: 'starting',
            completed: 0,
            total: 0,
            percent: 0,
            error: null,
            title: req.videoTitle,
            quality: req.quality || '',
            lastUpdated: Date.now()
        };
        persistState();

        chrome.scripting.executeScript({
            target: { tabId: req.tabId },
            func: chunkedDownloadFn,
            args: [req.lastItagUrl, req.videoTitle, requestId]
        }).catch(err => {
            const p = downloadProgress[requestId] || {};
            p.status = 'error';
            p.error = (err && err.message) ? err.message : String(err);
            p.lastUpdated = Date.now();
            downloadProgress[requestId] = p;
            persistState();
        });

        sendResponse({ success: true });
        return;
    }

    if (message.type === 'pauseDownload' ||
        message.type === 'resumeDownload' ||
        message.type === 'cancelDownload') {

        const rid = message.requestId;
        const req = capturedRequests[rid];

        if (downloadProgress[rid]) {
            if (message.type === 'pauseDownload') {
                downloadProgress[rid].status = 'paused';
            } else if (message.type === 'resumeDownload') {
                downloadProgress[rid].status = 'downloading';
            } else if (message.type === 'cancelDownload') {
                downloadProgress[rid].status = 'cancelled';
            }
            downloadProgress[rid].lastUpdated = Date.now();
            persistState();
        }

        if (req && req.tabId) {
            try {
                chrome.tabs.sendMessage(req.tabId, {
                    type: message.type,
                    requestId: rid
                }, () => { void chrome.runtime.lastError; });
            } catch (e) {}
        }
        sendResponse({ success: true });
        return;
    }

    if (message.type === "clearHistory") {
        const activeRequestIds = new Set();
        Object.keys(downloadProgress).forEach(rid => {
            const st = downloadProgress[rid] && downloadProgress[rid].status;
            if (st === 'starting' || st === 'downloading' || st === 'paused') {
                activeRequestIds.add(rid);
            } else {
                delete downloadProgress[rid];
            }
        });

        Object.keys(capturedRequests).forEach(rid => {
            if (!activeRequestIds.has(rid)) {
                delete capturedRequests[rid];
            }
        });

        persistState();
        sendResponse({ success: true });
        return;
    }

    if (message.type === "downloadProgressUpdate") {
        const rid = message.requestId;
        if (!downloadProgress[rid]) {
            downloadProgress[rid] = { status: 'starting', completed: 0, total: 0, percent: 0, error: null };
        }
        if (message.status)  downloadProgress[rid].status    = message.status;
        if (typeof message.completed === 'number') downloadProgress[rid].completed = message.completed;
        if (typeof message.total     === 'number') downloadProgress[rid].total     = message.total;
        if (typeof message.percent   === 'number') downloadProgress[rid].percent   = message.percent;
        if (message.error !== undefined)            downloadProgress[rid].error     = message.error;
        downloadProgress[rid].lastUpdated = Date.now();
        persistState();
        return;
    }

    if (message.type === "showPopup") {
        safeOpenPopup();
        return;
    }

    if (message.type === "registerBeforeUnload") {
        const tid = sender.tab && sender.tab.id;
        if (tid) {
            activeBeforeUnloadTabs[tid] = true;
        }
        sendResponse({ success: true });
        return;
    }

    if (message.type === "unregisterBeforeUnload") {
        const tid = sender.tab && sender.tab.id;
        if (tid) {
            delete activeBeforeUnloadTabs[tid];
        }
        sendResponse({ success: true });
        return;
    }
});

function safeOpenPopup() {
    try {
        const result = chrome.action.openPopup();
        if (result && typeof result.then === 'function') {
            result.catch(() => {});
        } else if (typeof result === 'undefined') {
            try {
                chrome.action.openPopup(() => {
                    void chrome.runtime.lastError;
                });
            } catch (e) {}
        }
    } catch (e) {}
}

function cleanupTabDebugger(tabId) {
    if (pollingTimers[tabId]) {
        clearInterval(pollingTimers[tabId]);
        delete pollingTimers[tabId];
    }
    const debuggee = { tabId: tabId };
    chrome.debugger.detach(debuggee, () => {
        if (chrome.runtime.lastError) return;
    });
    pendingTabs.delete(tabId);
    attachedTabs.delete(tabId);
}

function cleanupTabResources(tabId) {
    cleanupTabDebugger(tabId);
    Object.keys(capturedRequests).forEach(requestId => {
        if (capturedRequests[requestId].tabId === tabId) {
            delete capturedRequests[requestId];
        }
    });
    Object.keys(downloadProgress).forEach(rid => {
        const p = downloadProgress[rid];
        const st = p && p.status;
        if (st === 'starting' || st === 'downloading' || st === 'paused') {
            p.status = 'interrupted';
            p.error = 'Tab was closed during download. Click Retry to restart.';
            p.lastUpdated = Date.now();
        }
    });
    delete autoPopupCount[tabId];
    delete activeBeforeUnloadTabs[tabId];
    persistState();
}

function startAutoCaptureForTab(tabId) {
    cleanupTabDebugger(tabId);

    const debuggee = { tabId: tabId };
    chrome.debugger.attach(debuggee, "1.3", () => {
        if (chrome.runtime.lastError) return;
        attachedTabs.add(tabId);

        chrome.debugger.sendCommand(debuggee, "Network.enable", {}, () => {
            pollingTimers[tabId] = setInterval(() => {
                if (!attachedTabs.has(tabId)) return;

                let validRequests = [];
                for (const requestId in capturedRequests) {
                    const req = capturedRequests[requestId];
                    if (req.tabId === tabId && req.lastItagUrl && req.videoTitle) {
                        validRequests.push(req);
                    }
                }

                let currentCount = validRequests.length;
                if (!autoPopupCount[tabId]) autoPopupCount[tabId] = 0;

                if (currentCount > autoPopupCount[tabId]) {
                    autoPopupCount[tabId] = currentCount;
                    safeOpenPopup();
                }
            }, 1000);
        });
    });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.url && tab.url.startsWith("https://drive.google.com/")) {
        if (extensionEnabled || pendingTabs.has(tabId)) {
            if (!pollingTimers[tabId]) {
                startAutoCaptureForTab(tabId);
            }
            pendingTabs.delete(tabId);
        }
    } else if (changeInfo.url && !changeInfo.url.startsWith("https://drive.google.com/")) {
        if (pollingTimers[tabId]) {
            cleanupTabDebugger(tabId);
        }
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    cleanupTabResources(tabId);
});

chrome.debugger.onEvent.addListener((debuggeeId, method, params) => {
    const tabId = debuggeeId.tabId;
    if (!extensionEnabled && !pendingTabs.has(tabId)) return;
    if (!attachedTabs.has(tabId)) return;

    if (method === "Network.requestWillBeSent") {
        if (params.request.url.startsWith("https://workspacevideo-pa.clients6.google.com")) {
            const requestId = params.requestId;
            capturedRequests[requestId] = {
                url: params.request.url,
                method: params.request.method,
                timestamp: params.timestamp,
                tabId: tabId,
                capturedAt: Date.now()
            };
            persistState();
        }
    } else if (method === "Network.responseReceived") {
        const requestId = params.requestId;
        if (capturedRequests[requestId]) {
            chrome.debugger.sendCommand(
                { tabId: tabId },
                "Network.getResponseBody",
                { requestId: requestId },
                (result) => {
                    if (chrome.runtime.lastError || !result || !result.body) return;
                    capturedRequests[requestId].responseBody = result.body;
                    capturedRequests[requestId].base64Encoded = result.base64Encoded;
                    try {
                        const data = JSON.parse(result.body);
                        const fsd = data.mediaStreamingData && data.mediaStreamingData.formatStreamingData;
                        if (fsd && fsd.progressiveTranscodes && fsd.progressiveTranscodes.length > 0) {
                            const transcodes = fsd.progressiveTranscodes;
                            const last = transcodes[transcodes.length - 1];
                            capturedRequests[requestId].lastItagUrl = last.url;

                            const meta = last.transcodeMetadata || {};
                            const mimeType = meta.mimeType || '';
                            if (mimeType.startsWith('audio/')) {
                                capturedRequests[requestId].quality = 'AUDIO';
                            } else if (meta.height) {
                                capturedRequests[requestId].quality = meta.height + 'p';
                            } else if (meta.width) {
                                capturedRequests[requestId].quality = meta.width + 'p';
                            } else {
                                capturedRequests[requestId].quality = '';
                            }
                            if (meta.maxContainerBitrate) {
                                capturedRequests[requestId].bitrate = meta.maxContainerBitrate;
                            }
                        }
                        if (data.mediaMetadata && data.mediaMetadata.title) {
                            capturedRequests[requestId].videoTitle = data.mediaMetadata.title;
                        }
                        persistState();
                    } catch (e) {}
                }
            );
        }
    }
});

function chunkedDownloadFn(url, videoTitle, requestId) {
    const CHUNK_SIZE  = 512 * 1024;
    const CONCURRENCY = 24;
    const MAX_RETRIES = 4;
    const MIN_RELIABLE_SIZE = 256 * 1024;
    const STREAMING_MAX_RETRIES = 3;

    let isPaused    = false;
    let isCancelled = false;
    let messageListener = null;

    const abortController = (typeof AbortController !== 'undefined')
        ? new AbortController() : null;

    const sanitizeTitle = (raw) => {
        let t = (raw || 'video')
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, ' ')
            .replace(/^[\s.]+|[\s.]+$/g, '')
            .replace(/\.mp4$/i, '');
        if (t.length > 200) t = t.substring(0, 200);
        return t + '.mp4';
    };

    const safeTitle = sanitizeTitle(videoTitle);

    const report = (status, completedBytes, totalBytes, percent, error) => {
        try {
            chrome.runtime.sendMessage({
                type: 'downloadProgressUpdate',
                requestId: requestId,
                status: status,
                completed: completedBytes,
                total: totalBytes,
                percent: percent,
                error: error
            }, () => { void chrome.runtime.lastError; });
        } catch (e) {}
    };

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    const waitIfPaused = async () => {
        while (isPaused && !isCancelled) {
            await sleep(100);
        }
    };

    messageListener = (msg) => {
        if (!msg || msg.requestId !== requestId) return;
        if (msg.type === 'pauseDownload') {
            isPaused = true;
        } else if (msg.type === 'resumeDownload') {
            isPaused = false;
        } else if (msg.type === 'cancelDownload') {
            isCancelled = true;
            isPaused = false;
            if (abortController) {
                try { abortController.abort(); } catch (e) {}
            }
        }
    };
    try {
        chrome.runtime.onMessage.addListener(messageListener);
    } catch (e) {}

    const beforeUnloadHandler = (event) => {
        event.preventDefault();
        event.returnValue = 'A video download is still in progress. Are you sure you want to leave?';
        try {
            chrome.runtime.sendMessage({
                type: 'showPopup',
                requestId: requestId
            }, () => { void chrome.runtime.lastError; });
        } catch (e) {}
        return 'A video download is still in progress. Are you sure you want to leave?';
    };
    try {
        window.addEventListener('beforeunload', beforeUnloadHandler);
    } catch (e) {}
    try {
        chrome.runtime.sendMessage({ type: 'registerBeforeUnload' }, () => { void chrome.runtime.lastError; });
    } catch (e) {}

    const cleanup = () => {
        try {
            chrome.runtime.onMessage.removeListener(messageListener);
        } catch (e) {}
        try {
            window.removeEventListener('beforeunload', beforeUnloadHandler);
        } catch (e) {}
        try {
            chrome.runtime.sendMessage({ type: 'unregisterBeforeUnload' }, () => { void chrome.runtime.lastError; });
        } catch (e) {}
    };

    const triggerDownload = (blob) => {
        const downloadURL = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadURL;
        a.download = safeTitle;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => { try { URL.revokeObjectURL(downloadURL); } catch (e) {} }, 60000);
    };

    const isUrlExpired = (response) => {
        if (!response) return false;
        if (response.status === 403) return true;
        if (response.status === 410) return true;
        return false;
    };

    const isAbortError = (e) => {
        if (!e) return false;
        if (e.name === 'AbortError') return true;
        if (e.name === 'TimeoutError') return false;
        const msg = (e.message || '').toLowerCase();
        return msg.includes('abort') || msg.includes('signal is aborted');
    };

    const makeChunkedRequest = async (chunkUrl, start, end) => {
        const localController = (typeof AbortController !== 'undefined') ? new AbortController() : null;

        const pauseChecker = setInterval(() => {
            if (isCancelled) {
                try { localController.abort(); } catch (e) {}
            }
        }, 50);

        try {
            const response = await fetch(chunkUrl, {
                credentials: 'include',
                headers: {
                    Range: 'bytes=' + start + '-' + end,
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                },
                signal: localController ? localController.signal : undefined
            });
            return { response, controller: localController };
        } finally {
            clearInterval(pauseChecker);
        }
    };

    (async () => {
        try {
            report('starting', 0, 0, 0, null);

            if (isCancelled) {
                report('cancelled', 0, 0, 0, null);
                cleanup();
                return;
            }

            let totalSize = 0;
            let rangeSupported = false;

            try {
                const probe = await fetch(url, {
                    credentials: 'include',
                    headers: { Range: 'bytes=0-0' },
                    signal: abortController ? abortController.signal : undefined
                });

                if (isUrlExpired(probe)) {
                    report('error', 0, 0, 0, 'Video URL has expired. Reload the Drive tab to recapture a fresh URL.');
                    cleanup();
                    return;
                }

                if (probe.status === 206 || probe.ok) {
                    if (probe.status === 206) rangeSupported = true;

                    const cr = probe.headers.get('Content-Range');
                    if (cr) {
                        const m = cr.match(/\/(\d+)/);
                        if (m) {
                            totalSize = parseInt(m[1], 10);
                            rangeSupported = true;
                        }
                    }

                    if (!totalSize) {
                        const cl = probe.headers.get('Content-Length');
                        if (cl) {
                            const clNum = parseInt(cl, 10);
                            if (clNum > 1) {
                                totalSize = clNum;
                                rangeSupported = false;
                            }
                        }
                    }
                }

                try { await probe.arrayBuffer(); } catch (e) {}
            } catch (probeErr) {
                if (isCancelled) {
                    report('cancelled', 0, 0, 0, null);
                    cleanup();
                    return;
                }
            }

            if (isCancelled) {
                report('cancelled', 0, 0, 0, null);
                cleanup();
                return;
            }

            if (!totalSize || totalSize < MIN_RELIABLE_SIZE || !rangeSupported) {
                await streamingDownload();
                return;
            }

            await chunkedDownload(totalSize);
        } catch (err) {
            if (isCancelled) {
                report('cancelled', 0, 0, 0, null);
            } else {
                report('error', 0, 0, 0, err && err.message ? err.message : String(err));
            }
            cleanup();
        }
    })();

    async function streamingDownload() {
        let lastErr = null;

        for (let attempt = 1; attempt <= STREAMING_MAX_RETRIES; attempt++) {
            if (isCancelled) {
                report('cancelled', 0, 0, 0, null);
                cleanup();
                return;
            }

            let response;
            try {
                response = await fetch(url, {
                    credentials: 'include',
                    signal: abortController ? abortController.signal : undefined
                });
            } catch (e) {
                lastErr = e;
                if (isCancelled) {
                    report('cancelled', 0, 0, 0, null);
                    cleanup();
                    return;
                }
                if (attempt < STREAMING_MAX_RETRIES) {
                    await sleep(500 * attempt);
                    continue;
                }
                break;
            }

            if (isUrlExpired(response)) {
                report('error', 0, 0, 0, 'Video URL has expired. Reload the Drive tab to recapture a fresh URL.');
                cleanup();
                return;
            }

            if (!response.ok && response.status !== 206) {
                lastErr = new Error('HTTP ' + response.status);
                if (attempt < STREAMING_MAX_RETRIES) {
                    await sleep(500 * attempt);
                    continue;
                }
                break;
            }

            const contentLength = parseInt(response.headers.get('Content-Length') || '0', 10);
            const reader = response.body ? response.body.getReader() : null;
            const chunks = [];
            let received = 0;

            if (!reader) {
                try {
                    const blob = await response.blob();
                    triggerDownload(blob);
                    report('completed', blob.size, blob.size, 100, null);
                } catch (e) {
                    report('error', 0, 0, 0, e && e.message ? e.message : String(e));
                }
                cleanup();
                return;
            }

            try {
                while (true) {
                    if (isCancelled) {
                        try { reader.cancel(); } catch (e) {}
                        report('cancelled', received, contentLength, 0, null);
                        cleanup();
                        return;
                    }
                    if (isPaused) {
                        report('paused', received, contentLength,
                               contentLength > 0 ? Math.round((received / contentLength) * 100) : 0, null);
                        await waitIfPaused();
                        if (isCancelled) {
                            try { reader.cancel(); } catch (e) {}
                            report('cancelled', received, contentLength, 0, null);
                            cleanup();
                            return;
                        }
                        report('downloading', received, contentLength,
                               contentLength > 0 ? Math.round((received / contentLength) * 100) : 0, null);
                    }

                    const { done, value } = await reader.read();
                    if (done) break;
                    chunks.push(value);
                    received += value.byteLength;

                    const percent = contentLength > 0
                        ? Math.min(100, Math.round((received / contentLength) * 100))
                        : 0;
                    report('downloading', received, contentLength, percent, null);
                }

                const blob = new Blob(chunks, { type: 'video/mp4' });
                triggerDownload(blob);
                report('completed', blob.size, blob.size, 100, null);
                cleanup();
                return;
            } catch (e) {
                if (isCancelled) {
                    report('cancelled', received, contentLength, 0, null);
                    cleanup();
                    return;
                }
                if (isPaused) {
                    await waitIfPaused();
                    if (isCancelled) {
                        report('cancelled', received, contentLength, 0, null);
                        cleanup();
                        return;
                    }
                    report('downloading', received, contentLength,
                           contentLength > 0 ? Math.round((received / contentLength) * 100) : 0, null);
                    continue;
                }
                if (isAbortError(e) && !isCancelled) {
                    continue;
                }
                lastErr = e;
                if (attempt < STREAMING_MAX_RETRIES) {
                    await sleep(500 * attempt);
                    continue;
                }
                report('error', received, contentLength, 0,
                       e && e.message ? e.message : String(e));
                cleanup();
                return;
            }
        }

        if (lastErr) {
            if (isCancelled) {
                report('cancelled', 0, 0, 0, null);
            } else {
                report('error', 0, 0, 0, lastErr && lastErr.message ? lastErr.message : String(lastErr));
            }
        }
        cleanup();
    }

    async function chunkedDownload(totalSize) {
        const ranges = [];
        for (let start = 0; start < totalSize; start += CHUNK_SIZE) {
            const end = Math.min(start + CHUNK_SIZE - 1, totalSize - 1);
            ranges.push({ start: start, end: end });
        }

        report('downloading', 0, totalSize, 0, null);

        const chunks = new Array(ranges.length);
        let nextIndex = 0;
        let bytesDownloaded = 0;
        let lastReportTime = 0;

        async function worker() {
            while (true) {
                if (isCancelled) return;

                if (isPaused) {
                    await waitIfPaused();
                    if (isCancelled) return;
                }

                const index = nextIndex++;
                if (index >= ranges.length) return;

                const { start, end } = ranges[index];
                let chunkComplete = false;
                let rangeIgnored = false;

                for (let attempt = 1; attempt <= MAX_RETRIES && !chunkComplete; attempt++) {
                    if (isCancelled) return;
                    if (isPaused) {
                        await waitIfPaused();
                        if (isCancelled) return;
                    }

                    let response = null;
                    try {
                        const chunkUrl = url + (url.indexOf('?') >= 0 ? '&' : '?') +
                            'rn=' + index + '.' + attempt + '.' + Date.now();

                        const result = await makeChunkedRequest(chunkUrl, start, end);
                        response = result.response;

                        if (response.status === 200 && response.headers.get('Content-Range')) {
                            rangeIgnored = true;
                            break;
                        }
                        if (response.ok || response.status === 206) {
                            if (isUrlExpired(response)) {
                                report('error', bytesDownloaded, totalSize,
                                       Math.round((bytesDownloaded / totalSize) * 100),
                                       'Video URL has expired. Reload the Drive tab to recapture a fresh URL.');
                                cleanup();
                                return;
                            }
                        } else {
                            if (isUrlExpired(response)) {
                                report('error', bytesDownloaded, totalSize,
                                       Math.round((bytesDownloaded / totalSize) * 100),
                                       'Video URL has expired. Reload the Drive tab to recapture a fresh URL.');
                                cleanup();
                                return;
                            }
                            response = null;
                        }
                    } catch (e) {
                        if (isCancelled) return;
                        if (isPaused) {
                            await waitIfPaused();
                            if (isCancelled) return;
                            attempt--;
                            continue;
                        }
                        if (isAbortError(e) && !isCancelled) {
                            attempt--;
                            continue;
                        }
                        response = null;
                    }

                    if (rangeIgnored) break;

                    if (!response) {
                        if (attempt < MAX_RETRIES) {
                            const waitMs = 200 * attempt;
                            const steps = Math.max(1, Math.floor(waitMs / 50));
                            for (let i = 0; i < steps; i++) {
                                if (isCancelled) return;
                                if (isPaused) break;
                                await sleep(50);
                            }
                            continue;
                        }
                        throw new Error('Chunk ' + (index + 1) + ' failed after ' + MAX_RETRIES + ' retries');
                    }

                    let data;
                    try {
                        data = await response.arrayBuffer();
                    } catch (e) {
                        if (isCancelled) return;
                        if (isPaused) {
                            await waitIfPaused();
                            if (isCancelled) return;
                            attempt--;
                            continue;
                        }
                        if (isAbortError(e) && !isCancelled) {
                            attempt--;
                            continue;
                        }
                        if (attempt < MAX_RETRIES) {
                            const waitMs = 200 * attempt;
                            const steps = Math.max(1, Math.floor(waitMs / 50));
                            for (let i = 0; i < steps; i++) {
                                if (isCancelled) return;
                                await sleep(50);
                            }
                            continue;
                        }
                        throw e;
                    }

                    if (isCancelled) return;

                    const expected = end - start + 1;
                    if (data.byteLength < expected) {
                        if (attempt < MAX_RETRIES) {
                            await sleep(200 * attempt);
                            continue;
                        }
                        throw new Error('Chunk ' + (index + 1) + ' short read: ' + data.byteLength + '/' + expected);
                    }
                    chunks[index] = (data.byteLength > expected) ? data.slice(0, expected) : data;
                    bytesDownloaded += chunks[index].byteLength;
                    chunkComplete = true;

                    const now = Date.now();
                    if (now - lastReportTime > 100 || bytesDownloaded >= totalSize) {
                        lastReportTime = now;
                        const percent = Math.min(100, Math.round((bytesDownloaded / totalSize) * 100));
                        report('downloading', bytesDownloaded, totalSize, percent, null);
                    }
                }

                if (isCancelled) return;
                if (rangeIgnored) {
                    throw new Error('Server ignored Range header. Cannot safely download in chunks. Try again or use a different video.');
                }
                if (!chunkComplete) {
                    throw new Error('Chunk ' + (index + 1) + ' failed after ' + MAX_RETRIES + ' retries');
                }
            }
        }

        try {
            await Promise.all(
                Array.from(
                    { length: Math.min(CONCURRENCY, ranges.length) },
                    () => worker()
                )
            );

            if (isCancelled) {
                report('cancelled', bytesDownloaded, totalSize,
                       Math.round((bytesDownloaded / totalSize) * 100), null);
                cleanup();
                return;
            }

            const blob = new Blob(chunks, { type: 'video/mp4' });
            if (blob.size !== totalSize) {
                throw new Error('Final size mismatch: ' + blob.size + '/' + totalSize);
            }

            triggerDownload(blob);
            report('completed', blob.size, blob.size, 100, null);
        } catch (err) {
            if (isCancelled) {
                report('cancelled', bytesDownloaded, totalSize,
                       Math.round((bytesDownloaded / totalSize) * 100), null);
            } else {
                report('error', bytesDownloaded, totalSize,
                       Math.round((bytesDownloaded / totalSize) * 100),
                       err && err.message ? err.message : String(err));
            }
        } finally {
            cleanup();
        }
    }
}
