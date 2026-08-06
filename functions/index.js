'use strict';

// Aprimoramento opcional dos relatórios por IA (Anthropic ou OpenAI).
//
// Regras que esta function nunca pode violar (mesmos princípios do plano local):
// - A seção de situações de risco é decidida 100% no aparelho, por palavras-chave
//   determinísticas (script.js). Esta function pode no máximo reescrever o TEXTO
//   dessa seção em prosa mais natural — nunca pode adicionar uma menção a
//   plano/intenção/meios/autolesão/etc. que o texto local não tenha. `validarReescritaRisco`
//   é a barreira técnica que garante isso: se a IA acrescentar ou remover qualquer
//   achado, a reescrita inteira da seção de risco é descartada e o texto local
//   determinístico é devolvido no lugar.
// - Nenhum dado além do que a pessoa já viu na tela do relatório é enviado ao
//   provedor de IA. Em particular, a seção "Identificação" (que contém o nome da
//   pessoa) nunca é enviada — só o cliente (resumo-ia.js) decide o que empacotar,
//   mas como reforço, esta function também rejeita qualquer payload com campo "identificacao".
// - Uso exige login (mesma conta da sincronização) e tem um limite diário por
//   conta, para conter o pior cenário de custo sem precisar mudar as regras do
//   Firestore (o limite é gravado pelo Admin SDK, que ignora as regras do cliente).
// - App Check NÃO está ligado por padrão aqui: exigir App Check no servidor sem
//   o cliente enviar o token correspondente derruba a function para todo mundo
//   (foi exatamente o que aconteceu com a Authentication mais cedo neste projeto,
//   quando o enforcement foi ligado no console sem o SDK do App Check estar
//   inicializado no cliente). Para ativar esse reforço extra depois, configure o
//   App Check (reCAPTCHA v3) no Console do Firebase, adicione o SDK correspondente
//   em resumo-ia.js e sync.js, e só então mude `enforceAppCheck` para `true` abaixo.

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp();

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');

const REGIAO = 'southamerica-east1';
const LIMITE_DIARIO_POR_CONTA = 20;

// Ajuste aqui se quiser trocar de modelo — não há mais nenhum outro lugar no
// código que precise saber o nome do modelo.
const MODELO_ANTHROPIC = 'claude-sonnet-5';
const MODELO_OPENAI = 'gpt-4.1';

const CATEGORIAS_RISCO = [
  'pensamentos de morte',
  'autolesão',
  'vontade de tomar medicação além do prescrito',
  'atendimento hospitalar por crise',
  'plano',
  'intenção',
  'acesso a meios'
];

const INSTRUCOES_SISTEMA = `Você reescreve seções de um relatório de acompanhamento emocional em prosa profissional e neutra, em português do Brasil, para uma pessoa apresentar a um(a) profissional de psicologia, psiquiatria, medicina, terapia ocupacional ou assistência social.

Regras obrigatórias, sem nenhuma exceção:
- Nunca diagnostique e nunca afirme relação de causa e efeito que não esteja explícita nos dados recebidos.
- Comece frases preferencialmente com: "A pessoa relata", "Foi registrado", "A pessoa percebe", "Pode estar associado" ou "Necessita de avaliação profissional" — ou variações neutras equivalentes.
- Você recebe SOMENTE dados já resumidos localmente (temas com contagem, fatos já calculados). Nunca invente fatos, nomes, datas ou números que não estejam nos dados recebidos.
- O campo "risco", se vier, já contém a decisão final sobre situações de risco, calculada de forma determinística fora da IA. Você pode apenas reescrever esse texto em prosa mais natural, preservando exatamente os mesmos achados — nunca adicione nem remova menção a pensamentos de morte, autolesão, medicação além do prescrito, atendimento hospitalar, plano, intenção ou acesso a meios.
- Não use jargão clínico nem termos diagnósticos (ex.: não escreva "depressão", "transtorno" ou "quadro clínico").
- Mantenha cada seção curta, no mesmo espírito do texto original.
- Responda SOMENTE com um objeto JSON válido, com exatamente as mesmas chaves recebidas, sem markdown, sem comentários, sem texto fora do JSON.`;

exports.gerarResumoIA = onCall(
  { region: REGIAO, secrets: [ANTHROPIC_API_KEY, OPENAI_API_KEY], enforceAppCheck: false },
  async request => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Entre na sua conta para usar o aprimoramento por IA.');
    const uid = request.auth.uid;
    const { provedor, secoes } = request.data || {};

    if (provedor !== 'anthropic' && provedor !== 'openai') throw new HttpsError('invalid-argument', 'Escolha o provedor "anthropic" ou "openai".');
    if (!secoes || typeof secoes !== 'object' || Array.isArray(secoes)) throw new HttpsError('invalid-argument', 'Dados do relatório ausentes ou em formato inválido.');
    if ('identificacao' in secoes) throw new HttpsError('invalid-argument', 'A seção de identificação não pode ser enviada para a IA.');

    await aplicarLimiteDiario(uid);

    const chave = provedor === 'anthropic' ? ANTHROPIC_API_KEY.value() : OPENAI_API_KEY.value();
    if (!chave) throw new HttpsError('failed-precondition', `O provedor "${provedor}" ainda não está configurado neste servidor.`);

    const secoesRevisadas = provedor === 'anthropic'
      ? await chamarAnthropic(chave, secoes)
      : await chamarOpenAI(chave, secoes);

    return { secoes: validarESanearResposta(secoes, secoesRevisadas) };
  }
);

async function aplicarLimiteDiario(uid) {
  const db = getFirestore();
  const hoje = new Date().toISOString().slice(0, 10);
  const ref = db.collection('usuarios').doc(uid).collection('usoIA').doc(hoje);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const usado = snap.exists ? (snap.data().chamadas || 0) : 0;
    if (usado >= LIMITE_DIARIO_POR_CONTA) throw new HttpsError('resource-exhausted', 'Limite diário de uso da IA atingido nesta conta. Tente novamente amanhã, ou use o relatório resumido local.');
    tx.set(ref, { chamadas: usado + 1, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
  });
}

function montarPromptUsuario(secoes) {
  return `Reescreva as seções abaixo (formato JSON) seguindo todas as regras do sistema. Responda somente com um objeto JSON válido, com as mesmas chaves, valores em português do Brasil, sem markdown e sem texto fora do JSON.\n\n${JSON.stringify(secoes, null, 2)}`;
}

async function chamarAnthropic(apiKey, secoes) {
  const resposta = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODELO_ANTHROPIC,
      max_tokens: 2000,
      system: INSTRUCOES_SISTEMA,
      messages: [{ role: 'user', content: montarPromptUsuario(secoes) }]
    })
  });
  if (!resposta.ok) throw new HttpsError('unavailable', `A Anthropic não respondeu corretamente (código ${resposta.status}).`);
  const dados = await resposta.json();
  return interpretarJSON(dados.content?.[0]?.text || '');
}

async function chamarOpenAI(apiKey, secoes) {
  const resposta = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODELO_OPENAI,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: INSTRUCOES_SISTEMA },
        { role: 'user', content: montarPromptUsuario(secoes) }
      ]
    })
  });
  if (!resposta.ok) throw new HttpsError('unavailable', `A OpenAI não respondeu corretamente (código ${resposta.status}).`);
  const dados = await resposta.json();
  return interpretarJSON(dados.choices?.[0]?.message?.content || '');
}

function interpretarJSON(texto) {
  try {
    return JSON.parse(texto.trim().replace(/^```(?:json)?\s*|```$/g, ''));
  } catch {
    throw new HttpsError('internal', 'A resposta da IA não pôde ser interpretada.');
  }
}

// Garante que a saída só contenha as chaves esperadas (nunca chaves novas
// inventadas pela IA) e que a seção de risco, se presente, não teve nenhum
// achado adicionado ou removido em relação ao texto local determinístico.
function validarESanearResposta(secoesOriginais, secoesRevisadas) {
  const resultado = {};
  for (const chave of Object.keys(secoesOriginais)) {
    const valor = secoesRevisadas?.[chave];
    resultado[chave] = typeof valor === 'string' && valor.trim() ? valor.trim() : secoesOriginais[chave];
  }
  if ('risco' in resultado && !mesmosAchadosDeRisco(secoesOriginais.risco, resultado.risco)) {
    resultado.risco = secoesOriginais.risco;
  }
  return resultado;
}

function mesmosAchadosDeRisco(original, reescrita) {
  const normal = s => String(s || '').toLocaleLowerCase('pt-BR');
  const originalNorm = normal(original), reescritaNorm = normal(reescrita);
  return CATEGORIAS_RISCO.every(categoria => originalNorm.includes(categoria) === reescritaNorm.includes(categoria));
}
