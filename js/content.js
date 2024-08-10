function log(msg) {
	if (log.enabled) {
		console.log('REDIRECTOR Content Script [' + new Date().toISOString() + ']: ' + msg);
	}
}

log.enabled = false;

log('Loaded.');

// Function to handle different types of redirections
function handleRedirection(requestType, originalUrl, redirectUrl) {
	log('Content Script - Handling redirection:', requestType, originalUrl, redirectUrl);

	switch (requestType) {
		case 'sub_frame':
			document.querySelectorAll('iframe[src="' + originalUrl + '"], frame[src="' + originalUrl + '"]').forEach(el => {
				log('Redirecting iframe or frame. Original src: ' + el.src);
				el.src = redirectUrl;
				log('Redirected iframe or frame. New src: ' + el.src);
			});
			break;
		case 'stylesheet':
		case 'script':
		case 'image':
			document.querySelectorAll('[src="' + originalUrl + '"], [href="' + originalUrl + '"]').forEach(el => {
				if (el.src) {
					log('Redirecting src attribute. Original src: ' + el.src);
					el.src = redirectUrl;
					log('Redirected src attribute. New src: ' + el.src);
				} else if (el.href) {
					log('Redirecting href attribute. Original href: ' + el.href);
					el.href = redirectUrl;
					log('Redirected href attribute. New href: ' + el.href);
				}
			});
			break;
		case 'object':
			document.querySelectorAll('object[data="' + originalUrl + '"], embed[src="' + originalUrl + '"]').forEach(el => {
				if (el.src) {
					log('Redirecting object src attribute. Original src: ' + el.src);
					el.src = redirectUrl;
					log('Redirected object src attribute. New src: ' + el.src);
				} else if (el.data) {
					log('Redirecting object data attribute. Original data: ' + el.data);
					el.data = redirectUrl;
					log('Redirected object data attribute. New data: ' + el.data);
				}
			});
			break;
		case 'xmlhttprequest':
			// Handle XMLHttpRequest (AJAX) redirection if needed
			break;
		case 'other':
			// Handle "other" cases if applicable
			break;
		default:
			log('Unhandled type in content script:', requestType);
			break;
	}
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message.action === 'redirect') {
		try {
			log('Received redirect message:', message);
			handleRedirection(message.requestType, message.originalUrl, message.redirectUrl);
			sendResponse({
				status: 'success'
			});
		} catch (error) {
			console.error('Error handling redirect message:', error);
			sendResponse({
				status: 'error',
				message: error.message
			});
		}
		return true; // Keep the message channel open for asynchronous response
	}
});
