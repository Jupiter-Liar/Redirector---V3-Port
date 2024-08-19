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

function logPR(msg, force) {
	if (logPR.enabled || log.enabled || force) {
		log(msg, true, "CPR");
	}
}

function logSUDR(msg, force) {
	if (logSUDR.enabled || log.enabled || force) {
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

log.enabled = true; // Master switch to enable logging. If enabled, ALL logs will be printed.

// What follows are switches for individual functions and sections, since the amount of logging has gone way up.
logPreRL.enabled = true; // Logging for functions before redirection logic
logQR.enabled = true; // Logging for queueRedirects
logSRM.enabled = true; // Logging for sendRequestMessages
logCR.enabled = true; // Logging for checkRedirects
logMC.enabled = true; // Logging for monitorChanges
logCF.enabled = true; // Logging for createFilters
logPR.enabled = true; // Logging for processRedirects (formerly createPartitionedRedirects)
logSUDR.enabled = true; // Logging for setUpDeclarativeRedirects (formerly setUpRedirectListener)
logCHSR.enabled = false; // Logging for checkHistoryStateRedirects
logUpI.enabled = false; // Logging for updateIcon
logCROA.enabled = false; // Logging for chrome.runtime.onMessage.addListener
logCSLG.enabled = false; // Logging for two chrome.storage.local.get operations
logSI.enabled = false; // Logging for setupInitial
logSN.enabled = false; // Logging for sendNotifications
logHS.enabled = true; // Logging for handleStartup
var enableNotifications = false;

function isDarkMode() {
	logPreRL('Function isDarkMode is running.');

	return chrome.runtime.getPlatformInfo().then(platformInfo => platformInfo.isDarkMode);
}

var isFirefox = !!navigator.userAgent.match(/Firefox/i);
logPreRL('Browser detected: ' + (isFirefox ? 'Firefox' : 'Not Firefox'));

var storageArea = chrome.storage.local;
logPreRL('Initialized storage area');

// Redirects for basic declarative rules
var processedRedirects = {};
// Redirects for history state
var processedHistoryRedirects = {};

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
		data.path[nr] = `../images/${image}-${nr}.png`;
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

// This function was once responsible for all requests. Now it only pertains to history state redirects
function checkRedirects(details) {

	logCR('Received request details: ' + JSON.stringify(details));

	const tabId = details.tabId;
	logCR('Tab ID: ' + JSON.stringify(tabId));

	// Ignore requests during the prerender lifecycle phase
	if (details.documentLifecycle === 'prerender') {
		logCR('Request during prerender phase, ignoring.');
		return {};
	}

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
			// in that case 																												ignore!
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
			//			chrome.webRequest.onBeforeRequest.removeListener(checkRedirects);
			chrome.webNavigation.onHistoryStateUpdated.removeListener(checkHistoryStateRedirects);
		} else {
			logMC('Enabling Redirector, setting up listeners');
			setUpDeclarativeRedirects();
		}
	}

	if (changes.redirects) {
		logMC('Redirects have changed. New redirects: ' + JSON.stringify(changes.redirects.newValue));
		logMC('Setting up redirect listener again');
		setUpDeclarativeRedirects();
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
//function createFilter(redirects) {
//	logCF('Creating filter from redirects: ' + JSON.stringify(redirects));
//
//	var types = [];
//	for (var i = 0; i < redirects.length; i++) {
//		var redirect = redirects[i];
//		logCF('Processing redirect: ' + JSON.stringify(redirect));
//
//		redirect.appliesTo.forEach(function (type) {
//			// Added this condition below as part of fix for issue 115 https://github.com/einaregilsson/Redirector/issues/115
//			// Firefox considers responsive web images request as imageset. Chrome doesn't.
//			// Chrome throws an error for imageset type, so let's add to 'types' only for the values that chrome or firefox supports
//			if (chrome.webRequest.ResourceType[type.toUpperCase()] !== undefined) {
//				if (types.indexOf(type) === -1) {
//					types.push(type);
//					logCF('Adding supported type to filter: ' + type);
//				}
//			} else {
//				logCF('Skipping unsupported type: ' + type);
//			}
//		});
//	}
//	types.sort();
//	logCF('Filter types sorted: ' + JSON.stringify(types));
//
//	var filter = {
//		urls: ["https://*/*", "http://*/*"],
//		types: types
//	};
//	logCF('Created filter: ' + JSON.stringify(filter));
//
//	return filter;
//}


//A backup copy of createPartitionedRedirects, in case I break something and need to revert.

// Creates partitioned redirects from the given redirects array.
//function createPartitionedRedirects(redirects) {
//	logCPR('Creating partitioned redirects from: ' + JSON.stringify(redirects));
//
//	var partitioned = {};
//
//	for (var i = 0; i < redirects.length; i++) {
//		var redirect = new Redirect(redirects[i]);
//		logCPR('Processing redirect: ' + JSON.stringify(redirect));
//		redirect.compile();
//		logCPR('Compiled redirect: ' + JSON.stringify(redirect));
//
//		if (redirect.disabled) {
//			logCPR('Redirect is disabled, skipping: ' + JSON.stringify(redirect));
//			continue; // Skip this redirect if it is disabled
//		}
//
//		for (var j = 0; j < redirect.appliesTo.length; j++) {
//			var requestType = redirect.appliesTo[j];
//			logCPR('Processing request type: ' + requestType);
//
//			if (partitioned[requestType]) {
//				partitioned[requestType].push(redirect);
//				logCPR('Added redirect to existing partition for request type: ' + requestType);
//			} else {
//				partitioned[requestType] = [redirect];
//				logCPR('Created new partition for request type: ' + requestType);
//			}
//		}
//	}
//
//	logCPR('Partitioned redirects: ' + JSON.stringify(partitioned));
//	return partitioned;
//}

// Processes redirects retrieved by setUpDeclarativeRedirects
// Formerly known as createPartitionedRedirects
function processRedirects(redirects) {
	logPR('Creating partitioned redirects from: ' + JSON.stringify(redirects));

	// One array is for rules without exceptions, and the other is for rules with.
	var processed = [];
	var processedExceptions = [];
	var processedH = [];

	for (var i = 0; i < redirects.length; i++) {
		var redirect = new Redirect(redirects[i]);

		if (redirect.disabled) {
			logPR('Redirect is disabled, skipping: ' + JSON.stringify(redirect));
			continue; // Skip this redirect if it is disabled
		}

		//		logPR('Redirect: ' + redirect);

		logPR('Processing redirect: ' + JSON.stringify(redirect));
		redirect = redirect.compileB();
		logPR('Compiled redirect: ' + JSON.stringify(redirect));

		// Check if compiledRedirect is an array
		if (Array.isArray(redirect)) {
			// Use spread operator to add all elements of redirect to partitioned
			processedExceptions.unshift(...redirect);
		} else {
			// Add single compiledRedirect to partitioned
			processed.unshift(redirect);
		}
	}

	for (var i = 0; i < redirects.length; i++) {
		var redirect = new Redirect(redirects[i]);

		if (redirect.disabled) {
			logPR('Redirect is disabled, skipping: ' + JSON.stringify(redirect));
			continue; // Skip this redirect if it is disabled
		}

		if (!redirect.appliesTo.includes('history')) {
			logPR('Redirect does not apply to history, skipping: ' + JSON.stringify(redirect));
			continue; // Skip this redirect if "history" is not included
		}

		//		logPR('Redirect: ' + redirect);

		logPR('Applied history redirect: ' + JSON.stringify(redirect));

		processedH.push(redirect);
	}

	logPR('Processed redirects: ' + JSON.stringify(processed));
	logPR('Processed redirects with exceptions: ' + JSON.stringify(processedExceptions));
	logPR('Processed history redirects: ' + JSON.stringify(processedH));

	// Rules with exceptions come first, so they will have lower priorities and will not interfere with rules that have no exceptions. The whole array is in order from lowest priority to highest.
	processed = processedExceptions.concat(processed);

	logPR('Processed redirects combined: ' + JSON.stringify(processed, null, 2));
	return {
		processed,
		processedH
	};
}

// Pulls the rules from storage and sets up declarative redirects.
// Formerly known as setUpRedirectListener
function setUpDeclarativeRedirects() {
	//	logSUDR('Setting up redirect listener');

	// Unsubscribe first, in case there are changes...
	//	logSUDR('Removing existing listeners');
	// chrome.webRequest.onBeforeRequest.removeListener(checkRedirects);
	chrome.webNavigation.onHistoryStateUpdated.removeListener(checkHistoryStateRedirects);

	logSUDR('Retrieving redirects from storage');
	storageArea.get({
		redirects: []
	}, function (obj) {
		var redirects = obj.redirects;
		logSUDR('Retrieved redirects from storage: ' + JSON.stringify(redirects));

		if (redirects.length === 0) {
			logSUDR('No redirects defined, not setting up listener');
			return;
		}

		logSUDR('Processing redirects');

		//		// Destructure the result and assign to existing variables
		//		var {
		//			processed: tempProcessed,
		//			processedH: tempProcessedH
		//		} = processRedirects(redirects);
		//
		//		// Assign to already declared variables
		//		processedRedirects = tempProcessed;
		//		processedHistoryRedirects = tempProcessedH;

		// Destructure the result and assign to existing variables
		({
			processed: processedRedirects,
			processedH: processedHistoryRedirects
		} = processRedirects(redirects));

		logSUDR('Processed redirects: ' + JSON.stringify(processedRedirects));
		logSUDR('Processed history redirects: ' + JSON.stringify(processedHistoryRedirects));

		//		logSUDR('Creating filter');
		//		var filter = createFilter(redirects);
		//		logSUDR('Created filter: ' + JSON.stringify(filter));

		//		logSUDR('Setting filter for listener');
		// chrome.webRequest.onBeforeRequest.addListener(checkRedirects, filter, ["blocking"]); // Blocking is dead.
		//		chrome.webRequest.onBeforeRequest.addListener(checkRedirects, filter);
		//		logSUDR('Added webRequest.onBeforeRequest listener with filter');

		// Process each partitioned redirect
		let allRules = [];

		processedRedirects.forEach((redirect, index) => {
			// Ensure resourceTypes only contains allowed values
			if (redirect.condition && redirect.condition.resourceTypes) {
				redirect.condition.resourceTypes = filterResourceTypes(redirect.condition.resourceTypes);
			}

			// Validate the rule
			if (!validateRule(redirect)) {
				logSUDR('Invalid rule discarded: ' + JSON.stringify(redirect));
				return; // Skip invalid rules
			}

			// Check if regexSubstitution is empty and replace it with "about:blank"
			// This fixes an error where broken rules prevent changes.
			if (redirect.action && redirect.action.type === "redirect") {
				if (!redirect.action.redirect.regexSubstitution) {
					redirect.action.redirect.regexSubstitution = "about:blank";
				}
			}

			// Assign a unique ID for each rule
			redirect.id = allRules.length + 1;
			redirect.priority = redirect.id;

			allRules.push(redirect);
		});

		logSUDR('Formatted rules for declarativeNetRequest: ' + JSON.stringify(allRules));

		//		// Update the declarativeNetRequest rules
		//		chrome.declarativeNetRequest.updateDynamicRules({
		//			removeRuleIds: allRules.map(rule => rule.id),
		//			addRules: allRules
		//		}, () => {
		//			if (chrome.runtime.lastError) {
		//				logSUDR('Error setting up redirect listener: ' + chrome.runtime.lastError.message);
		//			} else {
		//				logSUDR('Redirect listener setup completed with all rules applied.');
		//			}
		//		});

		// Function to apply rules and handle errors
		function applyRules(rules) {
			// Create a list of promises for removing existing rules
			let removeRulesPromise = new Promise((resolve, reject) => {
				chrome.declarativeNetRequest.updateDynamicRules({
					removeRuleIds: rules.map(rule => rule.id) // Remove all existing rules
				}, () => {
					if (chrome.runtime.lastError) {
						logSUDR('Error removing existing rules: ' + chrome.runtime.lastError.message);
						reject(new Error(chrome.runtime.lastError.message));
					} else {
						resolve();
					}
				});
			});

			// Create a list of promises for applying each rule
			let applyRulePromises = rules.map(rule => new Promise((resolve, reject) => {
				chrome.declarativeNetRequest.updateDynamicRules({
					addRules: [rule]
				}, () => {
					if (chrome.runtime.lastError) {
						logSUDR(`Error applying rule with id ${rule.id}: ${chrome.runtime.lastError.message}`);
						reject(new Error(chrome.runtime.lastError.message));
					} else {
						logSUDR(`Rule with id ${rule.id} applied successfully.`);
						resolve(rule.id); // Resolve with the rule id
					}
				});
			}));

			// Wait for all promises to complete
			Promise.all([removeRulesPromise, ...applyRulePromises])
				.then((results) => {
					// results contains the ids of successfully applied rules
					let appliedRules = results.slice(1); // Exclude the removeRulesPromise result
					logSUDR(`Applied rules: ${JSON.stringify(appliedRules)}`);
				})
				.catch((error) => {
					logSUDR(`Error during rule application: ${error.message}`);
				});
		}

		// Function to get the problematic rule ID from the error message
		function getProblematicRuleId(errorMessage) {
			// Extract the rule ID from the error message if possible (assuming the error message includes this info)
			const match = errorMessage.match(/rule with ID (\d+)/);
			return match ? parseInt(match[1], 10) : null;
		}

		// Start the rule application process
		applyRules(allRules);

		if (Array.isArray(processedHistoryRedirects)) {
			logSUDR('processedHistoryRedirects is an array.');
		}

		if (processedHistoryRedirects.some(redirect => redirect.appliesTo.includes('history'))) {
			logSUDR('Adding HistoryState Listener');

			let historyFilter = {
				url: []
			};

			for (let r of processedHistoryRedirects) {
				// Check if `appliesTo` includes 'history'
				let pattern = r._preparePattern(r.includePattern);
				historyFilter.url.push({
					urlMatches: pattern
				});
				logSUDR('Prepared history state pattern for filter: ' + pattern);
			}

			logSUDR('History state filter: ' + JSON.stringify(historyFilter));

			chrome.webNavigation.onHistoryStateUpdated.addListener(checkHistoryStateRedirects, historyFilter);
			logSUDR('Added webNavigation.onHistoryStateUpdated listener with filter');
		} else {
			logSUDR('No history state redirects defined');
		}
	});
}

// Function to filter resource types
function filterResourceTypes(resourceTypes) {
	const allowedResourceTypes = [
                'csp_report',
                'font',
                'image',
                'main_frame',
                'media',
                'object',
                'other',
                'ping',
                'script',
                'stylesheet',
                'sub_frame',
                'webbundle',
                'websocket',
                'webtransport',
                'xmlhttprequest'
            ];
	return resourceTypes.filter(type => allowedResourceTypes.includes(type));
}

// This creates a trigger, where if a rule is found to be invalid and the very next rule is of the type "allow" — which means it was the exception to the invalid rule — this "allow" rule is also invalidated.
let allowKick = false;
// This switch resets allowKick at the appropriate moment. Shouldn't be necessary, but in case the script changes, it could become useful.
let allowKickReset = false;

function validateRule(rule) {
	let valid = true;

	// Check if `rule` is an object
	if (typeof rule !== 'object' || rule === null) {
		logSUDR('Invalid rule structure: Rule is not an object.');
		valid = false;
	}

	// Check `condition` field
	if (typeof rule.condition !== 'object' || rule.condition === null) {
		logSUDR('Invalid rule: `condition` is not an object.');
		valid = false;
	} else {
		// Check `regexFilter` and `urlFilter`
		if (typeof rule.condition.regexFilter !== 'string' && typeof rule.condition.urlFilter !== 'string') {
			logSUDR('Invalid rule: `condition.regexFilter` and `condition.urlFilter` are not strings.');
			valid = false;
		} else if (typeof rule.condition.regexFilter === 'string' && rule.condition.regexFilter.trim() === '') {
			logSUDR('Invalid rule: `condition.regexFilter` is an empty string.');
			valid = false;
		} else if (typeof rule.condition.urlFilter === 'string' && rule.condition.urlFilter.trim() === '') {
			logSUDR('Invalid rule: `condition.urlFilter` is an empty string.');
			valid = false;
		}

		// Check `resourceTypes` field
		if (rule.condition.resourceTypes) {
			if (!Array.isArray(rule.condition.resourceTypes)) {
				logSUDR('Invalid rule: `condition.resourceTypes` is not an array.');
				valid = false;
			} else {
				// Use the external function to validate resource types
				const validResourceTypes = filterResourceTypes(rule.condition.resourceTypes);

				if (validResourceTypes.length === 0) {
					logSUDR('Invalid rule: No valid resource types specified in `condition.resourceTypes`.');
					valid = false;
				} else if (validResourceTypes.length !== rule.condition.resourceTypes.length) {
					logSUDR('Invalid rule: `condition.resourceTypes` contains some invalid values.');
					valid = false;
				}
			}
		} else {
			logSUDR('Invalid rule: `condition.resourceTypes` is missing.');
			valid = false;
		}
	}

	// Check `action` field
	if (typeof rule.action !== 'object' || rule.action === null) {
		logSUDR('Invalid rule: `action` is not an object.');
		valid = false;
	} else {
		// Check `type` field in `action`
		if (typeof rule.action.type !== 'string') {
			logSUDR('Invalid rule: `action.type` is not a string.');
			valid = false;
		}

		// Check if `action` is of type `redirect` and validate `redirect` field
		if (rule.action.type === 'redirect') {
			if (typeof rule.action.redirect !== 'object' || rule.action.redirect === null) {
				logSUDR('Invalid rule: `action.redirect` is not an object.');
				valid = false;
			} else {
				if (typeof rule.action.redirect.regexSubstitution !== 'string' && typeof rule.action.redirect.url !== 'string') {
					logSUDR('Invalid rule: `action.redirect.regexSubstitution` and `action.redirect.url` are not strings.');
					valid = false;
				} else if (typeof rule.action.redirect.regexSubstitution === 'string' && rule.action.redirect.regexSubstitution.trim() === '') {
					logSUDR('Invalid rule: `action.redirect.regexSubstitution` is an empty string.');
					valid = false;
				} else if (typeof rule.action.redirect.url === 'string' && rule.action.redirect.url.trim() === '') {
					logSUDR('Invalid rule: `action.redirect.url` is not a string.');
					valid = false;
				}
			}
		} else if (rule.action.type === 'allow') {
			if (allowKick) {
				logSUDR('Invalid rule: This rule was the exception to an invalidated rule.');
				valid = false;
				allowKickReset = true;
			}
		}
	}

	if (valid) {
		logSUDR('Valid rule: ' + JSON.stringify(rule));
		allowKick = false;
	} else {
		allowKick = true;
		if (allowKickReset) {
			allowKickReset = false;
			allowKick = false;
		}
	}

	logSUDR('allowKick: ' + allowKick);

	return valid;
}

// Redirect URLs on places like Facebook and Twitter who don 't do real reloads, only do ajax updates and push a new URL to the address bar...

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
											setUpDeclarativeRedirects();
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
									setUpDeclarativeRedirects();
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
			setUpDeclarativeRedirects();
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

async function handleStartup() {
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

	//	// Update icon based on current dark/light mode settings
	//	updateIcon();
	//	logHS('Icon update initiated during startup');
	//
	//	// Set up dark mode media query listener
	//	let darkModeMql = window.matchMedia('(prefers-color-scheme: dark)');
	//	darkModeMql.onchange = function () {
	//		logHS('Dark mode preference changed. Updating icon...');
	//		updateIcon();
	//	};
	//	logHS('Dark mode media query listener set up');

	// Create or ensure the offscreen document exists for dark mode detection
	async function createOffscreenDocument() {
		const page = '../offscreen.html'; // Your offscreen document
		const reason = 'MATCH_MEDIA'; // Correct reason for media query detection
		const exists = await chrome.offscreen.hasDocument();

		if (!exists) {
			await chrome.offscreen.createDocument({
				url: page,
				reasons: [reason],
				justification: 'Needed to detect dark mode in the browser'
			});
			logHS('Offscreen document created for dark mode detection');
		} else {
			logHS('Offscreen document already exists');
		}
	}

	await createOffscreenDocument();

	// Listen for messages from the offscreen document
	chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
		if (message.isDarkMode !== undefined) {
			logHS(`Dark mode status received: ${message.isDarkMode}`);
			chrome.storage.local.set({
				darkMode: message.isDarkMode
			}, function () {
				if (chrome.runtime.lastError) {
					logHS('Error setting darkMode in storage: ' + chrome.runtime.lastError.message);
				} else {
					logHS('Dark mode preference stored');
					updateIcon(); // Trigger the icon update based on new dark mode preference
				}
			});
		}
	});

	logHS('Icon update initiated during startup');
	logHS('Dark mode media query listener set up through offscreen document');
}
