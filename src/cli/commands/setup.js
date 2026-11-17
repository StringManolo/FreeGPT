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
  nvidia: {
    title: "NVIDIA NIM",
    steps: [
      "Open NVIDIA Build: https://build.nvidia.com",
      "Sign up or log in with email. No credit card required.",
      "Pick any model (e.g. nvidia/nemotron-3-ultra-550b-a55b) and click 'Get API Key'.",
      "Copy the key — it starts with nvapi-.",
      "Make sure the key includes the 'Public API Endpoints' scope.",
    ]
  },
  gemini: {
    title: "Google Gemini",
    steps: [
      "Open Google AI Studio: https://aistudio.google.com/app/apikey",
      "Log in with your Google account.",
      'Click "Create API key" and choose or create a project.',
      "Copy the key.",
    ]
  },
  openrouter: {
    title: "OpenRouter",
    steps: [
      "Open OpenRouter: https://openrouter.ai/keys",
      "Sign up or log in.",
      'Click "Create Key".',
      "Copy the value (starts with sk-or-v1-).",
    ]
  },
/*  mistral: {
    title: "Mistral",
    steps: [
      "Open the Mistral console: https://console.mistral.ai/",
      "Sign up with email. No credit card, but PHONE VERIFICATION is required.",
      "Go to API Keys and create a new key.",
      "Copy the key. The free tier is the 'Experiment' plan: ~1 RPS, ~500K TPM per model.",
      "Note: the free plan lets Mistral train on your requests. Do not send private code.",
    ]
  },*/
  kilo: {
    title: "Kilo Gateway",
    steps: [
      "Open Kilo: https://kilo.ai/gateway",
      "Sign up with email. No credit card, no phone verification.",
      "Go to API Keys and create a new key.",
      "Copy the value.",
      "kilo-auto/free auto-routes to the best free model for each request (~200 req/h).",
    ]
  },
  sambanova: {
    title: "SambaNova Cloud",
    steps: [
      "Open SambaNova Cloud: https://cloud.sambanova.ai/",
      "Sign up with email. No credit card required.",
      "Go to API Keys and create a new key.",
      "Copy the value.",
      "Free tier is 20 RPM, 20 requests/day and 200K tokens/day per model. Use it as a last resort.",
    ]
  },
  cohere: {
    title: "Cohere (Trial key)",
    steps: [
      "Open the Cohere dashboard: https://dashboard.cohere.com/api-keys",
      "Sign up with email. No credit card required.",
      'Click "Create Trial Key".',
      "Copy the value.",
      "Trial keys are limited to 1,000 calls/month, 20 RPM, and non-commercial use only.",
    ]
  },
  cerebras: {
    title: "Cerebras",
    steps: [
      "Open the Cerebras Cloud console: https://cloud.cerebras.ai",
      "NOTE: as of late 2026, a credit card is required even for the $5 free credit.",
      "Sign up and add a payment method to activate the API.",
      "Go to the API Keys section, create a new key, and copy it.",
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

module.exports = {
  runSetup,
  SETUP_PROVIDERS: Object.keys(SETUP)
};
