(function installStudySourceImport(global) {
  'use strict';

  const client = global.KIWI_API_CLIENT;
  if (!client || typeof client.kiwiApiRequest !== 'function') {
    throw new Error('KIWI shared API client must load before the Study source import adapter.');
  }

  const SUPPORTED_FORMATS = new Set(['image', 'pdf', 'docx', 'txt', 'md', 'pptx']);

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('Could not read the selected file.'));
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        if (comma < 0) {
          reject(new Error('Could not encode the selected file.'));
          return;
        }
        resolve(result.slice(comma + 1));
      };
      reader.readAsDataURL(file);
    });
  }

  async function importStudySource({ deckId, file, format, subjectHint = '' } = {}) {
    const normalizedFormat = String(format || '').toLowerCase();
    if (!deckId) throw new TypeError('Study source import requires a deck id.');
    if (!(file instanceof File)) throw new TypeError('Study source import requires a browser File.');
    if (!SUPPORTED_FORMATS.has(normalizedFormat)) throw new TypeError('Unsupported Study source format.');

    const base64 = await fileToBase64(file);
    const body = normalizedFormat === 'image'
      ? {
          deck_id: deckId,
          image_base64: base64,
          mime_type: file.type || 'image/jpeg',
        }
      : {
          deck_id: deckId,
          [`${normalizedFormat}_base64`]: base64,
          subject_hint: String(subjectHint || ''),
        };

    return client.kiwiApiRequest(`/cards/import/${normalizedFormat}`, {
      method: 'POST',
      body,
      timeoutMs: 60_000,
    });
  }

  global.KIWIStudySourceImport = importStudySource;
})(window);
