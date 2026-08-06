'use strict';
const CHAVE = 'portoSeguro.diario.v2', CHAVE_ANTIGA = 'portoSeguro.diario.v1', CHAVE_CONTATO = 'portoSeguro.contato.v1', CHAVE_PIN = 'portoSeguro.pin.v1', VERSAO = 2;
const $ = (s, raiz = document) => raiz.querySelector(s), $$ = (s, raiz = document) => [...raiz.querySelectorAll(s)];
const armazenamento = window.PortoSeguroStorage;
const estado = { registros: [], selecionadosRelatorio: new Set(), planoSeguranca: null, caixaAcolhimento: null, perfil: null, feedbackApoio: [], mensagensRecentes: [], relatorioAtual: null, dadosRelatorioAtual: null, backup: null, armazenamentoPronto: false, bancoInicializado: false, modoArmazenamento: null, migracaoInicial: null, hashInicialPendente: null, audioPendente: null, audioUrl: null, audioDuracao: null, manterAudio: true, gravador: null, reconhecimento: null, inicioGravacao: null, respiracao: { ativa: false, pausada: false, ciclo: 0, fase: 'inspirar', restante: 4, timer: null }, ultimoFoco: null };
const CAMPOS_PLANO = ['sinais', 'gatilhos', 'ajuda', 'piora', 'lugares', 'contatos', 'profissionais', 'passos'];
let timerBloqueio;
let timerBloqueioPin;
const CHAVE_BACKUP_RECENTE='portoSeguro.backupRecente.v1';
const CHAVE_TENTATIVAS_PIN='portoSeguro.tentativasPin.v1', LIMITE_TENTATIVAS_PIN=3;
const ITERACOES_PIN=600000, ITERACOES_PIN_LEGADO=150000;
let operacaoCriptoEmAndamento=false;
let bloqueioAtivo=false;

function idSeguro() { return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function dataValida(valor) { return typeof valor === 'string' && !Number.isNaN(Date.parse(valor)); }
function normalizarPosCrise(item) {
  if (!item || typeof item !== 'object') return null;
  const intensidade = valor => Number.isInteger(valor) && valor >= 0 && valor <= 10 ? valor : null;
  return { intensityBefore: intensidade(item.intensityBefore), intensityAfter: intensidade(item.intensityAfter), trigger: String(item.trigger || ''), strategy: String(item.strategy || ''), result: String(item.result || ''), notes: String(item.notes || '') };
}
function normalizarRegistro(item) {
  if (!item || typeof item.id !== 'string' || typeof item.text !== 'string' || !dataValida(item.createdAt)) return null;
  const origem = Array.isArray(item.feelings) ? item.feelings : Array.isArray(item.feeling) ? item.feeling : [item.feeling || 'Ainda não sei dizer'];
  const feelings = [...new Set(origem.filter(x => typeof x === 'string').map(x => x.trim()).filter(Boolean))];
  if (!feelings.length) feelings.push('Ainda não sei dizer');
  return { id: item.id, title: String(item.title || gerarTitulo(item.text, item.createdAt)), feelings, feeling: feelings[0], intensity: Number.isInteger(item.intensity) && item.intensity >= 0 && item.intensity <= 10 ? item.intensity : null, text: item.text, helped: String(item.helped || ''), worsened: String(item.worsened || ''), transcription: String(item.transcription || ''), audioDuration: Number.isFinite(item.audioDuration) ? item.audioDuration : null, strategies: Array.isArray(item.strategies) ? item.strategies.filter(x => typeof x === 'string') : [], createdAt: item.createdAt, updatedAt: dataValida(item.updatedAt) ? item.updatedAt : null, history: Array.isArray(item.history) ? item.history : [], postCrisis: normalizarPosCrise(item.postCrisis) };
}
function status(texto, erro = false) { const el = $('#status-app'); if (!el) return; el.textContent = texto; el.classList.toggle('erro', erro); }
function alternarControlesArmazenamento(habilitados) { ['salvar-registro','baixar-backup','restaurar-backup','salvar-plano','apagar-plano','salvar-pos-crise','salvar-caixa','apagar-caixa','gravar-audio','salvar-perfil','redefinir-perfil','salvar-relatorio','apagar-copia-antiga'].forEach(id => { $('#'+id).disabled = !habilitados; }); }
function informarFalha(erro) { console.error('Operação de armazenamento não concluída:', erro?.name || 'Erro', erro?.message || 'sem detalhes'); status('Não foi possível concluir agora. Seus dados anteriores não foram apagados. Recomendamos manter seu backup em local seguro.', true); }
function formatarData(valor) { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(valor)); }
function gerarTitulo(texto, data = new Date().toISOString()) { const inicio = String(texto).trim().replace(/\s+/g, ' ').split(' ').slice(0, 7).join(' '); return inicio ? `${inicio}${String(texto).trim().split(/\s+/).length > 7 ? '…' : ''}` : `Registro de ${new Intl.DateTimeFormat('pt-BR').format(new Date(data))}`; }
function sentimentosSelecionados() { const lista=$$('input[name="sentimento"]:checked').map(x=>x.value); return lista.length?lista:['Ainda não sei dizer']; }
function sentimentosDoRegistro(r){return Array.isArray(r.feelings)&&r.feelings.length?r.feelings:[r.feeling||'Ainda não sei dizer']}
function textoSentimentos(r){return sentimentosDoRegistro(r).join(' + ')}
function fecharMenu(devolverFoco=false){$('#menu-principal').classList.remove('aberto');$('#alternar-menu').setAttribute('aria-expanded','false');if(devolverFoco)$('#alternar-menu').focus()}
function ativarSecao(){const id=decodeURIComponent(location.hash.slice(1))||'inicio',alvo=document.getElementById(id),secao=alvo?.closest('main>section')||$('#inicio');$$('main>section').forEach(s=>s.classList.toggle('secao-ativa',s===secao||(secao.id==='inicio'&&s.id==='apoio')));$$('#menu-principal a').forEach(a=>{const atual=a.getAttribute('href')===`#${secao.id}`;a.classList.toggle('atual',atual);if(atual)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});document.body.classList.add('navegacao-secoes');fecharMenu()}
function prepararLimpezaAvancada(){const aviso=$('#protecao-local>.aviso');if(!aviso||aviso.closest('details'))return;const detalhes=document.createElement('details'),resumo=document.createElement('summary');detalhes.id='limpeza-avancada';detalhes.className='aviso';resumo.textContent='Opções avançadas de armazenamento';aviso.before(detalhes);detalhes.append(resumo,...aviso.childNodes);aviso.remove()}
function opcoesSOS(){return $$('#config-sos input:checked').map(x=>x.value)}
function prepararSOS(){const campoTempo=$('#tempo-bloqueio').closest('.campo'),fieldset=document.createElement('fieldset');fieldset.id='config-sos';const legend=document.createElement('legend');legend.textContent='Opções disponíveis sem desbloquear';fieldset.append(legend);[['samu','SAMU 192'],['cvv','CVV 188'],['contato','Ligar para contato'],['whatsapp','WhatsApp'],['respirar','Respiração offline']].forEach(([valor,texto])=>{const label=document.createElement('label');label.className='checkbox';const input=document.createElement('input');input.type='checkbox';input.value=valor;input.checked=true;label.append(input,document.createTextNode(` ${texto}`));fieldset.append(label)});campoTempo.after(fieldset);$('#pin-desbloqueio').setAttribute('autocomplete','off')}
function salvarPreferenciasSOS(){const c=configuracaoPin();if(!c)return;try{localStorage.setItem(CHAVE_PIN,JSON.stringify({...c,sos:opcoesSOS()}));$('#status-pin').textContent='Preferências do Modo SOS salvas neste aparelho.'}catch{$('#status-pin').textContent='Não foi possível salvar as preferências do SOS.'}}
function prepararStatusUrgente(){const p=document.createElement('p');p.id='status-urgente';p.className='status';p.setAttribute('role','status');p.setAttribute('aria-live','polite');$('#form-contato').before(p)}
function statusUrgente(texto,erro=false){const el=$('#status-urgente');el.textContent=texto;el.classList.toggle('erro',erro)}
function configuracaoPin(){try{return JSON.parse(localStorage.getItem(CHAVE_PIN)||'null')}catch{return null}}
function bytesBase64(bytes){return btoa(String.fromCharCode(...bytes))}
async function derivarBitsBrutos(pin,salBase64,iteracoes){const sal=Uint8Array.from(atob(salBase64),c=>c.charCodeAt(0)),material=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);return crypto.subtle.deriveBits({name:'PBKDF2',salt:sal,iterations:iteracoes,hash:'SHA-256'},material,256)}
async function derivarPin(pin,salBase64,iteracoes=ITERACOES_PIN){const bits=await derivarBitsBrutos(pin,salBase64,iteracoes);return bytesBase64(new Uint8Array(bits))}
async function derivarChaveCifragem(pin,salBase64,iteracoes=ITERACOES_PIN){const bitsBrutos=await derivarBitsBrutos(pin,salBase64,iteracoes),hkdf=await crypto.subtle.importKey('raw',bitsBrutos,'HKDF',false,['deriveKey']);return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new Uint8Array(0),info:new TextEncoder().encode('portoSeguro.cifragem.v1')},hkdf,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
function estadoTentativasPin(){try{return JSON.parse(localStorage.getItem(CHAVE_TENTATIVAS_PIN)||'null')||{tentativas:0,bloqueadoAte:null}}catch{return{tentativas:0,bloqueadoAte:null}}}
function salvarTentativasPin(estado){try{localStorage.setItem(CHAVE_TENTATIVAS_PIN,JSON.stringify(estado))}catch{}}
function limparTentativasPin(){try{localStorage.removeItem(CHAVE_TENTATIVAS_PIN)}catch{}}
function duracaoBloqueioPin(tentativas){if(tentativas<LIMITE_TENTATIVAS_PIN)return 0;return Math.min(30*2**(tentativas-LIMITE_TENTATIVAS_PIN),300)*1000}
function habilitarFormularioPin(){$('#pin-desbloqueio').disabled=false;$('#btn-desbloquear').disabled=false}
function desabilitarFormularioPin(){$('#pin-desbloqueio').disabled=true;$('#btn-desbloquear').disabled=true}
function mostrarBloqueioPin(restanteMs){desabilitarFormularioPin();clearInterval(timerBloqueioPin);const atualizar=()=>{const b=estadoTentativasPin(),restante=b.bloqueadoAte?Date.parse(b.bloqueadoAte)-Date.now():0;if(restante<=0){clearInterval(timerBloqueioPin);habilitarFormularioPin();$('#status-desbloqueio').textContent='Você já pode tentar novamente.';return}$('#status-desbloqueio').textContent=`Muitas tentativas incorretas. Tente novamente em ${Math.ceil(restante/1000)}s.`};atualizar();timerBloqueioPin=setInterval(atualizar,1000)}
function verificarBloqueioPin(){const b=estadoTentativasPin(),restante=b.bloqueadoAte?Date.parse(b.bloqueadoAte)-Date.now():0;if(restante>0)mostrarBloqueioPin(restante);else habilitarFormularioPin()}
function limparDadosCarregados(){armazenamento.limparChave();estado.registros=[];estado.selecionadosRelatorio=new Set();estado.planoSeguranca=null;estado.caixaAcolhimento=null;estado.perfil=null;estado.feedbackApoio=[];estado.armazenamentoPronto=false;$('#lista-registros').replaceChildren();$('#contador-registros').textContent='0 registros';preencherPlano(null);preencherCaixa(null);preencherPerfil(null);const selecao=$('#selecao-relatorio');if(selecao)selecao.replaceChildren();alternarControlesArmazenamento(false)}
function bloquearAgora(){if(!configuracaoPin())return $('#status-pin').textContent='Configure um PIN primeiro.';bloqueioAtivo=true;clearTimeout(timerBloqueio);document.documentElement.classList.remove('pre-bloqueado');document.body.classList.add('bloqueado','sem-rolagem');$('#tela-sos').hidden=true;$('#tela-bloqueio').hidden=false;$('#pin-desbloqueio').value='';$('#status-desbloqueio').textContent='';limparDadosCarregados();verificarBloqueioPin();if(!$('#pin-desbloqueio').disabled)$('#pin-desbloqueio').focus()}
function reiniciarInatividade(){const c=configuracaoPin();clearTimeout(timerBloqueio);if(c&&!document.body.classList.contains('bloqueado'))timerBloqueio=setTimeout(bloquearAgora,Number(c.minutes||5)*60000)}
async function configurarPin(evento){evento.preventDefault();const pin=$('#novo-pin').value,confirmacao=$('#confirmar-pin').value;if(!/^\d{4,8}$/.test(pin)||pin!==confirmacao)return $('#status-pin').textContent='Use de 4 a 8 números iguais nos dois campos.';if(operacaoCriptoEmAndamento)return $('#status-pin').textContent='Aguarde a operação anterior terminar antes de tentar de novo.';operacaoCriptoEmAndamento=true;try{await garantirBanco();const sal=crypto.getRandomValues(new Uint8Array(16)),salBase64=bytesBase64(sal),chaveNova=await derivarChaveCifragem(pin,salBase64,ITERACOES_PIN);$('#status-pin').textContent='Cifrando seus dados neste aparelho…';await armazenamento.migrarCriptografia(chaveNova);const config={salt:salBase64,hash:await derivarPin(pin,salBase64,ITERACOES_PIN),iterations:ITERACOES_PIN,minutes:Number($('#tempo-bloqueio').value),sos:opcoesSOS(),createdAt:new Date().toISOString()};localStorage.setItem(CHAVE_PIN,JSON.stringify(config));limparTentativasPin();$('#novo-pin').value='';$('#confirmar-pin').value='';$('#status-pin').textContent='PIN ativado e dados cifrados neste aparelho. Bloqueando agora…';setTimeout(bloquearAgora,300)}catch(erro){console.error('PIN não configurado:',erro?.name||'Erro');$('#status-pin').textContent='Não foi possível ativar o PIN neste navegador. Nenhum dado foi apagado.'}finally{operacaoCriptoEmAndamento=false}}
async function desbloquear(evento){evento.preventDefault();const bloqueio=estadoTentativasPin(),restante=bloqueio.bloqueadoAte?Date.parse(bloqueio.bloqueadoAte)-Date.now():0;if(restante>0)return mostrarBloqueioPin(restante);const c=configuracaoPin(),pin=$('#pin-desbloqueio').value;if(!c||!/^\d{4,8}$/.test(pin))return $('#status-desbloqueio').textContent='Digite o PIN e toque em Desbloquear.';if(operacaoCriptoEmAndamento)return;const iteracoesAtuais=c.iterations||ITERACOES_PIN_LEGADO,hash=await derivarPin(pin,c.salt,iteracoesAtuais);if(hash!==c.hash){$('#pin-desbloqueio').value='';const tentativas=(bloqueio.tentativas||0)+1,duracao=duracaoBloqueioPin(tentativas);if(duracao>0){salvarTentativasPin({tentativas,bloqueadoAte:new Date(Date.now()+duracao).toISOString()});mostrarBloqueioPin(duracao)}else{salvarTentativasPin({tentativas,bloqueadoAte:null});$('#status-desbloqueio').textContent='PIN incorreto.'}return}if(operacaoCriptoEmAndamento)return;operacaoCriptoEmAndamento=true;$('#status-desbloqueio').textContent='Desbloqueando…';try{await garantirBanco();const chaveDerivada=await derivarChaveCifragem(pin,c.salt,iteracoesAtuais);armazenamento.definirChave(chaveDerivada);if(iteracoesAtuais<ITERACOES_PIN){const chaveNova=await derivarChaveCifragem(pin,c.salt,ITERACOES_PIN);await armazenamento.migrarCriptografia(chaveNova);const hashNovo=await derivarPin(pin,c.salt,ITERACOES_PIN);localStorage.setItem(CHAVE_PIN,JSON.stringify({...c,hash:hashNovo,iterations:ITERACOES_PIN}))}else{await armazenamento.ativarCriptografiaInicial()}}catch(erro){console.error('Não foi possível preparar a criptografia local:',erro?.name||'Erro');$('#status-desbloqueio').textContent='PIN correto, mas houve um problema ao preparar a proteção dos dados. Tente novamente.';armazenamento.limparChave();operacaoCriptoEmAndamento=false;return}limparTentativasPin();clearInterval(timerBloqueioPin);habilitarFormularioPin();bloqueioAtivo=false;$('#tela-bloqueio').hidden=true;document.body.classList.remove('bloqueado','sem-rolagem');document.documentElement.classList.remove('pre-bloqueado');reiniciarInatividade();try{await carregarDados(estado.hashInicialPendente)}finally{operacaoCriptoEmAndamento=false}estado.hashInicialPendente=null;$('#inicio').focus?.()}
async function removerPin(){if(!configuracaoPin())return $('#status-pin').textContent='Nenhum PIN está configurado.';if(operacaoCriptoEmAndamento)return $('#status-pin').textContent='Aguarde a operação anterior terminar antes de tentar de novo.';if(!confirm('Remover a proteção por PIN deste aparelho? Os dados deixarão de ser criptografados e voltarão a ficar em texto simples, como antes de ativar o PIN.'))return;operacaoCriptoEmAndamento=true;try{await garantirBanco();$('#status-pin').textContent='Decifrando seus dados…';await armazenamento.migrarCriptografia(null);localStorage.removeItem(CHAVE_PIN);limparTentativasPin();clearInterval(timerBloqueioPin);habilitarFormularioPin();clearTimeout(timerBloqueio);$('#status-pin').textContent='Proteção por PIN removida. Os dados voltaram a ficar sem criptografia neste aparelho.'}catch(erro){console.error('Não foi possível remover a criptografia:',erro?.name||'Erro');$('#status-pin').textContent='Não foi possível remover o PIN agora sem risco de perder acesso aos dados. Tente novamente.'}finally{operacaoCriptoEmAndamento=false}}
async function apagarCopiaAntiga(){const migracao=await armazenamento.buscarMetadado('migracaoLocalStorageV1'),backup=Date.parse(localStorage.getItem(CHAVE_BACKUP_RECENTE)||'');if(!migracao?.completedAt)return $('#status-pin').textContent='A migração ainda não foi validada; a cópia antiga foi preservada.';if(!Number.isFinite(backup)||Date.now()-backup>30*86400000)return $('#status-pin').textContent='Baixe primeiro um backup JSON recente. Nenhuma cópia foi removida.';if(!confirm('Você confirma que baixou e guardou um backup recente e deseja remover somente as cópias antigas?'))return;localStorage.removeItem(CHAVE);localStorage.removeItem(CHAVE_ANTIGA);$('#limpeza-avancada').hidden=true;$('#status-pin').textContent='Cópias antigas removidas. O diário atual no IndexedDB foi preservado.'}

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
  const registro = { id: idSeguro(), title: `Registro pós-crise — ${new Intl.DateTimeFormat('pt-BR').format(new Date(agora))}`, feelings: ['Ainda não sei dizer'], feeling: 'Ainda não sei dizer', intensity: postCrisis.intensityAfter, text: partes.join('\n\n') || 'Registro pós-crise de intensidade.', helped: postCrisis.result, worsened: postCrisis.trigger, transcription:'', audioDuration:null, strategies: postCrisis.strategy ? [postCrisis.strategy] : [], createdAt: agora, updatedAt: null, history: [], postCrisis };
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
function limparAudioPendente(mensagem=''){if(estado.audioUrl)URL.revokeObjectURL(estado.audioUrl);estado.audioUrl=null;estado.audioPendente=null;estado.audioDuracao=null;estado.manterAudio=true;$('#preview-audio-diario').removeAttribute('src');$('#resultado-audio').hidden=true;$('#transcricao-audio').value='';$('#duracao-audio').textContent='';if(mensagem)$('#status-audio').textContent=mensagem}
function descartarAudio(){if((estado.audioPendente||$('#transcricao-audio').value.trim())&&!confirm('Descartar definitivamente a gravação e a transcrição?'))return;limparAudioPendente('Gravação e transcrição descartadas.')}
function pararReconhecimento(){try{estado.reconhecimento?.stop()}catch{}estado.reconhecimento=null}
async function gravarAudio(){if(estado.gravador?.state==='recording')return;if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)return $('#status-audio').textContent='A gravação não está disponível neste navegador.';let stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:true});const partes=[],gravador=new MediaRecorder(stream);estado.gravador=gravador;estado.inicioGravacao=Date.now();estado.manterAudio=true;gravador.ondataavailable=e=>{if(e.data.size)partes.push(e.data)};gravador.onerror=()=>{$('#status-audio').textContent='A gravação foi interrompida pelo navegador.';pararReconhecimento()};gravador.onstop=()=>{stream.getTracks().forEach(t=>t.stop());pararReconhecimento();estado.gravador=null;$('#gravar-audio').disabled=false;$('#parar-audio').disabled=true;const blob=new Blob(partes,{type:gravador.mimeType||'audio/webm'});if(blob.size>8_000_000){limparAudioPendente();$('#status-audio').textContent='O áudio passou de 8 MB e foi descartado.';return}estado.audioDuracao=Math.max(1,Math.round((Date.now()-estado.inicioGravacao)/1000));if(estado.audioUrl)URL.revokeObjectURL(estado.audioUrl);estado.audioPendente=blob;estado.audioUrl=URL.createObjectURL(blob);$('#preview-audio-diario').src=estado.audioUrl;$('#resultado-audio').hidden=false;$('#duracao-audio').textContent=`Duração aproximada: ${estado.audioDuracao} s.`;$('#status-audio').textContent='Gravação pronta. Revise o áudio e a transcrição antes de salvar.'};if($('#transcrever-audio').checked){const SR=window.SpeechRecognition||window.webkitSpeechRecognition;if(!SR){$('#status-audio').textContent='A transcrição automática não está disponível neste navegador. O áudio será gravado normalmente.'}else{const rec=new SR();estado.reconhecimento=rec;rec.lang='pt-BR';rec.continuous=true;rec.interimResults=true;let confirmado='';rec.onresult=e=>{let parcial='';for(let i=e.resultIndex;i<e.results.length;i++){const t=e.results[i][0].transcript;if(e.results[i].isFinal)confirmado+=`${t} `;else parcial+=t}$('#transcricao-audio').value=(confirmado+parcial).trim()};rec.onerror=()=>{$('#status-audio').textContent='A transcrição foi interrompida. O áudio continua sendo gravado.'};try{rec.start()}catch{}}}gravador.start();$('#gravar-audio').disabled=true;$('#parar-audio').disabled=false;$('#status-audio').textContent=$('#transcrever-audio').checked?'Gravando áudio e transcrevendo com sua autorização…':'Gravando áudio… toque em parar quando terminar.'}catch(e){stream?.getTracks().forEach(t=>t.stop());pararReconhecimento();estado.gravador=null;$('#gravar-audio').disabled=false;$('#parar-audio').disabled=true;$('#status-audio').textContent=e?.name==='NotAllowedError'?'Permissão do microfone não concedida. Nenhum áudio foi gravado.':'Não foi possível iniciar a gravação.'}}
function pararGravacaoAudio(){if(estado.gravador?.state!=='recording')return;$('#parar-audio').disabled=true;$('#status-audio').textContent='Finalizando a gravação…';estado.gravador.stop()}
function valoresMarcados(seletor){return $$(`${seletor} input:checked`).map(x=>x.value)}
function perfilDoFormulario(){return{id:'meu-perfil',nome:$('#perfil-nome').value.trim(),tom:$('#perfil-tom').value,resposta:$('#perfil-resposta').value,orientacao:$('#perfil-orientacao').value,conforta:$('#perfil-conforta').value.trim(),evitar:$('#perfil-evitar').value.trim(),ajuda:$('#perfil-ajuda').value.trim(),piora:$('#perfil-piora').value.trim(),sinais:$('#perfil-sinais').value.trim(),fazer:$('#perfil-fazer').value.trim(),naoFazer:$('#perfil-nao-fazer').value.trim(),ambiente:valoresMarcados('#perfil-ambiente'),lembretes:valoresMarcados('#perfil-lembretes'),areas:[...valoresMarcados('#perfil-areas'),$('#perfil-outra-area').value.trim()].filter(Boolean),updatedAt:new Date().toISOString()}}
function preencherPerfil(p){const v=p||{};['nome','conforta','evitar','ajuda','piora','sinais','fazer','nao-fazer','outra-area'].forEach(c=>{$(`#perfil-${c}`).value=v[c==='nao-fazer'?'naoFazer':c==='outra-area'?'outraArea':c]||''});$('#perfil-tom').value=v.tom||'neutra';$('#perfil-resposta').value=v.resposta||'escuta';$('#perfil-orientacao').value=v.orientacao||'uma-coisa';[['#perfil-ambiente',v.ambiente],['#perfil-lembretes',v.lembretes],['#perfil-areas',v.areas]].forEach(([s,a])=>$$(`${s} input`).forEach(x=>x.checked=(a||[]).includes(x.value)));$('#estado-perfil').textContent=v.updatedAt?`Atualizado em ${formatarData(v.updatedAt)}`:'Ainda não salvo'}
async function salvarPerfil(evento){evento?.preventDefault();const p=perfilDoFormulario();try{await armazenamento.salvarPerfilAcolhimento(p);estado.perfil=p;preencherPerfil(p);preencherNomeRelatorio();$('#status-perfil').textContent='Perfil salvo automaticamente neste aparelho.'}catch(e){console.error('Perfil não salvo:',e?.name||'Erro');$('#status-perfil').textContent='Não foi possível salvar o perfil agora.'}}
let timerPerfil;function agendarPerfil(){clearTimeout(timerPerfil);timerPerfil=setTimeout(()=>salvarPerfil(),700)}
async function redefinirPerfil(){if(!estado.perfil)return $('#status-perfil').textContent='Ainda não há perfil salvo.';if(!confirm('Redefinir todas as respostas do Perfil de Acolhimento?'))return;clearTimeout(timerPerfil);try{await armazenamento.excluirPerfilAcolhimento();estado.perfil=null;$('#form-perfil').reset();preencherPerfil(null);preencherNomeRelatorio();$('#status-perfil').textContent='Perfil redefinido. O apoio neutro continua disponível.'}catch{$('#status-perfil').textContent='Não foi possível redefinir o perfil.'}}
function contextoApoio(){const atual=$('#texto-registro').value.trim()?{feelings:sentimentosSelecionados(),intensity:$('#intensidade-incerta').checked?null:Number($('#intensidade-registro').value),text:$('#texto-registro').value}:estado.registros[0];return atual||null}
function escolherFrase(){const p=estado.perfil||{},r=contextoApoio(),sent=new Set(r?sentimentosDoRegistro(r):[]),texto=(r?.text||'').toLocaleLowerCase('pt-BR'),alta=Number.isInteger(r?.intensity)&&r.intensity>=7;let frases=[];if(sent.has('Ansiedade')||/ansied|preocup|aperto/.test(texto))frases.push('Talvez ajude diminuir o ritmo por um instante. Você pode apoiar os pés no chão e escolher apenas o próximo passo possível.','Você não precisa resolver todas as preocupações agora. Experimente nomear uma coisa que está sob seu controle neste momento.');if(sent.has('Cansaço')||sent.has('Sobrecarga'))frases.push('Seu cansaço merece espaço. Se for possível, reduza uma exigência agora e deixe o restante para depois.','Quando tudo pesa ao mesmo tempo, escolher uma pausa pequena também é cuidado.');if(sent.has('Tristeza'))frases.push('Você não precisa apressar essa tristeza nem explicá-la perfeitamente. Pode apenas reconhecer que este momento está difícil.');if(sent.has('Confusão'))frases.push('Não saber organizar o que aconteceu é uma resposta possível. Comece pelo fato mais simples de que você se lembra.');if(sent.has('Medo'))frases.push('Perceba onde você está agora e procure um sinal concreto de segurança ao seu redor. Se não estiver em segurança, use as opções de ajuda humana.');if(alta)frases.push('A intensidade parece alta. Tente ficar perto de alguém de confiança ou acessar o SOS se houver risco imediato.');if(p.conforta)frases.push(p.conforta);if(p.resposta==='escuta')frases.push('Você pode colocar para fora o que aconteceu sem precisar encontrar uma solução agora.');if(p.orientacao==='uma-coisa'||p.orientacao==='instrucoes')frases.push('Vamos por partes: primeiro cuide do que é mais urgente e deixe o restante para um momento com mais fôlego.');if(p.tom==='carinhosa')frases.push('Vá com delicadeza consigo neste momento. Você não precisa dar conta de tudo de uma vez.');if(p.tom==='direta')frases.push('Escolha uma ação pequena e possível para os próximos cinco minutos.');if(!frases.length)frases=['Você não precisa organizar tudo agora. Escolha apenas o próximo passo possível.','Se quiser, comece descrevendo apenas o que aconteceu, sem julgar sua reação.'];const evitadas=new Set(estado.feedbackApoio.filter(x=>x.avaliacao!=='ajudou').map(x=>x.frase));const recentes=new Set(estado.mensagensRecentes.slice(-3));const ajudaram=new Set(estado.feedbackApoio.filter(x=>x.avaliacao==='ajudou').map(x=>x.frase));frases.sort((a,b)=>Number(ajudaram.has(b))-Number(ajudaram.has(a)));return frases.find(f=>!evitadas.has(f)&&!recentes.has(f))||frases.find(f=>!evitadas.has(f))||'Considere respirar no seu ritmo ou procurar alguém de confiança. Você decide o próximo passo.'}
function mostrarFrase(){const frase=escolherFrase(),temContexto=Boolean(contextoApoio()||estado.perfil);$('#frase-personalizada').textContent=frase;$('#contexto-frase').textContent=temContexto?'Escolhida localmente a partir do seu registro e das suas preferências.':'Ainda há poucas informações; esta é uma mensagem de apoio geral.';estado.mensagensRecentes.push(frase);estado.mensagensRecentes=estado.mensagensRecentes.slice(-5);$('#status-frase').textContent='';return frase}
async function avaliarFrase(avaliacao){const frase=$('#frase-personalizada').textContent;const item={id:idSeguro(),frase,avaliacao,createdAt:new Date().toISOString()};try{await armazenamento.salvarFeedbackApoio(item);estado.feedbackApoio.push(item);$('#status-frase').textContent=avaliacao==='ajudou'?'Preferência guardada somente neste aparelho.':'Entendido. Vou evitar mensagens semelhantes.';if(avaliacao!=='ajudou')mostrarFrase()}catch{$('#status-frase').textContent='Não foi possível guardar essa preferência agora.'}}

function limparFormulario() {
  $('#form-diario').reset(); $$('input[name="sentimento"]').forEach(x=>x.checked=x.value==='Ainda não sei dizer'); $('#registro-id').value = ''; $('#valor-intensidade').textContent = '5'; $('#intensidade-registro').disabled = false; $('#status-edicao').hidden = true; $('#cancelar-edicao').hidden = true; $('#salvar-registro').textContent = 'Salvar no meu aparelho'; $('#mensagem-sugestao').textContent = ''; limparAudioPendente();
}
async function salvarRegistro(evento) {
  evento.preventDefault(); const texto = $('#texto-registro').value.trim(); if (!texto) return $('#texto-registro').focus();
  if (!estado.armazenamentoPronto) return status('Aguarde enquanto preparamos o armazenamento local.', true);
  const agora = new Date().toISOString(), id = $('#registro-id').value, indice = estado.registros.findIndex(r => r.id === id);
  const feelings=sentimentosSelecionados();
  const dados = { title: $('#titulo-registro').value.trim() || gerarTitulo(texto, agora), feelings, feeling: feelings[0], intensity: $('#intensidade-incerta').checked ? null : Number($('#intensidade-registro').value), text: texto, helped: $('#ajudou-registro').value.trim(), worsened: $('#piorou-registro').value.trim(), transcription:$('#transcricao-audio').value.trim(), audioDuration:estado.audioDuracao };
  let registro;
  if (indice >= 0) {
    const anterior = estado.registros[indice], versao = { title: anterior.title, feelings: sentimentosDoRegistro(anterior), feeling: anterior.feeling, intensity: anterior.intensity, text: anterior.text, helped: anterior.helped, worsened: anterior.worsened, transcription:anterior.transcription||'', savedAt: anterior.updatedAt || anterior.createdAt };
    registro = { ...anterior, ...dados, updatedAt: agora, history: [...anterior.history, versao] };
  } else registro = { id: idSeguro(), ...dados, strategies: [], createdAt: agora, updatedAt: null, history: [] };
  const botao = $('#salvar-registro'); botao.disabled = true;
  try {
    await armazenamento.salvar(registro);
    let audioFalhou = false;
    if (estado.audioPendente&&estado.manterAudio) { try { await armazenamento.salvarAudioDiario(registro.id, estado.audioPendente); } catch (erroAudio) { audioFalhou = true; console.error('Áudio do diário não salvo:', erroAudio?.name || 'Erro'); } }
    if (!estado.manterAudio&&indice>=0) await armazenamento.excluirAudioDiario(registro.id);
    if (indice >= 0) estado.registros[indice] = registro; else { estado.registros.unshift(registro); estado.selecionadosRelatorio.add(registro.id); }
    limparFormulario(); renderizar(); mostrarFrase(); status(audioFalhou ? 'O texto foi salvo, mas não houve espaço para guardar o áudio.' : indice >= 0 ? 'Alterações salvas. A versão anterior foi preservada.' : 'Registro salvo neste aparelho.', audioFalhou);
  } catch (erro) { informarFalha(erro); }
  finally { botao.disabled = false; }
}
function editar(id) {
  const r = estado.registros.find(x => x.id === id); if (!r) return;
  $('#mensagem-sugestao').replaceChildren();
  $('#registro-id').value = r.id; $('#titulo-registro').value = r.title; $('#texto-registro').value = r.text; $('#ajudou-registro').value = r.helped; $('#piorou-registro').value = r.worsened;
  const sentimentosAtuais=new Set(sentimentosDoRegistro(r));$$('input[name="sentimento"]').forEach(x=>x.checked=sentimentosAtuais.has(x.value));
  $('#transcricao-audio').value=r.transcription||'';estado.audioDuracao=r.audioDuration||null;
  $('#intensidade-incerta').checked = r.intensity === null; $('#intensidade-registro').disabled = r.intensity === null; $('#intensidade-registro').value = r.intensity ?? 5; $('#valor-intensidade').textContent = r.intensity ?? '—'; $('#status-edicao').hidden = false; $('#cancelar-edicao').hidden = false; $('#salvar-registro').textContent = 'Salvar alterações'; $('#form-diario').scrollIntoView({ behavior: movimento(), block: 'start' }); $('#titulo-registro').focus({ preventScroll: true });
}
async function excluir(id) {
  const r = estado.registros.find(x => x.id === id); if (!r || !confirm(`Excluir definitivamente “${r.title}” e todo o histórico deste registro?\n\nCancelar mantém todos os dados. OK confirma a exclusão.`)) return;
  try { await armazenamento.excluir(id); estado.registros = estado.registros.filter(x => x.id !== id); estado.selecionadosRelatorio.delete(id); if ($('#registro-id').value === id) limparFormulario(); renderizar(); status('Registro excluído deste aparelho.'); }
  catch (erro) { informarFalha(erro); }
}
function filtros() { return { busca: $('#pesquisa').value.trim().toLocaleLowerCase('pt-BR'), sentimento: $('#filtro-sentimento').value, data: $('#filtro-data').value }; }
function registrosVisiveis() {
  const f = filtros(); return [...estado.registros].filter(r => (!f.busca || [r.title, r.text, r.helped, r.worsened, r.transcription, ...sentimentosDoRegistro(r)].join(' ').toLocaleLowerCase('pt-BR').includes(f.busca)) && (!f.sentimento || sentimentosDoRegistro(r).includes(f.sentimento)) && (!f.data || r.createdAt.slice(0, 10) === f.data)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
function renderizar() {
  const lista = $('#lista-registros'); lista.replaceChildren(); $('#contador-registros').textContent = `${estado.registros.length} ${estado.registros.length === 1 ? 'registro' : 'registros'}`;
  const visiveis = registrosVisiveis(); $('#sem-resultados').hidden = visiveis.length > 0;
  visiveis.forEach(r => {
    const frag = $('#modelo-registro').content.cloneNode(true), card = $('.card-registro', frag); card.dataset.id = r.id;
    const sentimentosTexto=textoSentimentos(r),resumo=r.text.replace(/\s+/g,' ').trim();$('.registro-titulo', frag).textContent = r.title; $('.registro-resumo',frag).textContent=`${sentimentosTexto} • ${r.intensity===null?'intensidade não informada':`intensidade ${r.intensity}/10`} • ${formatarData(r.createdAt)}`;$('.registro-data', frag).textContent = `Criado em ${formatarData(r.createdAt)}`; $('.registro-intensidade', frag).textContent = r.intensity === null ? 'Intensidade: não sei' : `Intensidade: ${r.intensity}/10`; $('.registro-sentimento', frag).textContent = `Sentimentos: ${sentimentosTexto}`; $('.registro-texto-resumo',frag).textContent=`${resumo.slice(0,140)}${resumo.length>140?'…':''}`;$('.registro-texto', frag).textContent = r.text; const seletor=$('.selecionar-registro', frag);seletor.value=r.id;seletor.checked=estado.selecionadosRelatorio.has(r.id);if(r.transcription)$('.registro-transcricao',frag).textContent=`Transcrição: ${r.transcription}`;else $('.registro-transcricao',frag).remove();
    const detalhes = $('.detalhes-registro', frag); if (r.helped) { const p = document.createElement('p'); p.textContent = `O que ajudou: ${r.helped}`; detalhes.append(p); } if (r.worsened) { const p = document.createElement('p'); p.textContent = `O que piorou: ${r.worsened}`; detalhes.append(p); }
    if (r.postCrisis) { const p = document.createElement('p'); p.textContent = 'Tipo: registro pós-crise'; detalhes.prepend(p); $('.editar-registro', frag).remove(); }
    const ed = $('.registro-edicao', frag); if (r.updatedAt) ed.textContent = `Editado em ${formatarData(r.updatedAt)} · ${r.history.length} ${r.history.length===1?'versão anterior':'versões anteriores'}`; else ed.remove();
    lista.append(frag); carregarAudioRegistro(r.id, card);
  });
  renderizarSelecaoRelatorio();
}

function prepararSelecaoRelatorio(){const ajuda=$('#form-relatorio .ajuda');ajuda.textContent='O relatório resume os registros por temas identificados e não reproduz o diário completo. Revise exatamente quais registros serão incluídos.';const caixa=document.createElement('fieldset');caixa.innerHTML='<legend>Registros incluídos</legend><div id="selecao-relatorio" class="selecao-relatorio"></div><p class="ajuda">Desmarque o que não deseja compartilhar. A seleção respeita também o período informado.</p>';ajuda.before(caixa)}
function preencherNomeRelatorio(){const nome=estado.perfil?.nome?.trim()||'';$('#relatorio-nome').value=nome;$('#aviso-nome-relatorio').hidden=Boolean(nome)}
function renderizarSelecaoRelatorio(){const lista=$('#selecao-relatorio');if(!lista)return;lista.replaceChildren();if(!estado.registros.length){lista.textContent='Nenhum registro disponível.';return}[...estado.registros].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).forEach(r=>{const label=document.createElement('label');label.className='checkbox';const input=document.createElement('input');input.type='checkbox';input.value=r.id;input.checked=estado.selecionadosRelatorio.has(r.id);input.addEventListener('change',()=>alternarSelecaoRelatorio(r.id,input.checked));label.append(input,document.createTextNode(` ${new Intl.DateTimeFormat('pt-BR').format(new Date(r.createdAt))} — ${r.title}`));lista.append(label)})}
function alternarSelecaoRelatorio(id,marcado){marcado?estado.selecionadosRelatorio.add(id):estado.selecionadosRelatorio.delete(id);$$(`.selecionar-registro[value="${CSS.escape(id)}"]`).forEach(x=>x.checked=marcado);$$(`#selecao-relatorio input[value="${CSS.escape(id)}"]`).forEach(x=>x.checked=marcado)}
async function carregarAudioRegistro(id, card){try{const item=await armazenamento.buscarAudioDiario(id);if(!item?.blob||!card.isConnected)return;const audio=document.createElement('audio');audio.controls=true;audio.preload='metadata';audio.src=URL.createObjectURL(item.blob);const titulo=document.createElement('p');titulo.className='ajuda';titulo.textContent='Áudio local deste registro:';$('.registro-audio',card).append(titulo,audio)}catch(e){console.info('Áudio local indisponível.',e?.name||'Erro')}}
function sugerir() {
  const texto = $('#texto-registro').value.toLocaleLowerCase('pt-BR'), mapa = [['Ansiedade',['ansied','ansiosa','ansioso','aperto','preocup','nervos']],['Tristeza',['trist','chor','vazio']],['Irritação',['raiva','irrit','revolt']],['Medo',['medo','pânico','assust']],['Cansaço',['cans','exaust','esgot']],['Confusão',['confus','não sei','perdid']],['Felicidade',['feliz','alegr','orgulho']],['Calma',['calm','tranquil','alívio']],['Frustração',['frustr','decepcion']],['Sobrecarga',['sobrecarreg','peso demais','não dou conta']]];
  if (!texto.trim()) { $('#mensagem-sugestao').textContent = 'Escreva um pouco primeiro.'; return; }
  const achados=mapa.filter(([,palavras])=>palavras.some(p=>texto.includes(p))).map(([nome])=>nome),alvo=$('#mensagem-sugestao');alvo.replaceChildren();if(!achados.length){alvo.textContent='Não encontrei sugestões claras. Tudo bem escolher “Ainda não sei dizer”.';return}alvo.append(document.createTextNode(`Possibilidades locais: ${achados.join(', ')}. Confirme as que deseja usar; isto não é diagnóstico. `));achados.forEach(nome=>{const botao=document.createElement('button');botao.type='button';botao.className='botao-link';botao.textContent=`Adicionar ${nome}`;botao.addEventListener('click',()=>{const input=$(`input[name="sentimento"][value="${CSS.escape(nome)}"]`);if(input){input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}));botao.disabled=true;botao.textContent=`${nome} adicionado`}});alvo.append(botao)});if (/(me matar|suicid|não quero viver|vou me machucar)/i.test(texto)){const alerta=document.createElement('button');alerta.type='button';alerta.className='botao-perigo';alerta.textContent='Ver ajuda humana agora';alerta.addEventListener('click',()=>{atualizarContato();abrirModal($('#tela-urgente'))});alvo.append(alerta)}
}

async function baixarBackup() {
  try {
    const registros = await armazenamento.buscarTodos();
    const planoSeguranca = await armazenamento.buscarPlanoSeguranca();
    const caixa = await armazenamento.buscarCaixaAcolhimento(), comfortBox = caixa ? { mensagem:caixa.mensagem, funciona:caixa.funciona, lembranca:caixa.lembranca, exercicio:caixa.exercicio, updatedAt:caixa.updatedAt } : null;
    if (!registros.length && !planoSeguranca && !caixa) return alert('Ainda não há dados para o backup.');
    const blob = new Blob([JSON.stringify({ app: 'Porto Seguro', version: VERSAO, schemaVersion: 3, createdAt: new Date().toISOString(), entries: registros, safetyPlan: planoSeguranca, comfortBox }, null, 2)], { type: 'application/json' }), a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `porto-seguro-backup-${new Date().toISOString().slice(0,10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 0); localStorage.setItem(CHAVE_BACKUP_RECENTE,new Date().toISOString()); status('Backup baixado. Fotos e áudios permanecem somente neste aparelho.');
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
  janela.document.write(`<!doctype html><meta charset="utf-8"><title>${escapar(titulo)}</title><style>body{font:16px/1.5 Arial;max-width:800px;margin:40px auto;color:#302b45}article{border-bottom:1px solid #ccc;padding:16px 0;white-space:pre-wrap}small{color:#655f77}@media print{body{margin:0}}</style><h1>${escapar(titulo)}</h1>${lista.map(r => `<article><h2>${escapar(r.title)}</h2><small>${escapar(formatarData(r.createdAt))} · ${escapar(textoSentimentos(r))} · Intensidade ${r.intensity ?? 'não informada'}</small><p>${escapar(r.text)}</p>${r.transcription?`<p><b>Transcrição:</b> ${escapar(r.transcription)}</p>`:''}${r.helped ? `<p><b>O que ajudou:</b> ${escapar(r.helped)}</p>` : ''}${r.worsened ? `<p><b>O que piorou:</b> ${escapar(r.worsened)}</p>` : ''}</article>`).join('')}<script>onload=()=>print()<\/script>`); janela.document.close();
}
function imprimirPlano() {
  const plano = planoDoFormulario();
  if (!CAMPOS_PLANO.some(campo => plano[campo])) { $('#status-plano').textContent = 'Preencha o plano antes de imprimir.'; return; }
  const janela = open('', '_blank'); if (!janela) { $('#status-plano').textContent = 'Permita a janela de impressão no navegador.'; return; }
  janela.opener = null; const escapar = s => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const titulos = { sinais:'Sinais de alerta', gatilhos:'Gatilhos que reconheço', ajuda:'O que costuma me ajudar', piora:'O que costuma piorar', lugares:'Lugares seguros', contatos:'Pessoas e contatos de confiança', profissionais:'Profissionais e serviços', passos:'Passos que gostaria de seguir' };
  janela.document.write(`<!doctype html><meta charset="utf-8"><title>Meu plano pessoal de segurança</title><style>body{font:16px/1.5 Arial;max-width:800px;margin:40px auto;color:#302b45}section{border-top:1px solid #ccc;padding:12px 0;white-space:pre-wrap}small{color:#655f77}@media print{body{margin:0}}</style><h1>Meu plano pessoal de segurança</h1><p><small>Porto Seguro · documento pessoal, não substitui atendimento profissional ou emergência.</small></p>${CAMPOS_PLANO.filter(campo=>plano[campo]).map(campo=>`<section><h2>${escapar(titulos[campo])}</h2><p>${escapar(plano[campo])}</p></section>`).join('')}<script>onload=()=>print()<\/script>`); janela.document.close();
}
function normalizarTexto(s){return String(s||'').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/\p{Diacritic}/gu,'')}
function registroTextoBusca(r){return [r.text,r.transcription,r.helped,r.worsened,r.postCrisis?.trigger,r.postCrisis?.notes].filter(Boolean).join(' ')}

const MAPA_MUDANCAS=[['Ansiedade',['ansied','ansiosa','ansioso','aperto no peito','preocup','nervos']],['Tristeza',['trist','chorei','chorando','vazio']],['Irritabilidade',['irrit','raiva','revolt']],['Confusão',['confus','nao sei','perdida','perdido']],['Alterações no sono',['insonia','nao consigo dormir','dormindo mal','pesadelo','acordo de madrugada','dormindo demais','durmo demais']],['Dificuldade de concentração',['concentr','esqueci','esquecendo','nao consigo pensar','lapso de memoria']],['Mudanças de comportamento',['me isolei','me isolando','parei de','deixei de','evitando','nao saio mais']],['Alterações perceptivas',['ouco vozes','vejo coisas','acho que estao me observando','alucina']],['Possíveis efeitos após mudança de medicação',['mudei a dose','troquei o remedio','troquei a medicacao','nova medicacao','ajustaram a medicacao','parei o remedio','esqueci de tomar o remedio']]];
const MAPA_GATILHOS=[['Conflitos familiares/conjugais',['marido','esposa','companheiro','companheira','namorado','namorada','brigou','briga','discussao','conflito']],['Falta de apoio',['sozinha','sozinho','ninguem me ajuda','nao tenho com quem']],['Sobrecarga',['sobrecarreg','nao dou conta','peso demais']],['Trabalho',['trabalho','emprego','chefe','demiss']],['Dependência financeira',['dependo dele','dependo dela','sem renda','sem emprego','financeir']],['Dor física',['dor ','doi ','doendo','machuc']],['Mudanças de rotina',['mudei de','nova rotina','mudou tudo']],['Sensação de abandono ou desvalorização',['abandon','nao me valorizam','invisivel']]];
const MAPA_ESTRATEGIAS=[['Respiração ou relaxamento',['respir','relax']],['Buscar companhia',['liguei para','chamei','pedi ajuda','fiquei perto de']],['Distração ou atividade',['assisti','ouvi musica','fui caminhar','sai para']],['Escrita ou registro',['escrevi','anotei']]];
const MAPA_PROTECAO=[['Filhos',['filho','filha','filhos','filhas']],['Acompanhamento profissional',['terapia','psicolog','psiquiatra','consulta marcada']],['Projetos e planos futuros',['projeto','planejo','pretendo']],['Desejo de melhorar',['quero melhorar','quero mudar','quero sair dessa']],['Rede de apoio',['amiga','amigo','familia me apoia','minha mae','meu pai']],['Busca por atendimento',['procurei ajuda','marquei consulta','busquei atendimento']]];
const MAPA_IMPACTOS=[['Sono',['sono','dormir','insonia']],['Alimentação',['comer','alimentac','apetite']],['Rotina',['rotina']],['Trabalho',['trabalho','emprego']],['Estudo',['estud','faculdade','escola','prova']],['Relacionamento',['relacionamento','namoro','casamento']],['Cuidado com os filhos',['cuidar dos filhos','cuidar do filho','cuidar da filha']],['Autonomia',['nao consigo sair','dependo de','sozinha nao','sozinho nao']],['Autocuidado',['banho','higiene','me cuidar']]];
const MAPA_RISCO={pensamentosDeMorte:['quero morrer','nao quero viver','vontade de morrer','pensei em morrer','cansada de viver','cansado de viver','queria desaparecer','queria sumir','sumir de vez','melhor eu nao existir','nao existisse','nao existir mais','nao estar mais aqui','nao aguento mais viver','nao aguento mais essa vida','queria nunca ter nascido','mais facil se eu'],autolesao:['me cortar','me machucar','me cortei','me machuquei','autolesao'],medicacaoAlemPrescrito:['tomar todos os remedios','tomar a cartela toda','overdose','exagerar na medicacao','tomar mais remedio do que devia'],plano:['tenho um plano','ja decidi como','separei os remedios para','escrevi uma carta de despedida','marquei o dia'],intencao:['vou fazer isso','estou decidida a','estou decidido a','nao aguento mais e vou','desta vez vou ate o fim'],acessoAMeios:['tenho os remedios guardados','tenho uma arma','guardei as laminas'],atendimentoHospitalar:['pronto socorro','internacao','samu','hospital psiquiatrico','atendimento de emergencia']};

function tabularTemas(lista,mapa,camposTexto=registroTextoBusca){const total=lista.length,contagens=mapa.map(([categoria])=>({categoria,ids:new Set()}));lista.forEach(r=>{const texto=normalizarTexto(camposTexto(r));mapa.forEach(([,palavras],i)=>{if(palavras.some(p=>texto.includes(p)))contagens[i].ids.add(r.id)})});return contagens.filter(c=>c.ids.size>0).map(c=>({categoria:c.categoria,contagem:c.ids.size,total})).sort((a,b)=>b.contagem-a.contagem)}
function frasesTemas(temas){return temas.map(t=>`Foi identificado um possível padrão de ${t.categoria.toLowerCase()} (mencionado em ${t.contagem} de ${t.total} registros selecionados).`)}

function registrosSelecionadosRelatorio(){const inicio=$('#relatorio-inicio').value,fim=$('#relatorio-fim').value,selecionados=estado.selecionadosRelatorio,incluirPos=$('#relatorio-incluir-pos-crise').checked;return estado.registros.filter(r=>(!inicio||r.createdAt.slice(0,10)>=inicio)&&(!fim||r.createdAt.slice(0,10)<=fim)&&selecionados.has(r.id)&&(incluirPos||!r.postCrisis)).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt))}

function calcularPeriodo(lista){if(!lista.length)return'Período resumido: não foi possível calcular (nenhum registro selecionado).';const datas=lista.map(r=>Date.parse(r.createdAt)).filter(Number.isFinite);if(!datas.length)return'Período resumido: não foi possível calcular (registros sem data válida).';const fmt=d=>new Intl.DateTimeFormat('pt-BR',{dateStyle:'short'}).format(d);return`Período resumido: ${fmt(new Date(Math.min(...datas)))} a ${fmt(new Date(Math.max(...datas)))}`}

function calcularIntensidadeMedia(lista){const validos=lista.filter(r=>Number.isInteger(r.intensity));if(!validos.length)return'Intensidade média não calculada por falta de registros numéricos suficientes.';const media=validos.reduce((a,r)=>a+r.intensity,0)/validos.length,mediaTexto=media.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});return`Intensidade média: ${mediaTexto}, calculada a partir de ${validos.length} dos ${lista.length} registros selecionados.`}

function identificacaoRelatorio(lista,profissionalTipo,profissionalNome){const pessoa=estado.perfil?.nome?.trim()||'não informado no Perfil de Acolhimento';return[`Pessoa acompanhada: ${pessoa}`,`Profissional destinatário: ${profissionalTipo}${profissionalNome?` — ${profissionalNome}`:''}`,calcularPeriodo(lista),`Quantidade de registros selecionados: ${lista.length}`,`Data de geração: ${formatarData(new Date().toISOString())}`,calcularIntensidadeMedia(lista)].join('\n')}

function estadoAtual(lista){if(!lista.length)return'Não há registros suficientes para descrever o estado atual.';const maisRecente=[...lista].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))[0],intensidade=Number.isInteger(maisRecente.intensity)?`${maisRecente.intensity}/10`:'não informada',partes=[`Emoções mais recentes registradas: ${textoSentimentos(maisRecente)}.`,`Intensidade mais recente: ${intensidade}.`,`Registro de ${formatarData(maisRecente.createdAt)}.`],temasRecentes=tabularTemas([maisRecente],MAPA_MUDANCAS);if(temasRecentes.length)partes.push(`Temas identificados no registro mais recente: ${temasRecentes.map(t=>t.categoria.toLowerCase()).join(', ')}.`);return partes.join(' ')}

function mudancasPercebidas(lista){const temas=tabularTemas(lista,MAPA_MUDANCAS);if(!temas.length)return'Não foram identificados padrões recorrentes claros nos registros selecionados.';return frasesTemas(temas).join(' ')+' Estas observações não implicam relação de causa e efeito nem substituem avaliação profissional.'}

function gatilhosContextos(lista){const linhas=frasesTemas(tabularTemas(lista,MAPA_GATILHOS)),gatilhosPos={};lista.forEach(r=>{const g=r.postCrisis?.trigger?.trim();if(g)gatilhosPos[g]=(gatilhosPos[g]||0)+1});const posOrdenado=Object.entries(gatilhosPos).sort((a,b)=>b[1]-a[1]);if(posOrdenado.length)linhas.push(`Gatilhos informados em registros pós-crise: ${posOrdenado.map(([g,n])=>`${g} (${n})`).join('; ')}.`);return linhas.length?linhas.join(' '):'Os registros não indicam gatilhos ou contextos recorrentes claros.'}

function estrategiasUtilizadas(lista){const vistas=new Set(),itens=[];lista.forEach(r=>{[r.helped,...(r.strategies||[]),r.postCrisis?.strategy].filter(Boolean).forEach(s=>{const chave=s.trim().toLocaleLowerCase('pt-BR');if(chave&&!vistas.has(chave)){vistas.add(chave);itens.push(s.trim())}})});if(itens.length)return`A pessoa relata ter utilizado as seguintes estratégias: ${itens.slice(0,8).join('; ')}.`;const porTexto=tabularTemas(lista,MAPA_ESTRATEGIAS);if(porTexto.length)return`Foram identificadas possíveis estratégias nos registros: ${porTexto.map(t=>t.categoria.toLowerCase()).join(', ')}.`;return'Os registros não informam claramente estratégias utilizadas.'}

function fatoresProtecao(lista){const temas=tabularTemas(lista,MAPA_PROTECAO);if(!temas.length)return'Não foram identificados fatores de proteção claramente descritos nos registros selecionados.';return frasesTemas(temas).join(' ')}

function impactosCotidiano(lista){const temas=tabularTemas(lista,MAPA_IMPACTOS);if(!temas.length)return'Os registros não descrevem claramente impactos no cotidiano.';return frasesTemas(temas).join(' ')}

function pontosConsulta(lista,observacoes){const perguntas=['Como a pessoa está se sentindo em relação ao período descrito neste relatório?'];const temasMudancas=tabularTemas(lista,MAPA_MUDANCAS);if(temasMudancas.length)perguntas.push(`O que pode estar associado ao padrão de ${temasMudancas[0].categoria.toLowerCase()} identificado nos registros?`);const temasGatilhos=tabularTemas(lista,MAPA_GATILHOS);if(temasGatilhos.length)perguntas.push(`Como lidar com os episódios relacionados a ${temasGatilhos[0].categoria.toLowerCase()}?`);perguntas.push('As estratégias já tentadas pela pessoa têm sido úteis? Há outras que poderiam ajudar?','Necessita de avaliação profissional adicional em relação aos temas trazidos neste relatório?');let texto=perguntas.map((p,i)=>`${i+1}. ${p}`).join('\n');if(observacoes)texto+=`\n\nObservações adicionais informadas pela pessoa:\n${observacoes}`;return texto}

const CATEGORIAS_RISCO=['pensamentos de morte','autolesão','vontade de tomar medicação além do prescrito','atendimento hospitalar por crise','plano','intenção','acesso a meios'];
function mesmosAchadosDeRisco(original,reescrita){const normal=s=>String(s||'').toLocaleLowerCase('pt-BR');const originalNorm=normal(original),reescritaNorm=normal(reescrita);return CATEGORIAS_RISCO.every(categoria=>originalNorm.includes(categoria)===reescritaNorm.includes(categoria))}
function detectarRisco(lista){const achados={};Object.keys(MAPA_RISCO).forEach(chave=>achados[chave]=new Set());lista.forEach(r=>{const texto=normalizarTexto(registroTextoBusca(r));Object.entries(MAPA_RISCO).forEach(([chave,palavras])=>{if(palavras.some(p=>texto.includes(p)))achados[chave].add(r.id)})});const rotulos={pensamentosDeMorte:'Pensamentos de morte',autolesao:'Autolesão',medicacaoAlemPrescrito:'Vontade de tomar medicação além do prescrito',atendimentoHospitalar:'Atendimento hospitalar por crise'};const linhas=[];let algumaMencao=false;['pensamentosDeMorte','autolesao','medicacaoAlemPrescrito','atendimentoHospitalar'].forEach(chave=>{if(achados[chave].size){linhas.push(`${rotulos[chave]}: mencionado(a) em ${achados[chave].size} registro(s).`);algumaMencao=true}});const temPlano=achados.plano.size>0,temIntencao=achados.intencao.size>0,temMeios=achados.acessoAMeios.size>0;if(temPlano){linhas.push(`Plano: mencionado em ${achados.plano.size} registro(s).`);algumaMencao=true}if(temIntencao){linhas.push(`Intenção: mencionada em ${achados.intencao.size} registro(s).`);algumaMencao=true}if(temMeios){linhas.push(`Acesso a meios: mencionado em ${achados.acessoAMeios.size} registro(s).`);algumaMencao=true}if(!temPlano&&!temIntencao&&!temMeios)linhas.push('Os registros não fornecem informações suficientes para determinar a presença de plano, intenção ou acesso atual a meios. Recomenda-se avaliação direta pela profissional.');if(!algumaMencao)linhas.unshift('Nenhuma menção explícita a pensamentos de morte, autolesão ou atendimento hospitalar por crise foi identificada nos registros selecionados.');return linhas.join('\n')}

function montarRelatorioResumido(dados){const secoesAtivas=new Set($$('.secao-relatorio-toggle:checked').map(x=>x.dataset.secao)),blocos=['RELATÓRIO RESUMIDO PARA ACOMPANHAMENTO','','1. IDENTIFICAÇÃO',dados.identificacao];if(secoesAtivas.has('objetivo'))blocos.push('','2. OBJETIVO INFORMADO PELA PESSOA',dados.objetivo);if(secoesAtivas.has('estadoAtual'))blocos.push('','3. ESTADO ATUAL',dados.estadoAtual);if(secoesAtivas.has('mudancas'))blocos.push('','4. MUDANÇAS PERCEBIDAS NO PERÍODO',dados.mudancas);if(secoesAtivas.has('gatilhos'))blocos.push('','5. POSSÍVEIS GATILHOS E CONTEXTOS',dados.gatilhos);blocos.push('','6. SITUAÇÕES DE RISCO',dados.risco);if(secoesAtivas.has('estrategias'))blocos.push('','7. ESTRATÉGIAS UTILIZADAS',dados.estrategias);if(secoesAtivas.has('protecao'))blocos.push('','8. FATORES DE PROTEÇÃO',dados.protecao);if(secoesAtivas.has('impactos'))blocos.push('','9. IMPACTOS NO COTIDIANO',dados.impactos);if(secoesAtivas.has('consulta'))blocos.push('','10. PONTOS SUGERIDOS PARA A CONSULTA',dados.pontosConsulta);blocos.push('','11. LIMITAÇÕES','Este documento organiza informações selecionadas pela própria pessoa. Não constitui diagnóstico, laudo, prontuário ou avaliação profissional.');return blocos.join('\n')}

function montarAnexoCompleto(lista){const linhas=['===== ANEXO: REGISTROS COMPLETOS (opcional) =====','Os registros completos podem conter informações íntimas, nomes de terceiros e linguagem pessoal.',''];lista.forEach(r=>{linhas.push(`${formatarData(r.createdAt)} — ${r.title}`,`Sentimentos: ${textoSentimentos(r)}; intensidade: ${r.intensity??'não informada'}.`,`Registro: ${r.text}`);if(r.transcription)linhas.push(`Transcrição: ${r.transcription}`);if(r.helped)linhas.push(`O que ajudou: ${r.helped}`);if(r.worsened)linhas.push(`O que piorou: ${r.worsened}`);linhas.push('')});return linhas.join('\n').trim()}

function primeiraFraseCurta(texto,maxPalavras=25){const primeira=String(texto||'').split(/(?<=[.!?])\s+/)[0]||'',palavras=primeira.trim().split(/\s+/).filter(Boolean);return palavras.slice(0,maxPalavras).join(' ')+(palavras.length>maxPalavras?'…':'')}
function removerNomesProvaveis(texto){return String(texto||'').replace(/\b(meu|minha)\s+(marido|esposa|companheiro|companheira|namorado|namorada|pai|mãe|irmão|irmã|filho|filha|amigo|amiga)\s+[A-ZÀ-Ú][a-zà-ú]+/g,'$1 $2')}
function montarCitacoes(lista,removerTerceiros){return lista.slice(0,6).map(r=>{let trecho=primeiraFraseCurta(r.text);if(removerTerceiros)trecho=removerNomesProvaveis(trecho);return trecho?`"${trecho}" (${formatarData(r.createdAt)})`:null}).filter(Boolean).join('\n')}

function contarPalavras(texto){return String(texto||'').trim().split(/\s+/).filter(Boolean).length}
function atualizarContadorPalavras(){const n=contarPalavras($('#texto-relatorio-editavel').value),el=$('#contador-palavras-relatorio');el.textContent=n?`${n} palavra(s) no relatório principal (recomendado: até ~700 para até 2 páginas).`:'';el.classList.toggle('erro',n>700)}

function gerarRelatorio(evento){
  evento.preventDefault();
  preencherNomeRelatorio();
  let profissionalTipo=$('#relatorio-profissional').value;if(profissionalTipo==='Outro profissional')profissionalTipo=$('#relatorio-outro-profissional').value.trim()||profissionalTipo;
  const profissionalNome=$('#relatorio-nome-profissional').value.trim(),lista=registrosSelecionadosRelatorio();
  if(!lista.length){$('#status-relatorio').textContent='Selecione ao menos um registro que corresponda ao período.';$('#resultado-relatorio').hidden=false;return}
  const dados={identificacao:identificacaoRelatorio(lista,profissionalTipo,profissionalNome),objetivo:$('#relatorio-objetivo').value.trim()||'Não informado.',estadoAtual:estadoAtual(lista),mudancas:mudancasPercebidas(lista),gatilhos:gatilhosContextos(lista),risco:detectarRisco(lista),estrategias:estrategiasUtilizadas(lista),protecao:fatoresProtecao(lista),impactos:impactosCotidiano(lista),pontosConsulta:pontosConsulta(lista,$('#observacoes-relatorio').value.trim())};
  let texto=montarRelatorioResumido(dados);
  if($('#relatorio-incluir-citacoes').checked){const citacoes=montarCitacoes(lista,!$('#relatorio-incluir-nomes-terceiros').checked);if(citacoes)texto+=`\n\n===== CITAÇÕES BREVES DOS REGISTROS (opcional) =====\n${citacoes}`}
  estado.relatorioAtual={id:idSeguro(),profissional:profissionalTipo,inicio:$('#relatorio-inicio').value,fim:$('#relatorio-fim').value,registros:lista.map(r=>r.id),texto,createdAt:new Date().toISOString()};
  estado.dadosRelatorioAtual=dados;
  $('#titulo-previa-relatorio').textContent=`Relatório resumido para ${profissionalTipo}`;
  $('#texto-relatorio-editavel').value=texto;
  atualizarContadorPalavras();
  atualizarBotaoAprimorarIA();
  $('#resultado-relatorio').hidden=false;
  $('#status-relatorio').textContent='Revise livremente: você pode editar o texto antes de salvar, ou usar as opções acima para incluir mais ou menos informações.';
  $('#resultado-relatorio').scrollIntoView({behavior:movimento()});
}
function imprimirRelatorio(){const texto=$('#texto-relatorio-editavel').value.trim();if(!texto)return;const profissional=estado.relatorioAtual?.profissional||'profissional',janela=open('','_blank');if(!janela)return $('#status-relatorio').textContent='Permita a janela de impressão no navegador.';janela.opener=null;const escapar=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));janela.document.write(`<!doctype html><meta charset="utf-8"><title>relatorio-para-${escapar(profissional.toLowerCase().replace(/[^a-z0-9]+/g,'-'))}</title><style>body{font:15px/1.55 Arial;max-width:850px;margin:35px auto;color:#302b45;white-space:pre-wrap}@media print{body{margin:0}}</style>${escapar(texto)}<script>onload=()=>print()<\/script>`);janela.document.close()}
async function salvarRelatorioAtual(){if(!estado.relatorioAtual)return;const item={...estado.relatorioAtual,texto:$('#texto-relatorio-editavel').value,updatedAt:new Date().toISOString()};try{await armazenamento.salvarRelatorio(item);estado.relatorioAtual=item;$('#status-relatorio').textContent='Relatório salvo neste aparelho.'}catch{$('#status-relatorio').textContent='Não foi possível salvar o relatório agora.'}}
function cancelarRelatorio(){estado.relatorioAtual=null;estado.dadosRelatorioAtual=null;$('#texto-relatorio-editavel').value='';$('#contador-palavras-relatorio').textContent='';$('#aprimorar-ia-relatorio').hidden=true;$('#resultado-relatorio').hidden=true}
function anexarRegistrosCompletos(){if(!estado.relatorioAtual)return $('#status-relatorio').textContent='Gere o relatório antes de anexar os registros completos.';if(!confirm('Os registros completos podem conter informações íntimas, nomes de terceiros e linguagem pessoal. Confirme se deseja incluí-los.'))return;const lista=estado.registros.filter(r=>estado.relatorioAtual.registros.includes(r.id)),anexo=montarAnexoCompleto(lista);$('#texto-relatorio-editavel').value=$('#texto-relatorio-editavel').value.trimEnd()+'\n\n'+anexo;atualizarContadorPalavras();$('#status-relatorio').textContent='Registros completos anexados. Revise antes de salvar ou imprimir.'}

// --- Aprimoramento opcional dos relatórios por IA --------------------------
function atualizarBotaoAprimorarIA(){$('#aprimorar-ia-relatorio').hidden=!$('#habilitar-ia-relatorio').checked||!estado.dadosRelatorioAtual}
function payloadSecoesIA(dados){const{identificacao,...resto}=dados;return resto}
function nomeProvedorIA(valor){return valor==='anthropic'?'Claude (Anthropic)':'ChatGPT (OpenAI)'}
function abrirConsentimentoIA(){if(!estado.dadosRelatorioAtual)return;const provedor=$('#ia-provedor').value,payload=payloadSecoesIA(estado.dadosRelatorioAtual);$('#ia-provedor-nome').textContent=nomeProvedorIA(provedor);$('#previa-envio-ia').value=JSON.stringify(payload,null,2);$('#status-consentimento-ia').textContent='';abrirModal($('#tela-consentimento-ia'))}
async function confirmarEnvioIA(){const resumoIA=window.PortoSeguroResumoIA;if(!resumoIA)return $('#status-consentimento-ia').textContent='Aprimoramento por IA indisponível neste navegador.';if(!estado.dadosRelatorioAtual)return;const provedor=$('#ia-provedor').value,payload=payloadSecoesIA(estado.dadosRelatorioAtual),botao=$('#confirmar-envio-ia');botao.disabled=true;$('#status-consentimento-ia').textContent='Enviando…';try{const resultado=await resumoIA.aprimorarComIA(provedor,payload);const secoesRevisadas=resultado?.secoes;if(!secoesRevisadas)throw new Error('Resposta vazia da IA.');if(!mesmosAchadosDeRisco(payload.risco,secoesRevisadas.risco))secoesRevisadas.risco=payload.risco;const dadosFinal={...estado.dadosRelatorioAtual,...secoesRevisadas};let texto=montarRelatorioResumido(dadosFinal);if($('#relatorio-incluir-citacoes').checked){const lista=estado.registros.filter(r=>estado.relatorioAtual?.registros?.includes(r.id));const citacoes=montarCitacoes(lista,!$('#relatorio-incluir-nomes-terceiros').checked);if(citacoes)texto+=`\n\n===== CITAÇÕES BREVES DOS REGISTROS (opcional) =====\n${citacoes}`}$('#texto-relatorio-editavel').value=texto;atualizarContadorPalavras();fecharModal($('#tela-consentimento-ia'));$('#status-relatorio').textContent='Texto aprimorado por IA. Revise com atenção antes de salvar ou imprimir.'}catch(erro){$('#status-consentimento-ia').textContent=erro?.message||'Não foi possível usar a IA agora.'}finally{botao.disabled=false}}

function movimento() { return matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'; }
function abrirModal(modal) { estado.ultimoFoco = document.activeElement; modal.hidden = false; document.body.classList.add('sem-rolagem'); $('button,a,input,[tabindex]:not([tabindex="-1"])', modal)?.focus(); }
function fecharModal(modal) { modal.hidden = true; document.body.classList.remove('sem-rolagem'); estado.ultimoFoco?.focus?.(); }
function prenderFoco(evento, modal) { if (evento.key !== 'Tab') return; const itens = $$('button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])', modal).filter(x=>x.offsetParent!==null); if (!itens.length) return; const [primeiro] = itens, ultimo = itens.at(-1); if (evento.shiftKey && document.activeElement === primeiro) { evento.preventDefault(); ultimo.focus(); } else if (!evento.shiftKey && document.activeElement === ultimo) { evento.preventDefault(); primeiro.focus(); } }
function iniciarRespiracao() { const r=estado.respiracao; clearInterval(r.timer); Object.assign(r,{ativa:true,pausada:false,ciclo:1,fase:'inspirar',restante:4}); $('#acoes-respiracao').hidden=false; $('#acoes-finais').hidden=true; $('#registrar-apos-respirar').hidden=bloqueioAtivo;$('#continuar-apoio').hidden=bloqueioAtivo; abrirModal($('#tela-respiracao')); atualizarRespiracao(); r.timer=setInterval(passoRespiracao,1000); }
function atualizarRespiracao() { const r=estado.respiracao; $('#instrucao-respiracao').textContent = r.fase === 'inspirar' ? 'Inspire devagar' : 'Solte o ar devagar'; $('#numero-respiracao').textContent=r.restante; $('#ciclo-respiracao').textContent=`Ciclo ${r.ciclo} de 5`; $('#pausar-respiracao').textContent=r.pausada?'Continuar':'Pausar'; }
function passoRespiracao() { const r=estado.respiracao; if (!r.ativa || r.pausada) return; r.restante--; if (r.restante <= 0) { if (r.fase==='inspirar') { r.fase='soltar'; r.restante=6; } else if (r.ciclo<5) { r.ciclo++; r.fase='inspirar'; r.restante=4; } else return finalizarRespiracao(); } atualizarRespiracao(); }
function finalizarRespiracao() { const r=estado.respiracao; clearInterval(r.timer); r.ativa=false; $('#instrucao-respiracao').textContent='Você concluiu. Perceba como está se sentindo agora.'; $('#numero-respiracao').textContent='✓'; $('#ciclo-respiracao').textContent='Cinco ciclos concluídos'; $('#acoes-respiracao').hidden=true; $('#acoes-finais').hidden=false; $('#respirar-novamente').focus(); }
function pararRespiracao() { const r=estado.respiracao; clearInterval(r.timer); r.ativa=false; fecharModal($('#tela-respiracao')); if(bloqueioAtivo)abrirSOS(); }
function registrarEstrategia() { pararRespiracao(); location.hash='diario'; $('#texto-registro').focus(); $('#texto-registro').value ||= 'Depois de respirar, estou me sentindo '; $('#ajudou-registro').value ||= 'Respiração guiada'; }

function mostrarApoio(tipo) {
  const box=$('#apoio-progressivo'); box.hidden=false;
  const textos={regular:escolherFrase(),confianca:'Você pode escolher alguém que escute sem julgar. Se quiser, configure um contato na tela de ajuda urgente; o aplicativo só facilitará a ligação quando você tocar.',perguntas:'O que ajudaria mais agora? Você pode escrever, apenas escolher uma opção ou ficar em silêncio por alguns instantes.'}; box.textContent=textos[tipo]||textos.perguntas;
}
function contato() { try { return JSON.parse(localStorage.getItem(CHAVE_CONTATO)||'null'); } catch { return null; } }
function atualizarContato() { const c=contato(); $('#nome-contato').textContent=c?.name?`Conversar com ${c.name}${c.phone?` · final ${c.phone.slice(-4)}`:''}`:'Configure um contato abaixo'; $('#contato-nome').value=c?.name||''; $('#contato-telefone').type='password'; $('#contato-telefone').value=c?.phone||''; $('#contato-mensagem').value=c?.message||'Não estou bem agora. Não precisa resolver nada, apenas fique comigo e, se puder, entre em contato.'; }
function abrirSOS(){if(!bloqueioAtivo)return;const c=contato(),permitidas=new Set(configuracaoPin()?.sos||['samu','cvv','contato','whatsapp','respirar']);[['sos-samu','samu'],['sos-cvv','cvv'],['sos-contato','contato'],['sos-whatsapp','whatsapp'],['sos-respirar','respirar']].forEach(([id,tipo])=>{$('#'+id).hidden=!permitidas.has(tipo)||(tipo==='contato'&&!c?.phone)||(tipo==='whatsapp'&&!c?.phone)});$('#sos-contato').href='#';$('#sos-contato-mascarado').textContent=c?.phone?`Contato •••• ${c.phone.slice(-4)}`:'Contato não configurado';$('#status-sos').textContent='';$('#tela-bloqueio').hidden=true;$('#tela-sos').hidden=false;$('#voltar-pin').focus()}
function voltarAoPin(){if(!bloqueioAtivo)return;$('#tela-sos').hidden=true;$('#tela-bloqueio').hidden=false;$('#pin-desbloqueio').value='';verificarBloqueioPin();if(!$('#pin-desbloqueio').disabled)$('#pin-desbloqueio').focus()}
function ligarContatoSOS(evento){evento.preventDefault();const c=contato();if(c?.phone)location.href=`tel:${c.phone}`}
function whatsappSOS(){const c=contato();if(!c?.phone)return $('#status-sos').textContent='Configure previamente um contato de confiança para usar esta opção.';const janela=window.open(`https://wa.me/${c.phone}?text=${encodeURIComponent('Preciso de ajuda agora. Por favor, entre em contato comigo.')}`,'_blank','noopener,noreferrer');$('#status-sos').textContent=janela?'WhatsApp aberto. A mensagem ainda não foi enviada; confirme no próprio WhatsApp.':'O navegador bloqueou a abertura. Permita pop-ups e tente novamente.'}
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
  const card=e.target.closest('.card-registro');if(card&&e.target.closest('.alternar-registro')){const botao=e.target.closest('.alternar-registro'),completo=$('.registro-completo',card),abrir=botao.getAttribute('aria-expanded')!=='true';botao.setAttribute('aria-expanded',String(abrir));botao.textContent=abrir?'Recolher registro':'Ver registro completo';completo.hidden=!abrir} if (card && e.target.matches('.editar-registro')) editar(card.dataset.id); if (card && e.target.matches('.excluir-registro')) excluir(card.dataset.id); if (card && e.target.matches('.imprimir-registro')) imprimirRegistros(estado.registros.filter(r=>r.id===card.dataset.id),'Registro — Porto Seguro');
});
$('#abrir-apoio').addEventListener('click',()=>{location.hash='apoio';mostrarApoio('perguntas')}); $('#form-diario').addEventListener('submit',salvarRegistro); $('#cancelar-edicao').addEventListener('click',()=>{limparFormulario();status('Edição cancelada; nenhuma alteração foi salva.')}); $('#intensidade-registro').addEventListener('input',e=>$('#valor-intensidade').textContent=e.target.value); $('#intensidade-incerta').addEventListener('change',e=>{ $('#intensidade-registro').disabled=e.target.checked; $('#valor-intensidade').textContent=e.target.checked?'—':$('#intensidade-registro').value }); $('#sugerir-sentimento').addEventListener('click',sugerir);
['pesquisa','filtro-sentimento','filtro-data'].forEach(id=>$('#'+id).addEventListener('input',renderizar)); $('#limpar-filtros').addEventListener('click',()=>{$('#pesquisa').value='';$('#filtro-sentimento').value='';$('#filtro-data').value='';renderizar()}); $('#baixar-backup').addEventListener('click',baixarBackup); $('#restaurar-backup').addEventListener('click',()=>$('#arquivo-backup').click()); $('#arquivo-backup').addEventListener('change',lerBackup); $('#mesclar-backup').addEventListener('click',()=>aplicarBackup(false)); $('#substituir-backup').addEventListener('click',()=>aplicarBackup(true)); $('#cancelar-backup').addEventListener('click',()=>{estado.backup=null;fecharModal($('#tela-restauracao'))}); $('#imprimir-diario').addEventListener('click',()=>imprimirRegistros(registrosVisiveis(),'Meu diário — Porto Seguro'));
$('#form-relatorio').addEventListener('submit',gerarRelatorio); $('#imprimir-relatorio').addEventListener('click',imprimirRelatorio); $('#salvar-relatorio').addEventListener('click',salvarRelatorioAtual); $('#cancelar-relatorio').addEventListener('click',cancelarRelatorio); $('#anexar-registros-completos').addEventListener('click',anexarRegistrosCompletos); $('#texto-relatorio-editavel').addEventListener('input',atualizarContadorPalavras); $('#habilitar-ia-relatorio').addEventListener('change',e=>{$('#opcoes-ia-provedor').hidden=!e.target.checked;atualizarBotaoAprimorarIA()}); $('#aprimorar-ia-relatorio').addEventListener('click',abrirConsentimentoIA); $('#cancelar-envio-ia').addEventListener('click',()=>fecharModal($('#tela-consentimento-ia'))); $('#confirmar-envio-ia').addEventListener('click',confirmarEnvioIA); $('#pausar-respiracao').addEventListener('click',()=>{const r=estado.respiracao;r.pausada=!r.pausada;atualizarRespiracao()}); $('#parar-respiracao').addEventListener('click',pararRespiracao); $('#fechar-respiracao').addEventListener('click',pararRespiracao); $('#respirar-novamente').addEventListener('click',iniciarRespiracao); $('#registrar-apos-respirar').addEventListener('click',registrarEstrategia); $('#continuar-apoio').addEventListener('click',()=>{pararRespiracao();location.hash='apoio';mostrarApoio('perguntas')}); $$('.fechar-modal').forEach(botao=>botao.addEventListener('click',()=>fecharModal(botao.closest('.modal'))));
$('#lista-mensagens-prontas').addEventListener('click',e=>{const botao=e.target.closest('.mensagem-pronta');if(botao)escolherMensagem(botao)}); $('#abrir-whatsapp-mensagem').addEventListener('click',abrirWhatsAppMensagemRapida); $('#copiar-mensagem').addEventListener('click',copiarMensagemRapida); $('#configurar-contato-mensagem').addEventListener('click',()=>{fecharModal($('#tela-mensagem-rapida'));atualizarContato();abrirModal($('#tela-urgente'));$('#contato-nome').focus()});
$('#form-contato').addEventListener('submit',e=>{e.preventDefault();const name=$('#contato-nome').value.trim(),phone=$('#contato-telefone').value.replace(/\D/g,''),message=$('#contato-mensagem').value.trim();if(!name||phone.length<10||phone.length>15||!message)return statusUrgente('Informe nome, WhatsApp com DDI e uma mensagem.',true);try{localStorage.setItem(CHAVE_CONTATO,JSON.stringify({name,phone,message}));atualizarContato();statusUrgente('Contato e mensagem salvos somente neste navegador.')}catch{statusUrgente('Não foi possível salvar o contato.',true)}}); $('#whatsapp-confianca').addEventListener('click',()=>{const c=contato();if(!c?.phone||!c?.message){$('#contato-nome').focus();return statusUrgente('Configure e salve o contato antes de abrir o WhatsApp.',true)}const janela=window.open(`https://wa.me/${c.phone}?text=${encodeURIComponent(c.message)}`,'_blank','noopener,noreferrer');statusUrgente(janela?'WhatsApp aberto com a mensagem preenchida. Confirme o envio no próprio WhatsApp.':'O navegador bloqueou a abertura. Permita pop-ups e tente novamente.',!janela)});
$('#aumentar-fonte').addEventListener('click',e=>{const ativo=document.body.classList.toggle('fonte-grande');e.currentTarget.setAttribute('aria-pressed',ativo);e.currentTarget.textContent=ativo?'Texto padrão':'Aumentar texto'});
function atualizarBotaoTema(){const escuro=document.documentElement.dataset.theme==='dark',botao=$('#theme-toggle');botao.setAttribute('aria-label',escuro?'Ativar modo claro':'Ativar modo escuro');botao.querySelector('span').textContent=escuro?'☀️':'🌙';document.querySelector('meta[name="theme-color"]').content=escuro?'#201b2c':'#fff8fb'}
$('#theme-toggle').addEventListener('click',()=>{const tema=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=tema;try{localStorage.setItem('portoSeguro.tema.v1',tema)}catch{}atualizarBotaoTema()});atualizarBotaoTema();
document.addEventListener('keydown',e=>{const modal=$$('.modal').find(m=>!m.hidden);if(!modal){if(e.key==='Escape'&&$('#menu-principal').classList.contains('aberto'))fecharMenu(true);return}if(e.key==='Escape'){modal===$('#tela-respiracao')?pararRespiracao():modal===$('#tela-sos')?voltarAoPin():fecharModal(modal)}else prenderFoco(e,modal)});
$('#form-plano-seguranca').addEventListener('submit',salvarPlano); $('#imprimir-plano').addEventListener('click',imprimirPlano); $('#apagar-plano').addEventListener('click',apagarPlano);
$('#form-pos-crise').addEventListener('submit',salvarPosCrise); $('#limpar-pos-crise').addEventListener('click',()=>{limparPosCrise();$('#status-pos-crise').textContent='Campos limpos; nada foi salvo.';});
['antes','depois'].forEach(sufixo=>{const faixa=$(`#pos-intensidade-${sufixo}`), incerta=$(`#pos-incerta-${sufixo}`), valor=$(`#pos-valor-${sufixo}`); faixa.addEventListener('input',()=>{valor.textContent=faixa.value}); incerta.addEventListener('change',()=>{faixa.disabled=incerta.checked;valor.textContent=incerta.checked?'—':faixa.value});});
$('#form-caixa').addEventListener('submit',salvarCaixa);$('#apagar-caixa').addEventListener('click',apagarCaixa);$('#gravar-audio').addEventListener('click',gravarAudio);$('#parar-audio').addEventListener('click',pararGravacaoAudio);$('#descartar-audio').addEventListener('click',descartarAudio);$('#manter-audio').addEventListener('click',()=>{estado.manterAudio=true;$('#status-audio').textContent='Áudio e transcrição serão mantidos ao salvar o registro.'});$('#somente-transcricao').addEventListener('click',()=>{if(!confirm('Excluir definitivamente o áudio e manter somente a transcrição editável?'))return;estado.manterAudio=false;estado.audioPendente=null;if(estado.audioUrl)URL.revokeObjectURL(estado.audioUrl);estado.audioUrl=null;$('#preview-audio-diario').removeAttribute('src');$('#duracao-audio').textContent='Somente a transcrição será salva.';$('#status-audio').textContent='Áudio removido. A transcrição foi mantida.'});
$('#form-perfil').addEventListener('submit',salvarPerfil);$('#form-perfil').addEventListener('input',agendarPerfil);$('#form-perfil').addEventListener('change',agendarPerfil);$('#redefinir-perfil').addEventListener('click',redefinirPerfil);$('#nova-frase').addEventListener('click',mostrarFrase);$$('.avaliar-frase').forEach(b=>b.addEventListener('click',()=>avaliarFrase(b.dataset.avaliacao)));
$('#form-pin').addEventListener('submit',configurarPin);$('#form-desbloqueio').addEventListener('submit',desbloquear);$('#bloquear-agora').addEventListener('click',bloquearAgora);$('#remover-pin').addEventListener('click',removerPin);$('#apagar-copia-antiga').addEventListener('click',apagarCopiaAntiga);['pointerdown','keydown','touchstart'].forEach(nome=>document.addEventListener(nome,reiniciarInatividade,{passive:true}));
document.addEventListener('visibilitychange',()=>{if(document.hidden&&configuracaoPin())bloquearAgora()});
addEventListener('pageshow',evento=>{if(evento.persisted&&configuracaoPin())bloquearAgora()});
$('#alternar-menu').addEventListener('click',()=>{const aberto=$('#menu-principal').classList.toggle('aberto');$('#alternar-menu').setAttribute('aria-expanded',String(aberto))});$('#menu-principal').addEventListener('click',e=>{if(e.target.closest('a'))fecharMenu()});document.addEventListener('pointerdown',e=>{if($('#menu-principal').classList.contains('aberto')&&!e.target.closest('#menu-principal')&&!e.target.closest('#alternar-menu'))fecharMenu()});$('#sentimentos').addEventListener('change',e=>{if(!e.target.matches('input[name="sentimento"]'))return;const incerto=$('input[name="sentimento"][value="Ainda não sei dizer"]');if(e.target===incerto&&incerto.checked)$$('input[name="sentimento"]').forEach(x=>{if(x!==incerto)x.checked=false});else if(e.target.checked)incerto.checked=false;if(!$$('input[name="sentimento"]:checked').length)incerto.checked=true});addEventListener('hashchange',ativarSecao);prepararLimpezaAvancada();prepararSOS();prepararStatusUrgente();prepararSelecaoRelatorio();$('#config-sos').addEventListener('change',salvarPreferenciasSOS);$('#lista-registros').addEventListener('change',e=>{if(e.target.matches('.selecionar-registro'))alternarSelecaoRelatorio(e.target.value,e.target.checked)});$('#abrir-sos').addEventListener('click',abrirSOS);$('#voltar-pin').addEventListener('click',voltarAoPin);$('#sos-contato').addEventListener('click',ligarContatoSOS);$('#sos-whatsapp').addEventListener('click',whatsappSOS);$('#sos-respirar').addEventListener('click',()=>{$('#tela-sos').hidden=true;iniciarRespiracao()});const SR=window.SpeechRecognition||window.webkitSpeechRecognition;$('#suporte-transcricao').textContent=SR?'A transcrição só começa se a opção acima estiver marcada.':'A transcrição automática não está disponível neste navegador. Você ainda pode gravar e manter o áudio.';ativarSecao();

// --- Sincronização opcional entre aparelhos (Firebase) ---------------------
const CHAVE_MODO_CONTA = 'portoSeguro.modoConta.v1';
function modoConta() { try { return localStorage.getItem(CHAVE_MODO_CONTA); } catch { return null; } }
function definirModoConta(modo) { try { localStorage.setItem(CHAVE_MODO_CONTA, modo); } catch {} }
function sincronizacao() { const s = window.PortoSeguroSync; if (s) s.inicializar(armazenamento); return s; }

function mostrarSeletorModoConta() { if (modoConta() || bloqueioAtivo) return; abrirModal($('#tela-modo-conta')); }

let sincronizacaoNovamenteSolicitada = false;
async function tentarSincronizarAutomaticamente() {
  const s = sincronizacao();
  if (!s || !s.usuarioAtual() || !s.temChaveSincronizacao()) return;
  // Uma sincronização já está rodando: marca para rodar mais uma vez assim que
  // ela terminar, em vez de sobrepor (a trava de reentrância) ou ignorar em
  // silêncio a mudança que acabou de acontecer.
  if (s.status().emAndamento) { sincronizacaoNovamenteSolicitada = true; return; }
  do {
    sincronizacaoNovamenteSolicitada = false;
    const resultado = await s.sincronizarAgora();
    if (estado.armazenamentoPronto) await recarregarEstadoDoArmazenamento();
    if (resultado?.ok) $('#status-sync-ultima').textContent = `Última sincronização: ${formatarData(resultado.quando)}.`;
    else if (resultado?.erro) $('#status-sync-ultima').textContent = `Sincronização parcial: ${resultado.erro}`;
  } while (sincronizacaoNovamenteSolicitada);
}

function atualizarPainelSync() {
  const s = sincronizacao();
  const logado = Boolean(s?.usuarioAtual());
  $('#sync-deslogado').hidden = logado;
  $('#sync-logado').hidden = !logado;
  if (!logado) return;
  $('#status-sync-sessao').textContent = `Conectado como ${s.usuarioAtual().email || 'conta Google'}.`;
  const temChave = s.temChaveSincronizacao();
  $('#sync-pronto').hidden = !temChave;
  if (temChave) { $('#sync-precisa-chave').hidden = true; $('#sync-configurar-chave').hidden = true; return; }
  s.existeChaveSincronizacaoConfigurada().then(existe => { $('#sync-precisa-chave').hidden = !existe; $('#sync-configurar-chave').hidden = existe; });
}

$('#form-sync-entrar').addEventListener('submit', async evento => {
  evento.preventDefault();
  const s = sincronizacao(); if (!s) return $('#status-sync-conta').textContent = 'Sincronização indisponível neste navegador.';
  const email = $('#sync-email').value.trim(), senha = $('#sync-senha').value;
  if (!email || !senha) return $('#status-sync-conta').textContent = 'Informe e-mail e senha.';
  try { await s.entrarComEmailSenha(email, senha); $('#status-sync-conta').textContent = ''; $('#sync-senha').value = ''; atualizarPainelSync(); }
  catch (erro) { console.error('Login não realizado:', erro?.code || erro?.name || 'Erro'); $('#status-sync-conta').textContent = 'Não foi possível entrar. Confira o e-mail e a senha.'; }
});
$('#sync-criar-conta').addEventListener('click', async () => {
  const s = sincronizacao(); if (!s) return $('#status-sync-conta').textContent = 'Sincronização indisponível neste navegador.';
  const email = $('#sync-email').value.trim(), senha = $('#sync-senha').value;
  if (!email || senha.length < 6) return $('#status-sync-conta').textContent = 'Informe um e-mail e uma senha com pelo menos 6 caracteres.';
  try { await s.criarContaComEmailSenha(email, senha); $('#status-sync-conta').textContent = ''; $('#sync-senha').value = ''; atualizarPainelSync(); }
  catch (erro) { console.error('Conta não criada:', erro?.code || erro?.name || 'Erro'); $('#status-sync-conta').textContent = 'Não foi possível criar a conta. O e-mail já pode estar em uso, ou a senha é fraca demais.'; }
});
$('#sync-google').addEventListener('click', async () => {
  const s = sincronizacao(); if (!s) return $('#status-sync-conta').textContent = 'Sincronização indisponível neste navegador.';
  try { await s.entrarComGoogle(); $('#status-sync-conta').textContent = ''; atualizarPainelSync(); }
  catch (erro) { console.error('Login com Google não realizado:', erro?.code || erro?.name || 'Erro'); $('#status-sync-conta').textContent = 'Não foi possível entrar com o Google.'; }
});
$('#form-sync-chave').addEventListener('submit', async evento => {
  evento.preventDefault();
  const s = sincronizacao(), frase = $('#sync-chave-frase').value;
  if (!frase) return $('#status-sync-chave').textContent = 'Digite a chave de sincronização.';
  try { await s.desbloquearChaveSincronizacao(frase); $('#sync-chave-frase').value = ''; $('#status-sync-chave').textContent = ''; atualizarPainelSync(); await tentarSincronizarAutomaticamente(); }
  catch (erro) { $('#status-sync-chave').textContent = erro?.message || 'Não foi possível desbloquear a sincronização.'; }
});
$('#form-sync-nova-chave').addEventListener('submit', async evento => {
  evento.preventDefault();
  const s = sincronizacao(), chave = $('#sync-nova-chave').value, confirmacao = $('#sync-confirmar-chave').value;
  if (chave.length < 8 || chave !== confirmacao) return $('#status-sync-nova-chave').textContent = 'Use ao menos 8 caracteres e confirme a mesma chave nos dois campos.';
  try { await s.configurarChaveSincronizacaoPelaPrimeiraVez(chave); $('#sync-nova-chave').value = ''; $('#sync-confirmar-chave').value = ''; $('#status-sync-nova-chave').textContent = ''; atualizarPainelSync(); await tentarSincronizarAutomaticamente(); }
  catch (erro) { console.error('Chave de sincronização não configurada:', erro?.name || 'Erro'); $('#status-sync-nova-chave').textContent = 'Não foi possível criar a chave de sincronização agora.'; }
});
$('#sync-agora').addEventListener('click', async () => { $('#status-sync-ultima').textContent = 'Sincronizando…'; await tentarSincronizarAutomaticamente(); });
$('#sync-sair').addEventListener('click', async () => { await sincronizacao()?.sair(); atualizarPainelSync(); });
$('#modo-somente-local').addEventListener('click', () => { definirModoConta('local'); fecharModal($('#tela-modo-conta')); });
$('#modo-sincronizado').addEventListener('click', () => { definirModoConta('sincronizado'); fecharModal($('#tela-modo-conta')); location.hash = 'sincronizacao'; ativarSecao(); });
addEventListener('online', tentarSincronizarAutomaticamente);
addEventListener('load', () => { const s = sincronizacao(); s?.aoMudarSessao(() => { atualizarPainelSync(); tentarSincronizarAutomaticamente(); }); });

// Só abre o IndexedDB e roda a migração legada do localStorage (uma vez por sessão).
// Precisa concluir ANTES de qualquer operação de criptografia, que depende do banco aberto.
async function garantirBanco() {
  if (estado.bancoInicializado) return;
  const resultado = await armazenamento.inicializar({ chaveAtual: CHAVE, chaveAntiga: CHAVE_ANTIGA, versaoBackup: VERSAO, normalizarRegistro });
  estado.bancoInicializado = true;
  estado.modoArmazenamento = resultado.modo;
  estado.migracaoInicial = resultado.migracao;
}

// Recarrega o estado em memória e a interface a partir do armazenamento local.
// Usado tanto no carregamento inicial quanto depois de uma sincronização bem-sucedida,
// já que sincronizarAgora() grava direto no IndexedDB sem passar pelo estado do script.js.
async function recarregarEstadoDoArmazenamento() {
  estado.registros = await armazenamento.buscarTodos();
  estado.selecionadosRelatorio = new Set(estado.registros.map(r => r.id));
  try { estado.planoSeguranca = await armazenamento.buscarPlanoSeguranca(); preencherPlano(estado.planoSeguranca); } catch (erro) { console.error('Plano pessoal indisponível:', erro?.name || 'Erro'); }
  try { estado.caixaAcolhimento = await armazenamento.buscarCaixaAcolhimento(); preencherCaixa(estado.caixaAcolhimento); } catch (erro) { console.error('Caixa indisponível:', erro?.name || 'Erro'); }
  try { estado.perfil = await armazenamento.buscarPerfilAcolhimento(); estado.feedbackApoio = await armazenamento.buscarFeedbackApoio(); preencherPerfil(estado.perfil); preencherNomeRelatorio(); } catch (erro) { console.error('Perfil indisponível:', erro?.name || 'Erro'); }
  renderizar();
}

async function carregarDados(hashInicial) {
  alternarControlesArmazenamento(false);
  status('Preparando o armazenamento local…');
  await garantirBanco();
  const resultado = { modo: estado.modoArmazenamento, migracao: estado.migracaoInicial };
  $('#limpeza-avancada').hidden=!localStorage.getItem(CHAVE)&&!localStorage.getItem(CHAVE_ANTIGA);
  await recarregarEstadoDoArmazenamento();
  mostrarFrase();
  estado.armazenamentoPronto = true;
  alternarControlesArmazenamento(true);
  if(hashInicial){const alvo=document.getElementById(decodeURIComponent(hashInicial.slice(1)));requestAnimationFrame(()=>requestAnimationFrame(()=>alvo?.scrollIntoView({block:'start'})))}
  if (resultado.modo === 'indexeddb') {
    status(resultado.migracao.executada && resultado.migracao.quantidade > 0 ? `${resultado.migracao.quantidade} registro(s) preservado(s) no novo armazenamento local.` : 'Armazenamento local pronto.');
  } else {
    status('Não foi possível usar o novo armazenamento neste navegador. Seus dados antigos não foram apagados; o modo de segurança continua ativo. Recomendamos manter um backup.', true);
  }
  mostrarSeletorModoConta();
  tentarSincronizarAutomaticamente();
}

async function inicializarAplicacao() {
  const hashInicial=location.hash;
  const pinAtual=configuracaoPin();
  if(pinAtual){$('#tempo-bloqueio').value=String(pinAtual.minutes||5);const permitidas=new Set(pinAtual.sos||['samu','cvv','contato','whatsapp','respirar']);$$('#config-sos input').forEach(x=>x.checked=permitidas.has(x.value));$('#status-pin').textContent='PIN ativo neste aparelho.';estado.hashInicialPendente=hashInicial;bloquearAgora()}
  else{document.documentElement.classList.remove('pre-bloqueado');await carregarDados(hashInicial)}
}

const sentimentos=[...new Set($$('input[name="sentimento"]').map(x=>x.value))]; sentimentos.forEach(v=>{const o=document.createElement('option');o.value=v;o.textContent=v;$('#filtro-sentimento').append(o)}); inicializarAplicacao();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(e=>console.info('Modo offline indisponível.',e)));
