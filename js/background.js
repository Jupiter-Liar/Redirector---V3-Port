// This is the background script. It is responsible for actually redirecting requests,
// as well as monitoring changes in the redirects and the disabled status and reacting to them.

importScripts('redirect.js');
const RULE_ID_STORAGE_KEY = 'ruleIds';

function log(msg, force, origin) {
	if (!origin) {
		origin = 'NSO';
	}
	if (log.enabled || force) {
		console.log('REDIRECTOR ' + origin + ' [' + new Date().toISOString() + ']: ' + msg);
	}
}

function logPreRL(msg, force) {
	if (logPreRL.enabled || log.enabled || force) {
		log(msg, true, "PreRL");
	}
}

function logQR(msg, force) {
	if (logQR.enabled || log.enabled || force) {
		log(msg, true, "QR");
	}
}

function logSRM(msg, force) {
	if (logSRM.enabled || log.enabled || force) {
		log(msg, true, "SRM");
	}
}

function logCR(msg, force) {
	if (logCR.enabled || log.enabled || force) {
		log(msg, true, "CR");
	}
}

function logMC(msg, force) {
	if (logMC.enabled || log.enabled || force) {
		log(msg, true, "MC");
	}
}

function logCF(msg, force) {
	if (logMC.enabled || log.enabled || force) {
		log(msg, true, "CF");
	}
}

function logCPR(msg, force) {
	if (logCPR.enabled || log.enabled || force) {
		log(msg, true, "CPR");
	}
}

function logSURL(msg, force) {
	if (logSURL.enabled || log.enabled || force) {
		log(msg, true, "SURL");
	}
}

function logCHSR(msg, force) {
	if (logCHSR.enabled || log.enabled || force) {
		log(msg, true, "CHSR");
	}
}

function logUpI(msg, force) {
	if (logUpI.enabled || log.enabled || force) {
		log(msg, true, "UpI");
	}
}

function logCROA(msg, force) {
	if (logCROA.enabled || log.enabled || force) {
		log(msg, true, "CROA");
	}
}

function logCSLG(msg, force) {
	if (logCSLG.enabled || log.enabled || force) {
		log(msg, true, "CSLG");
	}
}

function logSI(msg, force) {
	if (logSI.enabled || log.enabled || force) {
		log(msg, true, "SI");
	}
}

function logSN(msg, force) {
	if (logSN.enabled || log.enabled || force) {
		log(msg, true, "SN");
	}
}

function logHS(msg, force) {
	if (logSN.enabled || log.enabled || force) {
		log(msg, true, "HS");
	}
}

log.enabled = false; // Master switch to enable logging. If enabled, ALL logs will be printed.

// What follows are switches for individual functions and sections, since the amount of logging has gone way up.
logPreRL.enabled = false; // Logging for functions before redirection logic
logQR.enabled = false; // Logging for queueRedirects
logSRM.enabled = false; // Logging for sendRequestMessages
logCR.enabled = false; // Logging for checkRedirects
logMC.enabled = false; // Logging for monitorChanges
logCF.enabled = false; // Logging for checkFilters
logCPR.enabled = false; // Logging for createPartitionedRedirects
logSURL.enabled = false; // Logging for setUpRedirectListener
logCHSR.enabled = false; // Logging for checkHistoryStateRedirects
logUpI.enabled = false; // Logging for updateIcon
logCROA.enabled = false; // Logging for chrome.runtime.onMessage.addListener
logCSLG.enabled = false; // Logging for two chrome.storage.local.get operations
logSI.enabled = false; // Logging for setupInitial
logSN.enabled = false; // Logging for sendNotifications
logHS.enabled = false; // Logging for handleStartup
var enableNotifications = false;

function isDarkMode() {
	logPreRL('Function isDarkMode is running.');

	return chrome.runtime.getPlatformInfo().then(platformInfo => platformInfo.isDarkMode);
}

var isFirefox = !!navigator.userAgent.match(/Firefox/i);
logPreRL('Browser detected: ' + (isFirefox ? 'Firefox' : 'Not Firefox'));

var storageArea = chrome.storage.local;
logPreRL('Initialized storage area');

// Redirects partitioned by request type, so we have to run through
// the minimum number of redirects for each request.
var partitionedRedirects = {};

// Cache of URLs that have just been redirected to. They will not be redirected again, to
// stop recursive redirects, and endless redirect chains.
// Key is URL, value is timestamp of redirect.
var ignoreNextRequest = {};
logPreRL('Initialized ignoreNextRequest cache');

// URL => { timestamp:ms, count:1...n};
var justRedirected = {};
logPreRL('Initialized justRedirected cache');
var redirectThreshold = 3;
logPreRL('Redirect threshold set to: ' + redirectThreshold);

function setIcon(image) {
	logPreRL('Setting icon to: ' + image);

	var data = {
		path: {}
	};

	for (let nr of [16, 19, 32, 38, 48, 64, 128]) {
		data.path[nr] = `images/${image}-${nr}.png`;
		logPreRL('Icon path set for size ' + nr + ': ' + data.path[nr]);
	}

	chrome.action.setIcon(data, function () {
		var err = chrome.runtime.lastError;
		if (err) {
			// If not checked we will get unchecked errors in the background page console...
			logPreRL('Error in SetIcon: ' + err.message);
		} else {
			logPreRL('Icon set successfully');
		}
	});
}

// This is the first of a few new function, added after Einar's death. It redirects pages, or begins the process of routing other redirects to the content script.
function queueRedirects(requestType, originalUrl, redirectUrl, tabId) {
	logQR('Queue redirects called. Details: ' + JSON.stringify(requestType) + "; " + JSON.stringify(originalUrl) + "; " + JSON.stringify(redirectUrl) + "; " + JSON.stringify(tabId));

	switch (requestType) {
		case 'main_frame':
			logQR('Handling main_frame redirection.');
			// Update the main frame URL directly using the tabId
			chrome.tabs.update(tabId, {
				url: redirectUrl
			}, function (tab) {
				if (chrome.runtime.lastError) {
					console.error('Error updating main frame:', chrome.runtime.lastError);
				} else {
					logQR('Redirected main frame. New URL: ' + redirectUrl);
				}
			});
			break;

		case 'sub_frame':
		case 'stylesheet':
		case 'script':
		case 'image':
		case 'object':
		case 'xmlhttprequest':
		case 'other':
			logQR('Passing redirection to content script.');
			sendRedirectMessage(tabId, requestType, originalUrl, redirectUrl);
			break;

		default:
			logQR('Unhandled request type: ' + requestType);
			break;
	}
}

// This function sends redirects which can be handled by changing DOM code to a content script.
function sendRedirectMessage(tabId, requestType, originalUrl, redirectUrl, retryCount = 0) {
	const maxRetries = 3; // Set the maximum number of retries
	const retryDelay = 1000; // Delay in milliseconds before retrying
	logSRM('Passing redirection to content script for tab ID ' + tabId + '.');

	chrome.tabs.sendMessage(tabId, {
		action: 'redirect',
		requestType: requestType,
		originalUrl: originalUrl,
		redirectUrl: redirectUrl
	}, function (response) {
		if (chrome.runtime.lastError) {
			console.error('Error sending message to tab ' + tabId + ':', chrome.runtime.lastError.message);

			if (retryCount < maxRetries) {
				console.log(`Retrying (${retryCount + 1}/${maxRetries})...`);
				setTimeout(() => {
					sendRedirectMessage(tabId, requestType, originalUrl, redirectUrl, retryCount + 1);
				}, retryDelay);
			} else {
				console.error('Max retries reached. Message could not be sent.');
			}
		} else {
			logSRM('Response from content script on tab ' + tabId + ':', response);
		}
	});
}

function sendRedirectMessage(tabId, requestType, originalUrl, redirectUrl, retryCount = 0) {
	const maxRetries = 3; // Set the maximum number of retries
	const retryDelay = 1000; // Delay in milliseconds before retrying

	chrome.tabs.sendMessage(tabId, {
		action: 'redirect',
		requestType: requestType,
		originalUrl: originalUrl,
		redirectUrl: redirectUrl
	}, (response) => {
		if (chrome.runtime.lastError) {
			// Log the error object in a more readable format
			console.error('Error sending message:', chrome.runtime.lastError.message);

			if (retryCount < maxRetries) {
				console.log(`Retrying (${retryCount + 1}/${maxRetries})...`);
				setTimeout(() => {
					sendRedirectMessage(tabId, requestType, originalUrl, redirectUrl, retryCount + 1);
				}, retryDelay);
			} else {
				console.error('Max retries reached. Message could not be sent.');
			}
		} else {
			console.log('Message sent successfully:', response);
		}
	});
}

// This is the actual function that gets called for each request and must
// decide whether or not we want to redirect.
function checkRedirects(details) {
	logCR('Received request details: ' + JSON.stringify(details));

	const tabId = details.tabId;
	logCR('Tab ID: ' + JSON.stringify(tabId));

	// We only allow GET requests to be redirected, don't want to accidentally redirect
	// sensitive POST parameters
	if (details.method != 'GET') {
		logCR('Request method is not GET: ' + details.method);
		return {};
	}
	logCR('Checking redirect for: ' + details.type + ': ' + details.url);

	var list = partitionedRedirects[details.type];
	if (!list) {
		logCR('No redirect rules found for type: ' + details.type);
		return {};
	}
	logCR('Redirect rules list: ' + JSON.stringify(list));

	var timestamp = ignoreNextRequest[details.url];
	if (timestamp) {
		logCR('Ignoring ' + details.url + ', was just redirected ' + (new Date().getTime() - timestamp) + 'ms ago');
		delete ignoreNextRequest[details.url];
		return {};
	}

	for (var i = 0; i < list.length; i++) {
		var r = list[i];
		logCR('Checking rule: ' + JSON.stringify(r));
		var result = r.getMatch(details.url);
		logCR('Match result for URL ' + details.url + ': ' + JSON.stringify(result));

		if (result.isMatch) {
			// Check if we're stuck in a loop where we keep redirecting this,
			// in that case ignore!
			var data = justRedirected[details.url];
			var threshold = 3000; // 3 seconds

			if (!data || ((new Date().getTime() - data.timestamp) > threshold)) { // Obsolete after 3 seconds
				justRedirected[details.url] = {
					timestamp: new Date().getTime(),
					count: 1
				};
				logCR('First redirection for ' + details.url + ', recording timestamp and count.');
			} else {
				data.count++;
				justRedirected[details.url] = data;
				logCR('Incremented redirection count for ' + details.url + ': ' + data.count);

				if (data.count >= redirectThreshold) {
					logCR('Ignoring ' + details.url + ' because it has been redirected ' + data.count + ' times in the last ' + threshold + 'ms');
					return {};
				}
			}

			logCR('Redirecting ' + details.url + ' ===> ' + result.redirectTo + ', type: ' + details.type + ', pattern: ' + r.includePattern + ', Rule: ' + r.description);
			if (enableNotifications) {
				logCR('Sending notification for redirection.');
				sendNotifications(r, details.url, result.redirectTo);
			}
			ignoreNextRequest[result.redirectTo] = new Date().getTime();
			logCR('Added ' + result.redirectTo + ' to ignoreNextRequest with timestamp ' + new Date().getTime());

			// Pass the type to queueRedirects for handling
			return queueRedirects(details.type, details.url, result.redirectTo, tabId);
		} else {
			logCR('No match for rule: ' + JSON.stringify(r) + ' for URL: ' + details.url);
		}
	}

	logCR('No matching redirect rule found for URL: ' + details.url);
	return {};
}

// Monitor changes in data, and setup everything again.
// This could probably be optimized to not do everything on every change
// but why bother?
function monitorChanges(changes, namespace) {
	logMC('Monitor changes called. Namespace: ' + namespace);
	logMC('Changes detected: ' + JSON.stringify(changes));

	if (changes.disabled) {
		logMC('Detected change in disabled status. New value: ' + changes.disabled.newValue);
		updateIcon();

		if (changes.disabled.newValue === true) {
			logMC('Disabling Redirector, removing listeners');
			chrome.webRequest.onBeforeRequest.removeListener(checkRedirects);
			chrome.webNavigation.onHistoryStateUpdated.removeListener(checkHistoryStateRedirects);
		} else {
			logMC('Enabling Redirector, setting up listeners');
			setUpRedirectListener();
		}
	}

	if (changes.redirects) {
		logMC('Redirects have changed. New redirects: ' + JSON.stringify(changes.redirects.newValue));
		logMC('Setting up redirect listener again');
		setUpRedirectListener();
	}

	if (changes.logging) {
		//		log.enabled = changes.log.newValue;
		logMC('logging settings have changed to: ' + changes.logging.newValue, true); // Always want this to be logged
	}

	if (changes.enableNotifications) {
		logMC('Notifications setting changed to: ' + changes.enableNotifications.newValue);
		enableNotifications = changes.enableNotifications.newValue;
	}
}

chrome.storage.onChanged.addListener(monitorChanges);

// Creates a filter to pass to the listener so we don't have to run through
// all the redirects for all the request types we don't have any redirects for anyway.
function createFilter(redirects) {
	logCF('Creating filter from redirects: ' + JSON.stringify(redirects));

	var types = [];
	for (var i = 0; i < redirects.length; i++) {
		var redirect = redirects[i];
		logCF('Processing redirect: ' + JSON.stringify(redirect));

		redirect.appliesTo.forEach(function (type) {
			// Added this condition below as part of fix for issue 115 https://github.com/einaregilsson/Redirector/issues/115
			// Firefox considers responsive web images request as imageset. Chrome doesn't.
			// Chrome throws an error for imageset type, so let's add to 'types' only for the values that chrome or firefox supports
			if (chrome.webRequest.ResourceType[type.toUpperCase()] !== undefined) {
				if (types.indexOf(type) === -1) {
					types.push(type);
					logCF('Adding supported type to filter: ' + type);
				}
			} else {
				logCF('Skipping unsupported type: ' + type);
			}
		});
	}
	types.sort();
	logCF('Filter types sorted: ' + JSON.stringify(types));

	var filter = {
		urls: ["https://*/*", "http://*/*"],
		types: types
	};
	logCF('Created filter: ' + JSON.stringify(filter));

	return filter;
}

// Creates partitioned redirects from the given redirects array.
function createPartitionedRedirects(redirects) {
	logCPR('Creating partitioned redirects from: ' + JSON.stringify(redirects));

	var partitioned = {};

	for (var i = 0; i < redirects.length; i++) {
		var redirect = new Redirect(redirects[i]);
		logCPR('Processing redirect: ' + JSON.stringify(redirect));
		redirect.compile();
		logCPR('Compiled redirect: ' + JSON.stringify(redirect));

		for (var j = 0; j < redirect.appliesTo.length; j++) {
			var requestType = redirect.appliesTo[j];
			logCPR('Processing request type: ' + requestType);

			if (partitioned[requestType]) {
				partitioned[requestType].push(redirect);
				logCPR('Added redirect to existing partition for request type: ' + requestType);
			} else {
				partitioned[requestType] = [redirect];
				logCPR('Created new partition for request type: ' + requestType);
			}
		}
	}

	logCPR('Partitioned redirects: ' + JSON.stringify(partitioned));
	return partitioned;
}

// Sets up the listener, partitions the redirects, creates the appropriate filters etc.
function setUpRedirectListener() {
	logSURL('Setting up redirect listener');

	// Unsubscribe first, in case there are changes...
	logSURL('Removing existing listeners');
	chrome.webRequest.onBeforeRequest.removeListener(checkRedirects);
	chrome.webNavigation.onHistoryStateUpdated.removeListener(checkHistoryStateRedirects);

	logSURL('Retrieving redirects from storage');
	storageArea.get({
		redirects: []
	}, function (obj) {
		var redirects = obj.redirects;
		logSURL('Retrieved redirects from storage: ' + JSON.stringify(redirects));

		if (redirects.length === 0) {
			logSURL('No redirects defined, not setting up listener');
			return;
		}

		logSURL('Partitioning redirects');
		partitionedRedirects = createPartitionedRedirects(redirects);
		logSURL('Partitioned redirects: ' + JSON.stringify(partitionedRedirects));

		logSURL('Creating filter');
		var filter = createFilter(redirects);
		logSURL('Created filter: ' + JSON.stringify(filter));

		logSURL('Setting filter for listener');
		// chrome.webRequest.onBeforeRequest.addListener(checkRedirects, filter, ["blocking"]); // Blocking is dead.
		chrome.webRequest.onBeforeRequest.addListener(checkRedirects, filter);
		logSURL('Added webRequest.onBeforeRequest listener with filter');

		if (partitionedRedirects.history) {
			logSURL('Adding HistoryState Listener');

			let historyFilter = {
				url: []
			};
			for (let r of partitionedRedirects.history) {
				let pattern = r._preparePattern(r.includePattern);
				historyFilter.url.push({
					urlMatches: pattern
				});
				logSURL('Prepared history state pattern for filter: ' + pattern);
			}
			logSURL('History state filter: ' + JSON.stringify(historyFilter));

			chrome.webNavigation.onHistoryStateUpdated.addListener(checkHistoryStateRedirects, historyFilter);
			logSURL('Added webNavigation.onHistoryStateUpdated listener with filter');
		} else {
			logSURL('No history state redirects defined');
		}
	});
}

// Redirect URLs on places like Facebook and Twitter who don't do real reloads, only do ajax updates and push a new URL to the address bar...
function checkHistoryStateRedirects(ev) {
	logCHSR('Checking history state redirect for event: ' + JSON.stringify(ev));

	ev.type = 'history';
	ev.method = 'GET';
	let result = checkRedirects(ev);
	logCHSR('Redirect check result: ' + JSON.stringify(result));

	if (result.redirectUrl) {
		logCHSR('Redirecting tab ' + ev.tabId + ' to URL: ' + result.redirectUrl);
		chrome.tabs.update(ev.tabId, {
			url: result.redirectUrl
		});
	} else {
		logCHSR('No redirect URL found for event: ' + JSON.stringify(ev));
	}
}

// Sets on/off badge, and for Chrome updates dark/light mode icon
function updateIcon() {
	logUpI('Updating icon');

	logUpI('Retrieving disabled status from storage');
	chrome.storage.local.get({
		disabled: false
	}, function (obj) {
		logUpI('Retrieved storage object: ' + JSON.stringify(obj));

		// Update icon based on dark/light mode
		if (!isFirefox) {
			if (isDarkMode()) {
				logUpI('Dark mode is enabled. Setting dark theme icon.');
				setIcon('icon-dark-theme');
			} else {
				logUpI('Light mode is enabled. Setting light theme icon.');
				setIcon('icon-light-theme');
			}
		} else {
			logUpI('Firefox detected. Skipping theme icon update.');
		}

		// Update badge and background color based on disabled status
		if (obj.disabled) {
			logUpI('Redirector is disabled. Setting badge to "off".');
			chrome.action.setBadgeText({
				text: 'off'
			});
			chrome.action.setBadgeBackgroundColor({
				color: '#fc5953'
			});
			if (chrome.action.setBadgeTextColor) { // Not supported in Chrome
				logUpI('Setting badge text color to white.');
				chrome.action.setBadgeTextColor({
					color: '#fafafa'
				});
			} else {
				logUpI('Badge text color setting is not supported in this browser.');
			}
		} else {
			logUpI('Redirector is enabled. Setting badge to "on".');
			chrome.action.setBadgeText({
				text: 'on'
			});
			chrome.action.setBadgeBackgroundColor({
				color: '#35b44a'
			});
			if (chrome.action.setBadgeTextColor) { // Not supported in Chrome
				logUpI('Setting badge text color to white.');
				chrome.action.setBadgeTextColor({
					color: '#fafafa'
				});
			} else {
				logUpI('Badge text color setting is not supported in this browser.');
			}
		}
	});
}

// Firefox doesn't allow the "content script" which is actually privileged
// to access the objects it gets from chrome.storage directly, so we
// proxy it through here.
chrome.runtime.onMessage.addListener(
	function (request, sender, sendResponse) {
		logCROA('Received background message: ' + JSON.stringify(request));

		if (request.type === 'get-redirects') {
			logCROA('Request type: get-redirects');
			logCROA('Retrieving redirects from storage');
			storageArea.get({
				redirects: []
			}, function (obj) {
				logCROA('Retrieved redirects from storage: ' + JSON.stringify(obj.redirects));
				sendResponse(obj);
				logCROA('Sent redirects to content page');
			});

		} else if (request.type === 'save-redirects') {
			logCROA('Request type: save-redirects');
			logCROA('Saving redirects. Count: ' + request.redirects.length);
			logCROA('Redirects to be saved: ' + JSON.stringify(request.redirects));
			delete request.type;
			storageArea.set({
				redirects: request.redirects
			}, function () {
				if (chrome.runtime.lastError) {
					if (chrome.runtime.lastError.message.indexOf("QUOTA_BYTES_PER_ITEM quota exceeded") > -1) {
						logCROA("Redirects failed to save. Size of redirects exceeds allowed limit per item by Sync.");
						sendResponse({
							message: "Redirects failed to save as size of redirects larger than what's allowed by Sync. Refer Help Page"
						});
					} else {
						logCROA('Error saving redirects: ' + chrome.runtime.lastError.message);
					}
				} else {
					logCROA('Finished saving redirects to storage');
					sendResponse({
						message: "Redirects saved"
					});
				}
			});

		} else if (request.type === 'update-icon') {
			logCROA('Request type: update-icon');
			updateIcon();
			logCROA('Icon update initiated');

		} else if (request.type === 'toggle-sync') {
			logCROA('Request type: toggle-sync');
			logCROA('Toggling sync to: ' + request.isSyncEnabled);

			delete request.type;
			chrome.storage.local.set({
				isSyncEnabled: request.isSyncEnabled
			}, function () {
				if (request.isSyncEnabled) {
					logCROA('Sync enabled. Checking size of redirects for Sync.');
					storageArea = chrome.storage.sync;
					logCROA('Storage area size for Sync is 5 MB but one object (redirects) can hold only ' + storageArea.QUOTA_BYTES_PER_ITEM / 1000000 + ' MB, which is ' + storageArea.QUOTA_BYTES_PER_ITEM + " bytes");

					chrome.storage.local.getBytesInUse("redirects", function (size) {
						logCROA('Size of redirects in local storage: ' + size + ' bytes');

						if (size > storageArea.QUOTA_BYTES_PER_ITEM) {
							logCROA('Size of redirects (' + size + ' bytes) exceeds Sync limit (' + storageArea.QUOTA_BYTES_PER_ITEM + ' bytes). Sync not possible.');
							storageArea = chrome.storage.local; // Reverting to local storage
							sendResponse({
								message: "Sync Not Possible - size of Redirects larger than what's allowed by Sync. Refer Help page"
							});
						} else {
							logCROA('Size of redirects is within Sync limit.');
							chrome.storage.local.get({
								redirects: []
							}, function (obj) {
								logCROA('Retrieved redirects from local storage: ' + JSON.stringify(obj.redirects));
								if (obj.redirects.length > 0) {
									logCROA('Moving redirects from Local to Sync Storage Area.');
									chrome.storage.sync.set({
										redirects: obj.redirects
									}, function () {
										logCROA('Redirects moved from Local to Sync Storage Area.');
										chrome.storage.local.remove("redirects", function () {
											logCROA('Redirects removed from Local storage.');
											setUpRedirectListener();
											sendResponse({
												message: "sync-enabled"
											});
										});
									});
								} else {
									logCROA('No redirects in Local storage. Just enabling Sync.');
									sendResponse({
										message: "sync-enabled"
									});
								}
							});
						}
					});

				} else {
					logCROA('Sync disabled. Moving redirects from Sync to Local Storage.');
					storageArea = chrome.storage.local;
					logCROA('Storage area size for Local is ' + storageArea.QUOTA_BYTES / 1000000 + ' MB, which is ' + storageArea.QUOTA_BYTES + ' bytes');

					chrome.storage.sync.get({
						redirects: []
					}, function (obj) {
						logCROA('Retrieved redirects from sync storage: ' + JSON.stringify(obj.redirects));
						if (obj.redirects.length > 0) {
							logCROA('Moving redirects from Sync to Local Storage Area.');
							chrome.storage.local.set({
								redirects: obj.redirects
							}, function () {
								logCROA('Redirects moved from Sync to Local Storage Area.');
								chrome.storage.sync.remove("redirects", function () {
									logCROA('Redirects removed from Sync storage.');
									setUpRedirectListener();
									sendResponse({
										message: "sync-disabled"
									});
								});
							});
						} else {
							sendResponse({
								message: "sync-disabled"
							});
						}
					});
				}
			});

		} else {
			logCROA('Unexpected message type: ' + JSON.stringify(request));
			return false;
		}

		return true; // This tells the browser to keep sendResponse alive because we're sending the response asynchronously.
	}
);

// Retrieve logging setting from storage
chrome.storage.local.get({
	logging: false
}, function (obj) {
	logCSLG('Retrieved logging setting from storage: ' + obj.logging);
	//	log.enabled = obj.logging;
});

// Retrieve sync setting from storage and configure storage area accordingly
chrome.storage.local.get({
	isSyncEnabled: false
}, function (obj) {
	logCSLG('Retrieved sync setting from storage: ' + obj.isSyncEnabled);
	if (obj.isSyncEnabled) {
		storageArea = chrome.storage.sync;
	} else {
		storageArea = chrome.storage.local;
	}
	// Now we know which storageArea to use, call setupInitial function
	setupInitial();
});

// First time setup
log('Starting initial setup...');

// Update icon based on current settings
updateIcon();
log('Icon update initiated during initial setup');

// Function to set up initial settings based on storage values
function setupInitial() {
	logSI('Setting up initial configuration...');

	// Retrieve notifications setting from storage
	chrome.storage.local.get({
		enableNotifications: false
	}, function (obj) {
		logSI('Retrieved enableNotifications setting from storage: ' + obj.enableNotifications);
		enableNotifications = obj.enableNotifications;
	});

	// Retrieve disabled status and set up redirect listener if not disabled
	chrome.storage.local.get({
		disabled: false
	}, function (obj) {
		logSI('Retrieved disabled status from storage: ' + obj.disabled);
		if (!obj.disabled) {
			logSI('Redirector is enabled. Setting up redirect listener.');
			setUpRedirectListener();
		} else {
			logSI('Redirector is disabled.');
		}
	});
}

log('Redirector starting up...');

// Below is a feature request by an user who wished to see visual indication for an Redirect rule being applied on URL 
// https://github.com/einaregilsson/Redirector/issues/72
// By default, we will have it as false. If user wishes to enable it from settings page, we can make it true until user disables it (or browser is restarted)

// Upon browser startup, just set enableNotifications to false.
// Listen to a message from Settings page to change this to true.
function sendNotifications(redirect, originalUrl, redirectedUrl) {
	logSN("Showing redirect success notification");

	// Determine the icon based on the dark mode setting
	let icon = isDarkMode() ? "images/icon-dark-theme-48.png" : "images/icon-light-theme-48.png";
	logSN('Notification icon selected: ' + icon);

	// Check the user agent to determine notification type
	let userAgent = navigator.userAgent.toLowerCase();
	let isChrome = userAgent.indexOf("chrome") > -1 && userAgent.indexOf("opr") < 0;

	if (isChrome) {
		logSN('User agent indicates Chrome browser. Using "list" type notifications.');

		// Prepare notification items for Chrome's "list" type
		var items = [{
			title: "Original page: ",
			message: originalUrl
        }, {
			title: "Redirected to: ",
			message: redirectedUrl
        }];
		var head = "Redirector - Applied rule : " + redirect.description;
		logSN('Notification details: title="' + head + '", items=' + JSON.stringify(items));

		chrome.notifications.create({
			type: "list",
			items: items,
			title: head,
			message: head,
			iconUrl: icon
		}, function (notificationId) {
			if (chrome.runtime.lastError) {
				logSN('Error creating notification: ' + chrome.runtime.lastError.message);
			} else {
				logSN('Notification created with ID: ' + notificationId);
			}
		});
	} else {
		logSN('User agent indicates non-Chrome browser. Using "basic" type notifications.');

		// Prepare notification message for other browsers
		var message = "Applied rule : " + redirect.description + " and redirected original page " + originalUrl + " to " + redirectedUrl;
		logSN('Notification details: title="Redirector", message="' + message + '"');

		chrome.notifications.create({
			type: "basic",
			title: "Redirector",
			message: message,
			iconUrl: icon
		}, function (notificationId) {
			if (chrome.runtime.lastError) {
				logSN('Error creating notification: ' + chrome.runtime.lastError.message);
			} else {
				logSN('Notification created with ID: ' + notificationId);
			}
		});
	}
}

chrome.runtime.onStartup.addListener(handleStartup);

function handleStartup() {
	logHS('Handling startup...');

	// Disable notifications and update storage
	enableNotifications = false;
	chrome.storage.local.set({
		enableNotifications: false
	}, function () {
		if (chrome.runtime.lastError) {
			logHS('Error setting enableNotifications to false: ' + chrome.runtime.lastError.message);
		} else {
			logHS('Successfully set enableNotifications to false in storage');
		}
	});

	// Update icon based on current dark/light mode settings
	updateIcon();
	logHS('Icon update initiated during startup');

	// Set up dark mode media query listener
	let darkModeMql = window.matchMedia('(prefers-color-scheme: dark)');
	darkModeMql.onchange = function () {
		logHS('Dark mode preference changed. Updating icon...');
		updateIcon();
	};
	logHS('Dark mode media query listener set up');
}
