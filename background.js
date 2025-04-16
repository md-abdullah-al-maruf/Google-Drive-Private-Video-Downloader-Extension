let capturedRequests = {};
let pollingTimers = {};
let autoPopupCount = {};
let extensionEnabled = false;
const pendingTabs = new Set();

chrome.storage.local.get(['extensionEnabled'], (result) => {
    extensionEnabled = result.extensionEnabled || false;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "setEnabled") {
        extensionEnabled = message.enabled;
        
        if (message.enabled) {
            chrome.tabs.get(message.tabId, (tab) => {
                if (chrome.runtime.lastError || !tab) {
                    sendResponse({ success: false });
                    return;
                }
                if (tab.url?.includes("drive.google.com")) {
                    startAutoCaptureForTab(message.tabId);
                    pendingTabs.add(message.tabId);
                }
                sendResponse({ success: true });
            });
            return true;
        } else {
            capturedRequests = {};
            autoPopupCount = {};
            pendingTabs.clear();

            Object.keys(pollingTimers).forEach(tabId => {
                cleanupTabResources(Number(tabId));
            });
            sendResponse({ success: true });
        }
        return true;
    }
    if (message.type === "getRequests") {
        sendResponse({ requests: capturedRequests });
    }
});

function cleanupTabResources(tabId) {
    if (pollingTimers[tabId]) {
        clearInterval(pollingTimers[tabId]);
        delete pollingTimers[tabId];
    }
    const debuggee = { tabId: tabId };
    chrome.debugger.detach(debuggee, () => {
        if (chrome.runtime.lastError) return;
        
        Object.keys(capturedRequests).forEach(requestId => {
            if (capturedRequests[requestId].tabId === tabId) {
                delete capturedRequests[requestId];
            }
        });
        delete autoPopupCount[tabId];
    });
    pendingTabs.delete(tabId);
}

function startAutoCaptureForTab(tabId) {
    cleanupTabResources(tabId);
    
    const debuggee = { tabId: tabId };
    chrome.debugger.attach(debuggee, "1.3", () => {
        if (chrome.runtime.lastError) return;
        
        chrome.debugger.sendCommand(debuggee, "Network.enable", {}, () => {
            pollingTimers[tabId] = setInterval(() => {
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
                    chrome.windows.getLastFocused({ populate: false }, (window) => {
                        if (window && window.type === 'normal') {
                            try {
                                chrome.action.openPopup();
                            } catch (e) {
                            }
                        }
                    });
                }
            }, 1000);
        });
    });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.url?.startsWith("https://drive.google.com/")) {
        if (extensionEnabled || pendingTabs.has(tabId)) {
            if (!pollingTimers[tabId]) {
                startAutoCaptureForTab(tabId);
            }
            pendingTabs.delete(tabId);
        }
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    cleanupTabResources(tabId);
});

chrome.debugger.onEvent.addListener((debuggeeId, method, params) => {
    const tabId = debuggeeId.tabId;
    if (!extensionEnabled && !pendingTabs.has(tabId)) return;

    if (method === "Network.requestWillBeSent") {
        if (params.request.url.startsWith("https://workspacevideo-pa.clients6.google.com")) {
            const requestId = params.requestId;
            capturedRequests[requestId] = {
                url: params.request.url,
                method: params.request.method,
                timestamp: params.timestamp,
                tabId: tabId
            };
        }
    } else if (method === "Network.responseReceived") {
        const requestId = params.requestId;
        if (capturedRequests[requestId]) {
            chrome.debugger.sendCommand(
                { tabId: tabId },
                "Network.getResponseBody",
                { requestId: requestId },
                (result) => {
                    if (chrome.runtime.lastError) return;
                    capturedRequests[requestId].responseBody = result.body;
                    capturedRequests[requestId].base64Encoded = result.base64Encoded;
                    try {
                        const data = JSON.parse(result.body);
                        if (data.mediaStreamingData?.formatStreamingData?.progressiveTranscodes) {
                            const transcodes = data.mediaStreamingData.formatStreamingData.progressiveTranscodes;
                            capturedRequests[requestId].lastItagUrl = transcodes[transcodes.length - 1]?.url;
                        }
                        if (data.mediaMetadata?.title) {
                            capturedRequests[requestId].videoTitle = data.mediaMetadata.title;
                        }
                    } catch (e) {}
                }
            );
        }
    }
});