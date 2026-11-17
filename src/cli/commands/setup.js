"use strict";

const SETUP = {
  groq: {
    title: "Groq",
    steps: [
      "Open the Groq console: https://console.groq.com/keys",
      "Sign up or log in (Google, GitHub, or email). No credit card required.",
      'Click "Create API Key", give it a name (e.g. freegpt).',
      "Copy the value immediately — it starts with gsk_ and is shown only once.",
    ]
  },
  cerebras: {
    title: "Cerebras",
    steps: [
      "Open the Cerebras Cloud console: https://cloud.cerebras.ai",
      "Sign up (free tier, no credit card required).",
      "Go to the API Keys section.",
      "Create a new key and copy it."
    ]
  },
  gemini: {
    title: "Google Gemini",
    steps: [
      "Open Google AI Studio: https://aistudio.google.com/app/apikey",
      "Log in with your Google account.",
      'Click "Create API key" and choose or create a project.',
      "Copy the key."
    ]
  },
  openrouter: {
    title: "OpenRouter",
    steps: [
      "Open OpenRouter: https://openrouter.ai/keys",
      "Sign up or log in.",
      'Click "Create Key".',
      "Copy the value (starts with sk-or-v1-)."
    ]
  }
};

function runSetup(cli) {
  const c = cli.color;
  const args = cli.o
    .filter(([, pos]) => pos >= 2)
    .sort((a, b) => a[1] - b[1])
    .map(([value]) => value);

  const provider = args[0];

  if (!provider) {
    console.log(c.bold.cyan("FreeGPT setup"));
    console.log("");
    console.log("Choose a provider:");
    for (const name of Object.keys(SETUP)) {
      console.log(`  freegpt setup ${name}`);
    }
    return;
  }

  const info = SETUP[provider];
  if (!info) {
    console.error(
      c.red(`Unknown provider "${provider}". Available: ${Object.keys(SETUP).join(", ")}`)
    );
    process.exit(1);
  }

  console.log(c.bold.cyan(`${info.title} API key — setup instructions`));
  console.log("");
  info.steps.forEach((step, i) => {
    console.log(c.bold(`${i + 1}. `) + step);
  });
  console.log("");
  console.log(c.bold(`${info.steps.length + 1}. Add it to FreeGPT`));
  console.log(`   freegpt key ${provider} <your_api_key>`);
  console.log("");
  console.log(c.bold(`${info.steps.length + 2}. Verify`));
  console.log("   freegpt doctor");
}

module.exports = { runSetup };
