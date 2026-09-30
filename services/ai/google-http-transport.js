'use strict';

const {
  AIError,
  classifyGeminiHttpError,
  networkError,
  timeoutError,
} = require('./errors');

function normalizeGoogleContents(content) {
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

function createGoogleHttpTransport({
  fetchImpl = globalThis.fetch,
  endpointBase = 'https://generativelanguage.googleapis.com/v1beta',
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('Google AI HTTP transport requires a fetch implementation');
  }

  async function generate({
    apiKey,
    modelId,
    body,
    timeoutMs = 30000,
  }) {
    if (!apiKey) throw new Error('Google AI HTTP transport requires apiKey');
    if (!modelId) throw new Error('Google AI HTTP transport requires modelId');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const url = `${endpointBase}/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const startedAt = Date.now();

    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        signal: controller.signal,
      });

      const responseBody = await readResponseBody(response);
      const latencyMs = Date.now() - startedAt;

      if (!response.ok) {
        throw classifyGeminiHttpError({
          status: response.status,
          body: responseBody,
          headers: response.headers,
        });
      }

      return {
        raw: responseBody || {},
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
    if (!apiKey) throw new Error('Google AI HTTP transport requires apiKey');

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
        const responseBody = await readResponseBody(response);
        if (!response.ok) {
          throw classifyGeminiHttpError({
            status: response.status,
            body: responseBody,
            headers: response.headers,
          });
        }

        models.push(...(Array.isArray(responseBody?.models) ? responseBody.models : []));
        pageToken = responseBody?.nextPageToken || null;
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
  normalizeGoogleContents,
  readResponseBody,
  createGoogleHttpTransport,
};
