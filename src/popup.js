const DEFAULT_MASTODON_INSTANCE = 'https://mastodon.social';
const CHECKED_SERVICES_STORAGE_KEY = 'checkedServices';
const PENDING_SHARE_CONTEXT_STORAGE_KEY = 'pendingShareContext';

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
      const intent = new URL('https://mixi.social/home');
      intent.searchParams.set('text', text);
      return intent.toString();
    }
    default:
      throw new Error(`Unsupported service: ${service}`);
  }
}

async function loadCheckedServices() {
  const result = await chrome.storage.local.get(CHECKED_SERVICES_STORAGE_KEY);
  const savedValue = result[CHECKED_SERVICES_STORAGE_KEY];
  return Array.isArray(savedValue) ? savedValue : [];
}

async function loadPendingShareContext() {
  const result = await chrome.storage.local.get(PENDING_SHARE_CONTEXT_STORAGE_KEY);
  return result[PENDING_SHARE_CONTEXT_STORAGE_KEY] || null;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function normalizeComparableUrl(url) {
  try {
    const parsed = new URL(url);
    const normalizedPath = parsed.pathname.replace(/\/$/, '') || '/';
    return `${parsed.origin}${normalizedPath}${parsed.search}`;
  } catch {
    return '';
  }
}

function isInstagramPostPage(url) {
  try {
    const parsed = new URL(url);
    const pathSegments = parsed.pathname.split('/').filter(Boolean);
    const hasPostSegment = pathSegments.some((segment) => segment === 'p' || segment === 'reel');
    return parsed.hostname.includes('instagram.com') && hasPostSegment;
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

async function getOgMeta(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const descriptionMeta = document.querySelector('meta[property="og:description"]');
      const urlMeta = document.querySelector('meta[property="og:url"]');
      return {
        description: descriptionMeta?.getAttribute('content')?.trim() || '',
        ogUrl: urlMeta?.getAttribute('content')?.trim() || ''
      };
    }
  });
  return result?.result || { description: '', ogUrl: '' };
}

async function buildDefaultShareText(tab) {
  if (!tab?.url || !isInstagramPostPage(tab.url)) {
    return createShareText(tab.title || tab.url, tab.url);
  }

  let ogMeta = await getOgMeta(tab.id);
  const currentPageUrl = normalizeComparableUrl(tab.url);
  const currentOgUrl = normalizeComparableUrl(ogMeta.ogUrl);
  if (!ogMeta.description || !currentOgUrl || currentPageUrl !== currentOgUrl) {
    const waitLoadPromise = waitForTabComplete(tab.id);
    await chrome.tabs.reload(tab.id);
    await waitLoadPromise;
    ogMeta = await getOgMeta(tab.id);
  }

  const postBody = extractInstagramPostBody(ogMeta.description);
  return createShareText(postBody || tab.title || tab.url, tab.url);
}

async function openIntent(service, text, url, mastodonInstance) {
  const intentUrl = createIntentUrl(service, text, url, mastodonInstance);
  await chrome.tabs.create({ url: intentUrl });
}

async function init() {
  const pageInfo = document.getElementById('pageInfo');
  const shareText = document.getElementById('shareText');
  const shareButton = document.getElementById('shareButton');
  const copyButton = document.getElementById('copyButton');
  const actionStatus = document.getElementById('actionStatus');
  const openOptionsButton = document.getElementById('openOptions');

  let tab, mastodonInstance;

  try {
    const pendingContext = await loadPendingShareContext();
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
    if (pendingContext && pendingContext.url === tab.url) {
      const initialText = isInstagramPostPage(tab.url)
        ? defaultText
        : (pendingContext.text || defaultText);
      pageInfo.textContent = `タイトル: ${pendingContext.title || tab?.title || '(取得不可)'}\nURL: ${pendingContext.url || tab?.url || '(取得不可)'}\n右クリックメニューから開きました。内容を確認して共有してください。`;
      await chrome.storage.local.remove(PENDING_SHARE_CONTEXT_STORAGE_KEY);
      shareText.value = initialText;
    } else {
      pageInfo.textContent = `タイトル: ${tab?.title || '(取得不可)'}\nURL: ${tab?.url || '(取得不可)'}`;
      shareText.value = defaultText;
    }
  } catch (error) {
    pageInfo.textContent = error.message;
    return;
  }

  const serviceCheckboxes = Array.from(document.querySelectorAll('input[data-service]'));
  const savedCheckedServices = await loadCheckedServices();
  const savedCheckedServiceSet = new Set(savedCheckedServices);
  serviceCheckboxes.forEach((checkbox) => {
    checkbox.checked = savedCheckedServiceSet.has(checkbox.dataset.service);
    checkbox.addEventListener('change', () => {
      const checkedServices = serviceCheckboxes
        .filter((item) => item.checked)
        .map((item) => item.dataset.service);
      chrome.storage.local.set({ [CHECKED_SERVICES_STORAGE_KEY]: checkedServices });
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

  copyButton.addEventListener('click', async () => {
    const text = shareText.value;
    if (!text.trim()) {
      actionStatus.textContent = 'コピーするテキストを入力してください。';
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      actionStatus.textContent = 'テキストをクリップボードにコピーしました。';
    } catch {
      actionStatus.textContent = 'クリップボードへのコピーに失敗しました。';
    }
  });

  openOptionsButton.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
}

init();
