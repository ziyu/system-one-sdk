import { choice, defineQuestions } from '@system-one-ai/core';
import { exampleClient } from './config.js';

const questions = defineQuestions({
  action: choice('Choose the next action from the actions currently available. Use think when the request needs planning beyond a routine action.', {
    drink: 'Walk to the kitchen and drink water',
    rest: 'Sit on the sofa and rest',
    think: 'Ask the application to invoke its slower planning model',
    idle: 'Keep waiting because no action is currently needed',
  }),
});

try {
  const client = exampleClient();
  const result = await client.evaluate({
    state: {
      userMessage: 'Please get some water.',
      currentAction: 'idle',
      rooms: ['living room', 'kitchen'],
      objects: ['sofa', 'water dispenser'],
      memory: ['The water dispenser is in the kitchen.'],
    },
    questions,
  }, { timeoutMs: 1500, maxRetries: 0 });

  const decision = result.answers.action;
  const selectedProbability = decision.probabilities?.[decision.choice];
  // The threshold is illustrative; calibrate a threshold against your own labeled scenarios.
  if (selectedProbability === undefined || selectedProbability < 0.8) {
    console.log({ status: 'uncertain', decision });
  } else {
    // Application code dispatches this action. The SDK does not execute tools or call another model.
    console.log({ status: 'decision', action: decision.choice, selectedProbability });
  }
} catch (error) {
  // Model failure remains failure. No fake action and no automatic LLM substitution.
  console.error(error instanceof Error ? error.message : 'Evaluation failed.');
  process.exitCode = 1;
}
