// offscreen.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.action === 'check-dark-mode') {
		const darkModeMql = window.matchMedia('(prefers-color-scheme: dark)');
		sendResponse({
			isDarkMode: darkModeMql.matches
		});

		// Listen for changes to dark mode preference
		darkModeMql.addEventListener('change', (e) => {
			chrome.runtime.sendMessage({
				action: 'dark-mode-change',
				isDarkMode: e.matches
			});
		});
	}
});
