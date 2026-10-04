# @system-one-ai/decisions

Select business objects, actions and action parameters with a model, then map answers back to the original objects for the application to act on.

```ts
import { choiceFrom, defineDecision } from '@system-one-ai/decisions';
```

`definition.evaluate(client, { state, images })` accepts core's native `ImageInput[]` alongside text/JSON state. The selected client and model must support images; decision composition does not encode images into text or provider options.

Requires Node.js 20+. Build from the repository with `npm run build --workspace @system-one-ai/decisions`.
