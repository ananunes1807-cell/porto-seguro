'use strict';
const CHAVE = 'portoSeguro.diario.v2', CHAVE_ANTIGA = 'portoSeguro.diario.v1', CHAVE_CONTATO = 'portoSeguro.contato.v1', VERSAO = 2;
const $ = (s, raiz = document) => raiz.querySelector(s), $$ = (s, raiz = document) => [...raiz.querySelectorAll(s)];
const armazenamento = window.PortoSeguroStorage;
const estado = { registros: [], planoSeguranca: null, caixaAcolhimento: null, perfil: null, feedbackApoio: [], relatorioAtual: null, backup: null, armazenamentoPronto: false, audioPendente: null, audioUrl: null, gravador: null, respiracao: { ativa: false, pausada: false, ciclo: 0, fase: 'inspirar', restante: 4, timer: null }, ultimoFoco: null };
const CAMPOS_PLANO = ['sinais', 'gatilhos', 'ajuda', 'piora', 'lugares', 'contatos', 'profissionais', 'passos'];

function idSeguro() { return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function dataValida(valor) { return typeof valor === 'string' && !Number.isNaN(Date.parse(valor)); }
function normalizarPosCrise(item) {
  if (!item || typeof item !== 'object') return null;
  const intensidade = valor => Number.isInteger(valor) && valor >= 0 && valor <= 10 ? valor : null;
  return { intensityBefore: intensidade(item.intensityBefore), intensityAfter: intensidade(item.intensityAfter), trigger: String(item.trigger || ''), strategy: String(item.strategy || ''), result: String(item.result || ''), notes: String(item.notes || '') };
}
function normalizarRegistro(item) {
  if (!item || typeof item.id !== 'string' || typeof item.text !== 'string' || !dataValida(item.createdAt)) return null;
  return { id: item.id, title: String(item.title || gerarTitulo(item.text, item.createdAt)), feeling: String(item.feeling || 'Ainda não sei dizer'), intensity: Number.isInteger(item.intensity) && item.intensity >= 0 && item.intensity <= 10 ? item.intensity : null, text: item.text, helped: String(item.helped || ''), worsened: String(item.worsened || ''), strategies: Array.isArray(item.strategies) ? item.strategies.filter(x => typeof x === 'string') : [], createdAt: item.createdAt, updatedAt: dataValida(item.updatedAt) ? item.updatedAt : null, history: Array.isArray(item.history) ? item.history : [], postCrisis: normalizarPosCrise(item.postCrisis) };
}
function status(texto, erro = false) { const el = $('#status-app'); if (!el) return; el.textContent = texto; el.classList.toggle('erro', erro); }
function alternarControlesArmazenamento(habilitados) { ['salvar-registro','baixar-backup','restaurar-backup','salvar-plano','apagar-plano','salvar-pos-crise','salvar-caixa','apagar-caixa','gravar-audio','salvar-perfil','redefinir-perfil','salvar-relatorio'].forEach(id => { $('#'+id).disabled = !habilitados; }); }
function informarFalha(erro) { console.error('Operação de armazenamento não concluída:', erro?.name || 'Erro', erro?.message || 'sem detalhes'); status('Não foi possível concluir agora. Seus dados anteriores não foram apagados. Recomendamos manter seu backup em local seguro.', true); }
function formatarData(valor) { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(valor)); }
function gerarTitulo(texto, data = new Date().toISOString()) { const inicio = String(texto).trim().replace(/\s+/g, ' ').split(' ').slice(0, 7).join(' '); return inicio ? `${inicio}${String(texto).trim().split(/\s+/).length > 7 ? '…' : ''}` : `Registro de ${new Intl.DateTimeFormat('pt-BR').format(new Date(data))}`; }
function sentimentoSelecionado() { return $('input[name="sentimento"]:checked')?.value || 'Ainda não sei dizer'; }

function normalizarPlano(item) {
  if (!item || typeof item !== 'object') return null;
  const plano = { id: 'plano-pessoal', updatedAt: dataValida(item.updatedAt) ? item.updatedAt : new Date().toISOString() };
  CAMPOS_PLANO.forEach(campo => { plano[campo] = String(item[campo] || ''); });
  return plano;
}
function preencherPlano(plano) {
  CAMPOS_PLANO.forEach(campo => { $(`#plano-${campo}`).value = plano?.[campo] || ''; });
  $('#estado-plano').textContent = plano?.updatedAt ? `Atualizado em ${formatarData(plano.updatedAt)}` : 'Ainda não salvo';
}
function planoDoFormulario() {
  const plano = { id: 'plano-pessoal', updatedAt: new Date().toISOString() };
  CAMPOS_PLANO.forEach(campo => { plano[campo] = $(`#plano-${campo}`).value.trim(); });
  return plano;
}
async function salvarPlano(evento) {
  evento.preventDefault();
  const plano = planoDoFormulario();
  if (!CAMPOS_PLANO.some(campo => plano[campo])) { $('#status-plano').textContent = 'Preencha pelo menos um campo antes de salvar.'; return; }
  const botao = $('#salvar-plano'); botao.disabled = true;
  try { await armazenamento.salvarPlanoSeguranca(plano); estado.planoSeguranca = plano; preencherPlano(plano); $('#status-plano').textContent = 'Plano salvo somente neste aparelho.'; }
  catch (erro) { console.error('Plano pessoal não salvo:', erro?.name || 'Erro'); $('#status-plano').textContent = 'Não foi possível salvar o plano neste navegador. Nenhum dado anterior foi apagado.'; }
  finally { botao.disabled = false; }
}
async function apagarPlano() {
  if (!estado.planoSeguranca) { $('#status-plano').textContent = 'Ainda não há um plano salvo.'; return; }
  if (!confirm('Apagar todo o plano pessoal deste aparelho? Essa ação não pode ser desfeita.')) return;
  try { await armazenamento.excluirPlanoSeguranca(); estado.planoSeguranca = null; preencherPlano(null); $('#status-plano').textContent = 'Plano apagado deste aparelho.'; }
  catch (erro) { console.error('Plano pessoal não apagado:', erro?.name || 'Erro'); $('#status-plano').textContent = 'Não foi possível apagar o plano agora.'; }
}
function limparPosCrise() {
  $('#form-pos-crise').reset(); $('#pos-valor-antes').textContent = '5'; $('#pos-valor-depois').textContent = '5'; $('#pos-intensidade-antes').disabled = false; $('#pos-intensidade-depois').disabled = false;
}
async function salvarPosCrise(evento) {
  evento.preventDefault();
  if (!estado.armazenamentoPronto) { $('#status-pos-crise').textContent = 'Aguarde enquanto preparamos o armazenamento local.'; return; }
  const agora = new Date().toISOString();
  const postCrisis = { intensityBefore: $('#pos-incerta-antes').checked ? null : Number($('#pos-intensidade-antes').value), intensityAfter: $('#pos-incerta-depois').checked ? null : Number($('#pos-intensidade-depois').value), trigger: $('#pos-gatilho').value.trim(), strategy: $('#pos-estrategia').value.trim(), result: $('#pos-resultado').value.trim(), notes: $('#pos-observacoes').value.trim() };
  if (!postCrisis.trigger && !postCrisis.strategy && !postCrisis.result && !postCrisis.notes && postCrisis.intensityBefore === null && postCrisis.intensityAfter === null) { $('#status-pos-crise').textContent = 'Preencha ao menos uma informação antes de salvar.'; return; }
  const antes = postCrisis.intensityBefore === null ? 'não informada' : `${postCrisis.intensityBefore}/10`, depois = postCrisis.intensityAfter === null ? 'não informada' : `${postCrisis.intensityAfter}/10`;
  const partes = [`Intensidade antes: ${antes}. Intensidade depois: ${depois}.`, postCrisis.trigger && `Possível gatilho: ${postCrisis.trigger}`, postCrisis.strategy && `Estratégia utilizada: ${postCrisis.strategy}`, postCrisis.result && `Resultado percebido: ${postCrisis.result}`, postCrisis.notes && `Para lembrar ou conversar depois: ${postCrisis.notes}`].filter(Boolean);
  const registro = { id: idSeguro(), title: `Registro pós-crise — ${new Intl.DateTimeFormat('pt-BR').format(new Date(agora))}`, feeling: 'Ainda não sei dizer', intensity: postCrisis.intensityAfter, text: partes.join('\n\n') || 'Registro pós-crise de intensidade.', helped: postCrisis.result, worsened: postCrisis.trigger, strategies: postCrisis.strategy ? [postCrisis.strategy] : [], createdAt: agora, updatedAt: null, history: [], postCrisis };
  const botao = $('#salvar-pos-crise'); botao.disabled = true;
  try { await armazenamento.salvar(registro); estado.registros.unshift(registro); limparPosCrise(); renderizar(); $('#status-pos-crise').textContent = 'Registro pós-crise salvo no diário deste aparelho.'; }
  catch (erro) { console.error('Registro pós-crise não salvo:', erro?.name || 'Erro'); $('#status-pos-crise').textContent = 'Não foi possível salvar agora. Nenhum registro anterior foi apagado.'; }
  finally { botao.disabled = false; }
}
function arquivoValido(arquivo, tipo, limite) { return !arquivo || (arquivo.type.startsWith(tipo) && arquivo.size <= limite); }
function mostrarMidiaCaixa(caixa) {
  const foto=$('#preview-caixa-foto'), audio=$('#preview-caixa-audio'); foto.replaceChildren(); audio.replaceChildren();
  if(caixa?.photo instanceof Blob){const img=document.createElement('img');img.alt='Foto guardada na caixa de acolhimento';img.className='foto-acolhimento';img.src=URL.createObjectURL(caixa.photo);foto.append(img)}
  if(caixa?.audio instanceof Blob){const player=document.createElement('audio');player.controls=true;player.src=URL.createObjectURL(caixa.audio);audio.append(player)}
}
function preencherCaixa(caixa){['mensagem','funciona','lembranca','exercicio'].forEach(c=>{$(`#caixa-${c}`).value=caixa?.[c]||''});mostrarMidiaCaixa(caixa)}
async function salvarCaixa(evento){evento.preventDefault();const foto=$('#caixa-foto').files[0],audio=$('#caixa-audio').files[0];if(!arquivoValido(foto,'image/',4_000_000))return $('#status-caixa').textContent='Escolha uma imagem JPG, PNG ou WebP de até 4 MB.';if(!arquivoValido(audio,'audio/',6_000_000))return $('#status-caixa').textContent='Escolha um áudio de até 6 MB.';const atual=estado.caixaAcolhimento||{};const caixa={id:'minha-caixa',mensagem:$('#caixa-mensagem').value.trim(),funciona:$('#caixa-funciona').value.trim(),lembranca:$('#caixa-lembranca').value.trim(),exercicio:$('#caixa-exercicio').value.trim(),photo:foto||atual.photo||null,audio:audio||atual.audio||null,updatedAt:new Date().toISOString()};if(!caixa.mensagem&&!caixa.funciona&&!caixa.lembranca&&!caixa.exercicio&&!caixa.photo&&!caixa.audio)return $('#status-caixa').textContent='Adicione pelo menos um item à sua caixa.';try{await armazenamento.salvarCaixaAcolhimento(caixa);estado.caixaAcolhimento=caixa;$('#caixa-foto').value='';$('#caixa-audio').value='';mostrarMidiaCaixa(caixa);$('#status-caixa').textContent='Caixa de acolhimento salva neste aparelho.'}catch(e){console.error('Caixa não salva:',e?.name||'Erro');$('#status-caixa').textContent='Não foi possível salvar a caixa agora.'}}
async function apagarCaixa(){if(!estado.caixaAcolhimento)return $('#status-caixa').textContent='Ainda não há uma caixa salva.';if(!confirm('Apagar toda a caixa de acolhimento deste aparelho?'))return;try{await armazenamento.excluirCaixaAcolhimento();estado.caixaAcolhimento=null;preencherCaixa(null);$('#status-caixa').textContent='Caixa apagada deste aparelho.'}catch{$('#status-caixa').textContent='Não foi possível apagar a caixa agora.'}}
function descartarAudio(){if(estado.audioUrl)URL.revokeObjectURL(estado.audioUrl);estado.audioUrl=null;estado.audioPendente=null;const p=$('#preview-audio-diario');p.hidden=true;p.removeAttribute('src');$('#descartar-audio').hidden=true;$('#status-audio').textContent='Áudio descartado.'}
async function gravarAudio(){if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)return $('#status-audio').textContent='A gravação não está disponível neste navegador.';try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});const partes=[];const gravador=new MediaRecorder(stream);estado.gravador=gravador;gravador.ondataavailable=e=>{if(e.data.size)partes.push(e.data)};gravador.onstop=()=>{stream.getTracks().forEach(t=>t.stop());const blob=new Blob(partes,{type:gravador.mimeType||'audio/webm'});if(blob.size>8_000_000){$('#status-audio').textContent='O áudio passou de 8 MB e foi descartado.';return}estado.audioPendente=blob;estado.audioUrl=URL.createObjectURL(blob);const p=$('#preview-audio-diario');p.src=estado.audioUrl;p.hidden=false;$('#descartar-audio').hidden=false;$('#status-audio').textContent='Gravação pronta. Ouça antes de salvar.';$('#gravar-audio').disabled=false;$('#parar-audio').disabled=true};gravador.start();$('#gravar-audio').disabled=true;$('#parar-audio').disabled=false;$('#status-audio').textContent='Gravando… toque em parar quando terminar.'}catch(e){$('#status-audio').textContent=e?.name==='NotAllowedError'?'Permissão do microfone não concedida.':'Não foi possível iniciar a gravação.'}}
function valoresMarcados(seletor){return $$(`${seletor} input:checked`).map(x=>x.value)}
function perfilDoFormulario(){return{id:'meu-perfil',nome:$('#perfil-nome').value.trim(),tom:$('#perfil-tom').value,resposta:$('#perfil-resposta').value,orientacao:$('#perfil-orientacao').value,conforta:$('#perfil-conforta').value.trim(),evitar:$('#perfil-evitar').value.trim(),ajuda:$('#perfil-ajuda').value.trim(),piora:$('#perfil-piora').value.trim(),sinais:$('#perfil-sinais').value.trim(),fazer:$('#perfil-fazer').value.trim(),naoFazer:$('#perfil-nao-fazer').value.trim(),ambiente:valoresMarcados('#perfil-ambiente'),lembretes:valoresMarcados('#perfil-lembretes'),areas:[...valoresMarcados('#perfil-areas'),$('#perfil-outra-area').value.trim()].filter(Boolean),updatedAt:new Date().toISOString()}}
function preencherPerfil(p){const v=p||{};['nome','conforta','evitar','ajuda','piora','sinais','fazer','nao-fazer','outra-area'].forEach(c=>{$(`#perfil-${c}`).value=v[c==='nao-fazer'?'naoFazer':c==='outra-area'?'outraArea':c]||''});$('#perfil-tom').value=v.tom||'neutra';$('#perfil-resposta').value=v.resposta||'escuta';$('#perfil-orientacao').value=v.orientacao||'uma-coisa';[['#perfil-ambiente',v.ambiente],['#perfil-lembretes',v.lembretes],['#perfil-areas',v.areas]].forEach(([s,a])=>$$(`${s} input`).forEach(x=>x.checked=(a||[]).includes(x.value)));$('#estado-perfil').textContent=v.updatedAt?`Atualizado em ${formatarData(v.updatedAt)}`:'Ainda não salvo'}
async function salvarPerfil(evento){evento?.preventDefault();const p=perfilDoFormulario();try{await armazenamento.salvarPerfilAcolhimento(p);estado.perfil=p;preencherPerfil(p);$('#status-perfil').textContent='Perfil salvo automaticamente neste aparelho.'}catch(e){console.error('Perfil não salvo:',e?.name||'Erro');$('#status-perfil').textContent='Não foi possível salvar o perfil agora.'}}
let timerPerfil;function agendarPerfil(){clearTimeout(timerPerfil);timerPerfil=setTimeout(()=>salvarPerfil(),700)}
async function redefinirPerfil(){if(!estado.perfil)return $('#status-perfil').textContent='Ainda não há perfil salvo.';if(!confirm('Redefinir todas as respostas do Perfil de Acolhimento?'))return;clearTimeout(timerPerfil);try{await armazenamento.excluirPerfilAcolhimento();estado.perfil=null;$('#form-perfil').reset();preencherPerfil(null);$('#status-perfil').textContent='Perfil redefinido. O apoio neutro continua disponível.'}catch{$('#status-perfil').textContent='Não foi possível redefinir o perfil.'}}
function escolherFrase(){const p=estado.perfil||{};let frases=[];if(p.conforta)frases.push(p.conforta);if(p.resposta==='escuta')frases.push('Eu não vou tentar resolver tudo agora. Você pode colocar para fora o que aconteceu.');if(p.orientacao==='instrucoes'||p.orientacao==='uma-coisa')frases.push('Vamos fazer uma coisa por vez. Primeiro, afaste-se do que estiver aumentando a sobrecarga, se isso for possível.');if(p.tom==='carinhosa')frases.push('Você não precisa organizar tudo de uma vez. Vamos com calma, no seu tempo.');if(p.tom==='direta')frases.push('Escolha apenas o próximo passo possível agora.');if(p.tom==='tranquila')frases.push('Respire no seu ritmo. Não é necessário responder tudo agora.');if(!frases.length)frases=['Você não precisa organizar tudo agora. Escolha apenas o próximo passo possível.'];const rejeitadas=new Set(estado.feedbackApoio.filter(x=>x.avaliacao==='rejeitada').map(x=>x.frase));return frases.find(f=>!rejeitadas.has(f))||'Prefira outro tipo de apoio agora: respirar, escrever ou falar com alguém de confiança.'}
function mostrarFrase(){const frase=escolherFrase();$('#frase-personalizada').textContent=frase;$('#status-frase').textContent='';return frase}
async function avaliarFrase(avaliacao){const frase=$('#frase-personalizada').textContent;const item={id:idSeguro(),frase,avaliacao,createdAt:new Date().toISOString()};try{await armazenamento.salvarFeedbackApoio(item);estado.feedbackApoio.push(item);$('#status-frase').textContent=avaliacao==='ajudou'?'Obrigado. Vou considerar isso nas próximas escolhas.':'Entendido. Vou ajustar as próximas frases.';if(avaliacao!=='ajudou')mostrarFrase()}catch{$('#status-frase').textContent='Não foi possível guardar essa preferência agora.'}}

function limparFormulario() {
  $('#form-diario').reset(); $('#registro-id').value = ''; $('#valor-intensidade').textContent = '5'; $('#intensidade-registro').disabled = false; $('#status-edicao').hidden = true; $('#cancelar-edicao').hidden = true; $('#salvar-registro').textContent = 'Salvar no meu aparelho'; $('#mensagem-sugestao').textContent = '';
}
async function salvarRegistro(evento) {
  evento.preventDefault(); const texto = $('#texto-registro').value.trim(); if (!texto) return $('#texto-registro').focus();
  if (!estado.armazenamentoPronto) return status('Aguarde enquanto preparamos o armazenamento local.', true);
  const agora = new Date().toISOString(), id = $('#registro-id').value, indice = estado.registros.findIndex(r => r.id === id);
  const dados = { title: $('#titulo-registro').value.trim() || gerarTitulo(texto, agora), feeling: sentimentoSelecionado(), intensity: $('#intensidade-incerta').checked ? null : Number($('#intensidade-registro').value), text: texto, helped: $('#ajudou-registro').value.trim(), worsened: $('#piorou-registro').value.trim() };
  let registro;
  if (indice >= 0) {
    const anterior = estado.registros[indice], versao = { title: anterior.title, feeling: anterior.feeling, intensity: anterior.intensity, text: anterior.text, helped: anterior.helped, worsened: anterior.worsened, savedAt: anterior.updatedAt || anterior.createdAt };
    registro = { ...anterior, ...dados, updatedAt: agora, history: [...anterior.history, versao] };
  } else registro = { id: idSeguro(), ...dados, strategies: [], createdAt: agora, updatedAt: null, history: [] };
  const botao = $('#salvar-registro'); botao.disabled = true;
  try {
    await armazenamento.salvar(registro);
    let audioFalhou = false;
    if (estado.audioPendente) { try { await armazenamento.salvarAudioDiario(registro.id, estado.audioPendente); } catch (erroAudio) { audioFalhou = true; console.error('Áudio do diário não salvo:', erroAudio?.name || 'Erro'); } }
    if (indice >= 0) estado.registros[indice] = registro; else estado.registros.unshift(registro);
    limparFormulario(); if(estado.audioPendente) descartarAudio(); renderizar(); status(audioFalhou ? 'O texto foi salvo, mas não houve espaço para guardar o áudio.' : indice >= 0 ? 'Alterações salvas. A versão anterior foi preservada.' : 'Registro salvo neste aparelho.', audioFalhou);
  } catch (erro) { informarFalha(erro); }
  finally { botao.disabled = false; }
}
function editar(id) {
  const r = estado.registros.find(x => x.id === id); if (!r) return;
  $('#registro-id').value = r.id; $('#titulo-registro').value = r.title; $('#texto-registro').value = r.text; $('#ajudou-registro').value = r.helped; $('#piorou-registro').value = r.worsened;
  const radio = $(`input[name="sentimento"][value="${CSS.escape(r.feeling)}"]`) || $('input[name="sentimento"]'); radio.checked = true;
  $('#intensidade-incerta').checked = r.intensity === null; $('#intensidade-registro').disabled = r.intensity === null; $('#intensidade-registro').value = r.intensity ?? 5; $('#valor-intensidade').textContent = r.intensity ?? '—'; $('#status-edicao').hidden = false; $('#cancelar-edicao').hidden = false; $('#salvar-registro').textContent = 'Salvar alterações'; $('#form-diario').scrollIntoView({ behavior: movimento(), block: 'start' }); $('#titulo-registro').focus({ preventScroll: true });
}
async function excluir(id) {
  const r = estado.registros.find(x => x.id === id); if (!r || !confirm(`ATENÇÃO: excluir “${r.title}” apagará também seu histórico. Essa ação não pode ser desfeita. Deseja continuar?`)) return;
  try { await armazenamento.excluir(id); estado.registros = estado.registros.filter(x => x.id !== id); if ($('#registro-id').value === id) limparFormulario(); renderizar(); status('Registro excluído deste aparelho.'); }
  catch (erro) { informarFalha(erro); }
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
    if (r.postCrisis) { const p = document.createElement('p'); p.textContent = 'Tipo: registro pós-crise'; detalhes.prepend(p); $('.editar-registro', frag).remove(); }
    const ed = $('.registro-edicao', frag); if (r.updatedAt) ed.textContent = `Editado em ${formatarData(r.updatedAt)} · ${r.history.length} versão(ões) anterior(es)`; else ed.remove();
    lista.append(frag); carregarAudioRegistro(r.id, card);
  });
}
async function carregarAudioRegistro(id, card){try{const item=await armazenamento.buscarAudioDiario(id);if(!item?.blob||!card.isConnected)return;const audio=document.createElement('audio');audio.controls=true;audio.preload='metadata';audio.src=URL.createObjectURL(item.blob);const titulo=document.createElement('p');titulo.className='ajuda';titulo.textContent='Áudio local deste registro:';$('.registro-audio',card).append(titulo,audio)}catch(e){console.info('Áudio local indisponível.',e?.name||'Erro')}}
function sugerir() {
  const texto = $('#texto-registro').value.toLocaleLowerCase('pt-BR'), mapa = [['Ansiedade',['ansied','aperto','preocup','nervos']],['Tristeza',['trist','chor','vazio']],['Irritação',['raiva','irrit','revolt']],['Medo',['medo','pânico','assust']],['Cansaço',['cans','exaust','esgot']],['Confusão',['confus','não sei','perdid']],['Felicidade',['feliz','alegr','orgulho']],['Calma',['calm','tranquil','alívio']],['Frustração',['frustr','decepcion']],['Sobrecarga',['sobrecarreg','peso demais','não dou conta']]];
  if (!texto.trim()) { $('#mensagem-sugestao').textContent = 'Escreva um pouco primeiro.'; return; }
  const achado = mapa.find(([, palavras]) => palavras.some(p => texto.includes(p))); if (!achado) { $('#mensagem-sugestao').textContent = 'Não encontrei uma sugestão clara. Tudo bem escolher “Ainda não sei dizer”.'; return; }
  $(`input[name="sentimento"][value="${achado[0]}"]`).checked = true; $('#mensagem-sugestao').textContent = `Sugestão local: ${achado[0]}. Confirme ou escolha outra opção; isto não é diagnóstico.`;
  if (/(me matar|suicid|não quero viver|vou me machucar)/i.test(texto)) $('#mensagem-sugestao').textContent += ' Talvez você precise de apoio humano agora. Você gostaria de ver as opções de ajuda?';
}

async function baixarBackup() {
  try {
    const registros = await armazenamento.buscarTodos();
    const planoSeguranca = await armazenamento.buscarPlanoSeguranca();
    const caixa = await armazenamento.buscarCaixaAcolhimento(), comfortBox = caixa ? { mensagem:caixa.mensagem, funciona:caixa.funciona, lembranca:caixa.lembranca, exercicio:caixa.exercicio, updatedAt:caixa.updatedAt } : null;
    if (!registros.length && !planoSeguranca && !caixa) return alert('Ainda não há dados para o backup.');
    const blob = new Blob([JSON.stringify({ app: 'Porto Seguro', version: VERSAO, schemaVersion: 3, createdAt: new Date().toISOString(), entries: registros, safetyPlan: planoSeguranca, comfortBox }, null, 2)], { type: 'application/json' }), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `porto-seguro-backup-${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 0); status('Backup baixado. Fotos e áudios permanecem somente neste aparelho.');
  } catch (erro) { informarFalha(erro); }
}
function lerBackup(evento) {
  const arquivo = evento.target.files[0]; evento.target.value = ''; if (!arquivo || arquivo.size > 10_000_000) return status('Arquivo ausente ou maior que 10 MB.', true);
  const leitor = new FileReader(); leitor.onload = () => { try { const b = JSON.parse(leitor.result); if (b.app !== 'Porto Seguro' || !Array.isArray(b.entries)) throw Error('Formato não reconhecido.'); const validos = b.entries.map(normalizarRegistro).filter(Boolean); if (validos.length !== b.entries.length || (!validos.length && !b.safetyPlan && !b.comfortBox)) throw Error('Não há dados válidos no arquivo.'); const plano = b.safetyPlan ? normalizarPlano(b.safetyPlan) : null; const caixa=b.comfortBox&&typeof b.comfortBox==='object'?{mensagem:String(b.comfortBox.mensagem||''),funciona:String(b.comfortBox.funciona||''),lembranca:String(b.comfortBox.lembranca||''),exercicio:String(b.comfortBox.exercicio||''),updatedAt:dataValida(b.comfortBox.updatedAt)?b.comfortBox.updatedAt:new Date().toISOString()}:null; estado.backup = { registros: validos, plano, caixa }; $('#resumo-backup').textContent = `${validos.length} registro(s) válido(s)${plano ? ', um plano pessoal' : ''}${caixa?', textos da caixa de acolhimento':''}. Fotos e áudios não fazem parte do arquivo.`; abrirModal($('#tela-restauracao')); } catch (e) { status(`Não foi possível restaurar: ${e.message}`, true); } }; leitor.onerror = () => status('Não foi possível ler o arquivo.', true); leitor.readAsText(arquivo);
}
async function aplicarBackup(substituir) {
  if (!estado.backup) return; if (substituir && !confirm('Isso substituirá todos os registros atuais. Deseja continuar?')) return;
  try {
    await armazenamento.importar(estado.backup.registros, substituir);
    if (estado.backup.plano) await armazenamento.salvarPlanoSeguranca(estado.backup.plano);
    if (estado.backup.caixa) { const atual=await armazenamento.buscarCaixaAcolhimento()||{}; await armazenamento.salvarCaixaAcolhimento({...atual,...estado.backup.caixa}); }
    estado.registros = await armazenamento.buscarTodos();
    estado.planoSeguranca = await armazenamento.buscarPlanoSeguranca(); preencherPlano(estado.planoSeguranca);
    estado.caixaAcolhimento = await armazenamento.buscarCaixaAcolhimento(); preencherCaixa(estado.caixaAcolhimento);
    fecharModal($('#tela-restauracao')); renderizar(); status(`Backup ${substituir ? 'restaurado, substituindo' : 'mesclado com'} os registros atuais.`); estado.backup = null;
  } catch (erro) { informarFalha(erro); }
}

function imprimirRegistros(lista, titulo) {
  const janela = open('', '_blank'); if (!janela) return status('Permita a janela de impressão no navegador.', true); janela.opener = null;
  const escapar = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  janela.document.write(`<!doctype html><meta charset="utf-8"><title>${escapar(titulo)}</title><style>body{font:16px/1.5 Arial;max-width:800px;margin:40px auto;color:#302b45}article{border-bottom:1px solid #ccc;padding:16px 0;white-space:pre-wrap}small{color:#655f77}@media print{body{margin:0}}</style><h1>${escapar(titulo)}</h1>${lista.map(r => `<article><h2>${escapar(r.title)}</h2><small>${escapar(formatarData(r.createdAt))} · ${escapar(r.feeling)} · Intensidade ${r.intensity ?? 'não informada'}</small><p>${escapar(r.text)}</p>${r.helped ? `<p><b>O que ajudou:</b> ${escapar(r.helped)}</p>` : ''}${r.worsened ? `<p><b>O que piorou:</b> ${escapar(r.worsened)}</p>` : ''}</article>`).join('')}<script>onload=()=>print()<\/script>`); janela.document.close();
}
function imprimirPlano() {
  const plano = planoDoFormulario();
  if (!CAMPOS_PLANO.some(campo => plano[campo])) { $('#status-plano').textContent = 'Preencha o plano antes de imprimir.'; return; }
  const janela = open('', '_blank'); if (!janela) { $('#status-plano').textContent = 'Permita a janela de impressão no navegador.'; return; }
  janela.opener = null; const escapar = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const titulos = { sinais:'Sinais de alerta', gatilhos:'Gatilhos que reconheço', ajuda:'O que costuma me ajudar', piora:'O que costuma piorar', lugares:'Lugares seguros', contatos:'Pessoas e contatos de confiança', profissionais:'Profissionais e serviços', passos:'Passos que gostaria de seguir' };
  janela.document.write(`<!doctype html><meta charset="utf-8"><title>Meu plano pessoal de segurança</title><style>body{font:16px/1.5 Arial;max-width:800px;margin:40px auto;color:#302b45}section{border-top:1px solid #ccc;padding:12px 0;white-space:pre-wrap}small{color:#655f77}@media print{body{margin:0}}</style><h1>Meu plano pessoal de segurança</h1><p><small>Porto Seguro · documento pessoal, não substitui atendimento profissional ou emergência.</small></p>${CAMPOS_PLANO.filter(campo=>plano[campo]).map(campo=>`<section><h2>${escapar(titulos[campo])}</h2><p>${escapar(plano[campo])}</p></section>`).join('')}<script>onload=()=>print()<\/script>`); janela.document.close();
}
function gerarRelatorio(evento) {
  evento.preventDefault();const inicio=$('#relatorio-inicio').value,fim=$('#relatorio-fim').value,selecionados=new Set($$('.selecionar-registro:checked').map(x=>x.value)),incluirPos=$('#relatorio-incluir-pos-crise').checked;let profissional=$('#relatorio-profissional').value;if(profissional==='Outro profissional')profissional=$('#relatorio-outro-profissional').value.trim()||profissional;
  const lista=estado.registros.filter(r=>(!inicio||r.createdAt.slice(0,10)>=inicio)&&(!fim||r.createdAt.slice(0,10)<=fim)&&(!selecionados.size||selecionados.has(r.id))&&(incluirPos||!r.postCrisis)).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt));if(!lista.length){$('#status-relatorio').textContent='Nenhum registro corresponde ao período e à seleção.';$('#resultado-relatorio').hidden=false;return}
  const dataCurta=v=>v?new Intl.DateTimeFormat('pt-BR',{dateStyle:'long'}).format(new Date(`${v}T12:00:00`)):'não informado';const sentimentos={};lista.forEach(r=>sentimentos[r.feeling]=(sentimentos[r.feeling]||0)+1);const ranking=Object.entries(sentimentos).sort((a,b)=>b[1]-a[1]).map(([n,q])=>`${n} (${q})`).join(', ');const intensidades=lista.map(r=>r.intensity).filter(Number.isInteger);const media=intensidades.length?(intensidades.reduce((a,b)=>a+b,0)/intensidades.length).toFixed(1):'não informada';const foco={ 'Psicólogo(a)':'Emoções, possíveis gatilhos, situações recorrentes, pensamentos, relações e estratégias de acolhimento.',Psiquiatra:'Frequência, intensidade, sono, energia, ansiedade, humor, funcionamento e menções a medicação, quando registradas.','Médico(a)':'Sintomas físicos, dor, sono, alimentação, alterações percebidas e linha do tempo, quando registrados.','Terapeuta ocupacional':'Rotina, autocuidado, organização, sobrecarga sensorial, estudo, trabalho e adaptações.','Assistente social':'Rede de apoio, dificuldades práticas, trabalho, acesso a tratamento, transporte e rotina familiar.'}[profissional]||'Organização neutra e cronológica dos fatos selecionados.';
  const linhas=[`RELATÓRIO PESSOAL DIRECIONADO A: ${profissional.toUpperCase()}`,`Período analisado: ${dataCurta(inicio)} a ${dataCurta(fim)}`,`Fonte: ${lista.length} registro(s) selecionado(s) pela pessoa`,`Gerado em: ${formatarData(new Date().toISOString())}`,$('#relatorio-nome').value.trim()?`Nome informado pela pessoa: ${$('#relatorio-nome').value.trim()}`:'Nome: não informado','',`OBJETIVO INFORMADO PELA PESSOA\n${$('#relatorio-objetivo').value.trim()||'Não informado.'}`,'',`ORGANIZAÇÃO PARA ${profissional.toUpperCase()}\n${foco}`,'',`CALCULADO A PARTIR DOS REGISTROS\nSentimentos mais registrados: ${ranking||'não há informações suficientes nos registros selecionados'}.\nIntensidade média registrada: ${media}.`,'','LINHA DO TEMPO',...lista.map(r=>`${formatarData(r.createdAt)} — ${r.title}\nInformado pela pessoa: ${r.text}\nSentimento: ${r.feeling}; intensidade: ${r.intensity??'não informada'}.\nO que ajudou: ${r.helped||'não informado'}.\nO que piorou: ${r.worsened||'não informado'}.` )];if($('#relatorio-incluir-perfil').checked&&estado.perfil)linhas.push('','NECESSIDADES DE ACOLHIMENTO INFORMADAS PELA PESSOA',`Tom preferido: ${estado.perfil.tom}. Forma de apoio: ${estado.perfil.orientacao}. O que ajuda: ${estado.perfil.ajuda||'não informado'}. O que evitar: ${estado.perfil.evitar||'não informado'}.`);linhas.push('','OBSERVAÇÕES E PERGUNTAS PARA A CONSULTA',$('#observacoes-relatorio').value.trim()||'Não informadas.','','LIMITAÇÕES','Este documento organiza informações selecionadas pela própria pessoa. Não é laudo, prontuário, diagnóstico nem substitui avaliação profissional. Nenhuma IA foi utilizada.');const texto=linhas.join('\n');estado.relatorioAtual={id:idSeguro(),profissional,inicio,fim,registros:lista.map(r=>r.id),texto,createdAt:new Date().toISOString()};$('#titulo-previa-relatorio').textContent=`Relatório pessoal para ${profissional}`;$('#texto-relatorio-editavel').value=texto;$('#resultado-relatorio').hidden=false;$('#status-relatorio').textContent='Revise livremente: você pode editar ou apagar qualquer seção antes de salvar.';$('#resultado-relatorio').scrollIntoView({behavior:movimento()});
}
function imprimirRelatorio(){const texto=$('#texto-relatorio-editavel').value.trim();if(!texto)return;const profissional=estado.relatorioAtual?.profissional||'profissional',janela=open('','_blank');if(!janela)return $('#status-relatorio').textContent='Permita a janela de impressão no navegador.';janela.opener=null;const escapar=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));janela.document.write(`<!doctype html><meta charset="utf-8"><title>relatorio-para-${escapar(profissional.toLowerCase().replace(/[^a-z0-9]+/g,'-'))}</title><style>body{font:15px/1.55 Arial;max-width:850px;margin:35px auto;color:#302b45;white-space:pre-wrap}@media print{body{margin:0}}</style>${escapar(texto)}<script>onload=()=>print()<\/script>`);janela.document.close()}
async function salvarRelatorioAtual(){if(!estado.relatorioAtual)return;const item={...estado.relatorioAtual,texto:$('#texto-relatorio-editavel').value,updatedAt:new Date().toISOString()};try{await armazenamento.salvarRelatorio(item);estado.relatorioAtual=item;$('#status-relatorio').textContent='Relatório salvo neste aparelho.'}catch{$('#status-relatorio').textContent='Não foi possível salvar o relatório agora.'}}
function cancelarRelatorio(){estado.relatorioAtual=null;$('#texto-relatorio-editavel').value='';$('#resultado-relatorio').hidden=true}

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
  const textos={regular:escolherFrase(),confianca:'Você pode escolher alguém que escute sem julgar. Se quiser, configure um contato na tela de ajuda urgente; o aplicativo só facilitará a ligação quando você tocar.',perguntas:'O que ajudaria mais agora? Você pode escrever, apenas escolher uma opção ou ficar em silêncio por alguns instantes.'}; box.textContent=textos[tipo]||textos.perguntas;
}
function contato() { try { return JSON.parse(localStorage.getItem(CHAVE_CONTATO)||'null'); } catch { return null; } }
function atualizarContato() { const c=contato(); $('#nome-contato').textContent=c?.name?`Conversar com ${c.name}`:'Configure um contato abaixo'; $('#contato-nome').value=c?.name||''; $('#contato-telefone').value=c?.phone||''; $('#contato-mensagem').value=c?.message||'Não estou bem agora. Não precisa resolver nada, apenas fique comigo e, se puder, entre em contato.'; }
function abrirMensagemRapida() {
  const c=contato(), campo=$('#mensagem-rapida-texto');
  $$('.mensagem-pronta').forEach(botao=>botao.classList.remove('selecionada'));
  campo.value=''; $('#status-mensagem-rapida').textContent='';
  $('#destino-mensagem-rapida').textContent=c?.name?`A conversa será aberta com ${c.name}.`:'Configure um contato de confiança para abrir a conversa correta.';
  abrirModal($('#tela-mensagem-rapida'));
}
function escolherMensagem(botao) {
  $$('.mensagem-pronta').forEach(item=>item.classList.toggle('selecionada',item===botao));
  $('#mensagem-rapida-texto').value=botao.textContent.trim(); $('#mensagem-rapida-texto').focus();
}
function abrirWhatsAppMensagemRapida() {
  const c=contato(), mensagem=$('#mensagem-rapida-texto').value.trim();
  if(!mensagem){$('#status-mensagem-rapida').textContent='Escolha ou escreva uma mensagem primeiro.';return $('#mensagem-rapida-texto').focus()}
  if(!c?.phone){$('#status-mensagem-rapida').textContent='Configure um contato de confiança antes de abrir o WhatsApp.';return $('#configurar-contato-mensagem').focus()}
  window.open(`https://wa.me/${c.phone}?text=${encodeURIComponent(mensagem)}`,'_blank','noopener,noreferrer');
  $('#status-mensagem-rapida').textContent='WhatsApp aberto com a mensagem preenchida. Confirme o envio no próprio WhatsApp.';
}
async function copiarMensagemRapida() {
  const campo=$('#mensagem-rapida-texto'), mensagem=campo.value.trim();
  if(!mensagem){$('#status-mensagem-rapida').textContent='Escolha ou escreva uma mensagem primeiro.';return campo.focus()}
  try { if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(mensagem); else {campo.select();document.execCommand('copy');campo.setSelectionRange(0,0)} $('#status-mensagem-rapida').textContent='Mensagem copiada. Você decide onde e quando enviar.'; }
  catch { $('#status-mensagem-rapida').textContent='Não foi possível copiar automaticamente. Selecione o texto e copie manualmente.'; }
}

document.addEventListener('click', e => {
  const acao=e.target.closest('[data-acao]')?.dataset.acao; if (acao==='respirar') iniciarRespiracao(); if (acao==='escrever') { location.hash='diario'; $('#texto-registro').focus(); } if (acao==='regular'||acao==='confianca') mostrarApoio(acao); if (acao==='nao-consigo-falar') abrirMensagemRapida(); if (acao==='urgente') { atualizarContato(); abrirModal($('#tela-urgente')); }
  const card=e.target.closest('.card-registro'); if (card && e.target.matches('.editar-registro')) editar(card.dataset.id); if (card && e.target.matches('.excluir-registro')) excluir(card.dataset.id); if (card && e.target.matches('.imprimir-registro')) imprimirRegistros(estado.registros.filter(r=>r.id===card.dataset.id),'Registro — Porto Seguro');
});
$('#abrir-apoio').addEventListener('click',()=>{location.hash='apoio';mostrarApoio('perguntas')}); $('#form-diario').addEventListener('submit',salvarRegistro); $('#cancelar-edicao').addEventListener('click',()=>{limparFormulario();status('Edição cancelada; nenhuma alteração foi salva.')}); $('#intensidade-registro').addEventListener('input',e=>$('#valor-intensidade').textContent=e.target.value); $('#intensidade-incerta').addEventListener('change',e=>{ $('#intensidade-registro').disabled=e.target.checked; $('#valor-intensidade').textContent=e.target.checked?'—':$('#intensidade-registro').value }); $('#sugerir-sentimento').addEventListener('click',sugerir);
['pesquisa','filtro-sentimento','filtro-data'].forEach(id=>$('#'+id).addEventListener('input',renderizar)); $('#limpar-filtros').addEventListener('click',()=>{$('#pesquisa').value='';$('#filtro-sentimento').value='';$('#filtro-data').value='';renderizar()}); $('#baixar-backup').addEventListener('click',baixarBackup); $('#restaurar-backup').addEventListener('click',()=>$('#arquivo-backup').click()); $('#arquivo-backup').addEventListener('change',lerBackup); $('#mesclar-backup').addEventListener('click',()=>aplicarBackup(false)); $('#substituir-backup').addEventListener('click',()=>aplicarBackup(true)); $('#cancelar-backup').addEventListener('click',()=>{estado.backup=null;fecharModal($('#tela-restauracao'))}); $('#imprimir-diario').addEventListener('click',()=>imprimirRegistros(registrosVisiveis(),'Meu diário — Porto Seguro'));
$('#form-relatorio').addEventListener('submit',gerarRelatorio); $('#imprimir-relatorio').addEventListener('click',imprimirRelatorio); $('#salvar-relatorio').addEventListener('click',salvarRelatorioAtual); $('#cancelar-relatorio').addEventListener('click',cancelarRelatorio); $('#pausar-respiracao').addEventListener('click',()=>{const r=estado.respiracao;r.pausada=!r.pausada;atualizarRespiracao()}); $('#parar-respiracao').addEventListener('click',pararRespiracao); $('#fechar-respiracao').addEventListener('click',pararRespiracao); $('#respirar-novamente').addEventListener('click',iniciarRespiracao); $('#registrar-apos-respirar').addEventListener('click',registrarEstrategia); $('#continuar-apoio').addEventListener('click',()=>{pararRespiracao();location.hash='apoio';mostrarApoio('perguntas')}); $$('.fechar-modal').forEach(botao=>botao.addEventListener('click',()=>fecharModal(botao.closest('.modal'))));
$('#lista-mensagens-prontas').addEventListener('click',e=>{const botao=e.target.closest('.mensagem-pronta');if(botao)escolherMensagem(botao)}); $('#abrir-whatsapp-mensagem').addEventListener('click',abrirWhatsAppMensagemRapida); $('#copiar-mensagem').addEventListener('click',copiarMensagemRapida); $('#configurar-contato-mensagem').addEventListener('click',()=>{fecharModal($('#tela-mensagem-rapida'));atualizarContato();abrirModal($('#tela-urgente'));$('#contato-nome').focus()});
$('#form-contato').addEventListener('submit',e=>{e.preventDefault();const name=$('#contato-nome').value.trim(),phone=$('#contato-telefone').value.replace(/\D/g,''),message=$('#contato-mensagem').value.trim();if(!name||phone.length<10||phone.length>15||!message)return status('Informe nome, WhatsApp com DDI e uma mensagem.',true);try{localStorage.setItem(CHAVE_CONTATO,JSON.stringify({name,phone,message}));atualizarContato();status('Contato e mensagem salvos somente neste navegador.')}catch{status('Não foi possível salvar o contato.',true)}}); $('#whatsapp-confianca').addEventListener('click',()=>{const c=contato();if(!c?.phone||!c?.message){$('#contato-nome').focus();return status('Configure e salve o contato antes de abrir o WhatsApp.',true)}window.open(`https://wa.me/${c.phone}?text=${encodeURIComponent(c.message)}`,'_blank','noopener,noreferrer');status('WhatsApp aberto com a mensagem preenchida. Confirme o envio no próprio WhatsApp.')});
$('#aumentar-fonte').addEventListener('click',e=>{const ativo=document.body.classList.toggle('fonte-grande');e.currentTarget.setAttribute('aria-pressed',ativo);e.currentTarget.textContent=ativo?'Texto padrão':'Aumentar texto'});
document.addEventListener('keydown',e=>{const modal=$$('.modal').find(m=>!m.hidden);if(!modal)return;if(e.key==='Escape'){modal=== $('#tela-respiracao')?pararRespiracao():fecharModal(modal)}else prenderFoco(e,modal)});
$('#form-plano-seguranca').addEventListener('submit',salvarPlano); $('#imprimir-plano').addEventListener('click',imprimirPlano); $('#apagar-plano').addEventListener('click',apagarPlano);
$('#form-pos-crise').addEventListener('submit',salvarPosCrise); $('#limpar-pos-crise').addEventListener('click',()=>{limparPosCrise();$('#status-pos-crise').textContent='Campos limpos; nada foi salvo.';});
['antes','depois'].forEach(sufixo=>{const faixa=$(`#pos-intensidade-${sufixo}`), incerta=$(`#pos-incerta-${sufixo}`), valor=$(`#pos-valor-${sufixo}`); faixa.addEventListener('input',()=>{valor.textContent=faixa.value}); incerta.addEventListener('change',()=>{faixa.disabled=incerta.checked;valor.textContent=incerta.checked?'—':faixa.value});});
$('#form-caixa').addEventListener('submit',salvarCaixa);$('#apagar-caixa').addEventListener('click',apagarCaixa);$('#gravar-audio').addEventListener('click',gravarAudio);$('#parar-audio').addEventListener('click',()=>estado.gravador?.stop());$('#descartar-audio').addEventListener('click',descartarAudio);
$('#form-perfil').addEventListener('submit',salvarPerfil);$('#form-perfil').addEventListener('input',agendarPerfil);$('#form-perfil').addEventListener('change',agendarPerfil);$('#redefinir-perfil').addEventListener('click',redefinirPerfil);$('#nova-frase').addEventListener('click',mostrarFrase);$$('.avaliar-frase').forEach(b=>b.addEventListener('click',()=>avaliarFrase(b.dataset.avaliacao)));

async function inicializarAplicacao() {
  alternarControlesArmazenamento(false);
  status('Preparando o armazenamento local…');
  const resultado = await armazenamento.inicializar({ chaveAtual: CHAVE, chaveAntiga: CHAVE_ANTIGA, versaoBackup: VERSAO, normalizarRegistro });
  estado.registros = resultado.registros;
  try { estado.planoSeguranca = await armazenamento.buscarPlanoSeguranca(); preencherPlano(estado.planoSeguranca); } catch (erro) { console.error('Plano pessoal indisponível:', erro?.name || 'Erro'); $('#status-plano').textContent = 'O plano pessoal não está disponível neste navegador.'; }
  try { estado.caixaAcolhimento = await armazenamento.buscarCaixaAcolhimento(); preencherCaixa(estado.caixaAcolhimento); } catch (erro) { console.error('Caixa indisponível:', erro?.name || 'Erro'); $('#status-caixa').textContent = 'A caixa de acolhimento não está disponível neste navegador.'; }
  try { estado.perfil=await armazenamento.buscarPerfilAcolhimento();estado.feedbackApoio=await armazenamento.buscarFeedbackApoio();preencherPerfil(estado.perfil);mostrarFrase(); } catch(erro){console.error('Perfil indisponível:',erro?.name||'Erro');$('#status-perfil').textContent='O perfil não está disponível neste navegador.'}
  estado.armazenamentoPronto = true;
  alternarControlesArmazenamento(true);
  renderizar();
  if (resultado.modo === 'indexeddb') {
    status(resultado.migracao.executada && resultado.migracao.quantidade > 0 ? `${resultado.migracao.quantidade} registro(s) preservado(s) no novo armazenamento local.` : 'Armazenamento local pronto.');
  } else {
    status('Não foi possível usar o novo armazenamento neste navegador. Seus dados antigos não foram apagados; o modo de segurança continua ativo. Recomendamos manter um backup.', true);
  }
}

const sentimentos=[...new Set($$('input[name="sentimento"]').map(x=>x.value))]; sentimentos.forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;$('#filtro-sentimento').append(o)}); inicializarAplicacao();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(e=>console.info('Modo offline indisponível.',e)));
