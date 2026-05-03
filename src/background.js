const DEFAULT_MASTODON_INSTANCE = 'https://mastodon.social';
const CHECKED_SERVICES_STORAGE_KEY = 'checkedServices';
const CONTEXT_MENU_ID = 'share-to-sns';

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

function createIntentUrl(service, text, url, mastodonInstance) {
  switch (service) {
    case 'facebook': {
      const intent = new URL('https://www.facebook.com/sharer/sharer.php');
      intent.searchParams.set('u', url);
      intent.searchParams.set('quote', text);
      return intent.toString();
    }
    case 'x': {
      const intent = new URL('https://twitter.com/intent/tweet');
      intent.searchParams.set('text', text);
      intent.searchParams.set('url', url);
      return intent.toString();
    }
    case 'bluesky': {
      const intent = new URL('https://bsky.app/intent/compose');
      intent.searchParams.set('text', text);
      return intent.toString();
    }
    case 'mastodon': {
      const base = normalizeMastodonInstance(mastodonInstance);
      const intent = new URL('/share', base);
      intent.searchParams.set('text', text);
      return intent.toString();
    }
    case 'threads': {
      const intent = new URL('https://www.threads.com/intent/post');
      intent.searchParams.set('text', text);
      intent.searchParams.set('url', url);
      return intent.toString();
    }
    case 'mixi2': {
      return 'https://mixi.social/';
    }
    default:
      throw new Error(`Unsupported service: ${service}`);
  }
}

async function openIntent(service, text, url, mastodonInstance) {
  const intentUrl = createIntentUrl(service, text, url, mastodonInstance);
  await chrome.tabs.create({ url: intentUrl });
}

async function getCheckedServices() {
  const result = await chrome.storage.local.get(CHECKED_SERVICES_STORAGE_KEY);
  const services = result[CHECKED_SERVICES_STORAGE_KEY];
  return Array.isArray(services) ? services : [];
}

async function handleContextMenuClick(info, tab) {
  if (info.menuItemId !== CONTEXT_MENU_ID) {
    return;
  }

  if (!tab?.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
    return;
  }

  const checkedServices = await getCheckedServices();
  if (checkedServices.length === 0) {
    return;
  }

  const { mastodonInstance } = await chrome.storage.sync.get('mastodonInstance');
  const shareText = createShareText(tab.title || tab.url, tab.url);

  await Promise.all(
    checkedServices.map((service) =>
      openIntent(service, shareText, tab.url, mastodonInstance || DEFAULT_MASTODON_INSTANCE)
    )
  );
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'このページをSNSに共有',
    contexts: ['page']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  handleContextMenuClick(info, tab);
});
