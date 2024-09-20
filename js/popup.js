var storage = chrome.storage.local;
var viewModel = {}; //Just an object for the databinding

function applyBinding() {
	dataBind(document.body, viewModel);
}

function toggle(prop) {
	storage.get({
		[prop]: false
	}, function (obj) {
		const newValue = !obj[prop]; // Get the new value we're setting

		// Update the storage and viewModel
		storage.set({
            [prop]: newValue
		});
		viewModel[prop] = newValue;
		applyBinding();

		// If the prop is 'disabled', pass the new value to handleDisabledState
		if (prop === 'disabled') {
			handleDisabledState(newValue);
		}
	});
}

function saveThemePreference(theme) {
	storage.set({
		themePreference: theme
	}, function () {
		//		console.log(`Theme preference saved: ${theme}`);
		updateThemeIcons(theme);
	});
}

function updateThemeIcons(theme) {
	const themeIcons = {
		dark: el('#icon-dark'),
		light: el('#icon-light'),
		auto: el('#auto')
	};

	// Reset all borders
	for (let key in themeIcons) {
		themeIcons[key].style.borderColor = ''; // Remove border color
	}

	// Set border color for the selected theme
	if (themeIcons[theme]) {
		themeIcons[theme].style.borderColor = 'red';
	}
}

function handleThemeClick(event) {
	//	console.log('handleThemeClick');
	const theme = event.target.id.replace('icon-', '') || 'auto';
	saveThemePreference(theme);

	chrome.runtime.sendMessage({
		type: 'update-icon'
	}).catch(() => {
		// Ignore errors without logging
	});
}

function openRedirectorSettings() {

	//switch to open one if we have it to minimize conflicts
	var url = chrome.runtime.getURL('redirector.html');

	//FIREFOXBUG: Firefox chokes on url:url filter if the url is a moz-extension:// url
	//so we don't use that, do it the more manual way instead.
	chrome.tabs.query({
		currentWindow: true
	}, function (tabs) {
		for (var i = 0; i < tabs.length; i++) {
			if (tabs[i].url == url) {
				chrome.tabs.update(tabs[i].id, {
					active: true
				}, function (tab) {
					close();
				});
				return;
			}
		}

		chrome.tabs.create({
			url: url,
			active: true
		});
	});
	return;
};

function handleDisabledState(disabled) {
	if (disabled) {
		// Add the 'disabled' attribute to the body
		document.body.setAttribute('disabled', 'true');
	} else {
		// Remove the 'disabled' attribute from the body
		document.body.removeAttribute('disabled');
	}
}

function pageLoad() {
	storage.get({
		logging: false,
		enableNotifications: false,
		disabled: false,
		themePreference: 'auto' // Default value
	}, function (obj) {
		viewModel = obj;
		applyBinding();
		updateThemeIcons(obj.themePreference); // Update icons based on saved preference

		// Hide or show the disabled div
		if (obj.disabled) {
			handleDisabledState(true); // Perform actions when disabled is true
		}
	})

	el('#enable-notifications').addEventListener('input', () => toggle('enableNotifications'));
	el('#enable-logging').addEventListener('input', () => toggle('logging'));
	el('#toggle-disabled').addEventListener('click', () => toggle('disabled'));
	el('#open-redirector-settings').addEventListener('click', openRedirectorSettings);

	// Add event listeners for theme icons
	el('#icon-dark').addEventListener('click', handleThemeClick);
	el('#icon-light').addEventListener('click', handleThemeClick);
	el('#auto').addEventListener('click', handleThemeClick);
}

pageLoad();
//Setup page...
