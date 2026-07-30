const shareText = new URLSearchParams(window.location.search).get('text');

if (shareText) {
  openPostDialog(shareText);
}

async function openPostDialog(text) {
  await waitForPageLoad();

  const editor = await openDialogWithRetry();
  if (!editor) {
    return;
  }

  setEditorValue(editor, text);
  editor.focus();
}

function waitForPageLoad() {
  if (document.readyState === 'complete') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    window.addEventListener('load', resolve, { once: true });
  });
}

async function openDialogWithRetry(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const existingEditor = findPostEditor();
    if (existingEditor) {
      return existingEditor;
    }

    const postButton = [...document.querySelectorAll('button')]
      .find((button) =>
        button.textContent.includes('ポスト')
        && !button.disabled
        && button.getAttribute('aria-disabled') !== 'true'
      );

    if (postButton) {
      postButton.click();

      const editor = await waitForElement(findPostEditor, 3000);
      if (editor) {
        return editor;
      }
    }

    await wait(500);
  }

  return null;
}

function findPostEditor() {
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) {
    return null;
  }

  return dialog.querySelector('textarea, [contenteditable="true"]');
}

function setEditorValue(editor, value) {
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
    const prototype = editor instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    valueSetter?.call(editor, value);
  } else {
    editor.textContent = value;
  }

  editor.dispatchEvent(new InputEvent('input', {
    bubbles: true,
    inputType: 'insertText',
    data: value
  }));
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function waitForElement(findElement, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const existingElement = findElement();
    if (existingElement) {
      resolve(existingElement);
      return;
    }

    const observer = new MutationObserver(() => {
      const element = findElement();
      if (element) {
        clearTimeout(timeoutId);
        observer.disconnect();
        resolve(element);
      }
    });

    const timeoutId = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  });
}
