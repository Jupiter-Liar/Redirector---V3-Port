// Shows a message explaining how many redirects were imported.
// function showImportedMessage(imported, existing, updated, exRuleDel) {
function showImportedMessage(imported, existing, updated, exRuleDel) {
	let message = '';

	if (imported === 0 && existing === 0) {
		message = 'No redirects existed in the file.';
	}

	if (imported == 0 && existing > 0) {
		message = 'All redirects in the file already existed and were ignored.';
	}

	if (imported > 0) {
		message += `Successfully imported ${imported} redirect${imported > 1 ? 's' : ''}. `;
	}

	if (existing > 0) {
		message += `${existing} redirect${existing > 1 ? 's' : ''} already existed and were ignored. `;
	}


	if (exRuleDel) {
		message += ' Removed the example rule.';
	}
	closeImportPopup();
	showMessage(message, true);
}

function importRedirects(ev) {

	let file = ev.target.files[0];
	if (!file) {
		return;
	}
	var reader = new FileReader();

	reader.onload = function (e) {
		var data;
		try {
			data = JSON.parse(reader.result);
		} catch (e) {
			showMessage('Failed to parse JSON data, invalid JSON: ' + (e.message || '').substr(0, 100));
			return;
		}

		if (!data.redirects) {
			showMessage('Invalid JSON, missing "redirects" property');
			return;
		}

		var imported = 0,
			existing = 0;
		for (var i = 0; i < data.redirects.length; i++) {
			var r = new Redirect(data.redirects[i]);
			r.updateExampleResult();
			if (REDIRECTS.some(function (i) {
					return new Redirect(i).equals(r);
				})) {
				existing++;
			} else {
				REDIRECTS.push(r.toObject());
				imported++;
			}
		}

		showImportedMessage(imported, existing);

		saveChanges();
		renderRedirects();
	};

	try {
		reader.readAsText(file, 'utf-8');
	} catch (e) {
		showMessage('Failed to read import file');
	}
}

function updateExportLink() {
	var redirects = REDIRECTS.map(function (r) {
		return new Redirect(r).toObject();
	});

	let version = chrome.runtime.getManifest().version;

	var exportObj = {
		createdBy: 'Redirector v' + version,
		createdAt: new Date(),
		redirects: redirects
	};

	var json = JSON.stringify(exportObj, null, 4);

	//Using encodeURIComponent here instead of base64 because base64 always messed up our encoding for some reason...
	el('#export-link').href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(json);
}

updateExportLink();

var blurWrapper = document.getElementById("blur-wrapper");

// Function to open the import popup
function showImportPopup() {
	document.getElementById('import-popup').style.display = 'block';
	document.getElementById('cover').style.display = 'block';
	blurWrapper.classList.add("blur");
}

// Function to close the import popup
function closeImportPopup() {
	document.getElementById('import-popup').style.display = 'none';
	document.getElementById('cover').style.display = 'none';
	blurWrapper.classList.remove("blur");
}

// Setup event listeners for import functionality
function setupImportExportEventListeners() {

	document.querySelector('label[for="import-file"]').addEventListener('click', function (ev) {
		ev.preventDefault();
		showImportPopup();
	});

	const importFileInputPopup = document.getElementById("import-file-popup");
	importFileInputPopup.addEventListener('change', function (event) {
		importRedirects(event); // Call your import function
		event.target.value = ''; // Reset the input value so the same file can be selected again
	});

	document.querySelector('label[for="import-file"]').addEventListener('click', function (ev) {
		ev.preventDefault();
		showImportPopup();
	});

	document.getElementById('import-url-button').addEventListener('click', function () {
		const url = document.getElementById('import-url-popup').value;
		fetchAndImportFromURL(url);
	});

	document.getElementById('import-file-popup-cb').addEventListener('click', function () {
		document.getElementById('import-file-popup').click();
	});

	document.getElementById('cancel-import').addEventListener('click', closeImportPopup);

	document.getElementById('export-link').addEventListener('mousedown', updateExportLink);
}

function fetchAndImportFromURL(url) {
	if (url) {
		fetch(url)
			.then(response => {
				if (response.ok) {
					return response.text() || response.json();
				}
				throw new Error('Invalid response.');
			})
			.then(data => {
				importRedirects(data);
				//console.log("Redirects imported:", data);
			})
			.catch(error => {
				console.error('Problem fetching the URL:', error);
			});
	} else {
		alert("Please enter a URL.");
	}
}

setupImportExportEventListeners();
