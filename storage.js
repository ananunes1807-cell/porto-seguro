'use strict';

// Camada única de persistência do diário. A interface nunca acessa IndexedDB diretamente.
window.PortoSeguroStorage = (() => {
  const NOME_BANCO = 'portoSeguroDB';
  const VERSAO_BANCO = 5;
  const STORE_REGISTROS = 'registros';
  const STORE_METADADOS = 'metadados';
  const STORE_PLANOS = 'planosSeguranca';
  const STORE_ACOLHIMENTO = 'caixaAcolhimento';
  const STORE_AUDIOS = 'audiosDiario';
  const STORE_PERFIL = 'perfilAcolhimento';
  const STORE_FEEDBACK = 'feedbackApoio';
  const STORE_RELATORIOS = 'relatoriosSalvos';
  const META_MIGRACAO = 'migracaoLocalStorageV1';
  const META_CRIPTO = 'criptografiaV1';
  let banco = null;
  let modo = 'indexeddb';
  let configuracao = null;
  let chaveAtual = null; // CryptoKey AES-GCM em memória; nunca é persistida. Ausente = dados em texto simples.

  function requisicao(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('Falha em uma operação do IndexedDB.'));
    });
  }

  function concluirTransacao(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error || new Error('A transação foi cancelada.'));
      tx.onerror = () => reject(tx.error || new Error('A transação falhou.'));
    });
  }

  // A atualização de esquema acontece somente aqui.
  function abrirBanco() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB indisponível.'));
      const abertura = indexedDB.open(NOME_BANCO, VERSAO_BANCO);
      abertura.onupgradeneeded = () => {
        const db = abertura.result;
        const registros = db.objectStoreNames.contains(STORE_REGISTROS)
          ? abertura.transaction.objectStore(STORE_REGISTROS)
          : db.createObjectStore(STORE_REGISTROS, { keyPath: 'id' });
        if (!registros.indexNames.contains('porCriacao')) registros.createIndex('porCriacao', 'createdAt');
        if (!registros.indexNames.contains('porAtualizacao')) registros.createIndex('porAtualizacao', 'updatedAt');
        if (!registros.indexNames.contains('porSentimento')) registros.createIndex('porSentimento', 'feeling');
        if (!registros.indexNames.contains('porSentimentos')) registros.createIndex('porSentimentos', 'feelings', { multiEntry: true });
        if (!db.objectStoreNames.contains(STORE_METADADOS)) db.createObjectStore(STORE_METADADOS, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(STORE_PLANOS)) db.createObjectStore(STORE_PLANOS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE_ACOLHIMENTO)) db.createObjectStore(STORE_ACOLHIMENTO, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE_AUDIOS)) db.createObjectStore(STORE_AUDIOS, { keyPath: 'recordId' });
        if (!db.objectStoreNames.contains(STORE_PERFIL)) db.createObjectStore(STORE_PERFIL, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE_FEEDBACK)) db.createObjectStore(STORE_FEEDBACK, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE_RELATORIOS)) db.createObjectStore(STORE_RELATORIOS, { keyPath: 'id' });
      };
      abertura.onsuccess = () => {
        banco = abertura.result;
        banco.onversionchange = () => banco.close();
        resolve(banco);
      };
      abertura.onerror = () => reject(abertura.error || new Error('Não foi possível abrir o banco local.'));
      abertura.onblocked = () => reject(new Error('A atualização do banco foi bloqueada por outra aba.'));
    });
  }

  // --- Criptografia local (AES-GCM 256, chave derivada do PIN) -------------
  // Cada registro guarda seus campos-chave em claro (necessários como keyPath do
  // IndexedDB) e o restante cifrado em `{iv, dados}`. Sem PIN configurado, `chaveAtual`
  // permanece nula e tudo é lido/gravado em texto simples, como antes desta camada.

  function bytesBase64(bytes) { return btoa(String.fromCharCode(...bytes)); }
  function base64Bytes(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }

  function definirChave(chave) { chaveAtual = chave || null; }
  function limparChave() { chaveAtual = null; }
  function temChave() { return chaveAtual !== null; }

  async function cifrarObjeto(chave, objeto) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const bytes = new TextEncoder().encode(JSON.stringify(objeto));
    const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, chave, bytes));
    return { iv: bytesBase64(iv), dados: bytesBase64(cifrado) };
  }

  async function decifrarObjeto(chave, envelope) {
    const iv = base64Bytes(envelope.iv), dados = base64Bytes(envelope.dados);
    const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, chave, dados);
    return JSON.parse(new TextDecoder().decode(claro));
  }

  async function cifrarBlob(chave, blob) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const cifrado = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, chave, bytes));
    const combinado = new Uint8Array(iv.length + cifrado.length);
    combinado.set(iv);
    combinado.set(cifrado, iv.length);
    return new Blob([combinado], { type: 'application/octet-stream' });
  }

  async function decifrarBlob(chave, blobCifrado, tipoOriginal) {
    const bytes = new Uint8Array(await blobCifrado.arrayBuffer());
    const iv = bytes.slice(0, 12), dados = bytes.slice(12);
    const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, chave, dados);
    return new Blob([claro], { type: tipoOriginal || 'application/octet-stream' });
  }

  // Envelopa/desenvelopa registros simples (sem Blob), mantendo `camposClaros` fora da cifra.
  async function empacotarGenerico(valor, camposClaros, chave) {
    if (!chave) return valor;
    const claros = {}, resto = { ...valor };
    camposClaros.forEach(c => { claros[c] = resto[c]; delete resto[c]; });
    const envelope = await cifrarObjeto(chave, resto);
    return { ...claros, cifrado: true, iv: envelope.iv, dados: envelope.dados };
  }

  async function desempacotarGenerico(bruto, chave) {
    if (!bruto || !bruto.cifrado) return bruto;
    if (!chave) throw new Error('Dados protegidos por PIN; desbloqueie para lê-los.');
    const resto = await decifrarObjeto(chave, bruto);
    const { cifrado, iv, dados, ...claros } = bruto;
    return { ...claros, ...resto };
  }

  // Caixa de acolhimento tem campos de Blob (foto/áudio) que não cabem no JSON cifrado.
  async function empacotarCaixaGenerico(caixa, chave) {
    if (!chave) return caixa;
    const { id, photo, audio, ...resto } = caixa;
    const envelope = await cifrarObjeto(chave, resto);
    const photoCifrada = photo instanceof Blob ? await cifrarBlob(chave, photo) : null;
    const audioCifrado = audio instanceof Blob ? await cifrarBlob(chave, audio) : null;
    return { id, cifrado: true, iv: envelope.iv, dados: envelope.dados, photo: photoCifrada, photoTipo: photo instanceof Blob ? photo.type : null, audio: audioCifrado, audioTipo: audio instanceof Blob ? audio.type : null };
  }

  async function desempacotarCaixaGenerico(bruto, chave) {
    if (!bruto || !bruto.cifrado) return bruto;
    if (!chave) throw new Error('Dados protegidos por PIN; desbloqueie para lê-los.');
    const resto = await decifrarObjeto(chave, bruto);
    const photo = bruto.photo instanceof Blob ? await decifrarBlob(chave, bruto.photo, bruto.photoTipo) : null;
    const audio = bruto.audio instanceof Blob ? await decifrarBlob(chave, bruto.audio, bruto.audioTipo) : null;
    return { id: bruto.id, ...resto, photo, audio };
  }

  async function empacotarAudioGenerico(item, chave) {
    if (!chave) return item;
    const blobCifrado = await cifrarBlob(chave, item.blob);
    return { recordId: item.recordId, cifrado: true, blob: blobCifrado, tipoOriginal: item.blob.type, createdAt: item.createdAt };
  }

  async function desempacotarAudioGenerico(bruto, chave) {
    if (!bruto || !bruto.cifrado) return bruto;
    if (!chave) throw new Error('Áudio protegido por PIN; desbloqueie para ouvi-lo.');
    const blob = await decifrarBlob(chave, bruto.blob, bruto.tipoOriginal);
    return { recordId: bruto.recordId, blob, createdAt: bruto.createdAt };
  }

  async function marcarCriptografia(ativa) {
    const tx = banco.transaction(STORE_METADADOS, 'readwrite');
    tx.objectStore(STORE_METADADOS).put({ key: META_CRIPTO, ativada: Boolean(ativa), atualizadoEm: new Date().toISOString() });
    await concluirTransacao(tx);
  }

  async function reescreverStorePadrao(nomeStore, camposClaros, chaveLeitura, chaveEscrita) {
    const txLeitura = banco.transaction(nomeStore, 'readonly');
    const brutos = await requisicao(txLeitura.objectStore(nomeStore).getAll());
    if (!brutos.length) return;
    const reescritos = [];
    for (const bruto of brutos) {
      try {
        const claro = await desempacotarGenerico(bruto, chaveLeitura);
        reescritos.push(await empacotarGenerico(claro, camposClaros, chaveEscrita));
      } catch (erro) { console.error(`Item de ${nomeStore} não pôde ser migrado:`, erro?.name || 'Erro'); }
    }
    const tx = banco.transaction(nomeStore, 'readwrite');
    const store = tx.objectStore(nomeStore);
    reescritos.forEach(item => store.put(item));
    await concluirTransacao(tx);
  }

  async function reescreverCaixaStore(chaveLeitura, chaveEscrita) {
    const txLeitura = banco.transaction(STORE_ACOLHIMENTO, 'readonly');
    const bruto = await requisicao(txLeitura.objectStore(STORE_ACOLHIMENTO).get('minha-caixa'));
    if (!bruto) return;
    const claro = await desempacotarCaixaGenerico(bruto, chaveLeitura);
    const novo = await empacotarCaixaGenerico(claro, chaveEscrita);
    const tx = banco.transaction(STORE_ACOLHIMENTO, 'readwrite');
    tx.objectStore(STORE_ACOLHIMENTO).put(novo);
    await concluirTransacao(tx);
  }

  async function reescreverAudiosStore(chaveLeitura, chaveEscrita) {
    const txLeitura = banco.transaction(STORE_AUDIOS, 'readonly');
    const brutos = await requisicao(txLeitura.objectStore(STORE_AUDIOS).getAll());
    if (!brutos.length) return;
    const reescritos = [];
    for (const bruto of brutos) {
      try {
        const claro = await desempacotarAudioGenerico(bruto, chaveLeitura);
        reescritos.push(await empacotarAudioGenerico(claro, chaveEscrita));
      } catch (erro) { console.error('Áudio não pôde ser migrado:', erro?.name || 'Erro'); }
    }
    const tx = banco.transaction(STORE_AUDIOS, 'readwrite');
    const store = tx.objectStore(STORE_AUDIOS);
    reescritos.forEach(item => store.put(item));
    await concluirTransacao(tx);
  }

  async function reescreverArmazenamento(chaveLeitura, chaveEscrita) {
    await reescreverStorePadrao(STORE_REGISTROS, ['id'], chaveLeitura, chaveEscrita);
    await reescreverStorePadrao(STORE_PLANOS, ['id'], chaveLeitura, chaveEscrita);
    await reescreverStorePadrao(STORE_PERFIL, ['id'], chaveLeitura, chaveEscrita);
    await reescreverStorePadrao(STORE_FEEDBACK, ['id'], chaveLeitura, chaveEscrita);
    await reescreverStorePadrao(STORE_RELATORIOS, ['id'], chaveLeitura, chaveEscrita);
    await reescreverCaixaStore(chaveLeitura, chaveEscrita);
    await reescreverAudiosStore(chaveLeitura, chaveEscrita);
  }

  // Usado ao criar ou trocar o PIN: decifra tudo com a chave atual (se houver) e
  // regrava com `chaveNova` (ou em texto simples, se `chaveNova` for nula ao remover o PIN).
  async function migrarCriptografia(chaveNova) {
    if (modo !== 'indexeddb') { chaveAtual = chaveNova || null; return; }
    await reescreverArmazenamento(chaveAtual, chaveNova);
    chaveAtual = chaveNova || null;
    await marcarCriptografia(Boolean(chaveNova));
  }

  // Usado em desbloqueios normais: cobre dados que ainda estejam em texto simples
  // (aparelhos que já tinham PIN antes desta camada existir). Não repete o trabalho
  // depois da primeira vez, graças ao marcador em STORE_METADADOS.
  async function ativarCriptografiaInicial() {
    if (modo !== 'indexeddb' || !chaveAtual) return;
    const meta = await buscarMetadado(META_CRIPTO);
    if (meta?.ativada) return;
    await reescreverArmazenamento(chaveAtual, chaveAtual);
    await marcarCriptografia(true);
  }

  async function criptografiaAtiva() {
    if (modo !== 'indexeddb') return false;
    const meta = await buscarMetadado(META_CRIPTO);
    return Boolean(meta?.ativada);
  }

  async function buscarMetadado(key) {
    const tx = banco.transaction(STORE_METADADOS, 'readonly');
    return requisicao(tx.objectStore(STORE_METADADOS).get(key));
  }

  function lerCopiaLocal() {
    const atual = JSON.parse(localStorage.getItem(configuracao.chaveAtual) || 'null');
    const origem = atual?.entries || JSON.parse(localStorage.getItem(configuracao.chaveAntiga) || '[]');
    if (!Array.isArray(origem)) throw new Error('A cópia local do diário possui formato inválido.');
    const normalizados = origem.map(configuracao.normalizarRegistro);
    if (normalizados.some(item => !item)) throw new Error('A cópia local contém registro inválido.');
    return normalizados;
  }

  // Importação única: IDs são preservados, duplicados são ignorados e o marcador só é
  // gravado depois de conferir todos os IDs dentro da mesma transação.
  async function migrarLocalStorage() {
    if (await buscarMetadado(META_MIGRACAO)) return { executada: false, quantidade: 0 };
    const antigos = lerCopiaLocal();
    const tx = banco.transaction([STORE_REGISTROS, STORE_METADADOS], 'readwrite');
    const store = tx.objectStore(STORE_REGISTROS);
    const meta = tx.objectStore(STORE_METADADOS);
    const idsExistentes = new Set(await requisicao(store.getAllKeys()));
    antigos.forEach(registro => { if (!idsExistentes.has(registro.id)) store.add(registro); });
    const idsDepois = new Set(await requisicao(store.getAllKeys()));
    const preservados = antigos.every(registro => idsDepois.has(registro.id));
    if (!preservados) {
      tx.abort();
      throw new Error('A conferência dos identificadores da migração falhou.');
    }
    meta.put({ key: META_MIGRACAO, completedAt: new Date().toISOString(), sourceCount: antigos.length, schemaVersion: VERSAO_BANCO });
    await concluirTransacao(tx);
    return { executada: true, quantidade: antigos.length };
  }

  async function buscarTodosIndexedDB() {
    const tx = banco.transaction(STORE_REGISTROS, 'readonly');
    const lista = await requisicao(tx.objectStore(STORE_REGISTROS).getAll());
    const claros = [];
    for (const bruto of lista) {
      try { claros.push(await desempacotarGenerico(bruto, chaveAtual)); }
      catch (erro) { console.error('Registro não pôde ser lido:', erro?.name || 'Erro'); }
    }
    return claros.map(configuracao.normalizarRegistro).filter(Boolean).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  function salvarFallback(lista) {
    localStorage.setItem(configuracao.chaveAtual, JSON.stringify({ version: configuracao.versaoBackup, updatedAt: new Date().toISOString(), entries: lista }));
  }

  async function inicializar(opcoes) {
    configuracao = opcoes;
    try {
      await abrirBanco();
      const migracao = await migrarLocalStorage();
      modo = 'indexeddb';
      return { registros: await buscarTodosIndexedDB(), modo, migracao };
    } catch (erro) {
      modo = 'localStorage';
      console.error('Armazenamento local avançado indisponível:', erro?.name || 'Erro', erro?.message || 'sem detalhes');
      let registros = [];
      try { registros = lerCopiaLocal(); } catch (falha) { console.error('Cópia local indisponível:', falha?.name || 'Erro'); }
      return { registros, modo, migracao: { executada: false, quantidade: 0 }, erro };
    }
  }

  async function buscarTodos() {
    return modo === 'indexeddb' ? buscarTodosIndexedDB() : lerCopiaLocal();
  }

  async function buscarPorId(id) {
    if (modo !== 'indexeddb') return (await buscarTodos()).find(item => item.id === id) || null;
    const tx = banco.transaction(STORE_REGISTROS, 'readonly');
    const bruto = await requisicao(tx.objectStore(STORE_REGISTROS).get(id));
    return desempacotarGenerico(bruto, chaveAtual);
  }

  async function salvar(registro) {
    if (modo !== 'indexeddb') {
      const lista = await buscarTodos();
      const indice = lista.findIndex(item => item.id === registro.id);
      if (indice >= 0) lista[indice] = registro; else lista.push(registro);
      salvarFallback(lista);
      return;
    }
    const paraGravar = await empacotarGenerico(registro, ['id'], chaveAtual);
    const tx = banco.transaction(STORE_REGISTROS, 'readwrite');
    tx.objectStore(STORE_REGISTROS).put(paraGravar);
    await concluirTransacao(tx);
  }

  async function excluir(id) {
    if (modo !== 'indexeddb') return salvarFallback((await buscarTodos()).filter(item => item.id !== id));
    const tx = banco.transaction([STORE_REGISTROS, STORE_AUDIOS], 'readwrite');
    tx.objectStore(STORE_REGISTROS).delete(id);
    tx.objectStore(STORE_AUDIOS).delete(id);
    await concluirTransacao(tx);
  }

  async function importar(lista, substituir = false) {
    if (modo !== 'indexeddb') {
      const atuais = substituir ? [] : await buscarTodos();
      salvarFallback([...new Map([...atuais, ...lista].map(item => [item.id, item])).values()]);
      return;
    }
    const paraGravar = [];
    for (const item of lista) paraGravar.push(await empacotarGenerico(item, ['id'], chaveAtual));
    const tx = banco.transaction(STORE_REGISTROS, 'readwrite');
    const store = tx.objectStore(STORE_REGISTROS);
    if (substituir) store.clear();
    paraGravar.forEach(item => store.put(item));
    await concluirTransacao(tx);
  }

  async function buscarPlanoSeguranca() {
    if (modo !== 'indexeddb') return null;
    const tx = banco.transaction(STORE_PLANOS, 'readonly');
    const bruto = await requisicao(tx.objectStore(STORE_PLANOS).get('plano-pessoal'));
    return desempacotarGenerico(bruto, chaveAtual);
  }

  async function salvarPlanoSeguranca(plano) {
    if (modo !== 'indexeddb') throw new Error('O plano pessoal requer IndexedDB neste navegador.');
    const paraGravar = await empacotarGenerico({ ...plano, id: 'plano-pessoal' }, ['id'], chaveAtual);
    const tx = banco.transaction(STORE_PLANOS, 'readwrite');
    tx.objectStore(STORE_PLANOS).put(paraGravar);
    await concluirTransacao(tx);
  }

  async function excluirPlanoSeguranca() {
    if (modo !== 'indexeddb') return;
    const tx = banco.transaction(STORE_PLANOS, 'readwrite');
    tx.objectStore(STORE_PLANOS).delete('plano-pessoal');
    await concluirTransacao(tx);
  }

  async function buscarCaixaAcolhimento() {
    if (modo !== 'indexeddb') return null;
    const tx = banco.transaction(STORE_ACOLHIMENTO, 'readonly');
    const bruto = await requisicao(tx.objectStore(STORE_ACOLHIMENTO).get('minha-caixa'));
    return desempacotarCaixaGenerico(bruto, chaveAtual);
  }
  async function salvarCaixaAcolhimento(caixa) {
    if (modo !== 'indexeddb') throw new Error('IndexedDB indisponível.');
    const paraGravar = await empacotarCaixaGenerico({ ...caixa, id: 'minha-caixa' }, chaveAtual);
    const tx = banco.transaction(STORE_ACOLHIMENTO, 'readwrite');
    tx.objectStore(STORE_ACOLHIMENTO).put(paraGravar);
    await concluirTransacao(tx);
  }
  async function excluirCaixaAcolhimento() { if (modo !== 'indexeddb') return; const tx = banco.transaction(STORE_ACOLHIMENTO, 'readwrite'); tx.objectStore(STORE_ACOLHIMENTO).delete('minha-caixa'); await concluirTransacao(tx); }

  async function buscarAudioDiario(recordId) {
    if (modo !== 'indexeddb') return null;
    const tx = banco.transaction(STORE_AUDIOS, 'readonly');
    const bruto = await requisicao(tx.objectStore(STORE_AUDIOS).get(recordId));
    return desempacotarAudioGenerico(bruto, chaveAtual);
  }
  async function salvarAudioDiario(recordId, blob) {
    if (modo !== 'indexeddb') throw new Error('IndexedDB indisponível.');
    const paraGravar = await empacotarAudioGenerico({ recordId, blob, createdAt: new Date().toISOString() }, chaveAtual);
    const tx = banco.transaction(STORE_AUDIOS, 'readwrite');
    tx.objectStore(STORE_AUDIOS).put(paraGravar);
    await concluirTransacao(tx);
  }
  async function excluirAudioDiario(recordId) { if (modo !== 'indexeddb') return; const tx = banco.transaction(STORE_AUDIOS, 'readwrite'); tx.objectStore(STORE_AUDIOS).delete(recordId); await concluirTransacao(tx); }

  async function buscarPerfilAcolhimento() {
    if (modo !== 'indexeddb') return null;
    const tx = banco.transaction(STORE_PERFIL, 'readonly');
    const bruto = await requisicao(tx.objectStore(STORE_PERFIL).get('meu-perfil'));
    return desempacotarGenerico(bruto, chaveAtual);
  }
  async function salvarPerfilAcolhimento(perfil) {
    if (modo !== 'indexeddb') throw new Error('IndexedDB indisponível.');
    const paraGravar = await empacotarGenerico({ ...perfil, id: 'meu-perfil' }, ['id'], chaveAtual);
    const tx = banco.transaction(STORE_PERFIL, 'readwrite');
    tx.objectStore(STORE_PERFIL).put(paraGravar);
    await concluirTransacao(tx);
  }
  async function excluirPerfilAcolhimento() { if (modo !== 'indexeddb') return; const tx = banco.transaction(STORE_PERFIL, 'readwrite'); tx.objectStore(STORE_PERFIL).delete('meu-perfil'); await concluirTransacao(tx); }

  async function buscarFeedbackApoio() {
    if (modo !== 'indexeddb') return [];
    const tx = banco.transaction(STORE_FEEDBACK, 'readonly');
    const lista = await requisicao(tx.objectStore(STORE_FEEDBACK).getAll());
    const claros = [];
    for (const bruto of lista) {
      try { claros.push(await desempacotarGenerico(bruto, chaveAtual)); }
      catch (erro) { console.error('Item de feedback não pôde ser lido:', erro?.name || 'Erro'); }
    }
    return claros;
  }
  async function salvarFeedbackApoio(item) {
    if (modo !== 'indexeddb') return;
    const paraGravar = await empacotarGenerico(item, ['id'], chaveAtual);
    const tx = banco.transaction(STORE_FEEDBACK, 'readwrite');
    tx.objectStore(STORE_FEEDBACK).put(paraGravar);
    await concluirTransacao(tx);
  }

  async function salvarRelatorio(item) {
    if (modo !== 'indexeddb') throw new Error('IndexedDB indisponível.');
    const paraGravar = await empacotarGenerico(item, ['id'], chaveAtual);
    const tx = banco.transaction(STORE_RELATORIOS, 'readwrite');
    tx.objectStore(STORE_RELATORIOS).put(paraGravar);
    await concluirTransacao(tx);
  }

  return {
    inicializar, buscarTodos, buscarPorId, salvar, excluir, importar, buscarMetadado,
    buscarPlanoSeguranca, salvarPlanoSeguranca, excluirPlanoSeguranca,
    buscarCaixaAcolhimento, salvarCaixaAcolhimento, excluirCaixaAcolhimento,
    buscarAudioDiario, salvarAudioDiario, excluirAudioDiario,
    buscarPerfilAcolhimento, salvarPerfilAcolhimento, excluirPerfilAcolhimento,
    buscarFeedbackApoio, salvarFeedbackApoio, salvarRelatorio,
    definirChave, limparChave, temChave, migrarCriptografia, ativarCriptografiaInicial, criptografiaAtiva,
    informacoes: () => ({ nome: NOME_BANCO, versao: VERSAO_BANCO, stores: [STORE_REGISTROS, STORE_METADADOS, STORE_PLANOS, STORE_ACOLHIMENTO, STORE_AUDIOS, STORE_PERFIL, STORE_FEEDBACK, STORE_RELATORIOS], modo, cifrado: chaveAtual !== null })
  };
})();
