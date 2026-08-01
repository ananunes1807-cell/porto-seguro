'use strict';

// Camada única de persistência do diário. A interface nunca acessa IndexedDB diretamente.
window.PortoSeguroStorage = (() => {
  const NOME_BANCO = 'portoSeguroDB';
  const VERSAO_BANCO = 2;
  const STORE_REGISTROS = 'registros';
  const STORE_METADADOS = 'metadados';
  const STORE_PLANOS = 'planosSeguranca';
  const META_MIGRACAO = 'migracaoLocalStorageV1';
  let banco = null;
  let modo = 'indexeddb';
  let configuracao = null;

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
        if (!db.objectStoreNames.contains(STORE_METADADOS)) db.createObjectStore(STORE_METADADOS, { keyPath: 'key' });
        if (!db.objectStoreNames.contains(STORE_PLANOS)) db.createObjectStore(STORE_PLANOS, { keyPath: 'id' });
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
    return lista.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
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
    return requisicao(tx.objectStore(STORE_REGISTROS).get(id));
  }

  async function salvar(registro) {
    if (modo !== 'indexeddb') {
      const lista = await buscarTodos();
      const indice = lista.findIndex(item => item.id === registro.id);
      if (indice >= 0) lista[indice] = registro; else lista.push(registro);
      salvarFallback(lista);
      return;
    }
    const tx = banco.transaction(STORE_REGISTROS, 'readwrite');
    tx.objectStore(STORE_REGISTROS).put(registro);
    await concluirTransacao(tx);
  }

  async function excluir(id) {
    if (modo !== 'indexeddb') return salvarFallback((await buscarTodos()).filter(item => item.id !== id));
    const tx = banco.transaction(STORE_REGISTROS, 'readwrite');
    tx.objectStore(STORE_REGISTROS).delete(id);
    await concluirTransacao(tx);
  }

  async function importar(lista, substituir = false) {
    if (modo !== 'indexeddb') {
      const atuais = substituir ? [] : await buscarTodos();
      salvarFallback([...new Map([...atuais, ...lista].map(item => [item.id, item])).values()]);
      return;
    }
    const tx = banco.transaction(STORE_REGISTROS, 'readwrite');
    const store = tx.objectStore(STORE_REGISTROS);
    if (substituir) store.clear();
    lista.forEach(item => store.put(item));
    await concluirTransacao(tx);
  }

  async function buscarPlanoSeguranca() {
    if (modo !== 'indexeddb') return null;
    const tx = banco.transaction(STORE_PLANOS, 'readonly');
    return requisicao(tx.objectStore(STORE_PLANOS).get('plano-pessoal'));
  }

  async function salvarPlanoSeguranca(plano) {
    if (modo !== 'indexeddb') throw new Error('O plano pessoal requer IndexedDB neste navegador.');
    const tx = banco.transaction(STORE_PLANOS, 'readwrite');
    tx.objectStore(STORE_PLANOS).put({ ...plano, id: 'plano-pessoal' });
    await concluirTransacao(tx);
  }

  async function excluirPlanoSeguranca() {
    if (modo !== 'indexeddb') return;
    const tx = banco.transaction(STORE_PLANOS, 'readwrite');
    tx.objectStore(STORE_PLANOS).delete('plano-pessoal');
    await concluirTransacao(tx);
  }

  return { inicializar, buscarTodos, buscarPorId, salvar, excluir, importar, buscarMetadado, buscarPlanoSeguranca, salvarPlanoSeguranca, excluirPlanoSeguranca, informacoes: () => ({ nome: NOME_BANCO, versao: VERSAO_BANCO, stores: [STORE_REGISTROS, STORE_METADADOS, STORE_PLANOS], modo }) };
})();
