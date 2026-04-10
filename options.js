const DEFAULT_MASTODON_INSTANCE = 'https://mastodon.social';

function normalizeMastodonInstance(input) {
  const value = (input || '').trim();
  if (!value) {
    return DEFAULT_MASTODON_INSTANCE;
  }

  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withProtocol.replace(/\/$/, '');
}

async function restoreSettings() {
  const { mastodonInstance = DEFAULT_MASTODON_INSTANCE } = await chrome.storage.sync.get('mastodonInstance');
  document.getElementById('mastodonInstance').value = mastodonInstance;
}

async function saveSettings(event) {
  event.preventDefault();

  const status = document.getElementById('status');
  const input = document.getElementById('mastodonInstance');
  const mastodonInstance = normalizeMastodonInstance(input.value);

  await chrome.storage.sync.set({ mastodonInstance });
  input.value = mastodonInstance;
  status.textContent = '保存しました。';

  window.setTimeout(() => {
    status.textContent = '';
  }, 2000);
}

document.getElementById('settingsForm').addEventListener('submit', saveSettings);
restoreSettings();
