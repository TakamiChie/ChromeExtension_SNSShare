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

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function openIntent(service, text, url, mastodonInstance) {
  if (service === 'mixi2') {
    await navigator.clipboard.writeText(text);
    await chrome.tabs.create({ url: 'https://mixi.social/' });
  } else {
    const intentUrl = createIntentUrl(service, text, url, mastodonInstance);
    await chrome.tabs.create({ url: intentUrl });
  }
}

async function init() {
  const pageInfo = document.getElementById('pageInfo');
  const shareText = document.getElementById('shareText');
  const shareButton = document.getElementById('shareButton');
  const openOptionsButton = document.getElementById('openOptions');

  let tab, mastodonInstance, defaultText;

  try {
    tab = await getActiveTab();
    if (!tab || !tab.url) {
      throw new Error('現在のタブのURLを取得できませんでした。');
    }
    if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) {
      throw new Error('このページは共有できません。通常のWebページでお試しください。');
    }
    const storage = await chrome.storage.sync.get('mastodonInstance');
    mastodonInstance = storage.mastodonInstance || DEFAULT_MASTODON_INSTANCE;
    defaultText = createShareText(tab.title || tab.url, tab.url);
    shareText.value = defaultText;
    pageInfo.textContent = `タイトル: ${tab?.title || '(取得不可)'}\nURL: ${tab?.url || '(取得不可)'}`;
  } catch (error) {
    pageInfo.textContent = error.message;
    return;
  }

  shareButton.addEventListener('click', async () => {
    const checkedServices = Array.from(document.querySelectorAll('input[data-service]:checked')).map(cb => cb.dataset.service);
    if (checkedServices.length === 0) {
      pageInfo.textContent = 'SNSを選択してください。';
      return;
    }
    const text = shareText.value.trim();
    if (!text) {
      pageInfo.textContent = '共有テキストを入力してください。';
      return;
    }
    try {
      await Promise.all(checkedServices.map(service => openIntent(service, text, tab.url, mastodonInstance)));
    } catch (error) {
      pageInfo.textContent = error.message;
    }
  });

  openOptionsButton.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

init();
