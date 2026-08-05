'use strict';

// Sincronização opcional entre aparelhos (Firebase Authentication + Cloud Firestore).
// Regra central: o Firestore NUNCA recebe texto simples. Tudo é cifrado neste
// aparelho, antes do envio, com a "chave de sincronização" — um segredo separado
// da senha da conta (necessário porque o login por Google não expõe uma senha
// para o app usar como material de chave). Login = quem você é; chave de
// sincronização = o que protege os dados, e nunca é enviada ao Firebase.
//
// Reaproveita o mesmo desenho já usado para o PIN local (script.js/storage.js):
// PBKDF2 -> HKDF (domínios separados) -> chave AES-256-GCM, mantida só em
// memória. O envelope de cada documento é o mesmo formato do storage.js local:
// {<campoId>, cifrado:true, iv, dados}.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, connectAuthEmulator, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup, signOut as signOutFirebase
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, connectFirestoreEmulator,
  doc, getDoc, setDoc, collection, getDocs, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

window.PortoSeguroSync = (() => {
  // Preencha com a configuração do app Web do seu projeto Firebase
  // (Console do Firebase → Configurações do projeto → Seus apps → Web).
  // Os valores abaixo são placeholders e só funcionam contra o emulador local.
  const CONFIGURACAO_FIREBASE = {
    apiKey: 'SUBSTITUA_PELA_SUA_API_KEY',
    authDomain: 'porto-seguro-ananunes.firebaseapp.com',
    projectId: 'porto-seguro-ananunes',
    storageBucket: 'porto-seguro-ananunes.appspot.com',
    messagingSenderId: 'SUBSTITUA_PELO_SEU_SENDER_ID',
    appId: 'SUBSTITUA_PELO_SEU_APP_ID'
  };

  const ITERACOES_SINCRONIZACAO = 600000;
  const CHAVE_ESTADO_SYNC = 'portoSeguro.syncEstado.v1'; // bookkeeping local; não é segredo

  // Cada entrada descreve como ler/gravar/excluir localmente, para o motor de
  // sincronização genérico poder tratar todas as coleções da mesma forma.
  function definirColecoes(armazenamento) {
    return {
      registros: {
        buscarTodosLocal: () => armazenamento.buscarTodos(),
        salvarLocal: item => armazenamento.salvar(item),
        excluirLocal: id => armazenamento.excluir(id)
      },
      feedbackApoio: {
        buscarTodosLocal: () => armazenamento.buscarFeedbackApoio(),
        salvarLocal: item => armazenamento.salvarFeedbackApoio(item),
        excluirLocal: null // não existe exclusão de feedback na interface hoje
      },
      relatoriosSalvos: {
        buscarTodosLocal: () => armazenamento.buscarRelatorios(),
        salvarLocal: item => armazenamento.salvarRelatorio(item),
        excluirLocal: null // não existe exclusão de relatório salvo na interface hoje
      },
      planoSeguranca: {
        buscarTodosLocal: async () => { const p = await armazenamento.buscarPlanoSeguranca(); return p ? [p] : []; },
        salvarLocal: item => armazenamento.salvarPlanoSeguranca(item),
        excluirLocal: () => armazenamento.excluirPlanoSeguranca()
      },
      perfilAcolhimento: {
        buscarTodosLocal: async () => { const p = await armazenamento.buscarPerfilAcolhimento(); return p ? [p] : []; },
        salvarLocal: item => armazenamento.salvarPerfilAcolhimento(item),
        excluirLocal: () => armazenamento.excluirPerfilAcolhimento()
      },
      // Só os campos de texto da caixa de acolhimento sincronizam nesta versão.
      // Foto e áudio ficam somente neste aparelho (mesmo limite já existe hoje
      // no backup JSON local) — nunca tocamos nesses campos aqui.
      caixaAcolhimento: {
        buscarTodosLocal: async () => {
          const c = await armazenamento.buscarCaixaAcolhimento();
          if (!c) return [];
          const { photo, audio, ...texto } = c;
          return [texto];
        },
        salvarLocal: async item => {
          const atual = (await armazenamento.buscarCaixaAcolhimento()) || { id: 'minha-caixa' };
          await armazenamento.salvarCaixaAcolhimento({ ...atual, ...item });
        },
        excluirLocal: null // tombstone de texto não deve apagar foto/áudio locais
      }
    };
  }

  let app = null, auth = null, db = null, armazenamento = null;
  let chaveSincronizacao = null; // CryptoKey AES-GCM em memória; nunca persistida
  let operacaoSincronizacaoEmAndamento = false;
  let ultimaSincronizacao = null;
  let ultimoErro = null;

  function inicializar(storage) {
    armazenamento = storage;
    if (app) return;
    app = initializeApp(CONFIGURACAO_FIREBASE);
    auth = getAuth(app);
    db = getFirestore(app);
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
      try { connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true }); } catch {}
      try { connectFirestoreEmulator(db, 'localhost', 8085); } catch {}
    }
  }

  // --- Derivação da chave de sincronização (mesmo padrão do PIN local) -----
  function bytesBase64(bytes) { return btoa(String.fromCharCode(...bytes)); }
  function base64Bytes(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }

  async function derivarBitsBrutos(frase, salBase64, iteracoes) {
    const sal = base64Bytes(salBase64);
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(frase), 'PBKDF2', false, ['deriveBits']);
    return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: sal, iterations: iteracoes, hash: 'SHA-256' }, material, 256);
  }
  async function derivarHashVerificacao(frase, salBase64, iteracoes) {
    const bits = await derivarBitsBrutos(frase, salBase64, iteracoes);
    const hkdf = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveBits']);
    const saida = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode('portoSeguro.sync-verificacao.v1') }, hkdf, 256);
    return bytesBase64(new Uint8Array(saida));
  }
  async function derivarChave(frase, salBase64, iteracoes) {
    const bits = await derivarBitsBrutos(frase, salBase64, iteracoes);
    const hkdf = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode('portoSeguro.sync-cifragem.v1') }, hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  function definirChaveSincronizacao(chave) { chaveSincronizacao = chave || null; }
  function limparChaveSincronizacao() { chaveSincronizacao = null; }
  function temChaveSincronizacao() { return chaveSincronizacao !== null; }

  // --- Conta ---------------------------------------------------------------
  async function criarContaComEmailSenha(email, senha) {
    const cred = await createUserWithEmailAndPassword(auth, email, senha);
    return cred.user;
  }
  async function entrarComEmailSenha(email, senha) {
    const cred = await signInWithEmailAndPassword(auth, email, senha);
    return cred.user;
  }
  async function entrarComGoogle() {
    const cred = await signInWithPopup(auth, new GoogleAuthProvider());
    return cred.user;
  }
  async function sair() {
    limparChaveSincronizacao();
    if (auth) await signOutFirebase(auth);
  }
  function usuarioAtual() { return auth?.currentUser || null; }
  function aoMudarSessao(callback) { return onAuthStateChanged(auth, callback); }

  // --- Metadados de sincronização (salt + hash de verificação) --------------
  async function buscarMetadadoUsuario() {
    const uid = usuarioAtual()?.uid;
    if (!uid) return null;
    const snap = await getDoc(doc(db, 'usuarios', uid));
    return snap.exists() ? snap.data() : null;
  }

  async function existeChaveSincronizacaoConfigurada() {
    return Boolean(await buscarMetadadoUsuario());
  }

  // Primeira vez para esta conta: cria o salt, deriva hash + chave, grava no Firestore.
  async function configurarChaveSincronizacaoPelaPrimeiraVez(frase) {
    const uid = usuarioAtual()?.uid;
    if (!uid) throw new Error('Entre na sua conta antes de configurar a chave de sincronização.');
    const salBase64 = bytesBase64(crypto.getRandomValues(new Uint8Array(16)));
    const [hash, chave] = await Promise.all([
      derivarHashVerificacao(frase, salBase64, ITERACOES_SINCRONIZACAO),
      derivarChave(frase, salBase64, ITERACOES_SINCRONIZACAO)
    ]);
    await setDoc(doc(db, 'usuarios', uid), {
      saltSincronizacao: salBase64,
      hashVerificacaoSincronizacao: hash,
      iteracoesSincronizacao: ITERACOES_SINCRONIZACAO,
      criadoEm: new Date().toISOString()
    });
    chaveSincronizacao = chave;
  }

  // Aparelho novo (ou nova sessão): confere a frase digitada contra o hash salvo.
  async function desbloquearChaveSincronizacao(frase) {
    const meta = await buscarMetadadoUsuario();
    if (!meta) throw new Error('Ainda não existe uma chave de sincronização para esta conta.');
    const hash = await derivarHashVerificacao(frase, meta.saltSincronizacao, meta.iteracoesSincronizacao);
    if (hash !== meta.hashVerificacaoSincronizacao) throw new Error('Chave de sincronização incorreta.');
    chaveSincronizacao = await derivarChave(frase, meta.saltSincronizacao, meta.iteracoesSincronizacao);
  }

  // --- Envelope (mesmo formato de storage.js, cifrado com a chave de sync) --
  async function empacotar(valor, camposClaros) {
    const claros = {}, resto = { ...valor };
    camposClaros.forEach(c => { claros[c] = resto[c]; delete resto[c]; });
    const envelope = await armazenamento.cifrarObjeto(chaveSincronizacao, resto);
    return { ...claros, cifrado: true, iv: envelope.iv, dados: envelope.dados, atualizadoServidor: serverTimestamp() };
  }
  async function desempacotar(bruto) {
    if (!bruto || !bruto.cifrado) return null;
    const resto = await armazenamento.decifrarObjeto(chaveSincronizacao, bruto);
    const { cifrado, iv, dados, atualizadoServidor, ...claros } = bruto;
    return { ...claros, ...resto };
  }

  // --- Bookkeeping local de sincronização (não é segredo) -------------------
  function estadoSync() { try { return JSON.parse(localStorage.getItem(CHAVE_ESTADO_SYNC) || '{}'); } catch { return {}; } }
  function salvarEstadoSync(estado) { try { localStorage.setItem(CHAVE_ESTADO_SYNC, JSON.stringify(estado)); } catch {} }

  async function enviarDocumento(uid, nomeColecao, id, valorClaro) {
    const envelope = await empacotar(valorClaro, ['id']);
    await setDoc(doc(db, 'usuarios', uid, nomeColecao, id), envelope);
  }
  async function enviarTombstone(uid, nomeColecao, id) {
    const envelope = await empacotar({ id, excluido: true, excluidoEm: new Date().toISOString() }, ['id']);
    await setDoc(doc(db, 'usuarios', uid, nomeColecao, id), envelope);
  }

  // Sincroniza uma coleção (last-write-wins por documento, com exclusão via
  // tombstone para não "ressuscitar" localmente algo apagado em outro aparelho).
  async function sincronizarColecao(uid, nomeColecao, config, bookkeeping) {
    const locais = await config.buscarTodosLocal();
    const localPorId = new Map(locais.map(r => [r.id, r]));

    const snapshotRemoto = await getDocs(collection(db, 'usuarios', uid, nomeColecao));
    const remotoPorId = new Map();
    for (const docSnap of snapshotRemoto.docs) {
      const bruto = docSnap.data();
      const claro = await desempacotar(bruto);
      if (claro) remotoPorId.set(docSnap.id, { claro, atualizadoEmMs: bruto.atualizadoServidor?.toMillis?.() ?? Date.now() });
    }

    const todosIds = new Set([...localPorId.keys(), ...remotoPorId.keys()]);
    for (const id of todosIds) {
      const local = localPorId.get(id) || null;
      const remoto = remotoPorId.get(id) || null;
      const marcaConhecida = bookkeeping[id] || null;
      const localAssinatura = local ? (local.updatedAt || local.createdAt || null) : null;

      if (remoto?.claro?.excluido) {
        if (local && config.excluirLocal) await config.excluirLocal(id);
        bookkeeping[id] = { remotoMs: remoto.atualizadoEmMs, local: null };
        continue;
      }
      if (local && !remoto) {
        await enviarDocumento(uid, nomeColecao, id, local);
        bookkeeping[id] = { remotoMs: Date.now(), local: localAssinatura };
        continue;
      }
      if (!local && remoto) {
        if (marcaConhecida) {
          // já sincronizamos este registro antes; sumiu localmente => foi excluído aqui
          if (config.excluirLocal) await enviarTombstone(uid, nomeColecao, id);
          bookkeeping[id] = { remotoMs: Date.now(), local: null };
        } else {
          await config.salvarLocal(remoto.claro);
          bookkeeping[id] = { remotoMs: remoto.atualizadoEmMs, local: remoto.claro.updatedAt || remoto.claro.createdAt || null };
        }
        continue;
      }
      // existe dos dois lados
      const localMudou = localAssinatura !== (marcaConhecida?.local ?? null);
      const remotoMudou = !marcaConhecida || remoto.atualizadoEmMs > marcaConhecida.remotoMs;
      if (remotoMudou && !localMudou) {
        await config.salvarLocal(remoto.claro);
        bookkeeping[id] = { remotoMs: remoto.atualizadoEmMs, local: remoto.claro.updatedAt || remoto.claro.createdAt || null };
      } else if (localMudou && !remotoMudou) {
        await enviarDocumento(uid, nomeColecao, id, local);
        bookkeeping[id] = { remotoMs: Date.now(), local: localAssinatura };
      } else if (localMudou && remotoMudou) {
        // conflito real (mudou nos dois aparelhos desde a última sincronização):
        // a versão com carimbo de servidor mais recente decide, de forma previsível.
        await config.salvarLocal(remoto.claro);
        bookkeeping[id] = { remotoMs: remoto.atualizadoEmMs, local: remoto.claro.updatedAt || remoto.claro.createdAt || null };
      }
      // nenhum dos dois mudou: nada a fazer
    }
  }

  async function sincronizarAgora() {
    if (operacaoSincronizacaoEmAndamento) return { pausado: true };
    const uid = usuarioAtual()?.uid;
    if (!uid || !chaveSincronizacao || !armazenamento) return { pausado: true };
    operacaoSincronizacaoEmAndamento = true;
    ultimoErro = null;
    try {
      const colecoes = definirColecoes(armazenamento);
      const estado = estadoSync();
      for (const nomeColecao of Object.keys(colecoes)) {
        const bookkeeping = estado[nomeColecao] || (estado[nomeColecao] = {});
        try { await sincronizarColecao(uid, nomeColecao, colecoes[nomeColecao], bookkeeping); }
        catch (erro) { console.error(`Sincronização de ${nomeColecao} falhou:`, erro?.name || 'Erro', erro?.message || ''); ultimoErro = `${nomeColecao}: ${erro?.message || 'erro desconhecido'}`; }
      }
      salvarEstadoSync(estado);
      ultimaSincronizacao = new Date().toISOString();
      return { ok: !ultimoErro, erro: ultimoErro, quando: ultimaSincronizacao };
    } finally {
      operacaoSincronizacaoEmAndamento = false;
    }
  }

  function status() {
    return {
      logado: Boolean(usuarioAtual()),
      email: usuarioAtual()?.email || null,
      chaveSincronizacaoPronta: temChaveSincronizacao(),
      ultimaSincronizacao,
      ultimoErro,
      emAndamento: operacaoSincronizacaoEmAndamento
    };
  }

  return {
    inicializar,
    criarContaComEmailSenha, entrarComEmailSenha, entrarComGoogle, sair, usuarioAtual, aoMudarSessao,
    existeChaveSincronizacaoConfigurada, configurarChaveSincronizacaoPelaPrimeiraVez, desbloquearChaveSincronizacao,
    definirChaveSincronizacao, limparChaveSincronizacao, temChaveSincronizacao,
    sincronizarAgora, status
  };
})();
