'use strict';

const {
  AIError,
  classifyGeminiHttpError,
  networkError,
  timeoutError,
} = require('./errors');

function normalizeContents(content) {
  if (typeof content === 'string') {
    return [{ parts: [{ text: content }] }];
  }

  if (Array.isArray(content)) return content;

  if (content && Array.isArray(content.contents)) {
    return content.contents;
  }

  return [{ parts: [{ text: String(content ?? '') }] }];
}

async function readResponseBody(response) {
  const contentType = response.headers?.get?.('content-type') || '';
  if (contentType.includes('application/json')) {
    try { return await response.json(); } catch (_) { return null; }
  }

  try {
    const text = await response.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch (_) { return text; }
  } catch (_) {
    return null;
  }
}

function createGeminiTransport({
  fetchImpl = globalThis.fetch,
  endpointBase = 'https://generativelanguage.googleapis.com/v1beta',
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Gemini transport requires a fetch implementation');
  }

  async function generate({
    apiKey,
    modelId,
    content,
    generationConfig = {},
    timeoutMs = 30000,
  }) {
    if (!apiKey) throw new Error('Gemini transport requires apiKey');
    if (!modelId) throw new Error('Gemini transport requires modelId');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const url = `${endpointBase}/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const requestBody = {
      contents: normalizeContents(content),
      generationConfig,
    };

    const startedAt = Date.now();

    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      const body = await readResponseBody(response);
      const latencyMs = Date.now() - startedAt;

      if (!response.ok) {
        throw classifyGeminiHttpError({
          status: response.status,
          body,
          headers: response.headers,
        });
      }

      return {
        raw: body || {},
        latencyMs,
        httpStatus: response.status,
      };
    } catch (error) {
      if (error instanceof AIError) throw error;

      if (
        error?.name === 'AbortError' ||
        controller.signal.aborted ||
        String(error?.message || '').toLowerCase().includes('aborted')
      ) {
        throw timeoutError(timeoutMs, error);
      }

      throw networkError(error);
    } finally {
      clearTimeout(timer);
    }
  }

  async function listModels({
    apiKey,
    timeoutMs = 15000,
    pageSize = 1000,
  }) {
    if (!apiKey) throw new Error('Gemini transport requires apiKey');

    const models = [];
    let pageToken = null;

    do {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const params = new URLSearchParams({
        key: apiKey,
        pageSize: String(pageSize),
      });
      if (pageToken) params.set('pageToken', pageToken);
      const url = `${endpointBase}/models?${params.toString()}`;

      try {
        const response = await fetchImpl(url, {
          method: 'GET',
          signal: controller.signal,
        });
        const body = await readResponseBody(response);
        if (!response.ok) {
          throw classifyGeminiHttpError({
            status: response.status,
            body,
          });
        }

        models.push(...(Array.isArray(body?.models) ? body.models : []));
        pageToken = body?.nextPageToken || null;
      } catch (error) {
        if (error instanceof AIError) throw error;
        if (
          error?.name === 'AbortError' ||
          controller.signal.aborted ||
          String(error?.message || '').toLowerCase().includes('aborted')
        ) {
          throw timeoutError(timeoutMs, error);
        }
        throw networkError(error);
      } finally {
        clearTimeout(timer);
      }
    } while (pageToken);

    return models;
  }

  return Object.freeze({
    generate,
    listModels,
  });
}

module.exports = {
  normalizeContents,
  readResponseBody,
  createGeminiTransport,
};
