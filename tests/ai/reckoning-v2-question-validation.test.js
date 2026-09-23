'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createQuestionValidator,
  createQuestionBank,
  createAISemanticReviewer,
} = require('../../services/reckoning');

function evidence(overrides = {}) {
  return {
    sourceCardId: 'card-1',
    conceptKey: 'card:card-1',
    sourceSnapshot: {
      front_content: 'The mitochondrion produces ATP during cellular respiration.',
      back_content: 'ATP production occurs through oxidative phosphorylation.',
    },
    sourceHash: 'hash',
    riskLevel: 'CRITICAL',
    ...overrides,
  };
}

test('structural validator rejects duplicate, placeholder and malformed options', () => {
  const validator = createQuestionValidator();

  const result = validator.validateStructure({
    stem: 'Which statement best explains ATP production in this context?',
    options: ['Oxidative phosphorylation', 'Oxidative phosphorylation', 'Option C', 'Fermentation'],
    correctAnswer: 'A',
  });

  assert.equal(result.valid, false);
  assert.ok(result.issues.includes('duplicate_option'));
  assert.ok(result.issues.includes('placeholder_option'));
});

test('Challenge and Confirmation variants cannot be near-copies of previous questions', () => {
  const validator = createQuestionValidator();

  const previous = {
    stem: 'Which process produces most ATP in the mitochondrion during respiration?',
    options: ['Oxidative phosphorylation', 'Glycolysis', 'Fermentation', 'Diffusion'],
    correctAnswer: 'A',
  };

  const result = validator.validateStructure({
    stem: 'Which process produces most ATP in the mitochondrion during cellular respiration?',
    options: ['Oxidative phosphorylation', 'Glycolysis', 'Fermentation', 'Osmosis'],
    correctAnswer: 'A',
  }, {
    blueprint: { role: 'CONFIRMATION' },
    previousQuestion: previous,
  });

  assert.equal(result.valid, false);
  assert.ok(result.issues.includes('variant_too_similar'));
});

test('question bank creates explicit Diagnostic/Challenge/Confirmation families', () => {
  const bank = createQuestionBank();
  const critical = evidence();
  const high = evidence({ sourceCardId: 'card-2', conceptKey: 'card:card-2', riskLevel: 'HIGH' });
  const supporting = evidence({ sourceCardId: 'card-3', conceptKey: 'card:card-3', riskLevel: 'SUPPORTING' });
  const control = evidence({ sourceCardId: 'card-4', conceptKey: 'card:card-4', riskLevel: 'SUPPORTING' });

  const blueprints = bank.buildBlueprints({
    critical: [critical],
    high: [high],
    supporting: [supporting],
    controls: [control],
  });

  assert.deepEqual(
    blueprints.map((item) => item.role),
    [
      'DIAGNOSTIC', 'CHALLENGE', 'CONFIRMATION',
      'DIAGNOSTIC', 'CHALLENGE',
      'DIAGNOSTIC', 'CHALLENGE',
      'CONTROL', 'CHALLENGE',
    ]
  );
  assert.equal(blueprints[2].constraints.independentRetrieval, true);
  assert.equal(blueprints[1].constraints.changeScenario, true);
});

test('question generation routes through RECKONING_CBT and requires semantic approval', async () => {
  const calls = [];
  const validator = createQuestionValidator({
    semanticReview: async () => ({
      valid: true,
      grounded: true,
      singleBestAnswer: true,
      variantDistinct: true,
      issues: [],
    }),
  });

  const bank = createQuestionBank({
    validator,
    aiRun: async (...args) => {
      calls.push(args);
      return {
        text: JSON.stringify({
          stem: 'A cell needs most of its ATP from respiration. Which process is the best answer?',
          options: ['Oxidative phosphorylation', 'Diffusion', 'Osmosis', 'Fermentation'],
          correctAnswer: 'A',
          explanation: 'The supplied source identifies oxidative phosphorylation.',
        }),
        modelId: 'gemini-test',
        attempts: 1,
      };
    },
  });

  const blueprint = bank.buildBlueprints({
    critical: [evidence()],
    high: [],
    supporting: [],
    controls: [],
  })[0];

  const generated = await bank.generate(blueprint);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'RECKONING_CBT');
  assert.equal(generated.structure.valid, true);
  assert.equal(generated.semantics.valid, true);
  assert.equal(generated.question.correctIndex, 0);
});

test('AI semantic reviewer uses CBT_QUESTION_AUDIT rather than bypassing the orchestrator', async () => {
  const calls = [];
  const review = createAISemanticReviewer({
    aiRun: async (...args) => {
      calls.push(args);
      return {
        text: JSON.stringify({
          valid: true,
          grounded: true,
          singleBestAnswer: true,
          variantDistinct: true,
          issues: [],
        }),
      };
    },
  });

  const result = await review({
    question: {
      stem: 'Which process produces ATP?',
      options: ['A', 'B', 'C', 'D'],
      correctIndex: 0,
    },
    blueprint: { role: 'DIAGNOSTIC' },
    sourceSnapshot: { front_content: 'Source', back_content: 'Answer' },
  });

  assert.equal(calls[0][0], 'CBT_QUESTION_AUDIT');
  assert.equal(result.valid, true);
});

test('semantic validation fails closed when no semantic reviewer is configured', async () => {
  const validator = createQuestionValidator();
  const result = await validator.validateSemantics({
    stem: 'A valid-looking question?',
    options: ['A', 'B', 'C', 'D'],
    correctAnswer: 'A',
  });

  assert.equal(result.valid, false);
  assert.equal(result.reviewed, false);
  assert.ok(result.issues.includes('semantic_review_unavailable'));
});

test('retry prompt explicitly corrects duplicate-option validation failures', () => {
  const bank = createQuestionBank();
  const blueprint = bank.buildBlueprints({
    critical: [evidence()],
    high: [],
    supporting: [],
    controls: [],
  })[0];
  const prompt = bank.buildPrompt(blueprint, 'duplicate_option');
  assert.match(prompt, /RETRY CORRECTION/);
  assert.match(prompt, /duplicate_option/);
  assert.match(prompt, /distinct after lowercasing/i);
});
