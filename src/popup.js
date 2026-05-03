const DEFAULT_MASTODON_INSTANCE = 'https://mastodon.social';
const CHECKBOX_STATE_STORAGE_KEY = 'checkedServices';

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

function loadCheckedServices() {
  const savedValue = localStorage.getItem(CHECKBOX_STATE_STORAGE_KEY);
  if (!savedValue) {
    return [];
  }
  try {
    const parsed = JSON.parse(savedValue);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isInstagramPostPage(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.includes('instagram.com') && /^\/(p|reel)\//.test(parsed.pathname);
  } catch {
    return false;
  }
}

function waitForTabComplete(tabId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let timeoutId;

    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(timeoutId);
    };

    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        cleanup();
        resolve();
      }
    };

    timeoutId = setTimeout(() => {
      cleanup();
      reject(new Error('Instagramページの再読み込みがタイムアウトしました。'));
    }, timeoutMs);

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}


function extractInstagramPostBody(description) {
  const trimmedDescription = (description || '').trim();
  if (!trimmedDescription) {
    return '';
  }

  let bodyCandidate = trimmedDescription;
  const colonIndex = bodyCandidate.search(/[:：]/);
  if (colonIndex >= 0) {
    bodyCandidate = bodyCandidate.slice(colonIndex + 1);
  }

  const quoteIndex = bodyCandidate.search(/["“”'‘’「」]/);
  if (quoteIndex >= 0) {
    bodyCandidate = bodyCandidate.slice(quoteIndex + 1);
  }

  const blankLineMatch = bodyCandidate.match(/\n\s*\n/);
  if (blankLineMatch && typeof blankLineMatch.index === 'number') {
    bodyCandidate = bodyCandidate.slice(0, blankLineMatch.index);
  }

  const normalizedBody = bodyCandidate.trim();
  if (!normalizedBody) {
    return '';
  }

  return normalizedBody.slice(0, 100).trim();
}

async function getOgDescription(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const meta = document.querySelector('meta[property="og:description"]');
      return meta?.getAttribute('content')?.trim() || '';
    }
  });
  return result?.result || '';
}

async function buildDefaultShareText(tab) {
  if (!tab?.url || !isInstagramPostPage(tab.url)) {
    return createShareText(tab.title || tab.url, tab.url);
  }

  let description = await getOgDescription(tab.id);
  if (!description) {
    const waitLoadPromise = waitForTabComplete(tab.id);
    await chrome.tabs.reload(tab.id);
    await waitLoadPromise;
    description = await getOgDescription(tab.id);
  }

  const postBody = extractInstagramPostBody(description);
  return createShareText(postBody || tab.title || tab.url, tab.url);
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

  let tab, mastodonInstance;

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
    const defaultText = await buildDefaultShareText(tab);
    shareText.value = defaultText;
    pageInfo.textContent = `タイトル: ${tab?.title || '(取得不可)'}\nURL: ${tab?.url || '(取得不可)'}`;
  } catch (error) {
    pageInfo.textContent = error.message;
    return;
  }

  const serviceCheckboxes = Array.from(document.querySelectorAll('input[data-service]'));
  const savedCheckedServices = loadCheckedServices();
  const savedCheckedServiceSet = new Set(savedCheckedServices);
  serviceCheckboxes.forEach((checkbox) => {
    checkbox.checked = savedCheckedServiceSet.has(checkbox.dataset.service);
    checkbox.addEventListener('change', () => {
      const checkedServices = serviceCheckboxes
        .filter((item) => item.checked)
        .map((item) => item.dataset.service);
      localStorage.setItem(CHECKBOX_STATE_STORAGE_KEY, JSON.stringify(checkedServices));
    });
  });

  shareButton.addEventListener('click', async () => {
    const checkedServices = serviceCheckboxes
      .filter((item) => item.checked)
      .map((item) => item.dataset.service);
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
      await Promise.all(checkedServices.map((service) => openIntent(service, text, tab.url, mastodonInstance)));
    } catch (error) {
      pageInfo.textContent = error.message;
    }
  });

  openOptionsButton.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

init();
