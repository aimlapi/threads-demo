const { OpenAI } = require('openai');
const dotenv = require('dotenv');
const prompts = require('prompts');
const axios = require('axios').default;

dotenv.config({ path: ['.env.default', '.env'], override: true });

const STEP_NAMES = {
  CREATE_ASSISTANT: 'createAssistant',
  CREATE_THREAD: 'selectAssistant',
  RUN_THREAD: 'runThread',
  INITIAL: 'initial',
};

const steps = {
  [STEP_NAMES.CREATE_ASSISTANT]: async ({ api, vendorByModelId }) => {
    const { model, name, instructions, description } = await prompts([
      {
        type: 'autocomplete',
        name: 'model',
        message: 'Your assistant model',
        choices: Object.entries(vendorByModelId).map(([id, vendor]) => ({
          title: id,
          value: id,
          description: vendor,
        })),
      },
      {
        type: 'text',
        name: 'name',
        message: 'Your assistant name',
      },
      {
        type: 'text',
        name: 'instructions',
        message: 'Your assistant instructions',
      },
      {
        type: 'text',
        name: 'description',
        message: 'Your assistant description',
      },
    ]);

    await api.beta.assistants.create({
      model,
      name,
      description,
      instructions,
    });

    return { step: 'initial' };
  },
  [STEP_NAMES.INITIAL]: async ({ api }) => {
    const assistants = await api.beta.assistants.list({ order: 'desc' });
    const { assistantId } = await prompts({
      type: 'select',
      name: 'assistantId',
      message: 'Select assistant',
      choices: [
        { title: 'Create new', value: 'new' },
        ...assistants.data.map((item) => ({ title: item.name, description: item.model, value: item.id })),
      ],
    });

    if (assistantId === 'new') {
      return { step: STEP_NAMES.CREATE_ASSISTANT };
    }

    return { step: STEP_NAMES.CREATE_THREAD, assistantId };
  },
  [STEP_NAMES.CREATE_THREAD]: async ({ api }) => {
    const thread = await api.beta.threads.create({ messages: [] });
    return { step: STEP_NAMES.RUN_THREAD, thread };
  },

  [STEP_NAMES.RUN_THREAD]: async ({ api, assistantId, thread }) => {
    const { text } = await prompts([
      {
        type: 'text',
        name: 'text',
        message: 'Message',
      },
    ]);

    await api.beta.threads.messages.create(thread.id, {
      role: 'user',
      content: text,
      metadata: {
        userId: 'example-1',
      },
    });

    await api.beta.threads.runs.createAndPoll(thread.id, { assistant_id: assistantId });
    const messages = await api.beta.threads.messages.list(thread.id, { order: 'desc', limit: 1 });
    const msg = messages.data[0].content.find((item) => item.type === 'text').text.value;
    console.log(`Assistant: ${msg}`);

    return { step: STEP_NAMES.RUN_THREAD };
  },
};

const main = async () => {
  const api = new OpenAI({
    baseURL: 'https://api.aimlapi.com',
    apiKey: process.env.API_TOKEN,
  });

  const vendorByModelId = await axios.get('https://api.aimlapi.com/models').then((r) => r.data);
  let step = 'initial';
  let payload = { api, vendorByModelId };
  while (step) {
    const result = await steps[step](payload);
    const { step: nextStep, ...nextPayload } = result ?? {};

    payload = { ...payload, ...nextPayload };
    step = nextStep;
  }
};

main();
