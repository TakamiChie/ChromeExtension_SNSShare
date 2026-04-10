const DEFAULT_MASTODON_INSTANCE = 'https://mastodon.social';

function normalizeMastodonInstance(input) {
  const value = (input || '').trim();
  if (!value) {
    return DEFAULT_MASTODON_INSTANCE;
  }

  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withProtocol.replace(/\/$/, '');
}

function createShareText(title, url) {
  return `${title}\n${url}`;
}

function createIntentUrl(service, title, url, mastodonInstance) {
  const shareText = createShareText(title, url);

  switch (service) {
    case 'facebook': {
      const intent = new URL('https://www.facebook.com/sharer/sharer.php');
      intent.searchParams.set('u', url);
      intent.searchParams.set('quote', title);
      return intent.toString();
    }
    case 'x': {
      const intent = new URL('https://twitter.com/intent/tweet');
      intent.searchParams.set('text', title);
      intent.searchParams.set('url', url);
      return intent.toString();
    }
    case 'bluesky': {
      const intent = new URL('https://bsky.app/intent/compose');
      intent.searchParams.set('text', shareText);
      return intent.toString();
    }
    case 'mastodon': {
      const base = normalizeMastodonInstance(mastodonInstance);
      const intent = new URL('/share', base);
      intent.searchParams.set('text', shareText);
      return intent.toString();
    }
    case 'threads': {
      const intent = new URL('https://www.threads.com/intent/post');
      intent.searchParams.set('text', title);
      intent.searchParams.set('url', url);
      return intent.toString();
    }
    default:
      throw new Error(`Unsupported service: ${service}`);
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function openIntent(service) {
  const tab = await getActiveTab();
  if (!tab || !tab.url) {
    throw new Error('現在のタブのURLを取得できませんでした。');
  }

  if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
    throw new Error('このページは共有できません。通常のWebページでお試しください。');
  }

  const { mastodonInstance = DEFAULT_MASTODON_INSTANCE } = await chrome.storage.sync.get('mastodonInstance');
  const title = tab.title || tab.url;
  const intentUrl = createIntentUrl(service, title, tab.url, mastodonInstance);
  await chrome.tabs.create({ url: intentUrl });
}

async function init() {
  const pageInfo = document.getElementById('pageInfo');
  const openOptionsButton = document.getElementById('openOptions');

  try {
    const tab = await getActiveTab();
    pageInfo.textContent = `タイトル: ${tab?.title || '(取得不可)'}\nURL: ${tab?.url || '(取得不可)'}`;
  } catch (error) {
    pageInfo.textContent = error.message;
  }

  document.querySelectorAll('[data-service]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await openIntent(button.dataset.service);
      } catch (error) {
        pageInfo.textContent = error.message;
      }
    });
  });

  openOptionsButton.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

init();
