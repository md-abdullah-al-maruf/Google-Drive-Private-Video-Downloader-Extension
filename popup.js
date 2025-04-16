document.addEventListener("DOMContentLoaded", () => {
    const header = document.querySelector('.header');
    const notDriveMessage = document.getElementById('notDriveMessage');
    const downloadContainer = document.getElementById('downloadContainer');
    const statusMessage = document.getElementById('statusMessage');
    const btnOn = document.getElementById('btnOn');
    const btnOff = document.getElementById('btnOff');
    const reloadBtn = document.querySelector('.reload-btn');

    function updateUI(isEnabled) {
    btnOn.disabled = isEnabled;
    btnOff.disabled = !isEnabled;
    reloadBtn.classList.toggle('active', isEnabled);
	}

    function handleStateChange(newState) {
        chrome.storage.local.set({ extensionEnabled: newState }, () => {
            updateUI(newState);
            
            if (!newState) {
                downloadContainer.innerHTML = '';
                statusMessage.textContent = "Extension stopped.";
                setTimeout(() => {
                    statusMessage.textContent = "Click ON to start extension.";
                }, 2000);
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
                    if (newState && response?.success) {
                        chrome.tabs.reload(tab.id);
                    }
                });
            });
        });
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (!tab || !tab.url.startsWith('https://drive.google.com/')) {
            header.classList.add('hidden');
            downloadContainer.classList.add('hidden');
            statusMessage.classList.add('hidden');
            notDriveMessage.classList.remove('hidden');
            return;
        }

        header.classList.remove('hidden');
        downloadContainer.classList.remove('hidden');
        statusMessage.classList.remove('hidden');
        notDriveMessage.classList.add('hidden');

		chrome.storage.local.get(['extensionEnabled'], (result) => {
			const isEnabled = result.extensionEnabled !== undefined ? result.extensionEnabled : false;
			updateUI(isEnabled);
		});

        btnOn.addEventListener('click', () => handleStateChange(true));
        btnOff.addEventListener('click', () => handleStateChange(false));

        reloadBtn.addEventListener('click', () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                if (tabs[0]?.id) {
                    chrome.tabs.reload(tabs[0].id);
                }
            });
        });

        const activeTabId = tab.id;
        setInterval(() => {
            chrome.runtime.sendMessage({ type: "getRequests" }, (response) => {
                if (response && response.requests) {
                    const matchingRequests = [];
                    for (const requestId in response.requests) {
                        const req = response.requests[requestId];
                        if (req.tabId === activeTabId && req.lastItagUrl && req.videoTitle) {
                            matchingRequests.push(req);
                        }
                    }
                    if (matchingRequests.length > 0) {
                        statusMessage.textContent = "";
                        downloadContainer.innerHTML = "";
                        matchingRequests.forEach((req) => {
                            const item = document.createElement("div");
                            item.classList.add("video-item");

                            const titleSpan = document.createElement("span");
                            titleSpan.classList.add("video-title");
                            titleSpan.textContent = req.videoTitle.length > 35
                                ? req.videoTitle.substring(0, 35) + "..." 
                                : req.videoTitle;

                            const btn = document.createElement("button");
                            btn.classList.add("download-btn");
                            btn.innerHTML = "⬇";
                            btn.addEventListener("click", () => {
                                chrome.downloads.download({
                                    url: req.lastItagUrl,
                                    filename: req.videoTitle
                                }, () => {
                                    if (chrome.runtime.lastError) {
                                        statusMessage.textContent = "Can't able to download";
                                        statusMessage.classList.add("error");
                                    }
                                });
                            });

                            item.appendChild(titleSpan);
                            item.appendChild(btn);
                            downloadContainer.appendChild(item);
                        });
                    } else {
                        chrome.storage.local.get(['extensionEnabled'], (result) => {
                            if (result.extensionEnabled) {
                                statusMessage.textContent = "Waiting for new video source. If not working reload the page.";
                            }
                        });
                    }
                }
            });
        }, 1000);
    });
});