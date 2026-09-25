'use strict';

const SECRET_PATTERNS = Object.freeze([
  { id: 'database-url-literal', regex: /postgres(?:ql)?:\/\/[^\s'"\x60]+/gi },
  { id: 'env-secret-fallback', regex: /process\.env\.[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|DATABASE_URL)[A-Z0-9_]*\s*\|\|\s*['"\x60][^'"\x60\n]{4,}/gi },
  { id: 'provider-sdk-feature-import', regex: /(?:require\(|from\s+)['"][^'"]*(?:gemini|generative-ai|google\/genai|openai|anthropic|vertex|bedrock)[^'"]*['"]/gi },
]);

function auditSourceText(source, sourceName = 'unknown') {
  const text = String(source || '');
  const findings = [];

  for (const rule of SECRET_PATTERNS) {
    rule.regex.lastIndex = 0;
    let match;
    while ((match = rule.regex.exec(text))) {
      findings.push(Object.freeze({
        rule: rule.id,
        source: sourceName,
        index: match.index,
      }));
    }
  }

  return findings;
}

module.exports = { SECRET_PATTERNS, auditSourceText };
