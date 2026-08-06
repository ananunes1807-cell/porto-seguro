'use strict';

// Aprimoramento opcional dos relatórios por IA (Anthropic ou OpenAI), via a
// Cloud Function gerarResumoIA. Nunca é obrigatório: se qualquer coisa falhar
// (sem login, sem rede, function não publicada/configurada, limite diário
// atingido), quem chamou recebe um erro com mensagem já pronta para mostrar à
// pessoa, e deve manter o texto local (Fase 1) — a IA nunca bloqueia a geração
// do relatório em si, só um aprimoramento explícito e opcional depois.

import { getFunctions, connectFunctionsEmulator, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js';

window.PortoSeguroResumoIA = (() => {
  let functions = null;

  function inicializar() {
    if (functions) return;
    const app = window.PortoSeguroSync?.obterAppFirebase?.();
    if (!app) return;
    functions = getFunctions(app, 'southamerica-east1');
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      try { connectFunctionsEmulator(functions, 'localhost', 5001); } catch {}
    }
  }

  function disponivel() {
    inicializar();
    return Boolean(functions && window.PortoSeguroSync?.usuarioAtual());
  }

  // secoes: objeto só com as chaves de texto livre do relatório (nunca "identificacao" —
  // quem chama é responsável por nunca incluir essa chave). Em caso de sucesso,
  // devolve { secoes: {...mesmas chaves, texto revisado} }. Em caso de falha,
  // lança um Error com mensagem já adequada para mostrar diretamente à pessoa.
  async function aprimorarComIA(provedor, secoes) {
    inicializar();
    if (!functions) throw new Error('A sincronização precisa estar ativa neste aparelho para usar o aprimoramento por IA.');
    if (!window.PortoSeguroSync?.usuarioAtual()) throw new Error('Entre na sua conta para usar o aprimoramento por IA.');
    if ('identificacao' in secoes) throw new Error('Erro interno: a identificação não pode ser enviada para a IA.');
    const chamar = httpsCallable(functions, 'gerarResumoIA');
    try {
      const resultado = await chamar({ provedor, secoes });
      return resultado.data;
    } catch (erro) {
      const codigo = String(erro?.code || '');
      console.error('Aprimoramento por IA não concluído:', codigo || erro?.name || 'Erro');
      if (codigo.includes('resource-exhausted')) throw new Error('Limite diário de uso da IA atingido nesta conta. Tente novamente amanhã, ou use o relatório resumido local.');
      if (codigo.includes('unauthenticated')) throw new Error('Entre na sua conta para usar o aprimoramento por IA.');
      if (codigo.includes('failed-precondition')) throw new Error('Este provedor de IA ainda não está configurado no servidor.');
      if (codigo.includes('unavailable')) throw new Error('O provedor de IA não respondeu agora. O texto local foi mantido.');
      throw new Error('Não foi possível usar a IA agora. O texto local foi mantido.');
    }
  }

  return { inicializar, disponivel, aprimorarComIA };
})();
