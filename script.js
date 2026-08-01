'use strict';
const CHAVE = 'portoSeguro.diario.v2', CHAVE_ANTIGA = 'portoSeguro.diario.v1', CHAVE_CONTATO = 'portoSeguro.contato.v1', VERSAO = 2;
const $ = (s, raiz = document) => raiz.querySelector(s), $$ = (s, raiz = document) => [...raiz.querySelectorAll(s)];
const estado = { registros: [], backup: null, respiracao: { ativa: false, pausada: false, ciclo: 0, fase: 'inspirar', restante: 4, timer: null }, ultimoFoco: null };

function idSeguro() { return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function dataValida(valor) { return typeof valor === 'string' && !Number.isNaN(Date.parse(valor)); }
function normalizarRegistro(item) {
  if (!item || typeof item.id !== 'string' || typeof item.text !== 'string' || !dataValida(item.createdAt)) return null;
  return { id: item.id, title: String(item.title || gerarTitulo(item.text, item.createdAt)), feeling: String(item.feeling || 'Ainda não sei dizer'), intensity: Number.isInteger(item.intensity) && item.intensity >= 0 && item.intensity <= 10 ? item.intensity : null, text: item.text, helped: String(item.helped || ''), worsened: String(item.worsened || ''), strategies: Array.isArray(item.strategies) ? item.strategies.filter(x => typeof x === 'string') : [], createdAt: item.createdAt, updatedAt: dataValida(item.updatedAt) ? item.updatedAt : null, history: Array.isArray(item.history) ? item.history : [] };
}
function carregar() {
  try {
    const atual = JSON.parse(localStorage.getItem(CHAVE) || 'null');
    const origem = atual?.entries || JSON.parse(localStorage.getItem(CHAVE_ANTIGA) || '[]');
    const registros = (Array.isArray(origem) ? origem : []).map(normalizarRegistro).filter(Boolean);
    if (!atual && registros.length) persistir(registros);
    return registros;
  } catch (erro) { console.error('Falha ao ler o diário.', erro); status('Não foi possível ler os registros deste navegador.', true); return []; }
}
function persistir(lista = estado.registros) {
  try { localStorage.setItem(CHAVE, JSON.stringify({ version: VERSAO, updatedAt: new Date().toISOString(), entries: lista })); return true; }
  catch (erro) { console.error('Falha ao salvar o diário.', erro); status('Não foi possível salvar. O armazenamento pode estar cheio ou indisponível. Faça backup do que puder.', true); return false; }
}
function status(texto, erro = false) { const el = $('#status-app'); if (!el) return; el.textContent = texto; el.classList.toggle('erro', erro); }
function formatarData(valor) { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(valor)); }
function gerarTitulo(texto, data = new Date().toISOString()) { const inicio = String(texto).trim().replace(/\s+/g, ' ').split(' ').slice(0, 7).join(' '); return inicio ? `${inicio}${String(texto).trim().split(/\s+/).length > 7 ? '…' : ''}` : `Registro de ${new Intl.DateTimeFormat('pt-BR').format(new Date(data))}`; }
function sentimentoSelecionado() { return $('input[name="sentimento"]:checked')?.value || 'Ainda não sei dizer'; }

function limparFormulario() {
  $('#form-diario').reset(); $('#registro-id').value = ''; $('#valor-intensidade').textContent = '5'; $('#intensidade-registro').disabled = false; $('#status-edicao').hidden = true; $('#cancelar-edicao').hidden = true; $('#salvar-registro').textContent = 'Salvar no meu aparelho'; $('#mensagem-sugestao').textContent = '';
}
function salvarRegistro(evento) {
  evento.preventDefault(); const texto = $('#texto-registro').value.trim(); if (!texto) return $('#texto-registro').focus();
  const agora = new Date().toISOString(), id = $('#registro-id').value, indice = estado.registros.findIndex(r => r.id === id);
  const dados = { title: $('#titulo-registro').value.trim() || gerarTitulo(texto, agora), feeling: sentimentoSelecionado(), intensity: $('#intensidade-incerta').checked ? null : Number($('#intensidade-registro').value), text: texto, helped: $('#ajudou-registro').value.trim(), worsened: $('#piorou-registro').value.trim() };
  const anteriores = [...estado.registros];
  if (indice >= 0) {
    const anterior = estado.registros[indice], versao = { title: anterior.title, feeling: anterior.feeling, intensity: anterior.intensity, text: anterior.text, helped: anterior.helped, worsened: anterior.worsened, savedAt: anterior.updatedAt || anterior.createdAt };
    estado.registros[indice] = { ...anterior, ...dados, updatedAt: agora, history: [...anterior.history, versao] };
  } else estado.registros.unshift({ id: idSeguro(), ...dados, strategies: [], createdAt: agora, updatedAt: null, history: [] });
  if (!persistir()) { estado.registros = anteriores; return; }
  limparFormulario(); renderizar(); status(indice >= 0 ? 'Alterações salvas. A versão anterior foi preservada.' : 'Registro salvo neste aparelho.');
}
function editar(id) {
  const r = estado.registros.find(x => x.id === id); if (!r) return;
  $('#registro-id').value = r.id; $('#titulo-registro').value = r.title; $('#texto-registro').value = r.text; $('#ajudou-registro').value = r.helped; $('#piorou-registro').value = r.worsened;
  const radio = $(`input[name="sentimento"][value="${CSS.escape(r.feeling)}"]`) || $('input[name="sentimento"]'); radio.checked = true;
  $('#intensidade-incerta').checked = r.intensity === null; $('#intensidade-registro').disabled = r.intensity === null; $('#intensidade-registro').value = r.intensity ?? 5; $('#valor-intensidade').textContent = r.intensity ?? '—'; $('#status-edicao').hidden = false; $('#cancelar-edicao').hidden = false; $('#salvar-registro').textContent = 'Salvar alterações'; $('#form-diario').scrollIntoView({ behavior: movimento(), block: 'start' }); $('#titulo-registro').focus({ preventScroll: true });
}
function excluir(id) {
  const r = estado.registros.find(x => x.id === id); if (!r || !confirm(`ATENÇÃO: excluir “${r.title}” apagará também seu histórico. Essa ação não pode ser desfeita. Deseja continuar?`)) return;
  const anterior = estado.registros; estado.registros = estado.registros.filter(x => x.id !== id); if (!persistir()) { estado.registros = anterior; return; } if ($('#registro-id').value === id) limparFormulario(); renderizar(); status('Registro excluído deste aparelho.');
}
function filtros() { return { busca: $('#pesquisa').value.trim().toLocaleLowerCase('pt-BR'), sentimento: $('#filtro-sentimento').value, data: $('#filtro-data').value }; }
function registrosVisiveis() {
  const f = filtros(); return [...estado.registros].filter(r => (!f.busca || [r.title, r.text, r.helped, r.worsened].join(' ').toLocaleLowerCase('pt-BR').includes(f.busca)) && (!f.sentimento || r.feeling === f.sentimento) && (!f.data || r.createdAt.slice(0, 10) === f.data)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
function renderizar() {
  const lista = $('#lista-registros'); lista.replaceChildren(); $('#contador-registros').textContent = `${estado.registros.length} ${estado.registros.length === 1 ? 'registro' : 'registros'}`;
  const visiveis = registrosVisiveis(); $('#sem-resultados').hidden = visiveis.length > 0;
  visiveis.forEach(r => {
    const frag = $('#modelo-registro').content.cloneNode(true), card = $('.card-registro', frag); card.dataset.id = r.id;
    $('.registro-titulo', frag).textContent = r.title; $('.registro-data', frag).textContent = `Criado em ${formatarData(r.createdAt)}`; $('.registro-intensidade', frag).textContent = r.intensity === null ? 'Intensidade: não sei' : `Intensidade: ${r.intensity}/10`; $('.registro-sentimento', frag).textContent = `Sentimento: ${r.feeling}`; $('.registro-texto', frag).textContent = r.text; $('.selecionar-registro', frag).value = r.id;
    const detalhes = $('.detalhes-registro', frag); if (r.helped) { const p = document.createElement('p'); p.textContent = `O que ajudou: ${r.helped}`; detalhes.append(p); } if (r.worsened) { const p = document.createElement('p'); p.textContent = `O que piorou: ${r.worsened}`; detalhes.append(p); }
    const ed = $('.registro-edicao', frag); if (r.updatedAt) ed.textContent = `Editado em ${formatarData(r.updatedAt)} · ${r.history.length} versão(ões) anterior(es)`; else ed.remove();
    lista.append(frag);
  });
}
function sugerir() {
  const texto = $('#texto-registro').value.toLocaleLowerCase('pt-BR'), mapa = [['Ansiedade',['ansied','aperto','preocup','nervos']],['Tristeza',['trist','chor','vazio']],['Irritação',['raiva','irrit','revolt']],['Medo',['medo','pânico','assust']],['Cansaço',['cans','exaust','esgot']],['Confusão',['confus','não sei','perdid']],['Felicidade',['feliz','alegr','orgulho']],['Calma',['calm','tranquil','alívio']],['Frustração',['frustr','decepcion']],['Sobrecarga',['sobrecarreg','peso demais','não dou conta']]];
  if (!texto.trim()) { $('#mensagem-sugestao').textContent = 'Escreva um pouco primeiro.'; return; }
  const achado = mapa.find(([, palavras]) => palavras.some(p => texto.includes(p))); if (!achado) { $('#mensagem-sugestao').textContent = 'Não encontrei uma sugestão clara. Tudo bem escolher “Ainda não sei dizer”.'; return; }
  $(`input[name="sentimento"][value="${achado[0]}"]`).checked = true; $('#mensagem-sugestao').textContent = `Sugestão local: ${achado[0]}. Confirme ou escolha outra opção; isto não é diagnóstico.`;
  if (/(me matar|suicid|não quero viver|vou me machucar)/i.test(texto)) $('#mensagem-sugestao').textContent += ' Talvez você precise de apoio humano agora. Você gostaria de ver as opções de ajuda?';
}

function baixarBackup() {
  if (!estado.registros.length) return alert('Ainda não há registros para o backup.');
  const blob = new Blob([JSON.stringify({ app: 'Porto Seguro', version: VERSAO, createdAt: new Date().toISOString(), entries: estado.registros }, null, 2)], { type: 'application/json' }), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `porto-seguro-backup-${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 0); status('Backup baixado. Guarde o arquivo em um local escolhido por você.');
}
function lerBackup(evento) {
  const arquivo = evento.target.files[0]; evento.target.value = ''; if (!arquivo || arquivo.size > 10_000_000) return status('Arquivo ausente ou maior que 10 MB.', true);
  const leitor = new FileReader(); leitor.onload = () => { try { const b = JSON.parse(leitor.result); if (b.app !== 'Porto Seguro' || !Array.isArray(b.entries)) throw Error('Formato não reconhecido.'); const validos = b.entries.map(normalizarRegistro).filter(Boolean); if (!validos.length || validos.length !== b.entries.length) throw Error('Há registros inválidos no arquivo.'); estado.backup = validos; $('#resumo-backup').textContent = `${validos.length} registro(s) válido(s). Mesclar mantém os atuais e evita IDs duplicados; substituir apaga os atuais.`; abrirModal($('#tela-restauracao')); } catch (e) { status(`Não foi possível restaurar: ${e.message}`, true); } }; leitor.onerror = () => status('Não foi possível ler o arquivo.', true); leitor.readAsText(arquivo);
}
function aplicarBackup(substituir) {
  if (!estado.backup) return; if (substituir && !confirm('Isso substituirá todos os registros atuais. Deseja continuar?')) return;
  const anteriores = estado.registros, novos = substituir ? estado.backup : [...new Map([...estado.registros, ...estado.backup].map(r => [r.id, r])).values()]; estado.registros = novos;
  if (!persistir()) estado.registros = anteriores; else { fecharModal($('#tela-restauracao')); renderizar(); status(`Backup ${substituir ? 'restaurado, substituindo' : 'mesclado com'} os registros atuais.`); } estado.backup = null;
}

function imprimirRegistros(lista, titulo) {
  const janela = open('', '_blank'); if (!janela) return status('Permita a janela de impressão no navegador.', true); janela.opener = null;
  const escapar = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  janela.document.write(`<!doctype html><meta charset="utf-8"><title>${escapar(titulo)}</title><style>body{font:16px/1.5 Arial;max-width:800px;margin:40px auto;color:#302b45}article{border-bottom:1px solid #ccc;padding:16px 0;white-space:pre-wrap}small{color:#655f77}@media print{body{margin:0}}</style><h1>${escapar(titulo)}</h1>${lista.map(r => `<article><h2>${escapar(r.title)}</h2><small>${escapar(formatarData(r.createdAt))} · ${escapar(r.feeling)} · Intensidade ${r.intensity ?? 'não informada'}</small><p>${escapar(r.text)}</p>${r.helped ? `<p><b>O que ajudou:</b> ${escapar(r.helped)}</p>` : ''}${r.worsened ? `<p><b>O que piorou:</b> ${escapar(r.worsened)}</p>` : ''}</article>`).join('')}<script>onload=()=>print()<\/script>`); janela.document.close();
}
function gerarRelatorio(evento) {
  evento.preventDefault(); const inicio = $('#relatorio-inicio').value, fim = $('#relatorio-fim').value, selecionados = new Set($$('.selecionar-registro:checked').map(x => x.value));
  const lista = estado.registros.filter(r => (!inicio || r.createdAt.slice(0,10) >= inicio) && (!fim || r.createdAt.slice(0,10) <= fim) && (!selecionados.size || selecionados.has(r.id))).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt));
  const alvo = $('#conteudo-relatorio'); alvo.replaceChildren(); if (!lista.length) { alvo.textContent = 'Nenhum registro corresponde ao período ou à seleção.'; } else {
    const resumo = document.createElement('p'); resumo.textContent = `${lista.length} registro(s). Sentimentos: ${[...new Set(lista.map(r=>r.feeling))].join(', ')}.`; alvo.append(resumo);
    lista.forEach(r => { const artigo = document.createElement('article'), h = document.createElement('h4'), p = document.createElement('p'); h.textContent = `${formatarData(r.createdAt)} — ${r.title}`; p.textContent = `${r.feeling}; intensidade ${r.intensity ?? 'não informada'}. ${r.text}${r.helped ? ` O que ajudou: ${r.helped}.` : ''}${r.worsened ? ` O que piorou: ${r.worsened}.` : ''}${r.strategies.length ? ` Estratégias: ${r.strategies.join(', ')}.` : ''}${r.history.length ? ` ${r.history.length} alteração(ões) registrada(s).` : ''}`; artigo.append(h,p); alvo.append(artigo); });
    const obs = $('#observacoes-relatorio').value.trim(); if (obs) { const p = document.createElement('p'); p.textContent = `Observações: ${obs}`; alvo.append(p); }
  } $('#resultado-relatorio').hidden = false; $('#resultado-relatorio').scrollIntoView({behavior:movimento()});
}

function movimento() { return matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'; }
function abrirModal(modal) { estado.ultimoFoco = document.activeElement; modal.hidden = false; document.body.classList.add('sem-rolagem'); $('button,a,input,[tabindex]:not([tabindex="-1"])', modal)?.focus(); }
function fecharModal(modal) { modal.hidden = true; document.body.classList.remove('sem-rolagem'); estado.ultimoFoco?.focus?.(); }
function prenderFoco(evento, modal) { if (evento.key !== 'Tab') return; const itens = $$('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])', modal).filter(x=>x.offsetParent!==null); if (!itens.length) return; const [primeiro] = itens, ultimo = itens.at(-1); if (evento.shiftKey && document.activeElement === primeiro) { evento.preventDefault(); ultimo.focus(); } else if (!evento.shiftKey && document.activeElement === ultimo) { evento.preventDefault(); primeiro.focus(); } }
function iniciarRespiracao() { const r=estado.respiracao; clearInterval(r.timer); Object.assign(r,{ativa:true,pausada:false,ciclo:1,fase:'inspirar',restante:4}); $('#acoes-respiracao').hidden=false; $('#acoes-finais').hidden=true; abrirModal($('#tela-respiracao')); atualizarRespiracao(); r.timer=setInterval(passoRespiracao,1000); }
function atualizarRespiracao() { const r=estado.respiracao; $('#instrucao-respiracao').textContent = r.fase === 'inspirar' ? 'Inspire devagar' : 'Solte o ar devagar'; $('#numero-respiracao').textContent=r.restante; $('#ciclo-respiracao').textContent=`Ciclo ${r.ciclo} de 5`; $('#pausar-respiracao').textContent=r.pausada?'Continuar':'Pausar'; }
function passoRespiracao() { const r=estado.respiracao; if (!r.ativa || r.pausada) return; r.restante--; if (r.restante <= 0) { if (r.fase==='inspirar') { r.fase='soltar'; r.restante=6; } else if (r.ciclo<5) { r.ciclo++; r.fase='inspirar'; r.restante=4; } else return finalizarRespiracao(); } atualizarRespiracao(); }
function finalizarRespiracao() { const r=estado.respiracao; clearInterval(r.timer); r.ativa=false; $('#instrucao-respiracao').textContent='Você concluiu. Perceba como está se sentindo agora.'; $('#numero-respiracao').textContent='✓'; $('#ciclo-respiracao').textContent='Cinco ciclos concluídos'; $('#acoes-respiracao').hidden=true; $('#acoes-finais').hidden=false; $('#respirar-novamente').focus(); }
function pararRespiracao() { const r=estado.respiracao; clearInterval(r.timer); r.ativa=false; fecharModal($('#tela-respiracao')); }
function registrarEstrategia() { pararRespiracao(); location.hash='diario'; $('#texto-registro').focus(); $('#texto-registro').value ||= 'Depois de respirar, estou me sentindo '; $('#ajudou-registro').value ||= 'Respiração guiada'; }

function mostrarApoio(tipo) {
  const box=$('#apoio-progressivo'); box.hidden=false;
  const textos={regular:'Coloque os pés no chão, se isso for confortável. Observe três coisas que vê, duas que ouve e uma sensação no corpo. Não precisa mudar o que sente; apenas perceba que você está aqui agora.',confianca:'Você pode escolher alguém que escute sem julgar. Se quiser, configure um contato na tela de ajuda urgente; o aplicativo só facilitará a ligação quando você tocar.',perguntas:'O que ajudaria mais agora? Você pode escrever, apenas escolher uma opção ou ficar em silêncio por alguns instantes.'}; box.textContent=textos[tipo]||textos.perguntas;
}
function contato() { try { return JSON.parse(localStorage.getItem(CHAVE_CONTATO)||'null'); } catch { return null; } }
function atualizarContato() { const c=contato(); $('#nome-contato').textContent=c?.name?c.name:'Configure um contato abaixo'; $('#contato-nome').value=c?.name||''; $('#contato-telefone').value=c?.phone||''; }

document.addEventListener('click', e => {
  const acao=e.target.closest('[data-acao]')?.dataset.acao; if (acao==='respirar') iniciarRespiracao(); if (acao==='escrever') { location.hash='diario'; $('#texto-registro').focus(); } if (acao==='regular'||acao==='confianca') mostrarApoio(acao); if (acao==='urgente') { atualizarContato(); abrirModal($('#tela-urgente')); }
  const card=e.target.closest('.card-registro'); if (card && e.target.matches('.editar-registro')) editar(card.dataset.id); if (card && e.target.matches('.excluir-registro')) excluir(card.dataset.id); if (card && e.target.matches('.imprimir-registro')) imprimirRegistros(estado.registros.filter(r=>r.id===card.dataset.id),'Registro — Porto Seguro');
});
$('#abrir-apoio').addEventListener('click',()=>{location.hash='apoio';mostrarApoio('perguntas')}); $('#form-diario').addEventListener('submit',salvarRegistro); $('#cancelar-edicao').addEventListener('click',()=>{limparFormulario();status('Edição cancelada; nenhuma alteração foi salva.')}); $('#intensidade-registro').addEventListener('input',e=>$('#valor-intensidade').textContent=e.target.value); $('#intensidade-incerta').addEventListener('change',e=>{ $('#intensidade-registro').disabled=e.target.checked; $('#valor-intensidade').textContent=e.target.checked?'—':$('#intensidade-registro').value }); $('#sugerir-sentimento').addEventListener('click',sugerir);
['pesquisa','filtro-sentimento','filtro-data'].forEach(id=>$('#'+id).addEventListener('input',renderizar)); $('#limpar-filtros').addEventListener('click',()=>{$('#pesquisa').value='';$('#filtro-sentimento').value='';$('#filtro-data').value='';renderizar()}); $('#baixar-backup').addEventListener('click',baixarBackup); $('#restaurar-backup').addEventListener('click',()=>$('#arquivo-backup').click()); $('#arquivo-backup').addEventListener('change',lerBackup); $('#mesclar-backup').addEventListener('click',()=>aplicarBackup(false)); $('#substituir-backup').addEventListener('click',()=>aplicarBackup(true)); $('#cancelar-backup').addEventListener('click',()=>{estado.backup=null;fecharModal($('#tela-restauracao'))}); $('#imprimir-diario').addEventListener('click',()=>imprimirRegistros(registrosVisiveis(),'Meu diário — Porto Seguro'));
$('#form-relatorio').addEventListener('submit',gerarRelatorio); $('#imprimir-relatorio').addEventListener('click',()=>print()); $('#pausar-respiracao').addEventListener('click',()=>{const r=estado.respiracao;r.pausada=!r.pausada;atualizarRespiracao()}); $('#parar-respiracao').addEventListener('click',pararRespiracao); $('#fechar-respiracao').addEventListener('click',pararRespiracao); $('#respirar-novamente').addEventListener('click',iniciarRespiracao); $('#registrar-apos-respirar').addEventListener('click',registrarEstrategia); $('#continuar-apoio').addEventListener('click',()=>{pararRespiracao();location.hash='apoio';mostrarApoio('perguntas')}); $('.fechar-modal').addEventListener('click',()=>fecharModal($('#tela-urgente')));
$('#form-contato').addEventListener('submit',e=>{e.preventDefault();const name=$('#contato-nome').value.trim(),phone=$('#contato-telefone').value.replace(/[^\d+]/g,'');if(!name||phone.replace(/\D/g,'').length<8)return status('Informe nome e telefone válidos.',true);try{localStorage.setItem(CHAVE_CONTATO,JSON.stringify({name,phone}));atualizarContato();status('Contato salvo somente neste navegador.')}catch{status('Não foi possível salvar o contato.',true)}}); $('#ligar-confianca').addEventListener('click',()=>{const c=contato();if(!c)return $('#contato-nome').focus();location.href=`tel:${c.phone}`});
$('#aumentar-fonte').addEventListener('click',e=>{const ativo=document.body.classList.toggle('fonte-grande');e.currentTarget.setAttribute('aria-pressed',ativo);e.currentTarget.textContent=ativo?'Texto padrão':'Aumentar texto'});
document.addEventListener('keydown',e=>{const modal=$$('.modal').find(m=>!m.hidden);if(!modal)return;if(e.key==='Escape'){modal=== $('#tela-respiracao')?pararRespiracao():fecharModal(modal)}else prenderFoco(e,modal)});

const sentimentos=[...new Set($$('input[name="sentimento"]').map(x=>x.value))]; sentimentos.forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;$('#filtro-sentimento').append(o)}); estado.registros=carregar(); renderizar();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(e=>console.info('Modo offline indisponível.',e)));
