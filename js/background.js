//This is the background script. It is responsible for actually redirecting requests,
//as well as monitoring changes in the redirects and the disabled status and reacting to them.

importScripts('redirect.js');
const RULE_ID_STORAGE_KEY = 'ruleIds';

function log(msg, force) {
	const now = new Date();
	const timeString = now.toISOString(); // Formats the time as an ISO string
	if (log.enabled || force) {
		console.log(timeString + ' REDIRECTOR: ' + msg);
	}
}

log.enabled = true;
var enableNotifications = false;

function isDarkMode() {
	log('Function isDarkMode is running.');

	return chrome.runtime.getPlatformInfo().then(platformInfo => platformInfo.isDarkMode);
}

var isFirefox = !!navigator.userAgent.match(/Firefox/i);



var storageArea = chrome.storage.local;
//Redirects partitioned by request type, so we have to run through
//the minimum number of redirects for each request.
var partitionedRedirects = {};

//Cache of urls that have just been redirected to. They will not be redirected again, to
//stop recursive redirects, and endless redirect chains.
//Key is url, value is timestamp of redirect.
var ignoreNextRequest = {

};

//url => { timestamp:ms, count:1...n};
var justRedirected = {

};
var redirectThreshold = 3;

function setIcon(image) {
	log('function setIcon is running.');
	var data = {
		path: {}
	};

	for (let nr of [16, 19, 32, 38, 48, 64, 128]) {
		data.path[nr] = `images/${image}-${nr}.png`;
	}

	chrome.action.setIcon(data, function () {
		var err = chrome.runtime.lastError;
		if (err) {
			//If not checked we will get unchecked errors in the background page console...
			log('Error in SetIcon: ' + err.message);
		}
	});
}

//This is the actual function that gets called for each request and must
//decide whether or not we want to redirect.
function checkRedirects(details) {
	log('function checkRedirects is running.');

	//We only allow GET request to be redirected, don't want to accidentally redirect
	//sensitive POST parameters
	if (details.method !== 'GET') {
		return {};
	}

	log('Checking: ' + details.type + ': ' + details.url);

	var list = partitionedRedirects[details.type];
	if (!list) {
		log('No list for type: ' + details.type);
		return {};
	}

	var timestamp = ignoreNextRequest[details.url];
	if (timestamp) {
		log('Ignoring ' + details.url + ', was just redirected ' + (new Date().getTime() - timestamp) + 'ms ago');
		delete ignoreNextRequest[details.url];
		return {};
	}

	for (var i = 0; i < list.length; i++) {
		var r = list[i];
		if (r.disabled) {
			continue; // Skip disabled rules
		}
		if (r.excludePattern && new RegExp(r.excludePattern).test(details.url)) {
			continue; // Skip excluded URLs
		}
		var result = r.getMatch(details.url);

		if (result.isMatch) {
			// Check if we're stuck in a loop where we keep redirecting this, in that case ignore!
			var data = justRedirected[details.url];
			var threshold = 3000;
			if (!data || ((new Date().getTime() - data.timestamp) > threshold)) { // Obsolete after 3 seconds
				justRedirected[details.url] = {
					timestamp: new Date().getTime(),
					count: 1
				};
			} else {
				data.count++;
				justRedirected[details.url] = data;
				if (data.count >= redirectThreshold) {
					log('Ignoring ' + details.url + ' because we have redirected it ' + data.count + ' times in the last ' + threshold + 'ms');
					return {};
				}
			}

			log('Redirecting ' + details.url + ' ===> ' + result.redirectTo + ', type: ' + details.type + ', pattern: ' + r.includePattern + ' which is in Rule : ' + r.description);
			if (enableNotifications) {
				sendNotifications(r, details.url, result.redirectTo);
			}
			ignoreNextRequest[result.redirectTo] = new Date().getTime();

			// Log the rule for debugging
			log('Redirect rule: ' + JSON.stringify({
				id: r.id,
				priority: 1,
				action: {
					type: 'redirect',
					redirect: {
						url: result.redirectTo
					}
				},
				condition: {
					urlFilter: r.includePattern,
					resourceTypes: [details.type]
				}
			}));

			return {
				redirectUrl: result.redirectTo
			};
		}
	}

	return {};
}

//Monitor changes in data, and setup everything again.
//This could probably be optimized to not do everything on every change
//but why bother?
function monitorChanges(changes, namespace) {
	log('monitorChanges is running.');
	if (changes.disabled) {
		updateIcon();

		if (changes.disabled.newValue == true) {
			log('Disabling Redirector, removing rules');
			chrome.storage.local.get(RULE_ID_STORAGE_KEY, function (result) {
				var existingIds = result[RULE_ID_STORAGE_KEY] || [];
				chrome.declarativeNetRequest.updateDynamicRules({
					removeRuleIds: existingIds
				}, function () {
					if (chrome.runtime.lastError) {
						log('Error removing rules: ' + chrome.runtime.lastError.message);
					}
				});
			});
		} else {
			log('Enabling Redirector, setting up listener');
			setUpRedirectListener();
		}
	}

	if (changes.redirects) {
		log('Redirects have changed, setting up listener again');
		setUpRedirectListener();
	}

	if (changes.logging) {
		log.enabled = changes.logging.newValue;
		log('Logging settings have changed to ' + changes.logging.newValue, true);
	}
	if (changes.enableNotifications) {
		log('notifications setting changed to ' + changes.enableNotifications.newValue);
		enableNotifications = changes.enableNotifications.newValue;
	}
}

chrome.storage.onChanged.addListener(monitorChanges);

//Creates a filter to pass to the listener so we don't have to run through
//all the redirects for all the request types we don't have any redirects for anyway.
function createFilter(redirects) {
	log('function createFilter is running.');
	var types = [];
	var supportedTypes = new Set(Object.keys(chrome.declarativeNetRequest.ResourceType));

	for (var i = 0; i < redirects.length; i++) {
		redirects[i].appliesTo.forEach(function (type) {
			// Check if the type is supported by declarativeNetRequest
			if (supportedTypes.has(type.toUpperCase())) {
				if (types.indexOf(type) == -1) {
					types.push(type);
				}
			}
		});
	}
	types.sort();

	// Returning the same structure for compatibility
	return {
		urls: ["https://*/*", "http://*/*"],
		types: types
	};
}

function createPartitionedRedirects(redirects) {
	log('function createPartitionedRedirects is running.');
	var partitioned = {};

	for (var i = 0; i < redirects.length; i++) {
		var redirect = new Redirect(redirects[i]);
		redirect.compile();
		for (var j = 0; j < redirect.appliesTo.length; j++) {
			var requestType = redirect.appliesTo[j];
			if (partitioned[requestType]) {
				partitioned[requestType].push(redirect);
			} else {
				partitioned[requestType] = [redirect];
			}
		}
	}

	log('partitioned: ' + JSON.stringify(partitioned));
	return partitioned;
}

async function setUpRedirectListener() {
	log('setUpRedirectListener is running.');

	// Get existing redirects from storage
	chrome.storage.local.get({
		redirects: []
	}, function (obj) {
		const redirects = obj.redirects.map(o => new Redirect(o)); // Instantiate Redirect objects

		if (redirects.length === 0) {
			log('No redirects defined, not setting up listener');
			return;
		}

		// Filter out disabled redirects
		const enabledRedirects = redirects.filter(redirect => !redirect.disabled);

		if (enabledRedirects.length === 0) {
			log('No enabled redirects defined, not setting up listener');
			return;
		}

		// Partition redirects by request type
		const partitionedRedirects = createPartitionedRedirects(enabledRedirects);

		// Initialize a counter for generating unique IDs
		let ruleIdCounter = 1;

		// Construct declarative rules for declarativeNetRequest API
		const rules = [];
		const ruleIdsToRemove = [];
		for (const requestType in partitionedRedirects) {
			log('for (const requestType in partitionedRedirects) has been reached.');
			if (partitionedRedirects.hasOwnProperty(requestType)) {
				const redirectsForType = partitionedRedirects[requestType];
				redirectsForType.forEach(redirect => {
					if (!redirect.id) { // Assign a new ID if it doesn't exist
						redirect.id = ruleIdCounter++;
					}
					ruleIdsToRemove.push(redirect.id);
					rules.push({
						id: redirect.id, // Use the ID from redirect
						priority: 1,
						action: {
							type: 'redirect',
							redirect: {
								url: redirect.redirectUrl
							}
						},
						condition: {
							urlFilter: redirect.includePattern,
							resourceTypes: redirect.appliesTo || ['main_frame']
						}
					});
				});
			}
		}

		// Remove existing rules
		chrome.declarativeNetRequest.updateDynamicRules({
			removeRuleIds: ruleIdsToRemove
		}, function () {
			if (chrome.runtime.lastError) {
				console.error('Error removing rules:', chrome.runtime.lastError.message);
			} else {
				log('Rules removed successfully.');

				// Add new rules
				chrome.declarativeNetRequest.updateDynamicRules({
					addRules: rules
				}, function () {
					if (chrome.runtime.lastError) {
						console.error('Error adding rules:', chrome.runtime.lastError.message);
					} else {
						log('Rules added successfully.');
					}
				});
			}
		});

		// Set up history state updated listener if applicable
		if (partitionedRedirects.history) {
			log('Adding HistoryState Listener');
			const historyFilter = {
				url: []
			};
			for (const redirect of partitionedRedirects.history) {
				historyFilter.url.push({
					urlMatches: redirect._preparePattern(redirect.includePattern)
				});
			}
			chrome.webNavigation.onHistoryStateUpdated.addListener(checkHistoryStateRedirects, historyFilter);
		}
	});
}

////Sets up the listener, partitions the redirects, creates the appropriate filters etc.
//function setUpRedirectListener() {
//
//	chrome.webRequest.onBeforeRequest.removeListener(checkRedirects); //Unsubscribe first, in case there are changes...
//	chrome.webNavigation.onHistoryStateUpdated.removeListener(checkHistoryStateRedirects);
//
//	storageArea.get({
//		redirects: []
//	}, function (obj) {
//		var redirects = obj.redirects;
//		if (redirects.length == 0) {
//			log('No redirects defined, not setting up listener');
//			return;
//		}
//
//		partitionedRedirects = createPartitionedRedirects(redirects);
//		var filter = createFilter(redirects);
//
//		log('Setting filter for listener: ' + JSON.stringify(filter));
//		chrome.webRequest.onBeforeRequest.addListener(checkRedirects, filter, ["blocking"]);
//
//		if (partitionedRedirects.history) {
//			log('Adding HistoryState Listener');
//
//			let filter = {
//				url: []
//			};
//			for (let r of partitionedRedirects.history) {
//				filter.url.push({
//					urlMatches: r._preparePattern(r.includePattern)
//				});
//			}
//			chrome.webNavigation.onHistoryStateUpdated.addListener(checkHistoryStateRedirects, filter);
//		}
//	});
//}

//Redirect urls on places like Facebook and Twitter who don't do real reloads, only do ajax updates and push a new url to the address bar...
function checkHistoryStateRedirects(ev) {
	log('function checkHistoryStateRedirects is running.');

	ev.type = 'history';
	ev.method = 'GET';
	let result = checkRedirects(ev);
	if (result.redirectUrl) {
		chrome.tabs.update(ev.tabId, {
			url: result.redirectUrl
		});
	}
}

//Sets on/off badge, and for Chrome updates dark/light mode icon
function updateIcon() {
	log('function updateIcon is running.');
	chrome.storage.local.get({
		disabled: false
	}, function (obj) {

		//Do this here so even in Chrome we get the icon not too long after an dark/light mode switch...
		if (!isFirefox) {
			if (isDarkMode()) {
				setIcon('icon-dark-theme');
			} else {
				setIcon('icon-light-theme');
			}
		}

		if (obj.disabled) {
			chrome.action.setBadgeText({
				text: 'off'
			});
			chrome.action.setBadgeBackgroundColor({
				color: '#fc5953'
			});
			if (chrome.action.setBadgeTextColor) { //Not supported in Chrome
				chrome.action.setBadgeTextColor({
					color: '#fafafa'
				});
			}
		} else {
			chrome.action.setBadgeText({
				text: 'on'
			});
			chrome.action.setBadgeBackgroundColor({
				color: '#35b44a'
			});
			if (chrome.action.setBadgeTextColor) { //Not supported in Chrome
				chrome.action.setBadgeTextColor({
					color: '#fafafa'
				});
			}
		}
	});
}


//Firefox doesn't allow the "content script" which is actually privileged
//to access the objects it gets from chrome.storage directly, so we
//proxy it through here.
chrome.runtime.onMessage.addListener(
	function (request, sender, sendResponse) {
		log('croa is running');
		log('Received background message: ' + JSON.stringify(request));
		if (request.type == 'get-redirects') {
			log('Getting redirects from storage');
			storageArea.get({
				redirects: []
			}, function (obj) {
				log('Got redirects from storage: ' + JSON.stringify(obj));
				sendResponse(obj);
				log('Sent redirects to content page');
			});
		} else if (request.type == 'save-redirects') {
			console.log('Saving redirects, count=' + request.redirects.length);
			delete request.type;
			storageArea.set(request, function (a) {
				if (chrome.runtime.lastError) {
					if (chrome.runtime.lastError.message.indexOf("QUOTA_BYTES_PER_ITEM quota exceeded") > -1) {
						log("Redirects failed to save as size of redirects larger than allowed limit per item by Sync");
						sendResponse({
							message: "Redirects failed to save as size of redirects larger than what's allowed by Sync. Refer Help Page"
						});
					}
				} else {
					log('Finished saving redirects to storage');
					sendResponse({
						message: "Redirects saved"
					});
				}
			});
		} else if (request.type == 'update-icon') {
			updateIcon();
		} else if (request.type == 'toggle-sync') {
			// Notes on Toggle Sync feature here https://github.com/einaregilsson/Redirector/issues/86#issuecomment-389943854
			// This provides for feature request - issue 86
			delete request.type;
			log('toggling sync to ' + request.isSyncEnabled);
			// Setting for Sync enabled or not, resides in Local.
			chrome.storage.local.set({
					isSyncEnabled: request.isSyncEnabled
				},
				function () {
					if (request.isSyncEnabled) {
						storageArea = chrome.storage.sync;
						log('storageArea size for sync is 5 MB but one object (redirects) is allowed to hold only ' + storageArea.QUOTA_BYTES_PER_ITEM / 1000000 + ' MB, that is .. ' + storageArea.QUOTA_BYTES_PER_ITEM + " bytes");
						chrome.storage.local.getBytesInUse("redirects",
							function (size) {
								log("size of redirects is " + size + " bytes");
								if (size > storageArea.QUOTA_BYTES_PER_ITEM) {
									log("size of redirects " + size + " is greater than allowed for Sync which is " + storageArea.QUOTA_BYTES_PER_ITEM);
									// Setting storageArea back to Local.
									storageArea = chrome.storage.local;
									sendResponse({
										message: "Sync Not Possible - size of Redirects larger than what's allowed by Sync. Refer Help page"
									});
								} else {
									chrome.storage.local.get({
										redirects: []
									}, function (obj) {
										//check if at least one rule is there.
										if (obj.redirects.length > 0) {
											chrome.storage.sync.set(obj, function (a) {
												log('redirects moved from Local to Sync Storage Area');
												//Remove Redirects from Local storage
												chrome.storage.local.remove("redirects");
												// Call setupRedirectListener to setup the redirects 
												setUpRedirectListener();
												sendResponse({
													message: "sync-enabled"
												});
											});
										} else {
											log('No redirects are setup currently in Local, just enabling Sync');
											sendResponse({
												message: "sync-enabled"
											});
										}
									});
								}
							});
					} else {
						storageArea = chrome.storage.local;
						log('storageArea size for local is ' + storageArea.QUOTA_BYTES / 1000000 + ' MB, that is .. ' + storageArea.QUOTA_BYTES + " bytes");
						chrome.storage.sync.get({
							redirects: []
						}, function (obj) {
							if (obj.redirects.length > 0) {
								chrome.storage.local.set(obj, function (a) {
									log('redirects moved from Sync to Local Storage Area');
									//Remove Redirects from sync storage
									chrome.storage.sync.remove("redirects");
									// Call setupRedirectListener to setup the redirects 
									setUpRedirectListener();
									sendResponse({
										message: "sync-disabled"
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
			log('Unexpected message: ' + JSON.stringify(request));
			return false;
		}

		return true; //This tells the browser to keep sendResponse alive because
		//we're sending the response asynchronously.
	}
);


//First time setup
updateIcon();

async function getFromStorage(keys) {
	return new Promise((resolve, reject) => {
		chrome.storage.local.get(keys, (result) => {
			if (chrome.runtime.lastError) {
				reject(new Error(chrome.runtime.lastError.message));
			} else {
				resolve(result);
			}
		});
	});
}

async function saveToStorage(items) {
	return new Promise((resolve, reject) => {
		chrome.storage.local.set(items, () => {
			if (chrome.runtime.lastError) {
				reject(new Error(chrome.runtime.lastError.message));
			} else {
				resolve();
			}
		});
	});
}

async function setupInitial() {
	log('setupInitial is running.');
	try {
		var {
			enableNotifications
		} = await getFromStorage({
			enableNotifications: false
		});
		if (enableNotifications !== undefined) {
			enableNotifications = enableNotifications;
		}

		var {
			disabled
		} = await getFromStorage({
			disabled: false
		});
		if (!disabled) {
			await setUpRedirectListener();
		} else {
			log('Redirector is disabled');
		}
	} catch (error) {
		log('Error in setupInitial: ' + error.message);
	}
}

setupInitial();

log('Redirector starting up...');


// Below is a feature request by an user who wished to see visual indication for an Redirect rule being applied on URL 
// https://github.com/einaregilsson/Redirector/issues/72
// By default, we will have it as false. If user wishes to enable it from settings page, we can make it true until user disables it (or browser is restarted)

// Upon browser startup, just set enableNotifications to false.
// Listen to a message from Settings page to change this to true.
function sendNotifications(redirect, originalUrl, redirectedUrl) {
	//var message = "Applied rule : " + redirect.description + " and redirected original page " + originalUrl + " to " + redirectedUrl;
	log("Showing redirect success notification");
	//Firefox and other browsers does not yet support "list" type notification like in Chrome.
	// Console.log(JSON.stringify(chrome.notifications)); -- This will still show "list" as one option but it just won't work as it's not implemented by Firefox yet
	// Can't check if "chrome" typeof either, as Firefox supports both chrome and browser namespace.
	// So let's use useragent. 
	// Opera UA has both chrome and OPR. So check against that ( Only chrome which supports list) - other browsers to get BASIC type notifications.

	let icon = isDarkMode() ? "images/icon-dark-theme-48.png" : "images/icon-light-theme-48.png";

	if (navigator.userAgent.toLowerCase().indexOf("chrome") > -1 && navigator.userAgent.toLowerCase().indexOf("opr") < 0) {

		var items = [{
			title: "Original page: ",
			message: originalUrl
		}, {
			title: "Redirected to: ",
			message: redirectedUrl
		}];
		var head = "Redirector - Applied rule : " + redirect.description;
		chrome.notifications.create({
			type: "list",
			items: items,
			title: head,
			message: head,
			iconUrl: icon
		});
	} else {
		var message = "Applied rule : " + redirect.description + " and redirected original page " + originalUrl + " to " + redirectedUrl;

		chrome.notifications.create({
			type: "basic",
			title: "Redirector",
			message: message,
			iconUrl: icon
		});
	}
}

chrome.runtime.onStartup.addListener(handleStartup);

function handleStartup() {
	log('handleStartup is running.');
	enableNotifications = false;
	chrome.storage.local.set({
		enableNotifications: false
	});

	updateIcon(); //To set dark/light icon...

	//This doesn't work yet in Chrome, but we'll put it here anyway, in case it starts working...
	let darkModeMql = window.matchMedia('(prefers-color-scheme: dark)');
	darkModeMql.onchange = updateIcon;
}
